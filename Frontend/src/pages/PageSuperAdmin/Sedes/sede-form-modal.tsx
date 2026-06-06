"use client"

import { useState, useEffect } from "react"
import { X, Loader } from 'lucide-react'
import { toast } from 'sonner'
import type { Sede } from "../../../types/sede"
import { Button } from "../../../components/ui/button"
import { Input } from "../../../components/ui/input"
import { Textarea } from "../../../components/ui/textarea"

interface SedeFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (sede: Sede) => void
  sede: Sede | null
  isSaving?: boolean
}

export function SedeFormModal({ isOpen, onClose, onSave, sede,  isSaving = false }: SedeFormModalProps) {
  const [formData, setFormData] = useState<Partial<Sede>>({
    nombre: "",
    direccion: "",
    informacion_adicional: "",
    zona_horaria: "America/Bogota",
    telefono: "",
    email: "",
    activa: true
  })

  // Resetear el formulario cuando se abre/cierra el modal o cambia la sede
  useEffect(() => {
    if (isOpen) {
      if (sede) {
        // Modo edición: cargar datos de la sede existente
        setFormData({
          nombre: sede.nombre,
          direccion: sede.direccion,
          informacion_adicional: sede.informacion_adicional,
          zona_horaria: sede.zona_horaria,
          telefono: sede.telefono,
          email: sede.email,
          activa: sede.activa
        })
      } else {
        // Modo creación: resetear a valores por defecto
        setFormData({
          nombre: "",
          direccion: "",
          informacion_adicional: "",
          zona_horaria: "America/Bogota",
          telefono: "",
          email: "",
          activa: true
        })
      }
    }
  }, [sede, isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validar campos requeridos
    if (!formData.nombre || !formData.direccion || !formData.telefono || !formData.email) {
      toast.warning("Por favor completa todos los campos requeridos")
      return
    }

    try {
      if (sede) {
        // Modo edición: mantener todos los campos existentes y actualizar solo los modificados
        const sedeData: Sede = {
          ...sede, // Mantener todos los campos originales (IDs, fechas, etc.)
          nombre: formData.nombre!,
          direccion: formData.direccion!,
          informacion_adicional: formData.informacion_adicional || "",
          zona_horaria: formData.zona_horaria!,
          telefono: formData.telefono!,
          email: formData.email!,
          activa: formData.activa!
        }
        await onSave(sedeData)
      } else {
        // Modo creación: enviar solo los campos básicos, el backend generará los IDs
        const sedeData: Sede = {
          _id: "", // Será generado por el backend
          sede_id: "", // Será generado por el backend
          fecha_creacion: new Date().toISOString(), // El backend puede sobreescribir esto
          creado_por: "admin", // El backend puede sobreescribir esto
          nombre: formData.nombre!,
          direccion: formData.direccion!,
          informacion_adicional: formData.informacion_adicional || "",
          zona_horaria: formData.zona_horaria!,
          telefono: formData.telefono!,
          email: formData.email!,
          activa: true // Las nuevas sedes siempre son activas
        }
        await onSave(sedeData)
      }
    } catch (error) {
      console.error("Error al guardar la sede:", error)
      // No recargar la página si hay error
    }
  }

  // Cerrar el modal si no está abierto
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-gray-300 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-5">
          <h2 className="text-xl font-semibold text-gray-900">
            {sede ? "Editar sede" : "Añadir sede"}
          </h2>
          <button
            onClick={onClose}
            disabled={isSaving}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Nombre de la sede *
            </label>
            <Input
              type="text"
              value={formData.nombre || ""}
              onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
              className="h-10 border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus-visible:ring-gray-500"
              required
              disabled={isSaving}
              placeholder="Ej: Sede Principal"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Dirección *
            </label>
            <Input
              type="text"
              value={formData.direccion || ""}
              onChange={(e) => setFormData({ ...formData, direccion: e.target.value })}
              className="h-10 border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus-visible:ring-gray-500"
              required
              disabled={isSaving}
              placeholder="Ej: Calle 123 #45-67"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Información adicional
            </label>
            <Textarea
              value={formData.informacion_adicional || ""}
              onChange={(e) => setFormData({ ...formData, informacion_adicional: e.target.value })}
              className="min-h-[120px] border-gray-300 text-gray-900 placeholder:text-gray-400 focus-visible:border-gray-500 focus-visible:ring-gray-500"
              disabled={isSaving}
              placeholder="Información adicional sobre la sede..."
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Teléfono *
              </label>
              <Input
                type="tel"
                value={formData.telefono || ""}
                onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                className="h-10 border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus-visible:ring-gray-500"
                required
                disabled={isSaving}
                placeholder="Ej: 6011234567"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Email *
              </label>
              <Input
                type="email"
                value={formData.email || ""}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="h-10 border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus-visible:ring-gray-500"
                required
                disabled={isSaving}
                placeholder="Ej: contacto@sede.com"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Zona horaria *
            </label>
            <select
              value={formData.zona_horaria || "America/Bogota"}
              onChange={(e) => setFormData({ ...formData, zona_horaria: e.target.value })}
              className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-1 focus:ring-gray-500"
              required
              disabled={isSaving}
            >
              <option value="America/Bogota">Bogotá</option>
              <option value="Europe/Madrid">Madrid</option>
              <option value="America/New_York">New York</option>
              <option value="Europe/London">London</option>
            </select>
          </div>

          {sede && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="activa"
                checked={formData.activa || false}
                onChange={(e) => setFormData({ ...formData, activa: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500"
                disabled={isSaving}
              />
              <label htmlFor="activa" className="text-sm font-medium text-gray-700">
                Sede activa
              </label>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSaving}
              className="border-gray-300 text-gray-700 hover:bg-gray-100"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSaving}
              className="bg-black text-white hover:bg-gray-800"
            >
              {isSaving ? (
                <>
                  <Loader className="h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                sede ? "Guardar cambios" : "Crear sede"
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
