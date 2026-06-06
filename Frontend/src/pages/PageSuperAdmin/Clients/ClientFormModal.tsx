"use client"

import { useState, useEffect } from "react"
import { X } from "lucide-react"
import { Button } from "../../../components/ui/button"
import { crearCliente } from "../../../components/Quotes/clientsService"
import { useAuth } from "../../../components/Auth/AuthContext"
import { DatePicker } from "../../../components/ui/DatePicker"
interface ClientFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => Promise<void>
  isSaving?: boolean
  sedeId: string
}

export function ClientFormModal({ isOpen, onClose, onSuccess, isSaving = false, sedeId }: ClientFormModalProps) {
  const { user, activeSedeId } = useAuth()
  const [formData, setFormData] = useState({
    nombre: "",
    correo: "",
    telefono: "",
    cedula: "",
    ciudad: "",
    fecha_de_nacimiento: "",
    notas: ""
  })

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [localIsSaving, setLocalIsSaving] = useState(false)
  const resolvedSedeId = String(
    sedeId ||
      activeSedeId ||
      user?.sede_id ||
      sessionStorage.getItem("beaux-sede_id") ||
      localStorage.getItem("beaux-sede_id") ||
      ""
  ).trim()

  // Resetear form cuando se abre
  useEffect(() => {
    if (isOpen) {
      setFormData({
        nombre: "",
        correo: "",
        telefono: "",
        cedula: "",
        ciudad: "",
        fecha_de_nacimiento: "",
        notas: ""
      })
      setError(null)
      setSuccess(false)
    }
  }, [isOpen])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalIsSaving(true)
    setError(null)
    setSuccess(false)

    try {
      // Validaciones básicas
      if (!formData.nombre.trim()) {
        throw new Error('El nombre es requerido')
      }

      if (!user?.access_token) {
        throw new Error('No hay sesión activa')
      }

      const clienteData = {
        nombre: formData.nombre.trim(),
        ...(formData.correo?.trim() ? { correo: formData.correo.trim() } : {}),
        ...(formData.telefono?.trim() ? { telefono: formData.telefono.trim() } : {}),
        ...(formData.cedula?.trim() ? { cedula: formData.cedula.trim() } : {}),
        ...(formData.ciudad?.trim() ? { ciudad: formData.ciudad.trim() } : {}),
        ...(formData.fecha_de_nacimiento?.trim() ? { fecha_de_nacimiento: formData.fecha_de_nacimiento.trim() } : {}),
        ...(resolvedSedeId ? { sede_id: resolvedSedeId } : {}),
        ...(formData.notas?.trim() ? { notas: formData.notas.trim() } : {})
      }

      console.log('📤 Creando cliente:', clienteData)

      // Llamar a crearCliente
      const result = await crearCliente(user.access_token, clienteData)

      if (result.success) {
        setSuccess(true)
        await onSuccess()
        onClose()
      } else {
        throw new Error('No se pudo crear el cliente')
      }

    } catch (err: any) {
      console.error('❌ Error creando cliente:', err)
      setError(err.message || "Error al crear cliente")
    } finally {
      setLocalIsSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-lg border border-gray-100 bg-white shadow-sm max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-medium text-gray-900">Nuevo Cliente</h2>
          <button
            onClick={onClose}
            disabled={localIsSaving || isSaving}
            className="p-1 hover:bg-gray-50 rounded disabled:opacity-50"
          >
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">
              Nombre completo *
            </label>
            <input
              name="nombre"
              type="text"
              value={formData.nombre}
              onChange={handleChange}
              required
              disabled={localIsSaving || isSaving}
              className="w-full h-8 text-sm border border-gray-300 rounded px-2 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:opacity-50"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-gray-700 mb-1 block">
                Cédula
              </label>
              <input
                name="cedula"
                type="text"
                value={formData.cedula}
                onChange={handleChange}
                disabled={localIsSaving || isSaving}
                className="w-full h-8 text-sm border border-gray-300 rounded px-2 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:opacity-50"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700 mb-1 block">
                Teléfono
              </label>
              <input
                name="telefono"
                type="tel"
                value={formData.telefono}
                onChange={handleChange}
                disabled={localIsSaving || isSaving}
                className="w-full h-8 text-sm border border-gray-300 rounded px-2 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">
              Correo electrónico
            </label>
            <input
              name="correo"
              type="email"
              value={formData.correo}
              onChange={handleChange}
              disabled={localIsSaving || isSaving}
              className="w-full h-8 text-sm border border-gray-300 rounded px-2 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">
              Ciudad
            </label>
            <input
              name="ciudad"
              type="text"
              value={formData.ciudad}
              onChange={handleChange}
              disabled={localIsSaving || isSaving}
              className="w-full h-8 text-sm border border-gray-300 rounded px-2 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">
              Fecha de Nacimiento
            </label>
            <DatePicker
              value={formData.fecha_de_nacimiento}
              onChange={(v) => handleChange({ target: { name: "fecha_de_nacimiento", value: v } } as any)}
              disabled={localIsSaving || isSaving}
              popoverPosition="up"
              fromYear={1920}
              toYear={new Date().getFullYear()}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">
              Notas
            </label>
            <textarea
              name="notas"
              value={formData.notas}
              onChange={handleChange}
              disabled={localIsSaving || isSaving}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:opacity-50 resize-none min-h-[60px]"
              rows={3}
            />
          </div>

          {/* Mensajes de estado */}
          {error && (
            <div className="rounded-md bg-red-50 p-3 border border-red-200">
              <div className="flex">
                <div className="ml-3">
                  <h3 className="text-xs font-medium text-red-800">Error</h3>
                  <div className="text-xs text-red-700 mt-1 whitespace-pre-wrap">{error}</div>
                </div>
              </div>
            </div>
          )}

          {success && (
            <div className="rounded-md bg-green-50 p-3 border border-green-200">
              <div className="flex">
                <div className="ml-3">
                  <h3 className="text-xs font-medium text-green-800">¡Éxito!</h3>
                  <p className="text-xs text-green-700 mt-1">Cliente creado exitosamente</p>
                </div>
              </div>
            </div>
          )}

          {/* Botones */}
          <div className="flex justify-end gap-2 pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="text-xs border-gray-300 text-gray-700 hover:bg-gray-50"
              disabled={localIsSaving || isSaving}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="text-xs bg-gray-900 hover:bg-gray-800 text-white"
              disabled={localIsSaving || isSaving}
            >
              {(localIsSaving || isSaving) ? "Creando..." : "Crear Cliente"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
