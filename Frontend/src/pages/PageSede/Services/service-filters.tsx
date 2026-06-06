"use client"

import { Input } from "../../../components/ui/input"
import { Search } from 'lucide-react'

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
    <div className="mb-6 flex flex-wrap gap-4">
      {/* Search */}
      <div className="relative flex-1 min-w-[300px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          placeholder="Buscar servicios..."
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          className="pl-10 bg-white border-gray-300"
        />
      </div>

      {/* Category Filter - Usando select nativo */}
      <div className="relative w-[180px]">
        <select
          value={filters.categoria}
          onChange={(e) => onFiltersChange({ ...filters, categoria: e.target.value })}
          className="w-full h-10 px-3 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none cursor-pointer"
        >
          <option value="all">Todas las categorías</option>
          <option value="Cortes">Cortes</option>
          <option value="Coloración">Coloración</option>
          <option value="Barba">Barba</option>
          <option value="Tratamientos">Tratamientos</option>
          <option value="Peinados">Peinados</option>
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
          <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
            <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
          </svg>
        </div>
      </div>

      {/* Status Filter - Usando select nativo */}
      <div className="relative w-[180px]">
        <select
          value={filters.activo}
          onChange={(e) => onFiltersChange({ ...filters, activo: e.target.value })}
          className="w-full h-10 px-3 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none cursor-pointer"
        >
          <option value="all">Todos los estados</option>
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
          <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
            <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
          </svg>
        </div>
      </div>
    </div>
  )
}