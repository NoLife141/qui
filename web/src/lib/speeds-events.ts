/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { getApiBaseUrl } from "./base-url"

export type SpeedsEventType = "connected" | "speeds_update"

export interface SpeedsEvent<T = unknown> {
  type: SpeedsEventType
  data: T
}

export interface SpeedsPayload {
  instanceId: number
  dl_info_speed: number
  up_info_speed: number
  timestamp: number
}

export interface SpeedsConnectedPayload {
  instanceId: number
  timestamp: number
}

export interface SpeedsEventHandlers {
  onConnected?: (data: SpeedsConnectedPayload) => void
  onSpeedsUpdate?: (data: SpeedsPayload) => void
  onError?: (error: Event) => void
  onDisconnected?: () => void
  onReconnecting?: (info: { attempt: number; delayMs: number }) => void
  onMaxReconnectAttempts?: () => void
}

export class SpeedsEventSource {
  private eventSource: EventSource | null = null
  private instanceId: number
  private handlers: SpeedsEventHandlers
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private baseReconnectDelay = 1000
  private isIntentionalClose = false

  constructor(instanceId: number, handlers: SpeedsEventHandlers) {
    this.instanceId = instanceId
    this.handlers = handlers
  }

  connect(): void {
    if (this.eventSource) {
      this.disconnect()
    }

    this.isIntentionalClose = false
    const url = `${getApiBaseUrl()}/instances/${this.instanceId}/speeds/events`

    try {
      this.eventSource = new EventSource(url, { withCredentials: true })

      this.eventSource.addEventListener("connected", (event) => {
        this.reconnectAttempts = 0
        try {
          const parsed = JSON.parse(event.data) as SpeedsEvent<SpeedsConnectedPayload>
          this.handlers.onConnected?.(parsed.data)
        } catch (e) {
          console.error("Failed to parse speeds connected event", e)
        }
      })

      this.eventSource.addEventListener("speeds_update", (event) => {
        try {
          const parsed = JSON.parse(event.data) as SpeedsEvent<SpeedsPayload>
          this.handlers.onSpeedsUpdate?.(parsed.data)
        } catch (e) {
          console.error("Failed to parse speeds update event", e)
        }
      })

      this.eventSource.onerror = (error) => {
        this.handlers.onError?.(error)

        if (!this.isIntentionalClose) {
          this.scheduleReconnect()
        }
      }
    } catch (error) {
      console.error("Failed to create speeds EventSource", error)
      this.scheduleReconnect()
    }
  }

  disconnect(): void {
    this.isIntentionalClose = true

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
      this.handlers.onDisconnected?.()
    }

    this.reconnectAttempts = 0
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("Speeds SSE max reconnection attempts reached")
      this.handlers.onMaxReconnectAttempts?.()
      return
    }

    if (this.reconnectTimer) {
      return
    }

    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }

    const attempt = this.reconnectAttempts + 1
    const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts)
    this.reconnectAttempts = attempt

    this.handlers.onReconnecting?.({ attempt, delayMs: delay })

    console.debug(`Speeds SSE reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN
  }
}
