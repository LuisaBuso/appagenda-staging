"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "../../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card"
import { API_BASE_URL } from "../../../types/config"
import { Calendar } from "lucide-react"
import { formatDateDMY } from "../../../lib/dateFormat"
import type { DateRange } from "./sales-metrics"

interface Appointment {
  _id: string
  cliente: string
  cliente_nombre: string
  cliente_id?: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  servicio: string
  servicio_nombre: string
  estilista?: string
  profesional_nombre: string
  estado: string
  sede_id: string
  valor_total?: number
  estado_pago?: string
  abono?: number
  saldo_pendiente?: number
}

interface ApiResponse {
  total: number
  sede_id: string
  citas: Appointment[]
}

interface TodayAppointmentsProps {
  onSelectAppointment: (appointment: Appointment) => void
  selectedAppointmentId?: string
  period: string
  dateRange: DateRange
  onVisibleAppointmentIdsChange?: (ids: string[]) => void
}

const PERIOD_LABELS: Record<string, string> = {
  today: "Hoy",
  last_7_days: "7 días",
  last_30_days: "30 días",
  month: "Mes actual",
  custom: "Rango personalizado",
}

const BILLING_VISIBLE_STATES = new Set([
  "finalizado",
  "finalizada",
  "completada",
  "completado",
])

const toYmd = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

const getGlobalRange = (period: string, dateRange: DateRange): DateRange => {
  const today = new Date()
  const todayYmd = toYmd(today)

  if (period === "custom" && dateRange.start_date && dateRange.end_date) {
    return {
      start_date: dateRange.start_date,
      end_date: dateRange.end_date,
    }
  }

  if (period === "last_7_days") {
    const start = new Date(today)
    start.setDate(start.getDate() - 6)
    return { start_date: toYmd(start), end_date: todayYmd }
  }

  if (period === "last_30_days") {
    const start = new Date(today)
    start.setDate(start.getDate() - 29)
    return { start_date: toYmd(start), end_date: todayYmd }
  }

  if (period === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1)
    return { start_date: toYmd(start), end_date: todayYmd }
  }

  return { start_date: todayYmd, end_date: todayYmd }
}

const formatAmountNoDecimals = (value: number | undefined) => {
  const safeValue = Number.isFinite(value) ? Number(value) : 0
  return Math.round(safeValue).toLocaleString("es-CO", { maximumFractionDigits: 0 })
}

const getAppointmentDate = (appointment: Appointment): string => {
  return String(appointment.fecha || "").split("T")[0]
}

