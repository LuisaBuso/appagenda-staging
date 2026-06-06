// components/modals/EditClientModal.tsx
import { useState, useEffect } from 'react'
import { X, Loader2 } from 'lucide-react'
import { Button } from "../../../components/ui/button"
import { clientesService, UpdateClienteData } from "./clientesService"
import { DatePicker } from "../../../components/ui/DatePicker"

interface EditClientModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
    cliente: {
        id: string
        cliente_id?: string
        nombre: string
        correo?: string
        telefono?: string
        cedula?: string
        ciudad?: string
        fecha_de_nacimiento?: string
        notas?: string
    }
    token: string
}

const normalizeDateForInput = (value?: string) => {
    if (!value) return ''
    const trimmed = value.trim()
    if (!trimmed) return ''

    // Ya está en formato de input date.
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

    // Soporta fechas con slash (mm/dd/yyyy o dd/mm/yyyy).
    const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (slashMatch) {
        const first = Number(slashMatch[1])
        const second = Number(slashMatch[2])
        const year = Number(slashMatch[3])
        let month = first
        let day = second

        // Si el primer valor supera 12, inferimos dd/mm/yyyy.
        if (first > 12 && second <= 12) {
            day = first
            month = second
        }

        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        }
    }

    const parsed = new Date(trimmed)
    if (!Number.isNaN(parsed.getTime())) {
        const y = parsed.getFullYear()
        const m = String(parsed.getMonth() + 1).padStart(2, '0')
        const d = String(parsed.getDate()).padStart(2, '0')
        return `${y}-${m}-${d}`
    }

    return ''
}

