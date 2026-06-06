"use client"

import { useState } from "react"
import { Search, MoreVertical, Edit, Trash2, User, Filter } from 'lucide-react'
import { confirmAction } from '../../../components/ui/confirm-dialog'
import type { Estilista } from "../../../types/estilista"
import { formatSedeNombre } from "../../../lib/sede"

interface EstilistasListProps {
  estilistas: Estilista[]
  selectedEstilista: Estilista | null
  onSelectEstilista: (estilista: Estilista) => void
  onEdit?: (estilista: Estilista) => void
  onDelete?: (estilista: Estilista) => void
}

export function EstilistasList({ 
  estilistas, 
  selectedEstilista, 
  onSelectEstilista,
  onEdit,
  onDelete 
}: EstilistasListProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [filterActive, setFilterActive] = useState<boolean | null>(null)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)

  // 🔥 CORREGIDO: Verificar que estilistas sea un array
  const safeEstilistas = Array.isArray(estilistas) ? estilistas : []
  
  const filteredEstilistas = safeEstilistas.filter(estilista => {
    // 🔥 CORREGIDO: Verificar que estilista no sea null/undefined
    if (!estilista) return false
    
    const matchesSearch = estilista.nombre?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         estilista.email?.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesFilter = filterActive === null || estilista.activo === filterActive
    
    return matchesSearch && matchesFilter
  })

  const toggleMenu = (id: string) => {
    setMenuOpenId(menuOpenId === id ? null : id)
  }

  const handleEdit = (estilista: Estilista, e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuOpenId(null)
    onEdit?.(estilista)
  }

  const handleDelete = async (estilista: Estilista, e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuOpenId(null)
    const confirmed = await confirmAction({ title: "Confirmar", message: `¿Estás seguro de que quieres eliminar a ${estilista.nombre}?`, confirmLabel: "Sí, eliminar", variant: "danger" });
    if (confirmed) {
      onDelete?.(estilista)
    }
  }

  // 🔥 CORREGIDO: Función segura para obtener especialidades
  const getEspecialidades = (estilista: Estilista) => {
    return Array.isArray(estilista.especialidades) ? estilista.especialidades : []
  }

  return (
    <div className="h-full flex flex-col">
      {/* Buscador elegante */}
      <div className="p-3 border-b border-gray-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar estilistas..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 text-gray-900"
          />
        </div>
      </div>

      {/* Filtros elegantes */}
      <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-500" />
          <div className="flex-1 flex gap-2">
            <button
              onClick={() => setFilterActive(null)}
              className={`flex-1 px-3 py-2 text-sm rounded-lg transition-colors ${
                filterActive === null 
                  ? 'bg-gray-800 text-white' 
                  : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'
              }`}
            >
              Todos
            </button>
            <button
              onClick={() => setFilterActive(true)}
              className={`flex-1 px-3 py-2 text-sm rounded-lg transition-colors ${
                filterActive === true 
                  ? 'bg-gray-800 text-white' 
                  : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'
              }`}
            >
              Activos
            </button>
            <button
              onClick={() => setFilterActive(false)}
              className={`flex-1 px-3 py-2 text-sm rounded-lg transition-colors ${
                filterActive === false 
                  ? 'bg-gray-800 text-white' 
                  : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'
              }`}
            >
              Inactivos
            </button>
          </div>
        </div>
      </div>

      {/* Lista de estilistas */}
      <div className="flex-1 overflow-y-auto p-1.5">
        {filteredEstilistas.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-3">
              <User className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-sm text-gray-600 mb-1">No se encontraron estilistas</p>
            {searchTerm && (
              <p className="text-xs text-gray-500">Intenta con otro término de búsqueda</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredEstilistas.map((estilista) => {
              // 🔥 CORREGIDO: Verificar que estilista sea válido
              if (!estilista) return null
              
              const especialidades = getEspecialidades(estilista)
              const especialidadesCount = especialidades.length
              const isSelected = selectedEstilista?.profesional_id === estilista.profesional_id

              return (
                <div
                  key={estilista.profesional_id}
                  onClick={() => onSelectEstilista(estilista)}
                  className={`p-2.5 cursor-pointer rounded-lg transition-all duration-200 ${
                    isSelected
                      ? 'bg-gray-100 border-l-4 border-l-gray-800 shadow-sm'
                      : 'bg-white hover:bg-gray-50 border border-gray-100 hover:border-gray-200 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Avatar/Inicial elegante */}
                    <div className={`flex-shrink-0 h-9 w-9 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                      isSelected 
                        ? 'bg-gray-800 text-white' 
                        : 'bg-gray-100 text-gray-900 group-hover:bg-gray-200'
                    }`}>
                      {estilista.nombre?.charAt(0).toUpperCase() || 'E'}
                    </div>

                    {/* Información */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className={`font-medium truncate ${
                          isSelected ? 'text-gray-900' : 'text-gray-900'
                        }`}>
                          {estilista.nombre || 'Nombre no disponible'}
                        </h3>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium transition-colors ${
                            estilista.activo
                              ? isSelected 
                                ? 'bg-green-100 text-green-800' 
                                : 'bg-green-50 text-green-700'
                              : isSelected
                                ? 'bg-gray-200 text-gray-700'
                                : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {estilista.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </div>
                      
                      <p className={`text-sm truncate mb-1.5 ${
                        isSelected ? 'text-gray-600' : 'text-gray-600'
                      }`}>
                        {estilista.email || 'Email no disponible'}
                      </p>
                      
                      <div className={`flex items-center gap-2 text-xs ${
                        isSelected ? 'text-gray-500' : 'text-gray-500'
                      }`}>
                        <span className="flex items-center gap-1">
                          <Building className="h-3 w-3" />
                          {formatSedeNombre((estilista as any).sede_nombre, 'Sede no asignada')}
                        </span>
                        {estilista.comision && (
                          <span className="flex items-center gap-1">
                            <Percent className="h-3 w-3" />
                            {estilista.comision}% comisión
                          </span>
                        )}
                      </div>

                      {especialidadesCount > 0 && (
                        <div className="mt-2">
                          <div className="flex flex-wrap gap-1.5">
                            {especialidades.slice(0, 2).map((especialidad, index) => (
                              <span
                                key={index}
                                className={`inline-block px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
                                  isSelected
                                    ? 'bg-white border border-gray-200 text-gray-700'
                                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                                }`}
                              >
                                {especialidad}
                              </span>
                            ))}
                            {especialidadesCount > 2 && (
                              <span className={`inline-block px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
                                isSelected
                                  ? 'bg-white border border-gray-200 text-gray-700'
                                  : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                              }`}>
                                +{especialidadesCount - 2}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Menú de acciones */}
                    <div className="relative flex-shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleMenu(estilista.profesional_id)
                        }}
                        className={`p-1.5 rounded-lg transition-colors ${
                          isSelected 
                            ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-200' 
                            : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                        }`}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>

                      {menuOpenId === estilista.profesional_id && (
                        <>
                          {/* Overlay para cerrar al hacer clic fuera */}
                          <div 
                            className="fixed inset-0 z-40"
                            onClick={() => setMenuOpenId(null)}
                          />
                          
                          {/* Menú */}
                          <div className="absolute right-0 top-8 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-36 py-1">
                            <button
                              onClick={(e) => handleEdit(estilista, e)}
                              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                              <Edit className="h-4 w-4" />
                              Editar
                            </button>
                            <button
                              onClick={(e) => handleDelete(estilista, e)}
                              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                              Eliminar
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Contador elegante */}
      <div className="p-2 border-t border-gray-100 bg-gray-50">
        <p className="text-xs text-gray-600 text-center font-medium">
          Mostrando {filteredEstilistas.length} de {safeEstilistas.length} estilistas
        </p>
      </div>
    </div>
  )
}

// Componentes de iconos adicionales que se necesitan
function Building({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  )
}

function Percent({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m-6 10h6m-6-4h6m4-8a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ) 
}
