/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { formatSpeedWithUnit, type SpeedUnit } from "@/lib/speedUnits"
import { useEffect, useRef } from "react"

interface UseSpeedTitleOptions {
  downloadSpeed?: number | null
  uploadSpeed?: number | null
  speedUnit: SpeedUnit
  suffix?: string
  baseTitle?: string
  enabled?: boolean
}

export function useSpeedTitle({
  downloadSpeed = 0,
  uploadSpeed = 0,
  speedUnit,
  suffix,
  baseTitle,
  enabled = true,
}: UseSpeedTitleOptions) {
  const defaultTitleRef = useRef<string | null>(null)

  useEffect(() => {
    if (defaultTitleRef.current === null) {
      defaultTitleRef.current = baseTitle ?? document.title
      return
    }

    if (baseTitle && defaultTitleRef.current !== baseTitle) {
      defaultTitleRef.current = baseTitle
    }
  }, [baseTitle])

  useEffect(() => {
    return () => {
      if (defaultTitleRef.current !== null) {
        document.title = defaultTitleRef.current
      }
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      if (defaultTitleRef.current !== null) {
        document.title = defaultTitleRef.current
      }
      return
    }

    const safeDownloadSpeed = downloadSpeed ?? 0
    const safeUploadSpeed = uploadSpeed ?? 0
    const speedTitle = `D: ${formatSpeedWithUnit(safeDownloadSpeed, speedUnit)} U: ${formatSpeedWithUnit(safeUploadSpeed, speedUnit)}`
    const suffixTitle = suffix ? ` | ${suffix}` : ""
    const nextTitle = `${speedTitle}${suffixTitle}`

    const applyTitle = () => {
      if (document.visibilityState !== "visible") {
        return
      }
      document.title = nextTitle
    }

    applyTitle()

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        document.title = nextTitle
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [downloadSpeed, enabled, speedUnit, suffix, uploadSpeed])
}
