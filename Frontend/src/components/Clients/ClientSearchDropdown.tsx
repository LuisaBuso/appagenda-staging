"use client"

import { memo } from "react"
import { Loader2 } from "lucide-react"
import type { Cliente } from "../../types/cliente"
import { getLastVisitLabel, type RankedClient } from "../../lib/client-search"

interface ClientSearchDropdownProps {
  suggestions: RankedClient[]
  isLoading: boolean
  error: string | null
  searchValue: string
  onSelectSuggestion: (client: Cliente) => void
  highlight: (text: string, query: string) => React.ReactNode
}

export const ClientSearchDropdown = memo(function ClientSearchDropdown({
  suggestions,
  isLoading,
  error,
  searchValue,
  onSelectSuggestion,
  highlight,
}: ClientSearchDropdownProps) {
  return (
    <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-lg border border-gray-200 bg-white shadow-xl">
      {isLoading && (
        <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-gray-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
          <span>Buscando clientes...</span>
        </div>
      )}

      {!isLoading && error && (
        <div className="px-3 py-2.5 text-xs text-red-600">No se pudo buscar: {error}</div>
      )}

      {!isLoading && !error && suggestions.length === 0 && (
        <div className="px-3 py-2.5 text-xs text-gray-500">
          Sin resultados para &ldquo;{searchValue}&rdquo;
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="max-h-72 overflow-auto divide-y divide-gray-100">
          {suggestions.map((result) => {
            const cliente = result.cliente
            const avatar =
              (cliente as any).foto ||
              (cliente as any).foto_url ||
              (cliente as any).imagen ||
              (cliente as any).image_url
            const initial = cliente.nombre?.charAt(0)?.toUpperCase() || "C"

            return (
              <button
                key={cliente.id}
                type="button"
                className="w-full px-3 py-2.5 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
                onMouseDown={(e) => {
                  e.preventDefault()
                  onSelectSuggestion(cliente)
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {avatar ? (
                      <img src={avatar} alt={cliente.nombre} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-sm font-semibold text-gray-700">{initial}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-gray-900 text-sm truncate">
                        {highlight(cliente.nombre, searchValue)}
                      </div>
                      <span className="text-[11px] text-gray-500 whitespace-nowrap">
                        {getLastVisitLabel(cliente)}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 flex flex-wrap gap-2 mt-0.5">
                      <span className="truncate max-w-[140px]">
                        {highlight(cliente.telefono || "—", searchValue)}
                      </span>
                      {cliente.cedula && (
                        <span className="truncate max-w-[120px]">
                          {highlight(cliente.cedula, searchValue)}
                        </span>
                      )}
                      {cliente.email && (
                        <span className="truncate max-w-[140px] text-gray-400">
                          {highlight(cliente.email, searchValue)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
})
