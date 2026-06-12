// app/(protected)/admin-sede/ventas/Billing.tsx
"use client"

import { useState, useEffect, useMemo } from "react"
import { ShoppingBag, Search, FileText } from "lucide-react"
import { Sidebar } from "../../../components/Layout/Sidebar"
import { Button } from "../../../components/ui/button"
import { Skeleton } from "../../../components/ui/skeleton"
import { DirectSaleModal } from "./DirectSaleModal"
import { ServiceProtocol } from "./service-protocol"
import { FacturaDetailModal } from "../Sales-invoiced/factura-detail-modal"
import type { Factura } from "../../../types/factura"
import { FacturaService } from "../Sales-invoiced/facturas"
import { DEFAULT_PERIOD } from "../../../lib/period"
import { toLocalYMD } from "../../../lib/dateFormat"
import { useAuth } from "../../../components/Auth/AuthContext"
import {
  formatCurrencyMetric,
  type PaymentMethodTotals,
} from "./salesMetricsApi"
import { API_BASE_URL } from "../../../types/config"
import { getStoredCurrency } from "../../../lib/currency"
import { PeriodoSelector, type PeriodoId } from "../../../components/ui/PeriodoSelector"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Appointment {
  _id: string
  cliente: string
  cliente_id?: string
  cliente_nombre?: string
  cliente_telefono?: string
  telefono_cliente?: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  servicio: string
  servicio_nombre?: string
  servicios?: Array<{
    servicio_id: string
    nombre: string
    precio: number
    precio_personalizado?: boolean
  }>
  precio_total?: number
  estilista?: string
  profesional_nombre?: string
  productos?: Array<{
    producto_id: string
    nombre: string
    cantidad: number
    precio_unitario: number
    subtotal: number
    moneda: string
    comision_porcentaje: number
    comision_valor: number
    agregador_por: string
    agregado_por_rol: string
    profesional_id: string
  }>
  estado: string
  sede_id: string
  sede_nombre?: string
  valor_total?: number
  estado_pago?: string
  estado_factura?: string
  abono?: number
  saldo_pendiente?: number
  historial_pagos?: Array<{
    fecha: string
    monto: number
    metodo: string
    tipo: string
    registrado_por: string
    saldo_despues: number
    notas?: string
  }>
  ficha_realizada?: boolean
  date?: string
  appointment_date?: string
  tipo_origen?: string
}

interface DateRange {
  start_date: string
  end_date: string
}

type FilterStatus = "pendientes" | "facturadas"

// ─── Constants ────────────────────────────────────────────────────────────────

// All terminal states the backend may return for a finished appointment.
// Mirrors the logic in getEstadoColor() from today-appointments.tsx, plus facturado.
const BILLING_VISIBLE_STATES = new Set([
  "finalizado",
  "finalizada",
  "completado",
  "completada",
  "terminado",
  "terminada",
  "realizado",
  "realizada",
  "facturado",
  "facturada",
])


// ─── Helpers ──────────────────────────────────────────────────────────────────

const toYmd = (date: Date): string => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

const getGlobalRange = (period: string, dr: DateRange): DateRange => {
  const today = new Date()
  const todayYmd = toYmd(today)
  if (period === "custom" && dr.start_date && dr.end_date) return dr
  if (period === "last_7_days") {
    const s = new Date(today)
    s.setDate(s.getDate() - 6)
    return { start_date: toYmd(s), end_date: todayYmd }
  }
  if (period === "last_30_days") {
    const s = new Date(today)
    s.setDate(s.getDate() - 29)
    return { start_date: toYmd(s), end_date: todayYmd }
  }
  if (period === "month") {
    const s = new Date(today.getFullYear(), today.getMonth(), 1)
    return { start_date: toYmd(s), end_date: todayYmd }
  }
  return { start_date: todayYmd, end_date: todayYmd }
}

const getAppointmentDate = (a: Appointment): string => {
  const raw = String(a.fecha || a.date || a.appointment_date || "")
  if (!raw) return toLocalYMD(new Date())
  return raw.split("T")[0]
}

