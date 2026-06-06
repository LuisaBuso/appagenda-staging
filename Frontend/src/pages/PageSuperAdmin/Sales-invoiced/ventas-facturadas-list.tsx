"use client"

import { useState, useEffect, useMemo } from "react"
import {
  Search,
  Download,
  Loader2,
  Building,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react"
import { toast } from 'sonner'
import { Button } from "../../../components/ui/button"
import { Input } from "../../../components/ui/input"
import { FacturaDetailModal } from "./factura-detail-modal"
import { PeriodoSelector, type PeriodoId } from "../../../components/ui/PeriodoSelector"
import { PageHeader } from "../../../components/Layout/PageHeader"
import type { Factura } from "../../../types/factura"
import { facturaService } from "./facturas"
import { sedeService } from "../Sedes/sedeService"
import type { Sede } from "../../../types/sede"
import { formatSedeNombre } from "../../../lib/sede"
import { formatDateDMY, formatLocalDate } from "../../../lib/dateFormat"
import { PaymentMethodsSummary } from "../../../components/SalesInvoiced/payment-methods-summary"
import {
  calculatePaymentMethodTotals,
  type PaymentMethodTotals,
} from "../../../lib/payment-methods-summary"

const toIsoLocalDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

type FacturaFilters = {
  searchTerm: string
  fecha_desde: string
  fecha_hasta: string
}

type AppliedFacturaFilters = {
  fecha_desde: string | null
  fecha_hasta: string | null
  search: string | null
}

const EMPTY_FACTURA_FILTERS: FacturaFilters = {
  searchTerm: "",
  fecha_desde: "",
  fecha_hasta: "",
}

export function VentasFacturadasList() {
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedSede, setSelectedSede] = useState("")
  const [, setFechaDesde] = useState("")
  const [, setFechaHasta] = useState("")
  const [periodoActivo, setPeriodoActivo] = useState<PeriodoId>("hoy")
  const [rangoAplicado, setRangoAplicado] = useState<{ from: Date; to: Date } | undefined>(undefined)
  const [selectedFactura, setSelectedFactura] = useState<Factura | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [facturas, setFacturas] = useState<Factura[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingSedes, setIsLoadingSedes] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sedes, setSedes] = useState<Sede[]>([])
  const [sedeIdMap, setSedeIdMap] = useState<Record<string, string>>({}) // Mapa de _id a sede_id
  const [pagination, setPagination] = useState<any>(null)
  const [filtersApplied, setFiltersApplied] = useState<AppliedFacturaFilters | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [limit] = useState(50)
  const [appliedFilters, setAppliedFilters] = useState<FacturaFilters>(EMPTY_FACTURA_FILTERS)
  const [paymentSummary, setPaymentSummary] = useState<PaymentMethodTotals | null>(null)

  // Cargar sedes disponibles
  useEffect(() => {
    cargarSedes()
  }, [])

  // Inicializar filtros al seleccionar sede
  useEffect(() => {
    if (selectedSede) {
      const today = toIsoLocalDate(new Date())
      const initialFilters: FacturaFilters = {
        ...EMPTY_FACTURA_FILTERS,
        fecha_desde: today,
        fecha_hasta: today,
      }

      setSearchTerm("")
      setFechaDesde(today)
      setFechaHasta(today)
      setAppliedFilters(initialFilters)
      cargarFacturas(1, initialFilters)
    } else {
      setFacturas([])
      setPagination(null)
      setFiltersApplied(null)
      setAppliedFilters(EMPTY_FACTURA_FILTERS)
      setPaymentSummary(null)
    }
  }, [selectedSede, sedeIdMap])

  const cargarSedes = async () => {
    try {
      setIsLoadingSedes(true)
      const token = sessionStorage.getItem("access_token")
      if (!token) {
        throw new Error("No hay token de autenticación")
      }
      
      const sedesData = await sedeService.getSedes(token)
      setSedes(sedesData)
      
      // Crear mapa de _id a sede_id
      const idMap: Record<string, string> = {}
      sedesData.forEach(sede => {
        if (sede._id && sede.sede_id) {
          idMap[sede._id] = sede.sede_id
        }
      })
      setSedeIdMap(idMap)

    } catch (err) {
      console.error("Error cargando sedes:", err)
      setError("Error al cargar las sedes disponibles")
    } finally {
      setIsLoadingSedes(false)
    }
  }

  const cargarFacturas = async (page: number = 1, filtros: FacturaFilters = appliedFilters) => {
    try {
      setIsLoading(true)
      setError(null)

      const primarySedeId = sedeIdMap[selectedSede] || selectedSede
      const secondarySedeId =
        sedeIdMap[selectedSede] && sedeIdMap[selectedSede] !== selectedSede
          ? selectedSede
          : ""

      if (!primarySedeId) {
        throw new Error("ID de sede no válido")
      }

      console.log("Cargando facturas para sede:", primarySedeId)

      let result = await facturaService.getVentasBySedePaginadas(primarySedeId, {
        page,
        limit,
        fecha_desde: filtros.fecha_desde,
        fecha_hasta: filtros.fecha_hasta,
        search: filtros.searchTerm || undefined,
      })

      // Compatibilidad: algunos entornos aceptan _id y otros sede_id en el path.
      if (result.facturas.length === 0 && secondarySedeId) {
        try {
          const fallbackResult = await facturaService.getVentasBySedePaginadas(secondarySedeId, {
            page,
            limit,
            fecha_desde: filtros.fecha_desde,
            fecha_hasta: filtros.fecha_hasta,
            search: filtros.searchTerm || undefined,
          })

          if (fallbackResult.facturas.length > 0) {
            result = fallbackResult
          }
        } catch (fallbackError) {
          console.warn("Fallback de sede con _id falló, se mantiene resultado principal:", fallbackError)
        }
      }
      
      console.log("Facturas cargadas:", result.facturas.length)
      
      // Actualizar el estado con las facturas
      setFacturas(result.facturas as Factura[])
      setPagination(result.pagination || null)
      setPaymentSummary(result.paymentSummary || null)
      setFiltersApplied({
        ...(result.filters_applied || {}),
        fecha_desde: filtros.fecha_desde || null,
        fecha_hasta: filtros.fecha_hasta || null,
        search: filtros.searchTerm || null,
      })
      setCurrentPage(page)
      
    } catch (err: any) {
      console.error("Error cargando facturas:", err)
      setError(err.message || "Error al cargar las facturas. Por favor, intenta nuevamente.")
      setFacturas([])
      setPagination(null)
      setPaymentSummary(null)
    } finally {
      setIsLoading(false)
    }
  }

  const handlePeriodoChange = (periodo: PeriodoId, fechas?: { from: Date; to: Date }) => {
    setPeriodoActivo(periodo)
    const today = new Date()
    const todayYmd = toIsoLocalDate(today)
    let desde = todayYmd
    let hasta = todayYmd
    if (periodo === "hoy") {
      desde = todayYmd; hasta = todayYmd
    } else if (periodo === "7dias") {
      const s = new Date(today); s.setDate(s.getDate() - 6)
      desde = toIsoLocalDate(s); hasta = todayYmd
    } else if (periodo === "mes") {
      const s = new Date(today.getFullYear(), today.getMonth(), 1)
      desde = toIsoLocalDate(s); hasta = todayYmd
    } else if (periodo === "30dias") {
      const s = new Date(today); s.setDate(s.getDate() - 29)
      desde = toIsoLocalDate(s); hasta = todayYmd
    } else if (periodo === "rango" && fechas) {
      setRangoAplicado(fechas)
      // ✅ DEBUG: Verify custom range dates
      console.log('[SuperAdmin VentasFacturadas] Custom range applied:', {
        from: fechas.from,
        to: fechas.to,
        from_month: fechas.from.getMonth(),
        to_month: fechas.to.getMonth(),
      });
      desde = toIsoLocalDate(fechas.from)
      hasta = toIsoLocalDate(fechas.to)
    }
    if (periodo !== "rango" || fechas) {
      setFechaDesde(desde)
      setFechaHasta(hasta)
      const filtros: FacturaFilters = { searchTerm: searchTerm.trim(), fecha_desde: desde, fecha_hasta: hasta }
      setAppliedFilters(filtros)
      cargarFacturas(1, filtros)
    }
  }

  const irAPagina = (pagina: number) => {
    if (pagina >= 1 && pagina <= (pagination?.total_pages || 1)) {
      cargarFacturas(pagina, appliedFilters)
    }
  }

  const irPrimeraPagina = () => {
    irAPagina(1)
  }

  const irUltimaPagina = () => {
    irAPagina(pagination?.total_pages || 1)
  }

  const irPaginaAnterior = () => {
    irAPagina(currentPage - 1)
  }

  const irPaginaSiguiente = () => {
    irAPagina(currentPage + 1)
  }

  const handleRowClick = (factura: Factura) => {
    setSelectedFactura(factura)
    setIsModalOpen(true)
  }

  const formatDate = (dateString: string) => formatDateDMY(dateString, dateString)
  const appliedDateSummary = (() => {
    if (!filtersApplied) return null

    if (filtersApplied.fecha_desde && filtersApplied.fecha_hasta) {
      return `Rango aplicado: ${formatDate(filtersApplied.fecha_desde)} - ${formatDate(filtersApplied.fecha_hasta)}`
    }

    if (filtersApplied.fecha_desde) {
      return `Desde: ${formatDate(filtersApplied.fecha_desde)}`
    }

    if (filtersApplied.fecha_hasta) {
      return `Hasta: ${formatDate(filtersApplied.fecha_hasta)}`
    }

    return null
  })()

  const getCurrencyLocale = (currency: string) => {
    if (currency === "USD") return "en-US"
    if (currency === "MXN") return "es-MX"
    return "es-CO"
  }

  const formatCurrency = (amount: number, currency: string) => {
    const safeCurrency = (currency || "COP").toUpperCase()
    const safeAmount = Number.isFinite(amount) ? amount : 0
    return `${safeCurrency} ${Math.round(safeAmount).toLocaleString(getCurrencyLocale(safeCurrency))}`
  }

  const summaryCurrency = (facturas[0]?.moneda || "COP").toUpperCase()

  const formatSummaryCurrency = (amount: number) => {
    const safeAmount = Number.isFinite(amount) ? amount : 0
    return `$ ${Math.round(safeAmount).toLocaleString(getCurrencyLocale(summaryCurrency))}`
  }

  const selectedSedeNombre = formatSedeNombre(
    sedes.find(s => s._id === selectedSede)?.nombre,
    "Sede seleccionada"
  )

  const paymentTotals = useMemo(() => {
    if (paymentSummary) {
      return paymentSummary
    }

    // TODO: Sin agregados del backend para este filtro, estos totales reflejan las filas cargadas en la página actual.
    return calculatePaymentMethodTotals(facturas)
  }, [paymentSummary, facturas])

  const handleExportCSV = () => {
    try {
      // Crear encabezados CSV
      const headers = [
        "Fecha Pago",
        "Cliente",
        "Local",
        "Profesional",
        "N° Comprobante",
        "Método Pago",
        "Total",
        "Estado"
      ]
      
      // Crear filas de datos
      const rows = facturas.map(factura => [
        formatDate(factura.fecha_pago),
        factura.nombre_cliente,
        factura.local,
        factura.profesional_nombre,
        factura.numero_comprobante,
        factura.metodo_pago,
        formatCurrency(factura.total, factura.moneda),
        factura.estado
      ])
      
      // Crear contenido CSV
      const csvContent = [
        headers.join(","),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
      ].join("\n")
      
      // Obtener nombre de la sede seleccionada
      const sedeNombre = formatSedeNombre(
        sedes.find(s => s._id === selectedSede)?.nombre,
        "sede"
      )
      
      // Crear y descargar archivo
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.setAttribute("download", `ventas-${sedeNombre}-${new Date().toISOString().split('T')[0]}.csv`)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      
    } catch (error) {
      console.error("Error exportando CSV:", error)
      toast.error("Error al exportar el archivo CSV")
    }
  }

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <PageHeader
          title="Ventas Facturadas"
          subtitle={
            selectedSede
              ? `Sede: ${selectedSedeNombre}`
              : "Selecciona una sede para ver las facturas"
          }
          actions={
            selectedSede && facturas.length > 0 ? (
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-1 px-3 py-1.5 text-sm border border-black hover:bg-gray-50"
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Exportar CSV
              </button>
            ) : null
          }
        />

        {/* Selector de Sede */}
        <div className="mb-6">
          <label className="mb-1.5 block text-xs font-medium">Seleccionar sede</label>
          {isLoadingSedes ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="text-sm text-gray-600">Cargando sedes...</span>
            </div>
          ) : sedes.length === 0 ? (
            <div className="text-sm text-gray-600">No hay sedes disponibles</div>
          ) : (
            <select
              value={selectedSede}
              onChange={(e) => setSelectedSede(e.target.value)}
              className="h-9 w-full border px-3 text-sm focus:border-gray-400 focus:outline-none"
              disabled={isLoadingSedes}
            >
              <option value="">-- Seleccionar sede --</option>
              {sedes.map((sede) => (
                <option key={sede._id} value={sede._id}>
                  {formatSedeNombre(sede.nombre)}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Filtros (solo mostrar si hay sede seleccionada) */}
        {selectedSede && (
          <>
            <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
              {/* Row: buscador + período en la misma línea */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative w-full max-w-sm">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                  <Input
                    placeholder="Buscar cliente, cédula..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-9 pl-8 text-sm"
                    disabled={isLoading}
                  />
                </div>
                <PeriodoSelector
                  periodoActivo={periodoActivo}
                  onPeriodoChange={handlePeriodoChange}
                  rangoAplicado={rangoAplicado}
                />
              </div>

              {/* Rango aplicado — solo cuando hay info útil */}
              {appliedDateSummary && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <span>{appliedDateSummary}</span>
                </div>
              )}
            </div>

            <PaymentMethodsSummary
              totals={paymentTotals}
              loading={isLoading}
              formatAmount={formatSummaryCurrency}
            />

            {/* Estado de carga/error */}
            {isLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="ml-2 text-sm text-gray-600">Cargando facturas...</span>
              </div>
            )}

            {error && !isLoading && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-700">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => cargarFacturas(currentPage, appliedFilters)}
                >
                  Reintentar
                </Button>
              </div>
            )}

            {/* Tabla */}
            {!isLoading && !error && (
              <div className="rounded-lg border bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="border-b bg-gray-50">
                      <tr>
                        <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Fecha pago</th>
                        <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Cliente</th>
                        <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Local</th>
                        <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Profesional</th>
                        <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">N° Comprobante</th>
                        <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Método pago</th>
                        <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Total</th>
                        <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {facturas.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                            No se encontraron facturas con los filtros aplicados.
                          </td>
                        </tr>
                      ) : (
                        facturas.map((factura) => (
                          <tr
                            key={`${factura.identificador}-${factura.fecha_pago}`}
                            onClick={() => handleRowClick(factura)}
                            className="cursor-pointer transition-colors hover:bg-gray-50"
                          >
                            <td className="px-6 py-4 text-sm text-gray-700">{formatDate(factura.fecha_pago)}</td>
                            <td className="px-6 py-4 text-sm text-gray-700">{factura.nombre_cliente}</td>
                            <td className="px-6 py-4 text-sm text-gray-700">{factura.local}</td>
                            <td className="px-6 py-4 text-sm text-gray-700">{factura.profesional_nombre}</td>
                            <td className="px-6 py-4 text-sm text-gray-700">{factura.numero_comprobante}</td>
                            <td className="px-6 py-4 text-sm text-gray-700 capitalize">{factura.metodo_pago}</td>
                            <td className="px-6 py-4 text-sm font-semibold text-gray-900">
                              {formatCurrency(factura.total, factura.moneda)}
                            </td>
                            <td className="px-6 py-4">
                              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                                factura.estado === "pagado" 
                                  ? "bg-green-100 text-green-800" 
                                  : "bg-yellow-100 text-yellow-800"
                              }`}>
                                {factura.estado}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Resumen */}
            {!isLoading && !error && facturas.length > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-600">
                {pagination
                  ? `Mostrando ${pagination.from} a ${pagination.to} de ${pagination.total} facturas`
                  : `Mostrando ${facturas.length} facturas`}
              </div>
            )}

            {/* Controles de paginación */}
            {!isLoading && !error && pagination && pagination.total_pages > 1 && (
              <div className="flex flex-wrap items-center justify-end gap-1 pt-2">
                <button
                  onClick={irPrimeraPagina}
                  disabled={currentPage === 1 || isLoading}
                  className="inline-flex h-8 w-8 items-center justify-center border disabled:opacity-50"
                  aria-label="Primera página"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={irPaginaAnterior}
                  disabled={!pagination.has_prev || isLoading}
                  className="inline-flex h-8 w-8 items-center justify-center border disabled:opacity-50"
                  aria-label="Página anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-2 text-sm text-gray-600">
                  Página {currentPage} de {pagination.total_pages}
                </span>
                <button
                  onClick={irPaginaSiguiente}
                  disabled={!pagination.has_next || isLoading}
                  className="inline-flex h-8 w-8 items-center justify-center border disabled:opacity-50"
                  aria-label="Página siguiente"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button
                  onClick={irUltimaPagina}
                  disabled={currentPage === pagination.total_pages || isLoading}
                  className="inline-flex h-8 w-8 items-center justify-center border disabled:opacity-50"
                  aria-label="Última página"
                >
                  <ChevronsRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </>
        )}

        {/* Mensaje cuando no hay sede seleccionada */}
        {!selectedSede && sedes.length > 0 && !isLoadingSedes && (
          <div className="text-center py-12 border border-dashed">
            <Building className="h-8 w-8 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600 text-sm">Selecciona una sede para ver las facturas</p>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedFactura && (
        <FacturaDetailModal 
          factura={selectedFactura} 
          open={isModalOpen} 
          onOpenChange={setIsModalOpen} 
        />
      )}
    </>
  )
}
