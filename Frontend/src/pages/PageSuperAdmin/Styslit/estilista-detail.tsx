"use client"

import { Edit, Trash2, Mail, Calendar, Building, Percent, Star, Clock, User } from 'lucide-react'
import { Button } from "../../../components/ui/button"
import { confirmAction } from '../../../components/ui/confirm-dialog'
import type { Estilista } from "../../../types/estilista"
import { formatSedeNombre } from "../../../lib/sede"
import { formatDateDMY } from "../../../lib/dateFormat"

interface EstilistaDetailProps {
  estilista: Estilista
  onEdit?: (estilista: Estilista) => void
  onDelete?: (estilista: Estilista) => void
}

export function EstilistaDetail({ estilista, onEdit, onDelete }: EstilistaDetailProps) {
  // 🔥 CORREGIDO: Verificaciones de seguridad
  if (!estilista) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
          <User className="h-8 w-8 text-gray-400" />
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">No hay datos del estilista</h3>
        <p className="text-sm text-gray-600 text-center max-w-sm">
          Selecciona un estilista de la lista para ver sus detalles
        </p>
      </div>
    )
  }

  // 🔥 CORREGIDO: Función segura para obtener especialidades
  const getEspecialidades = () => {
    return Array.isArray(estilista.especialidades) ? estilista.especialidades : []
  }

  const getEspecialidadesDetalle = () => {
    return Array.isArray(estilista.especialidades_detalle) ? estilista.especialidades_detalle : []
  }

  const especialidades = getEspecialidades()
  const especialidadesDetalle = getEspecialidadesDetalle()
  const especialidadesCount = especialidades.length

  const handleEdit = () => {
    onEdit?.(estilista)
  }

  const handleDelete = async () => {
    const confirmed = await confirmAction({ title: "Confirmar", message: `¿Estás seguro de que quieres eliminar a ${estilista.nombre || 'este estilista'}?`, confirmLabel: "Sí, eliminar", variant: "danger" });
    if (confirmed) {
      onDelete?.(estilista)
    }
  }

  const formatDate = (dateString: string) => formatDateDMY(dateString, 'No disponible')

  return (
    <div className="h-full overflow-y-auto bg-white">
      {/* Header minimalista */}
      <div className="border-b border-gray-100 p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-gray-900 rounded-full flex items-center justify-center text-white text-lg font-medium">
              {estilista.nombre ? estilista.nombre.charAt(0).toUpperCase() : 'E'}
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">
                {estilista.nombre || 'Nombre no disponible'}
              </h1>
              <p className="text-sm text-gray-600 mt-0.5">
                {estilista.rol ? estilista.rol.charAt(0).toUpperCase() + estilista.rol.slice(1) : 'Rol no disponible'}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            {onEdit && (
              <Button
                onClick={handleEdit}
                variant="outline"
                size="sm"
                className="border-black bg-black text-white hover:bg-gray-900 hover:text-white"
              >
                <Edit className="h-4 w-4 mr-2" />
                Editar
              </Button>
            )}
            {onDelete && (
              <Button
                onClick={handleDelete}
                variant="outline"
                size="sm"
                className="border-gray-300 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Eliminar
              </Button>
            )}
          </div>
        </div>

        {/* Estado */}
        <div className="inline-flex">
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              estilista.activo
                ? 'bg-gray-100 text-gray-800'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {estilista.activo ? 'Activo' : 'Inactivo'}
          </span>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {/* Grid de información */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Información de contacto */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <Mail className="h-4 w-4 text-gray-600" />
              </div>
              <h3 className="font-medium text-gray-900">Contacto</h3>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 mb-1">Email</p>
                <p className="text-sm text-gray-900 font-medium">{estilista.email || '—'}</p>
              </div>
            </div>
          </div>

          {/* Información laboral */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <Building className="h-4 w-4 text-gray-600" />
              </div>
              <h3 className="font-medium text-gray-900">Laboral</h3>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 mb-1">Sede</p>
                <p className="text-sm text-gray-900 font-medium">
                  {formatSedeNombre((estilista as any).sede_nombre, 'Sede no asignada')}
                </p>
              </div>
              {estilista.comision && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">Comisión</p>
                  <div className="flex items-center gap-1">
                    <Percent className="h-3.5 w-3.5 text-gray-600" />
                    <p className="text-sm text-gray-900 font-medium">{estilista.comision}%</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Fechas */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <Calendar className="h-4 w-4 text-gray-600" />
              </div>
              <h3 className="font-medium text-gray-900">Fechas</h3>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 mb-1">Creado</p>
                <p className="text-sm text-gray-900">{formatDate(estilista.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Actualizado</p>
                <p className="text-sm text-gray-900">{formatDate(estilista.updated_at)}</p>
              </div>
            </div>
          </div>

          {/* Estadísticas */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <Clock className="h-4 w-4 text-gray-600" />
              </div>
              <h3 className="font-medium text-gray-900">Detalles</h3>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 mb-1">Rol</p>
                <p className="text-sm text-gray-900 capitalize">{estilista.rol || 'No definido'}</p>
              </div>
              {estilista.created_by && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">Creado por</p>
                  <p className="text-sm text-gray-900">{estilista.created_by}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Especialidades */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <Star className="h-4 w-4 text-gray-600" />
              </div>
              <h3 className="font-medium text-gray-900">
                Especialidades {especialidadesCount > 0 && `(${especialidadesCount})`}
              </h3>
            </div>
          </div>
          
          {especialidadesCount > 0 ? (
            <div className="space-y-3">
              {/* Lista de especialidades */}
              <div>
                <p className="text-xs text-gray-500 mb-2">Asignadas</p>
                <div className="flex flex-wrap gap-2">
                  {especialidades.map((especialidad, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center px-2.5 py-1 bg-gray-100 text-gray-800 rounded-full text-xs font-medium"
                    >
                      {especialidad}
                    </span>
                  ))}
                </div>
              </div>

              {/* Detalles de especialidades */}
              {especialidadesDetalle.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">Detalles</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {especialidadesDetalle.map((detalle, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 p-2 bg-gray-50 rounded border border-gray-100"
                      >
                        <div className="w-1.5 h-1.5 bg-gray-400 rounded-full"></div>
                        <span className="text-sm text-gray-700">{detalle.nombre}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-gray-500">No hay especialidades asignadas</p>
            </div>
          )}
        </div>

        {/* Información de eliminación */}
        {(estilista.deleted_at || estilista.deleted_by) && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center">
                <Trash2 className="h-3 w-3 text-gray-600" />
              </div>
              <h3 className="text-sm font-medium text-gray-900">Eliminación</h3>
            </div>
            <div className="space-y-1 text-sm text-gray-600">
              {estilista.deleted_at && (
                <p>Eliminado el: {formatDate(estilista.deleted_at)}</p>
              )}
              {estilista.deleted_by && (
                <p>Eliminado por: {estilista.deleted_by}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
