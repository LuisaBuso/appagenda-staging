"use client"

import { Edit, Trash2, Mail, Calendar, Building, Percent, Star, Clock } from 'lucide-react'
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
      <div className="flex h-full items-center justify-center text-gray-500">
        No hay datos del estilista disponibles
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
      {/* Header */}
      <div className="border-b bg-gradient-to-r from-blue-50 to-indigo-50 p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white text-xl font-bold shadow-lg">
              {estilista.nombre ? estilista.nombre.charAt(0).toUpperCase() : 'E'}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {estilista.nombre || 'Nombre no disponible'}
              </h1>
              <p className="text-gray-600 mt-1">
                {estilista.rol ? estilista.rol.charAt(0).toUpperCase() + estilista.rol.slice(1) : 'Rol no disponible'}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleEdit}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Edit className="h-4 w-4" />
              Editar
            </button>
            <button
              onClick={handleDelete}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              Eliminar
            </button>
          </div>
        </div>

        {/* Estado */}
        <div className="mt-4">
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
              estilista.activo
                ? 'bg-green-100 text-green-800'
                : 'bg-red-100 text-red-800'
            }`}
          >
            {estilista.activo ? 'Activo' : 'Inactivo'}
          </span>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Información básica */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Mail className="h-4 w-4 text-blue-600" />
              Información de contacto
            </h3>
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-medium text-gray-600">Email:</span>
                <p className="text-gray-900">{estilista.email || 'No disponible'}</p>
              </div>
              {/* 🔥 ELIMINADO: No mostrar ID del profesional */}
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Building className="h-4 w-4 text-green-600" />
              Información laboral
            </h3>
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-medium text-gray-600">Sede:</span>
                {/* 🔥 CORREGIDO: Mostrar nombre de la sede en lugar del ID */}
                <p className="text-gray-900">
                  {formatSedeNombre((estilista as any).sede_nombre, 'Sede no asignada')}
                </p>
              </div>
              {estilista.comision && (
                <div>
                  <span className="font-medium text-gray-600">Comisión:</span>
                  <p className="text-gray-900 flex items-center gap-1">
                    <Percent className="h-3 w-3" />
                    {estilista.comision}%
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Especialidades */}
        <div className="bg-gray-50 rounded-lg p-4">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Star className="h-4 w-4 text-yellow-600" />
            Especialidades {especialidadesCount > 0 && `(${especialidadesCount})`}
          </h3>
          
          {especialidadesCount > 0 ? (
            <div className="space-y-3">
              {/* Lista simple de especialidades */}
              <div>
                <p className="text-sm text-gray-600 mb-2">Especialidades asignadas:</p>
                <div className="flex flex-wrap gap-2">
                  {especialidades.map((especialidad, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium"
                    >
                      {especialidad}
                    </span>
                  ))}
                </div>
              </div>

              {/* Detalles de especialidades si están disponibles */}
              {especialidadesDetalle.length > 0 && (
                <div>
                  <p className="text-sm text-gray-600 mb-2">Detalles de especialidades:</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {especialidadesDetalle.map((detalle, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 p-2 bg-white rounded-lg border"
                      >
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                        <span className="text-sm text-gray-700">{detalle.nombre}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No hay especialidades asignadas</p>
          )}
        </div>

        {/* Información adicional */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-purple-600" />
              Fechas importantes
            </h3>
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-medium text-gray-600">Creado:</span>
                <p className="text-gray-900">{formatDate(estilista.created_at)}</p>
              </div>
              <div>
                <span className="font-medium text-gray-600">Actualizado:</span>
                <p className="text-gray-900">{formatDate(estilista.updated_at)}</p>
              </div>
              {estilista.created_by && (
                <div>
                  <span className="font-medium text-gray-600">Creado por:</span>
                  <p className="text-gray-900">{estilista.created_by}</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-orange-600" />
              Estadísticas
            </h3>
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-medium text-gray-600">Estado:</span>
                <p className="text-gray-900">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      estilista.activo
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {estilista.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </p>
              </div>
              <div>
                <span className="font-medium text-gray-600">Rol:</span>
                <p className="text-gray-900 capitalize">{estilista.rol || 'No definido'}</p>
              </div>
              {/* 🔥 ELIMINADO: No mostrar ID de franquicia */}
            </div>
          </div>
        </div>

        {/* Información de eliminación si existe */}
        {(estilista.deleted_at || estilista.deleted_by) && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <h3 className="font-semibold text-red-900 mb-2 flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              Información de eliminación
            </h3>
            <div className="space-y-1 text-sm text-red-700">
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
