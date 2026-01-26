/*
 * Copyright (c) 2025-2026, s0up and the autobrr contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"
import type { ServerStateSpeeds } from "@/types"

type UseServerStateSpeedsOptions = {
  enabled?: boolean
}

export function useServerStateSpeeds(
  instanceId: number | null | undefined,
  options: UseServerStateSpeedsOptions = {}
) {
  const shouldEnable = options.enabled ?? true

  return useQuery<ServerStateSpeeds>({
    queryKey: ["server-state-speeds", instanceId],
    queryFn: () => api.getServerStateSpeeds(instanceId!),
    enabled: shouldEnable && instanceId !== null && instanceId !== undefined,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  })
}
