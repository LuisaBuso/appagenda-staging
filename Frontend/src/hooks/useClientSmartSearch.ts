import { useEffect, useMemo, useRef, useState } from "react"
import type { Cliente } from "../types/cliente"
import {
  dedupeClientes,
  rankClientsByRelevance,
  type RankedClient,
} from "../lib/client-search"

interface UseClientSmartSearchOptions {
  baseClientes?: Cliente[]
  fetchRemote?: (query: string) => Promise<Cliente[]>
  debounceMs?: number
  maxSuggestions?: number
  enabled?: boolean
}

const DEFAULT_DEBOUNCE_MS = 180
const DEFAULT_MAX_RESULTS = 8

export const useClientSmartSearch = (
  query: string,
  {
    baseClientes = [],
    fetchRemote,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    maxSuggestions = DEFAULT_MAX_RESULTS,
    enabled = true,
  }: UseClientSmartSearchOptions = {}
) => {
  const [results, setResults] = useState<RankedClient[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latestRequestIdRef = useRef(0)

  const trimmedQuery = useMemo(() => query.trim(), [query])

  useEffect(() => {
    if (!enabled || !trimmedQuery) {
      setResults([])
      setIsLoading(false)
      setError(null)
      return
    }

    const timeout = setTimeout(async () => {
      const requestId = ++latestRequestIdRef.current
      setIsLoading(true)
      setError(null)

      try {
        const remote = fetchRemote ? await fetchRemote(trimmedQuery) : []
        const pool = dedupeClientes([...baseClientes, ...remote])
        const ranked = rankClientsByRelevance(pool, trimmedQuery, maxSuggestions)

        if (latestRequestIdRef.current === requestId) {
          setResults(ranked)
        }
      } catch (err) {
        if (latestRequestIdRef.current === requestId) {
          setError(err instanceof Error ? err.message : "No se pudo buscar clientes")
        }
      } finally {
        if (latestRequestIdRef.current === requestId) {
          setIsLoading(false)
        }
      }
    }, debounceMs)

    return () => clearTimeout(timeout)
  }, [baseClientes, debounceMs, enabled, fetchRemote, maxSuggestions, trimmedQuery])

  return {
    results,
    isLoading,
    error,
  }
}

export type SmartSearchResult = RankedClient
