/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { api } from "@/lib/api"
import { formatSpeedWithUnit, useSpeedUnits } from "@/lib/speedUnits"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

interface UseTitleBarSpeedsOptions {
  mode: "dashboard" | "instance"
  instanceId?: number
  instanceName?: string
  foregroundSpeeds?: { dl: number; up: number }
}

export function useServerStateSpeeds(instanceId?: number) {
  const isEnabled = typeof instanceId === "number"

  const { data } = useQuery({
    queryKey: ["server-state-speeds", instanceId],
    queryFn: () => api.getTorrents(instanceId as number, {
      page: 0,
      limit: 1,
      sort: "added_on",
      order: "desc",
    }),
    enabled: isEnabled,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  })

  const serverState = data?.serverState

  if (!serverState) {
    return undefined
  }

  return {
    dl: serverState.dl_info_speed ?? 0,
    up: serverState.up_info_speed ?? 0,
  }
}

export function useTitleBarSpeeds({
  mode,
  instanceId,
  instanceName,
  foregroundSpeeds,
}: UseTitleBarSpeedsOptions) {
  const [speedUnit] = useSpeedUnits()
  const defaultTitleRef = useRef<string | null>(null)
  const [isHidden, setIsHidden] = useState(() => {
    if (typeof document === "undefined") {
      return false
    }

    return document.hidden
  })

  const backgroundSpeeds = useServerStateSpeeds(instanceId)
  const effectiveSpeeds = isHidden ? backgroundSpeeds : foregroundSpeeds

  useEffect(() => {
    if (typeof document === "undefined") {
      return
    }

    const handleVisibilityChange = () => {
      setIsHidden(document.hidden)
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (typeof document === "undefined") {
      return
    }

    if (defaultTitleRef.current === null) {
      defaultTitleRef.current = document.title
    }

    if (!effectiveSpeeds) {
      document.title = defaultTitleRef.current ?? ""
      return
    }

    const downloadSpeed = effectiveSpeeds.dl ?? 0
    const uploadSpeed = effectiveSpeeds.up ?? 0
    const speedTitle = `D: ${formatSpeedWithUnit(downloadSpeed, speedUnit)} U: ${formatSpeedWithUnit(uploadSpeed, speedUnit)}`

    if (mode === "dashboard") {
      document.title = `${speedTitle} | Dashboard`
    } else {
      const instanceSuffix = instanceName ? ` | ${instanceName}` : ""
      document.title = `${speedTitle}${instanceSuffix}`
    }

    return () => {
      document.title = defaultTitleRef.current ?? ""
    }
  }, [effectiveSpeeds, instanceName, mode, speedUnit])
}