export function EditClientModal({ isOpen, onClose, onSuccess, cliente, token }: EditClientModalProps) {
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState(false)

    // Obtener sede_id del sessionStorage
    const sedeId = sessionStorage.getItem('beaux-sede_id')

    // Form state con todos los campos
    const [formData, setFormData] = useState<UpdateClienteData>({
        cliente_id: '',
        nombre: '',
        correo: '',
        telefono: '',
        cedula: '',
        ciudad: '',
        fecha_de_nacimiento: '',
        notas: '',
        sede_id: sedeId || ''
    })

    // Inicializar form con datos del cliente
    useEffect(() => {
        if (cliente && isOpen) {
            setFormData({
                cliente_id: cliente.cliente_id || cliente.id,
                nombre: cliente.nombre || '',
                correo: cliente.correo || '',
                telefono: cliente.telefono || '',
                cedula: cliente.cedula || '',
                ciudad: cliente.ciudad || '',
                fecha_de_nacimiento: normalizeDateForInput(cliente.fecha_de_nacimiento),
                notas: cliente.notas || '',
                sede_id: sedeId || ''
            })
            setError(null)
            setSuccess(false)
        }
    }, [cliente, isOpen, sedeId])

    if (!isOpen) return null

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target
        setFormData(prev => ({
            ...prev,
            [name]: value
        }))
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)
        setError(null)
        setSuccess(false)

        try {
            // Validaciones básicas
            if (!formData.nombre?.trim()) {
                throw new Error('El nombre es requerido')
            }

            // Si hay fecha, validar formato aaaa-mm-dd
            if (formData.fecha_de_nacimiento && formData.fecha_de_nacimiento.trim() !== '') {
                const dateRegex = /^\d{4}-\d{2}-\d{2}$/
                if (!dateRegex.test(formData.fecha_de_nacimiento)) {
                    throw new Error('La fecha debe tener el formato aaaa-mm-dd (ej: 1990-12-25)')
                }

                const [year, month, day] = formData.fecha_de_nacimiento.split('-')
                const monthNum = parseInt(month, 10)
                const dayNum = parseInt(day, 10)
                const yearNum = parseInt(year, 10)

                if (monthNum < 1 || monthNum > 12) {
                    throw new Error('El mes debe estar entre 01 y 12')
                }
                if (dayNum < 1 || dayNum > 31) {
                    throw new Error('El día debe estar entre 01 y 31')
                }
                if (yearNum < 1900 || yearNum > new Date().getFullYear()) {
                    throw new Error(`El año debe estar entre 1900 y ${new Date().getFullYear()}`)
                }
            }

            // Preparar datos para enviar
            const updateData: UpdateClienteData = {
                cliente_id: formData.cliente_id || cliente.id,
                nombre: formData.nombre?.trim(),
                correo: formData.correo?.trim() || '',
                telefono: formData.telefono?.trim() || '',
                cedula: formData.cedula?.trim() || '',
                ciudad: formData.ciudad?.trim() || '',
                fecha_de_nacimiento: formData.fecha_de_nacimiento?.trim() || '', // Enviar como está
                notas: formData.notas?.trim() || '',
                sede_id: formData.sede_id || sedeId || ''
            }

            console.log('📤 Actualizando cliente:', updateData)

            await clientesService.updateCliente(token, cliente.id, updateData)

            setSuccess(true)
            setTimeout(() => {
                onSuccess()
                onClose()
            }, 1500)

        } catch (err: any) {
            console.error('❌ Error actualizando cliente:', err)
            setError(err.message || 'Error al actualizar el cliente')
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="relative w-full max-w-2xl rounded-lg bg-white shadow-lg">
                {/* Header */}
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900">Editar Cliente</h2>
                        <p className="text-sm text-gray-500">Modifica la información del cliente</p>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={isLoading}
                        className="rounded-full p-1 hover:bg-gray-100 disabled:opacity-50"
                    >
                        <X className="h-5 w-5 text-gray-500" />
                    </button>
                </div>

                {/* Form - Scrollable */}
                <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Información Básica */}
                        <div>
                            <h3 className="mb-4 text-sm font-medium text-gray-900">Información Básica</h3>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div className="sm:col-span-2">
                                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                                        Nombre completo *
                                    </label>
                                    <input
                                        type="text"
                                        name="nombre"
                                        value={formData.nombre || ''}
                                        onChange={handleChange}
                                        required
                                        disabled={isLoading}
                                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:cursor-not-allowed disabled:bg-gray-50"
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                                        Correo electrónico
                                    </label>
                                    <input
                                        type="email"
                                        name="correo"
                                        value={formData.correo || ''}
                                        onChange={handleChange}
                                        disabled={isLoading}
                                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:cursor-not-allowed disabled:bg-gray-50"
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                                        Teléfono
                                    </label>
                                    <input
                                        type="tel"
                                        name="telefono"
                                        value={formData.telefono || ''}
                                        onChange={handleChange}
                                        disabled={isLoading}
                                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:cursor-not-allowed disabled:bg-gray-50"
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                                        Cédula / Identificación
                                    </label>
                                    <input
                                        type="text"
                                        name="cedula"
                                        value={formData.cedula || ''}
                                        onChange={handleChange}
                                        disabled={isLoading}
                                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:cursor-not-allowed disabled:bg-gray-50"
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                                        Ciudad
                                    </label>
                                    <input
                                        type="text"
                                        name="ciudad"
                                        value={formData.ciudad || ''}
                                        onChange={handleChange}
                                        disabled={isLoading}
                                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:cursor-not-allowed disabled:bg-gray-50"
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                                        Fecha de Nacimiento
                                    </label>
                                    <DatePicker
                                        value={formData.fecha_de_nacimiento || ''}
                                        onChange={(v) => handleChange({ target: { name: "fecha_de_nacimiento", value: v } } as any)}
                                        disabled={isLoading}
                                        fromYear={1920}
                                        toYear={new Date().getFullYear()}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Información Adicional */}
                        <div>
                            <h3 className="mb-4 text-sm font-medium text-gray-900">Información Adicional</h3>
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                                    Notas adicionales
                                </label>
                                <textarea
                                    name="notas"
                                    value={formData.notas || ''}
                                    onChange={handleChange}
                                    disabled={isLoading}
                                    rows={4}
                                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:cursor-not-allowed disabled:bg-gray-50"
                                />
                            </div>
                        </div>

                        {/* Información del Sistema (solo lectura) */}
                        {/* <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <h3 className="mb-3 text-sm font-medium text-gray-700">Información del Sistema</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">ID del Cliente</label>
                  <p className="text-sm font-medium text-gray-900">{cliente.id}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Sede ID</label>
                  <p className="text-sm font-medium text-gray-900">{sedeId || 'No asignada'}</p>
                </div>
              </div>
            </div> */}

                        {/* Mensajes de estado */}
                        {error && (
                            <div className="rounded-md bg-red-50 p-4">
                                <div className="flex">
                                    <div className="ml-3">
                                        <h3 className="text-sm font-medium text-red-800">Error</h3>
                                        <p className="text-sm text-red-700 mt-1">{error}</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {success && (
                            <div className="rounded-md bg-green-50 p-4">
                                <div className="flex">
                                    <div className="ml-3">
                                        <h3 className="text-sm font-medium text-green-800">¡Éxito!</h3>
                                        <p className="text-sm text-green-700 mt-1">Cliente actualizado exitosamente</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </form>
                </div>

                {/* Footer */}
                <div className="sticky bottom-0 border-t border-gray-200 bg-white px-6 py-4">
                    <div className="flex justify-end gap-3">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onClose}
                            disabled={isLoading}
                            className="border-gray-300 text-gray-700 hover:bg-gray-50"
                        >
                            Cancelar
                        </Button>
                        <Button
                            type="submit"
                            onClick={handleSubmit}
                            disabled={isLoading}
                            className="bg-gray-900 hover:bg-gray-800 text-white"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Guardando...
                                </>
                            ) : (
                                'Guardar cambios'
                            )}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}
