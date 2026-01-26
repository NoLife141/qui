// Copyright (c) 2025-2026, s0up and the autobrr contributors.
// SPDX-License-Identifier: GPL-2.0-or-later

package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/autobrr/qui/internal/qbittorrent"
)

// SpeedsSSEHandler manages Server-Sent Events for per-instance speed updates.
type SpeedsSSEHandler struct {
	syncManager *qbittorrent.SyncManager

	mu      sync.RWMutex
	clients map[int]map[*speedsSSEClient]struct{}

	pollerMu sync.Mutex
	pollers  map[int]context.CancelFunc
}

type speedsSSEClient struct {
	instanceID int
	events     chan speedsSSEEvent
	done       chan struct{}
	closeOnce  sync.Once
}

type speedsSSEEvent struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

const (
	speedsEventConnected = "connected"
	speedsEventUpdate    = "speeds_update"
)

type speedsPayload struct {
	InstanceID    int   `json:"instanceId"`
	DownloadSpeed int64 `json:"dl_info_speed"`
	UploadSpeed   int64 `json:"up_info_speed"`
	Timestamp     int64 `json:"timestamp"`
}

// NewSpeedsSSEHandler creates a new speeds SSE handler.
func NewSpeedsSSEHandler(syncManager *qbittorrent.SyncManager) *SpeedsSSEHandler {
	return &SpeedsSSEHandler{
		syncManager: syncManager,
		clients:     make(map[int]map[*speedsSSEClient]struct{}),
		pollers:     make(map[int]context.CancelFunc),
	}
}

// HandleSSE handles the SSE connection for speed updates.
func (h *SpeedsSSEHandler) HandleSSE(w http.ResponseWriter, r *http.Request) {
	instanceID, err := parseInstanceID(w, r)
	if err != nil {
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		RespondError(w, http.StatusInternalServerError, "Streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	client := &speedsSSEClient{
		instanceID: instanceID,
		events:     make(chan speedsSSEEvent, 16),
		done:       make(chan struct{}),
	}

	h.addClient(instanceID, client)
	defer h.removeClient(instanceID, client)

	h.ensurePoller(instanceID)

	if err := h.sendEvent(w, flusher, speedsSSEEvent{
		Type: speedsEventConnected,
		Data: map[string]any{
			"instanceId": instanceID,
			"timestamp":  time.Now().Unix(),
		},
	}); err != nil {
		log.Debug().Err(err).Int("instanceID", instanceID).Msg("Speeds SSE failed to send connected event")
		return
	}

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-client.done:
			return
		case event := <-client.events:
			if err := h.sendEvent(w, flusher, event); err != nil {
				log.Debug().Err(err).Int("instanceID", instanceID).Msg("Speeds SSE send error")
				return
			}
		}
	}
}

func (h *SpeedsSSEHandler) sendEvent(w http.ResponseWriter, flusher http.Flusher, event speedsSSEEvent) error {
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}

	_, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Type, data)
	if err != nil {
		return err
	}

	flusher.Flush()
	return nil
}

func (h *SpeedsSSEHandler) addClient(instanceID int, client *speedsSSEClient) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.clients[instanceID] == nil {
		h.clients[instanceID] = make(map[*speedsSSEClient]struct{})
	}
	h.clients[instanceID][client] = struct{}{}

	log.Debug().Int("instanceID", instanceID).Int("clients", len(h.clients[instanceID])).Msg("Speeds SSE client connected")
}

func (c *speedsSSEClient) closeDone() {
	c.closeOnce.Do(func() {
		close(c.done)
	})
}

func (h *SpeedsSSEHandler) removeClient(instanceID int, client *speedsSSEClient) {
	client.closeDone()

	shouldStopPoller := false

	h.mu.Lock()
	if h.clients[instanceID] != nil {
		delete(h.clients[instanceID], client)
		if len(h.clients[instanceID]) == 0 {
			delete(h.clients, instanceID)
			shouldStopPoller = true
		}
	}
	h.mu.Unlock()

	if shouldStopPoller {
		h.stopPoller(instanceID)
	}

	log.Debug().Int("instanceID", instanceID).Msg("Speeds SSE client disconnected")
}

func (h *SpeedsSSEHandler) broadcast(instanceID int, event speedsSSEEvent) {
	h.mu.RLock()
	clientsCopy := make([]*speedsSSEClient, 0, len(h.clients[instanceID]))
	for client := range h.clients[instanceID] {
		clientsCopy = append(clientsCopy, client)
	}
	h.mu.RUnlock()

	for _, client := range clientsCopy {
		select {
		case client.events <- event:
		default:
			log.Debug().Int("instanceID", instanceID).Msg("Speeds SSE client buffer full")
		}
	}
}

func (h *SpeedsSSEHandler) ensurePoller(instanceID int) {
	h.pollerMu.Lock()
	defer h.pollerMu.Unlock()

	if _, exists := h.pollers[instanceID]; exists {
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	h.pollers[instanceID] = cancel

	go h.pollLoop(ctx, instanceID)
}

func (h *SpeedsSSEHandler) stopPoller(instanceID int) {
	h.pollerMu.Lock()
	defer h.pollerMu.Unlock()

	if cancel, exists := h.pollers[instanceID]; exists {
		cancel()
		delete(h.pollers, instanceID)
		log.Debug().Int("instanceID", instanceID).Msg("Speeds SSE poller stopped")
	}
}

func (h *SpeedsSSEHandler) pollLoop(ctx context.Context, instanceID int) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	var lastDownload int64
	var lastUpload int64
	var hadState bool

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			state, err := h.syncManager.GetCachedServerState(ctx, instanceID)
			if err != nil {
				if errors.Is(err, qbittorrent.ErrInstanceDisabled) {
					log.Debug().Int("instanceID", instanceID).Msg("Speeds SSE instance disabled")
					return
				}
				log.Debug().Err(err).Int("instanceID", instanceID).Msg("Speeds SSE failed to fetch server state")
				continue
			}

			var downloadSpeed int64
			var uploadSpeed int64
			hasState := false
			if state != nil {
				downloadSpeed = state.DlInfoSpeed
				uploadSpeed = state.UpInfoSpeed
				hasState = true
			}

			if hasState == hadState && downloadSpeed == lastDownload && uploadSpeed == lastUpload {
				continue
			}

			lastDownload = downloadSpeed
			lastUpload = uploadSpeed
			hadState = hasState

			h.broadcast(instanceID, speedsSSEEvent{
				Type: speedsEventUpdate,
				Data: speedsPayload{
					InstanceID:    instanceID,
					DownloadSpeed: downloadSpeed,
					UploadSpeed:   uploadSpeed,
					Timestamp:     time.Now().Unix(),
				},
			})
		}
	}
}