const getAppointmentTimestamp = (appointment: Appointment): number => {
  const datePart = getAppointmentDate(appointment)
  const timePart = appointment.hora_inicio || "00:00"
  const date = new Date(`${datePart}T${timePart}:00`)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

const getEstadoColor = (estado: string) => {
  const estadoLower = (estado || "").toLowerCase()

  if (estadoLower.includes("cancel")) {
    return {
      bg: "bg-red-100",
      text: "text-red-700",
      border: "border-red-200",
      label: "Cancelado",
    }
  }

  if (estadoLower.includes("factur")) {
    return {
      bg: "bg-gray-100",
      text: "text-gray-800",
      border: "border-gray-300",
      label: "Facturado",
    }
  }

  if (["finalizado", "finalizada", "completado", "completada", "terminado", "terminada", "realizado", "realizada"].some(flag => estadoLower.includes(flag))) {
    return {
      bg: "bg-orange-100",
      text: "text-orange-800",
      border: "border-orange-200",
      label: "Finalizado",
    }
  }

  if (estadoLower.includes("no asist")) {
    return {
      bg: "bg-yellow-100",
      text: "text-yellow-800",
      border: "border-yellow-200",
      label: "No asistió",
    }
  }

  if (["confirmada", "confirmado", "agendada", "agendado", "reservada", "reservado", "pendiente", "en proceso", "en_proceso", "proceso"].some(flag => estadoLower.includes(flag))) {
    return {
      bg: "bg-green-100",
      text: "text-green-700",
      border: "border-green-200",
      label: "Agendada / Confirmada",
    }
  }

  return {
    bg: "bg-gray-100",
    text: "text-gray-800",
    border: "border-gray-200",
    label: estado || "Estado",
  }
}

export function TodayAppointments({
  onSelectAppointment,
  selectedAppointmentId,
  period,
  dateRange,
  onVisibleAppointmentIdsChange,
}: TodayAppointmentsProps) {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const appliedRange = useMemo(() => getGlobalRange(period, dateRange), [period, dateRange])
  const periodLabel = PERIOD_LABELS[period] || "Período"
  const rangeLabel = `${formatDateDMY(appliedRange.start_date)} - ${formatDateDMY(appliedRange.end_date)}`

  const applyGlobalFilter = (source: Appointment[]) => {
    const filtered = source
      .filter((appointment) => {
        const estado = String(appointment.estado || "").toLowerCase()
        if (!BILLING_VISIBLE_STATES.has(estado)) {
          return false
        }

        const citaFecha = getAppointmentDate(appointment)
        if (!citaFecha) {
          return false
        }

        return citaFecha >= appliedRange.start_date && citaFecha <= appliedRange.end_date
      })
      .sort((a, b) => getAppointmentTimestamp(b) - getAppointmentTimestamp(a))

    setAppointments(filtered)
    onVisibleAppointmentIdsChange?.(filtered.map((appointment) => appointment._id))
  }

  const fetchCitas = async () => {
    try {
      setLoading(true)
      setError(null)

      const token = localStorage.getItem("access_token") || sessionStorage.getItem("access_token")

      if (!token) {
        setError("No se encontró token de autenticación")
        return
      }

      const response = await fetch(`${API_BASE_URL}scheduling/quotes/`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      })

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`)
      }

      const data: ApiResponse | Appointment[] = await response.json()
      const citas = Array.isArray(data)
        ? data
        : Array.isArray(data.citas)
          ? data.citas
          : []
      applyGlobalFilter(citas)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar citas")
      onVisibleAppointmentIdsChange?.([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchCitas()
  }, [period, appliedRange.start_date, appliedRange.end_date])

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Citas finalizados</CardTitle>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Calendar className="h-4 w-4" />
            <span>{periodLabel}: {rangeLabel}</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="py-8 text-center">
            <p className="text-gray-500">Cargando citas finalizados...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Citas finalizados</CardTitle>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Calendar className="h-4 w-4" />
            <span>{periodLabel}: {rangeLabel}</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="py-8 text-center">
            <p className="text-red-500">{error}</p>
            <Button onClick={() => void fetchCitas()} variant="outline" className="mt-4">
              Reintentar
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Citas finalizados</CardTitle>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Calendar className="h-4 w-4" />
          <span>{periodLabel}: {rangeLabel}</span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {appointments.length === 0 ? (
          <div className="py-8 text-center">
            <Calendar className="mx-auto mb-4 h-12 w-12 text-gray-300" />
            <p className="text-gray-500">No hay citas finalizados para el período seleccionado</p>
            <p className="mt-2 text-sm text-gray-400">
              Cambia el filtro de período para consultar más resultados.
            </p>
          </div>
        ) : (
          appointments.map((appointment) => {
            const isSelected = appointment._id === selectedAppointmentId
            const nombreProfesional = appointment.profesional_nombre || appointment.estilista || "Profesional no asignado"
            const nombreServicio = appointment.servicio_nombre || appointment.servicio
            const nombreCliente = appointment.cliente_nombre || appointment.cliente
            const estadoConfig = getEstadoColor(appointment.estado)

            return (
              <div
                key={appointment._id}
                className={`flex items-center justify-between rounded-lg border p-4 ${
                  isSelected
                    ? "border-[oklch(0.55_0.25_280)] bg-[oklch(0.55_0.25_280)/0.1]"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="flex-1">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="font-semibold">{nombreProfesional}</p>
                    <span className={`rounded-full border px-2 py-1 text-xs ${estadoConfig.bg} ${estadoConfig.text} ${estadoConfig.border}`}>
                      {estadoConfig.label}
                    </span>
                  </div>

                  <p className="mb-1 text-sm text-gray-600">
                    {formatDateDMY(getAppointmentDate(appointment))} · {appointment.hora_inicio}–{appointment.hora_fin}
                  </p>
                  <p className="mb-1 text-sm text-gray-500">{nombreServicio}</p>
                  <p className="mb-1 text-xs text-gray-400">Cliente: {nombreCliente}</p>

                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
                    {appointment.valor_total !== undefined && (
                      <div className="flex items-center gap-1">
                        <span className="font-medium">Valor:</span>
                        <span className="font-semibold">${formatAmountNoDecimals(appointment.valor_total)}</span>
                      </div>
                    )}
                    {appointment.estado_pago && (
                      <div className="flex items-center gap-1">
                        <span className="font-medium">Pago:</span>
                        <span
                          className={`font-semibold ${
                            appointment.estado_pago.toLowerCase() === "pagado"
                              ? "text-green-600"
                              : appointment.estado_pago.toLowerCase() === "pendiente"
                              ? "text-yellow-600"
                              : "text-gray-600"
                          }`}
                        >
                          {appointment.estado_pago}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-3">
                  <span className="rounded bg-gray-100 px-2 py-1 text-sm font-medium">
                    {appointment.hora_inicio}
                  </span>

                  <Button
                    variant={isSelected ? "default" : "outline"}
                    size="sm"
                    onClick={() => onSelectAppointment(appointment)}
                    className="min-w-[100px]"
                  >
                    {appointment.estado_pago?.toLowerCase() === "pagado" ? "Ver Detalle" : "Facturar"}
                  </Button>
                </div>
              </div>
            )
          })
        )}

        <div className="border-t pt-2 text-xs text-gray-400">
          <div className="flex items-center justify-between">
            <p>Mostrando citas finalizados para: {rangeLabel}</p>
            <p className="font-medium text-green-600">
              Total: {appointments.length} finalizado{appointments.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
