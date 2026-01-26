/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { useEffect, useState } from "react"

/**
 * Hook to persist the background refresh preference in localStorage.
 */
export function usePersistedBackgroundRefresh(defaultValue: boolean = false) {
  const storageKey = "qui-background-refresh"

  const [backgroundRefreshEnabled, setBackgroundRefreshEnabled] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored !== null) {
        const parsed = JSON.parse(stored)
        return typeof parsed === "boolean" ? parsed : defaultValue
      }
    } catch (error) {
      console.error("Failed to load background refresh preference from localStorage:", error)
    }

    return defaultValue
  })

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(backgroundRefreshEnabled))
    } catch (error) {
      console.error("Failed to save background refresh preference to localStorage:", error)
    }
  }, [backgroundRefreshEnabled, storageKey])

  return [backgroundRefreshEnabled, setBackgroundRefreshEnabled] as const
}