const getTimestamp = (a: Appointment): number => {
  const d = `${getAppointmentDate(a)}T${a.hora_inicio || "00:00"}:00`
  const t = new Date(d).getTime()
  return isNaN(t) ? 0 : t
}

const isFacturada = (a: Pick<Appointment, "estado_factura">): boolean =>
  a.estado_factura?.toLowerCase() === "facturado"

const getInitials = (name: string): string =>
  name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()

const fmtCOP = (n: number | undefined): string =>
  "$" +
  Math.round(n ?? 0).toLocaleString("es-CO", { maximumFractionDigits: 0 })

// ─── Component ────────────────────────────────────────────────────────────────

export default function Billing() {
  const { user, isAuthenticated, activeSedeId } = useAuth()
  const isRecepcionista =
    String(user?.role ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_") === "recepcionista"

  // ── Period ────────────────────────────────────────────────────────────────
  const [period, setPeriod] = useState(DEFAULT_PERIOD)
  const [dateRange, setDateRange] = useState<DateRange>({
    start_date: "",
    end_date: "",
  })
  const [periodoActivo, setPeriodoActivo] = useState<PeriodoId>("hoy")
  const [rangoAplicado, setRangoAplicado] = useState<{ from: Date; to: Date } | undefined>(undefined)

  const PERIODO_TO_PERIOD: Record<PeriodoId, string> = {
    hoy: "today",
    "7dias": "last_7_days",
    mes: "month",
    "30dias": "last_30_days",
    rango: "custom",
  }

  // ── Appointments ──────────────────────────────────────────────────────────
  const [allAppointments, setAllAppointments] = useState<Appointment[]>([])
  const [loadingAppointments, setLoadingAppointments] = useState(true)
  const [errorAppointments, setErrorAppointments] = useState<string | null>(
    null,
  )

  // ── Metrics ───────────────────────────────────────────────────────────────
  const [metrics, setMetrics] = useState({
    ventas_totales: 0,
    ventas_servicios: 0,
    ventas_productos: 0,
  })
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodTotals>({
    efectivo: 0,
    transferencia: 0,
    tarjeta: 0,
    tarjeta_credito: 0,
    tarjeta_debito: 0,
    sin_pago: 0,
    otros: 0,
    addi: 0,
    giftcard: 0,
    link_de_pago: 0,
    descuento_nomina: 0,
    abono_transferencia: 0,
  })
  const [loadingMetrics, setLoadingMetrics] = useState(true)
  const [currency, setCurrency] = useState(getStoredCurrency("USD"))
  const [metricsRefreshKey, setMetricsRefreshKey] = useState(0)

  // ── UI ────────────────────────────────────────────────────────────────────
  const [selectedAppointment, setSelectedAppointment] =
    useState<Appointment | null>(null)
  const [showDirectSaleModal, setShowDirectSaleModal] = useState(false)
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("pendientes")
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedFactura, setSelectedFactura] = useState<Factura | null>(null)
  const [showFacturaModal, setShowFacturaModal] = useState(false)
  const [cachedFacturas, setCachedFacturas] = useState<Factura[]>([])


  const appliedRange = useMemo(
    () => getGlobalRange(period, dateRange),
    [period, dateRange],
  )

  const periodRangeLabel = useMemo(() => {
    const fmt = (ymd: string) => {
      const [y, m, d] = ymd.split("-").map(Number)
      return new Date(y, m - 1, d).toLocaleDateString("es-CO", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    }
    const { start_date, end_date } = appliedRange
    if (!start_date || !end_date) return ""
    if (start_date === end_date) return fmt(start_date)
    // Different dates: "10 de abril – 16 de abril de 2026"
    const [sy, sm] = start_date.split("-").map(Number)
    const [ey, em] = end_date.split("-").map(Number)
    const startOpts: Intl.DateTimeFormatOptions =
      sy !== ey || sm !== em
        ? { day: "numeric", month: "long", year: "numeric" }
        : { day: "numeric", month: "long" }
    const startStr = new Date(sy, sm - 1, Number(start_date.split("-")[2])).toLocaleDateString(
      "es-CO",
      startOpts,
    )
    return `${startStr} – ${fmt(end_date)}`
  }, [appliedRange])

  // ── Fetch appointments ────────────────────────────────────────────────────
  const fetchAppointments = async () => {
    try {
      setLoadingAppointments(true)
      setErrorAppointments(null)
      const token =
        localStorage.getItem("access_token") ||
        sessionStorage.getItem("access_token")
      if (!token) {
        setErrorAppointments("No se encontró token de autenticación")
        return
      }
      const res = await fetch(`${API_BASE_URL}scheduling/quotes/`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      })
      if (!res.ok) throw new Error(`Error ${res.status}: ${res.statusText}`)

      const data = await res.json()
      const citas: Appointment[] = Array.isArray(data)
        ? data
        : Array.isArray(data.citas)
          ? data.citas
          : []

      const BILLING_INCLUDES = [
        "finaliz", "complet", "terminad", "realizad", "factur",
      ]
      const isBillingVisible = (estado: string) => {
        const e = String(estado || "").toLowerCase()
        return (
          BILLING_VISIBLE_STATES.has(e) ||
          BILLING_INCLUDES.some((prefix) => e.includes(prefix))
        )
      }

      const filtered = citas
        .filter((a) => {
          if (!isBillingVisible(a.estado)) return false
          // Include all billing-visible appointments: facturadas appear in the
          // Facturadas tab; non-facturadas appear in Pendientes/Pagadas tabs.
          const fecha = getAppointmentDate(a)
          return (
            fecha >= appliedRange.start_date && fecha <= appliedRange.end_date
          )
        })
        .sort((a, b) => getTimestamp(b) - getTimestamp(a))

      setAllAppointments(filtered)
    } catch (err) {
      setErrorAppointments(
        err instanceof Error ? err.message : "Error al cargar citas",
      )
    } finally {
      setLoadingAppointments(false)
    }
  }

  // ── Compute metrics from cachedFacturas (all sales: citas + ventas directas)
  const computeMetricsFromFacturas = (facturas: Factura[]) => {
    let totalServicios = 0, totalProductos = 0
    const aggPay: PaymentMethodTotals = {
      efectivo: 0, transferencia: 0, tarjeta: 0, tarjeta_credito: 0, tarjeta_debito: 0,
      sin_pago: 0, otros: 0, addi: 0, giftcard: 0, link_de_pago: 0, descuento_nomina: 0, abono_transferencia: 0,
    }
    const METHOD_MAP: Record<string, keyof PaymentMethodTotals> = {
      efectivo: "efectivo", transferencia: "transferencia", tarjeta: "tarjeta",
      tarjeta_credito: "tarjeta_credito", tarjeta_debito: "tarjeta_debito",
      addi: "addi", giftcard: "giftcard", gift_card: "giftcard",
      link_de_pago: "link_de_pago", link_pago: "link_de_pago",
      descuento_nomina: "descuento_nomina", descuento_por_nomina: "descuento_nomina",
      abono_transferencia: "abono_transferencia",
    }
    for (const f of facturas) {
      for (const item of f.items || []) {
        if (item.tipo === "servicio") totalServicios += item.subtotal || 0
        else totalProductos += item.subtotal || 0
      }
      if (f.historial_pagos) {
        for (const p of f.historial_pagos) {
          const key = METHOD_MAP[(p.metodo || "").toLowerCase().replace(/[\s-]+/g, "_")]
          if (key) aggPay[key] += p.monto || 0
          else aggPay.otros += p.monto || 0
        }
      }
    }
    const totalVentas = totalServicios + totalProductos
    setMetrics({ ventas_totales: totalVentas, ventas_servicios: totalServicios, ventas_productos: totalProductos })
    setPaymentMethods(aggPay)
    setLoadingMetrics(false)
  }

  // ── Load metrics ──────────────────────────────────────────────────────────
  const loadMetrics = () => {
    if (isRecepcionista) return
    setLoadingMetrics(true)
    computeMetricsFromFacturas(cachedFacturas)
  }

  const fetchFacturasForRange = async () => {
    try {
      const sedeId =
        activeSedeId ||
        (user?.sede_id as string) ||
        sessionStorage.getItem("beaux-sede_id") ||
        localStorage.getItem("beaux-sede_id") ||
        ""
      if (!sedeId) return
      const service = new FacturaService()
      const result = await service.buscarFacturas({
        fecha_desde: appliedRange.start_date,
        fecha_hasta: appliedRange.end_date,
        limit: 200,
      })
      setCachedFacturas(result.facturas as Factura[])
    } catch {
      setCachedFacturas([])
    }
  }

  useEffect(() => {
    void fetchAppointments()
    void fetchFacturasForRange()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedRange.start_date, appliedRange.end_date])

  useEffect(() => {
    loadMetrics()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cachedFacturas, metricsRefreshKey])

  // Close panel if selected appointment is filtered out by period change
  useEffect(() => {
    if (
      selectedAppointment &&
      !allAppointments.find((a) => a._id === selectedAppointment._id)
    ) {
      setSelectedAppointment(null)
    }
  }, [allAppointments, selectedAppointment])

  // ── Ventas directas facturadas (from cachedFacturas) ───────────────────────
  const ventasDirectasFacturadas = useMemo(() => {
    const isVentaDirecta = (f: Factura) => {
      const items = f.items || []
      if (items.length === 0) return false
      return items.every((i) => i.tipo === "producto")
    }
    return cachedFacturas
      .filter((f) => f.estado === "pagado" && isVentaDirecta(f))
      .map((f): Appointment => {
        const itemNames = (f.items || []).map((i) => i.nombre).filter(Boolean)
        return {
          _id: f.venta_id || f.identificador,
          cliente: f.nombre_cliente || "",
          cliente_nombre: f.nombre_cliente || "Sin cliente",
          cliente_id: f.cliente_id,
          cliente_telefono: f.telefono_cliente,
          fecha: (f.fecha_pago || "").split("T")[0],
          hora_inicio: "",
          hora_fin: "",
          servicio: itemNames[0] || "Venta directa",
          servicio_nombre: itemNames.length > 1 ? `${itemNames[0]} +${itemNames.length - 1}` : itemNames[0] || "Venta directa",
          estilista: f.vendido_por || f.profesional_nombre || "—",
          profesional_nombre: f.vendido_por || f.profesional_nombre || "—",
          estado: "facturado",
          estado_factura: "facturado",
          estado_pago: "pagado",
          sede_id: f.sede_id,
          sede_nombre: f.local,
          valor_total: f.total,
          precio_total: f.total,
          abono: f.total,
          saldo_pendiente: 0,
          historial_pagos: f.historial_pagos?.map((p) => ({ ...p, notas: p.notas || "" })),
          ficha_realizada: false,
          tipo_origen: "venta_directa",
        }
      })
  }, [cachedFacturas, allAppointments])

  // ── Filtered + searched list ──────────────────────────────────────────────
  const filteredAppointments = useMemo(() => {
    let result: Appointment[]
    if (filterStatus === "pendientes") {
      result = allAppointments.filter((a) => {
        const estadoFactura = (a.estado_factura ?? "").toLowerCase()
        const estadoCita = (a.estado ?? "").toLowerCase()
        const noFacturada = estadoFactura !== "facturado"
        const estilistaFinalizo = ["completada", "finalizado", "finalizada", "completado", "terminado", "terminada", "realizado", "realizada"].includes(estadoCita)
        return noFacturada && estilistaFinalizo
      })
    } else {
      const citasFacturadas = allAppointments.filter((a) => isFacturada(a))
      result = [...citasFacturadas, ...ventasDirectasFacturadas]
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((a) => {
        const prof = (a.profesional_nombre || a.estilista || "").toLowerCase()
        const cli = (a.cliente_nombre || a.cliente || "").toLowerCase()
        const svc = (a.servicio_nombre || a.servicio || "").toLowerCase()
        return prof.includes(q) || cli.includes(q) || svc.includes(q)
      })
    }
    return result
  }, [allAppointments, ventasDirectasFacturadas, filterStatus, searchQuery])

  // ── Bottom bar stats ──────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const citasFacturadas = allAppointments.filter((a) => isFacturada(a))
    const pendientes = allAppointments.filter((a) => {
      const estadoFactura = (a.estado_factura ?? "").toLowerCase()
      const estadoCita = (a.estado ?? "").toLowerCase()
      const noFacturada = estadoFactura !== "facturado"
      const estilistaFinalizo = ["completada", "finalizado", "finalizada", "completado", "terminado", "terminada", "realizado", "realizada"].includes(estadoCita)
      return noFacturada && estilistaFinalizo
    })
    return {
      facturadas: citasFacturadas.length + ventasDirectasFacturadas.length,
      pendientes: pendientes.length,
    }
  }, [allAppointments, ventasDirectasFacturadas])

  const fmt = (n: number) => formatCurrencyMetric(n, currency)

  const filterChips: { id: FilterStatus; label: string; count: number }[] = [
    { id: "facturadas", label: "Facturadas", count: stats.facturadas },
    { id: "pendientes", label: "Pendientes", count: stats.pendientes },
  ]

  const handlePeriodoChange = (periodo: PeriodoId, fechas?: { from: Date; to: Date }) => {
    setPeriodoActivo(periodo)
    setPeriod(PERIODO_TO_PERIOD[periodo])
    if (periodo === "rango" && fechas) {
      setRangoAplicado(fechas)
      // ✅ DEBUG: Verify custom range dates
      console.log('[Billing] Custom range applied:', {
        from: fechas.from,
        to: fechas.to,
        from_month: fechas.from.getMonth(),
        to_month: fechas.to.getMonth(),
      })
      setDateRange({
        start_date: toYmd(fechas.from),
        end_date: toYmd(fechas.to),
      })
    }
  }

  const buildFacturaFromAppointment = (a: Appointment): Factura => {
    const servicios = a.servicios || []
    const productos = a.productos || []
    const items = [
      ...servicios.map((s) => ({
        tipo: "servicio",
        servicio_id: s.servicio_id,
        nombre: s.nombre,
        cantidad: 1,
        precio_unitario: s.precio,
        subtotal: s.precio,
        moneda: currency,
        comision: 0,
      })),
      ...productos.map((p) => ({
        tipo: "producto",
        producto_id: p.producto_id,
        nombre: p.nombre,
        cantidad: p.cantidad,
        precio_unitario: p.precio_unitario,
        subtotal: p.subtotal,
        moneda: p.moneda || currency,
        comision: 0,
      })),
    ]
    if (items.length === 0 && (a.servicio_nombre || a.servicio)) {
      items.push({
        tipo: "servicio",
        servicio_id: "",
        nombre: a.servicio_nombre || a.servicio || "",
        cantidad: 1,
        precio_unitario: a.valor_total || a.precio_total || 0,
        subtotal: a.valor_total || a.precio_total || 0,
        moneda: currency,
        comision: 0,
      })
    }
    const metodo = a.historial_pagos?.[0]?.metodo || "efectivo"
    return {
      identificador: a._id,
      fecha_pago: a.fecha,
      local: a.sede_nombre || "",
      sede_id: a.sede_id,
      moneda: currency,
      tipo_comision: "",
      cliente_id: a.cliente_id || "",
      nombre_cliente: a.cliente_nombre || a.cliente || "",
      cedula_cliente: "",
      email_cliente: "",
      telefono_cliente: a.cliente_telefono || a.telefono_cliente || "",
      total: a.valor_total || a.precio_total || 0,
      comprobante_de_pago: "",
      numero_comprobante: "",
      fecha_comprobante: a.fecha,
      monto: a.valor_total || a.precio_total || 0,
      profesional_id: "",
      profesional_nombre: a.profesional_nombre || a.estilista || "",
      metodo_pago: metodo,
      facturado_por: "",
      vendido_por: "",
      estado: a.estado_pago || "pagado",
      items,
      historial_pagos: a.historial_pagos?.map((p) => ({
        ...p,
        notas: p.notas || "",
      })),
    }
  }

  const handleOpenFactura = (a: Appointment, e: React.MouseEvent) => {
    e.stopPropagation()
    const appointmentDate = getAppointmentDate(a)
    const clientName = (a.cliente_nombre || a.cliente || "").trim().toLowerCase()
    const total = a.valor_total || a.precio_total || 0

    const match = cachedFacturas.find((f) => {
      const fDate = (f.fecha_pago || "").split("T")[0]
      const fName = (f.nombre_cliente || "").trim().toLowerCase()
      return fDate === appointmentDate && fName === clientName && Math.abs(f.total - total) < 1
    })

    setSelectedFactura(match || buildFacturaFromAppointment(a))
    setShowFacturaModal(true)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {selectedFactura && (
        <FacturaDetailModal
          factura={selectedFactura}
          open={showFacturaModal}
          onOpenChange={(open) => {
            setShowFacturaModal(open)
            if (!open) setSelectedFactura(null)
          }}
        />
      )}

      <DirectSaleModal
        isOpen={showDirectSaleModal}
        onClose={() => setShowDirectSaleModal(false)}
        onSaleCompleted={() => setMetricsRefreshKey((k) => k + 1)}
      />


      <div className="flex flex-col h-screen bg-white">
        <Sidebar />

        {/* ── Body (nav-bar-height accounted for by flex-col above) ─────────── */}
        <div className="flex flex-1 min-h-0">

        {/* ── Main ─────────────────────────────────────────────────────────── */}
        <div className="flex flex-1 flex-col min-w-0 overflow-y-auto">

          {/* Header */}
          <div className="px-4 md:px-8 pt-6 pb-0 flex flex-wrap justify-between items-start gap-3 flex-shrink-0">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                Facturación
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Citas finalizadas · {periodRangeLabel}
              </p>
            </div>
            <div className="flex gap-2">
              {/* Venta directa — original logic preserved, style updated */}
              <button
                onClick={() => setShowDirectSaleModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <ShoppingBag className="h-3.5 w-3.5" />
                Venta directa
              </button>
            </div>
          </div>

          {/* Period bar */}
          <div className="px-4 md:px-8 pt-4 pb-0 flex-shrink-0">
            <PeriodoSelector
              periodoActivo={periodoActivo}
              onPeriodoChange={handlePeriodoChange}
              rangoAplicado={rangoAplicado}
            />
          </div>

          {/* KPI section — hidden for recepcionista */}
          {!isRecepcionista && (
            <div className="px-4 md:px-8 pt-4 pb-0 flex-shrink-0">
              {/* Row 1: Ventas Totales · Servicios · Productos */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-2.5">
                {[
                  {
                    label: "Ventas Totales",
                    value: metrics.ventas_totales,
                    sub: `${stats.facturadas} transacciones`,
                    main: true,
                  },
                  {
                    label: "Servicios",
                    value: metrics.ventas_servicios,
                    sub: `${stats.facturadas} servicios`,
                    main: false,
                  },
                  {
                    label: "Productos",
                    value: metrics.ventas_productos,
                    sub: "productos vendidos",
                    main: false,
                  },
                ].map((card) => (
                  <div
                    key={card.label}
                    className={`p-3.5 border border-gray-200 rounded-lg ${card.main ? "bg-gray-50" : "bg-white"}`}
                  >
                    <div className="text-xs font-medium text-gray-500 mb-1">
                      {card.label}
                    </div>
                    {loadingMetrics ? (
                      <Skeleton className="h-7 w-28 bg-gray-200 my-0.5" />
                    ) : (
                      <div className="text-[22px] font-bold text-gray-900 tracking-tight leading-tight">
                        {fmt(card.value)}
                      </div>
                    )}
                    <div className="text-xs text-gray-400 mt-0.5">
                      {card.sub}
                    </div>
                  </div>
                ))}
              </div>

              {/* Row 2: Payment methods — from api/sales-dashboard/ventas/dashboard */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                {(
                  [
                    { label: "Efectivo",         value: paymentMethods.efectivo },
                    { label: "Transferencia",    value: paymentMethods.transferencia },
                    { label: "Tarjeta",          value: paymentMethods.tarjeta },
                    { label: "T. Crédito",       value: paymentMethods.tarjeta_credito },
                    { label: "T. Débito",        value: paymentMethods.tarjeta_debito },
                    { label: "Sin pago",         value: paymentMethods.sin_pago },
                    { label: "Otros",            value: paymentMethods.otros },
                    { label: "Addi",             value: paymentMethods.addi },
                    { label: "Gift Card",        value: paymentMethods.giftcard },
                    { label: "Link de pago",     value: paymentMethods.link_de_pago },
                    { label: "Desc. nómina",     value: paymentMethods.descuento_nomina },
                    { label: "Abono transf.",    value: paymentMethods.abono_transferencia },
                  ] as { label: string; value: number }[]
                ).map((m) => (
                  <div
                    key={m.label}
                    className="p-2.5 border border-gray-200 rounded-lg text-center bg-white"
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-0.5 leading-tight">
                      {m.label}
                    </div>
                    {loadingMetrics ? (
                      <div className="h-4 w-12 mx-auto bg-gray-100 rounded animate-pulse my-0.5" />
                    ) : (
                      <div className={`text-sm font-bold ${m.value > 0 ? "text-gray-800" : "text-gray-300"}`}>
                        {fmtCOP(m.value)}
                      </div>
                    )}
                    <div className="text-[9px] text-gray-300">
                      {m.value > 0 ? fmt(m.value) : "—"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="mx-4 md:mx-8 mt-4 border-t border-gray-200 flex-shrink-0" />

          {/* Filters + search */}
          <div className="px-4 md:px-8 py-3 flex flex-wrap items-center gap-1.5 flex-shrink-0">
            {filterChips.map((c) => (
              <button
                key={c.id}
                onClick={() => setFilterStatus(c.id)}
                className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
                  filterStatus === c.id
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                }`}
              >
                {c.label}
                <span className="ml-1 opacity-60 text-[10px]">{c.count}</span>
              </button>
            ))}
            <div className="ml-auto relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 border border-gray-200 rounded-full text-xs w-44 focus:outline-none focus:border-gray-400 bg-white placeholder:text-gray-400"
              />
            </div>
          </div>

          {/* Appointment list */}
          <div className="px-4 md:px-8 pb-2">
            {/* Column headers */}
            <div className="flex items-center gap-3 px-3.5 mb-1">
              <div className="w-8 flex-shrink-0" />
              <span className="flex-1 text-[9px] font-bold uppercase tracking-[0.5px] text-gray-400">
                Cliente / Estilista o Vendedor · Servicio o Producto
              </span>
              <span className="w-24 text-center text-[9px] font-bold uppercase tracking-[0.5px] text-gray-400">
                Pago
              </span>
              {filterStatus === "facturadas" && (
                <span className="hidden sm:block w-16 text-center text-[9px] font-bold uppercase tracking-[0.5px] text-gray-400">
                  Factura
                </span>
              )}
              <span className="hidden sm:block w-16 text-center text-[9px] font-bold uppercase tracking-[0.5px] text-gray-400">
                Ficha
              </span>
              <span className="hidden sm:block w-24 text-right text-[9px] font-bold uppercase tracking-[0.5px] text-gray-400">
                Horario
              </span>
              <span className="w-24 text-right text-[9px] font-bold uppercase tracking-[0.5px] text-gray-400">
                Valor
              </span>
            </div>

            {loadingAppointments ? (
              <div className="py-8 text-center text-sm text-gray-400">
                Cargando citas...
              </div>
            ) : errorAppointments ? (
              <div className="py-8 text-center">
                <p className="text-sm text-red-500 mb-3">
                  {errorAppointments}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchAppointments()}
                >
                  Reintentar
                </Button>
              </div>
            ) : filteredAppointments.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-gray-400">
                  No hay citas pendientes de facturar
                </p>
                <p className="text-xs text-gray-300 mt-1">
                  Prueba con otro filtro o cambia el período
                </p>
              </div>
            ) : (
              <div>
                {filteredAppointments.map((a) => {
                  const isSelected = selectedAppointment?._id === a._id
                  const stylistName =
                    a.profesional_nombre || a.estilista || "—"
                  const clientName = (a.cliente_nombre || a.cliente || "")
                    .split(" ")
                    .slice(0, 2)
                    .join(" ")
                  const serviceName = a.servicio_nombre || a.servicio || "—"
                  const hasAbono = (a.abono ?? 0) > 0

                  return (
                    <div
                      key={a._id}
                      onClick={() => setSelectedAppointment(a)}
                      className={`flex items-center px-3.5 py-2.5 rounded-lg cursor-pointer transition-colors gap-3 mb-0.5 ${
                        isSelected ? "bg-gray-100" : "hover:bg-gray-50"
                      }`}
                    >
                      {/* Avatar */}
                      <div className="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                        {getInitials(clientName || stylistName)}
                      </div>

                      {/* Names */}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-900 truncate">
                          {clientName || "Sin cliente"}
                        </div>
                        <div className="text-xs text-gray-500 truncate mt-0.5">
                          <span className="text-gray-400">{stylistName}</span>
                          {stylistName && serviceName !== "—" ? " · " : ""}
                          <span className="font-medium text-gray-700">
                            {serviceName}
                          </span>
                        </div>
                      </div>

                      {/* Pago badge */}
                      <div className="w-24 flex justify-center">
                        <span
                          className={`text-[9px] font-semibold uppercase tracking-[0.3px] px-1.5 py-0.5 rounded-sm border ${
                            hasAbono
                              ? "border-gray-800 text-gray-800"
                              : "border-gray-300 text-gray-400"
                          }`}
                        >
                          {hasAbono ? "Con pago" : "Pendiente"}
                        </span>
                      </div>

                      {/* Factura icon — only in Facturadas tab */}
                      {filterStatus === "facturadas" && (
                        <div className="hidden sm:flex w-16 justify-center">
                          {(isFacturada(a) || a.tipo_origen === "venta_directa") ? (
                            <button
                              onClick={(e) => handleOpenFactura(a, e)}
                              title="Ver factura"
                              className="text-gray-400 hover:text-gray-900 transition-colors"
                            >
                              <FileText className="h-4 w-4" />
                            </button>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </div>
                      )}

                      {/* Ficha badge — hidden on mobile */}
                      <div className="hidden sm:flex w-16 justify-center">
                        <span className="text-[9px] font-semibold uppercase tracking-[0.3px] px-1.5 py-0.5 rounded-sm border border-gray-200 text-gray-300">
                          —
                        </span>
                      </div>

                      {/* Time — hidden on mobile */}
                      <div className="hidden sm:block w-24 text-right text-xs text-gray-500 tabular-nums">
                        {a.hora_inicio}–{a.hora_fin}
                      </div>

                      {/* Value */}
                      <div className="w-24 text-right text-sm font-bold text-gray-900">
                        {fmtCOP(a.valor_total)}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Bottom bar */}
          <div className="px-4 md:px-8 py-2.5 border-t border-gray-200 bg-gray-50 flex flex-wrap justify-between items-center gap-2 text-xs text-gray-500 flex-shrink-0">
            <div>
              <b className="text-gray-700">{stats.pendientes}</b> pendientes ·{" "}
              <b className="text-gray-700">{stats.facturadas}</b> facturadas
            </div>
          </div>
        </div>

        {/* ── Detail panel (slides in from right) ──────────────────────────── */}
        <div
          className={`flex-shrink-0 transition-all duration-200 border-gray-200 overflow-hidden ${
            selectedAppointment ? "w-full sm:w-[440px] border-l" : "w-0 border-0"
          }`}
        >
          {selectedAppointment && (
            <div className="w-full sm:w-[440px] h-full overflow-y-auto">
              <ServiceProtocol
                selectedAppointment={selectedAppointment}
                onClose={() => setSelectedAppointment(null)}
                onAppointmentUpdated={(updated) => {
                  if (updated.estado_factura?.toLowerCase() === "facturado") {
                    // Cita completamente facturada: actualizar en lista (aparecerá en tab Facturadas)
                    setAllAppointments((prev) =>
                      prev.map((a) =>
                        a._id === updated._id ? { ...a, ...updated } : a,
                      ),
                    )
                    setSelectedAppointment(null)
                  } else {
                    setAllAppointments((prev) =>
                      prev.map((a) =>
                        a._id === updated._id ? { ...a, ...updated } : a,
                      ),
                    )
                    setSelectedAppointment((prev) =>
                      prev?._id === updated._id
                        ? { ...prev, ...updated }
                        : prev,
                    )
                  }
                }}
              />
            </div>
          )}
        </div>

        </div>{/* end flex body row */}
      </div>
    </>
  )
}
