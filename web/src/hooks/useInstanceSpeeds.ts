/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { SpeedsEventSource, type SpeedsPayload } from "@/lib/speeds-events"

type SSEStatus = "disabled" | "connecting" | "live" | "reconnecting" | "disconnected"

export function useInstanceSpeeds(instanceId: number, enabled: boolean = true) {
  const [speeds, setSpeeds] = useState<SpeedsPayload | null>(null)
  const [sseStatus, setSseStatus] = useState<SSEStatus>("disabled")
  const [sseReconnectAttempt, setSseReconnectAttempt] = useState(0)
  const eventSourceRef = useRef<SpeedsEventSource | null>(null)

  useEffect(() => {
    if (!enabled || instanceId <= 0) {
      setSseStatus("disabled")
      setSseReconnectAttempt(0)
      return
    }

    const eventSource = new SpeedsEventSource(instanceId, {
      onSpeedsUpdate: (data) => {
        setSpeeds(data)
      },
      onConnected: () => {
        setSseStatus("live")
        setSseReconnectAttempt(0)
      },
      onDisconnected: () => {
        setSseStatus("disconnected")
      },
      onError: () => {
        setSseStatus("reconnecting")
      },
      onReconnecting: ({ attempt }) => {
        setSseStatus("reconnecting")
        setSseReconnectAttempt(attempt)
      },
      onMaxReconnectAttempts: () => {
        setSseStatus("disconnected")
      },
    })

    setSseStatus("connecting")
    eventSource.connect()
    eventSourceRef.current = eventSource

    return () => {
      eventSource.disconnect()
      eventSourceRef.current = null
      setSseStatus("disabled")
      setSseReconnectAttempt(0)
    }
  }, [enabled, instanceId])

  return { speeds, sseStatus, sseReconnectAttempt }
}

export function useInstancesSpeeds(instanceIds: number[], enabled: boolean = true) {
  const idsKey = useMemo(() => instanceIds.join(","), [instanceIds])
  const [speedsByInstance, setSpeedsByInstance] = useState<Record<number, SpeedsPayload>>({})
  const sourcesRef = useRef<Map<number, SpeedsEventSource>>(new Map())

  useEffect(() => {
    if (!enabled || instanceIds.length === 0) {
      sourcesRef.current.forEach((source) => source.disconnect())
      sourcesRef.current.clear()
      setSpeedsByInstance({})
      return
    }

    const activeIds = new Set(instanceIds)

    sourcesRef.current.forEach((source, id) => {
      if (!activeIds.has(id)) {
        source.disconnect()
        sourcesRef.current.delete(id)
      }
    })

    instanceIds.forEach((id) => {
      if (sourcesRef.current.has(id)) {
        return
      }

      const source = new SpeedsEventSource(id, {
        onSpeedsUpdate: (data) => {
          setSpeedsByInstance((prev) => ({ ...prev, [id]: data }))
        },
      })

      source.connect()
      sourcesRef.current.set(id, source)
    })

    return () => {
      sourcesRef.current.forEach((source) => source.disconnect())
      sourcesRef.current.clear()
    }
  }, [enabled, idsKey, instanceIds])

  return speedsByInstance
}
