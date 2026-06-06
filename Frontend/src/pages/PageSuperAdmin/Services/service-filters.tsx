
"use client"

import { Search } from "lucide-react";

interface ServiceFiltersProps {
  filters: {
    search: string
    categoria: string
    activo: string
  }
  onFiltersChange: (filters: any) => void
}

export function ServiceFilters({ filters, onFiltersChange }: ServiceFiltersProps) {
  return (
    <div className="mb-6 space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Buscar servicios..."
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          className="w-full pl-10 pr-3 py-2 text-sm border border-gray-300 focus:outline-none focus:border-gray-400"
        />
      </div>

      <div className="flex gap-2">
        <select
          value={filters.categoria}
          onChange={(e) => onFiltersChange({ ...filters, categoria: e.target.value })}
          className="flex-1 px-3 py-2 text-sm border border-gray-300 focus:outline-none focus:border-gray-400"
        >
          <option value="all">Todas las categorías</option>
          <option value="Cortes">Cortes</option>
          <option value="Coloración">Coloración</option>
          <option value="Barba">Barba</option>
          <option value="Tratamientos">Tratamientos</option>
          <option value="Peinados">Peinados</option>
        </select>

        <select
          value={filters.activo}
          onChange={(e) => onFiltersChange({ ...filters, activo: e.target.value })}
          className="flex-1 px-3 py-2 text-sm border border-gray-300 focus:outline-none focus:border-gray-400"
        >
          <option value="all">Todos los estados</option>
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
        </select>
      </div>
    </div>
  )
}