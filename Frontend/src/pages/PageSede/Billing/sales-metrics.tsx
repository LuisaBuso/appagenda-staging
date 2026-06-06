"use client"

import { Card, CardContent } from "../../../components/ui/card"
import { useState, useEffect, useMemo } from "react"
import { useAuth } from "../../../components/Auth/AuthContext"
import { getSalesMetrics, formatCurrencyMetric } from "./salesMetricsApi"
import { Calendar, DollarSign, Package, Users } from "lucide-react"
import { Button } from "../../../components/ui/button"
import { Skeleton } from "../../../components/ui/skeleton"
import { formatDateDMY, toLocalYMD } from "../../../lib/dateFormat"
import { DatePicker } from "../../../components/ui/DatePicker"
import { getStoredCurrency, normalizeCurrencyCode } from "../../../lib/currency"

interface SalesMetricsProps {
  period: string;
  dateRange: DateRange;
  onPeriodChange: (period: string) => void;
  onDateRangeChange: (range: DateRange) => void;
  sedeId?: string;
  hideSummaryCards?: boolean;
}

export interface DateRange {
  start_date: string;
  end_date: string;
}

const getDefaultDateRange = (): DateRange => {
  const today = new Date();
  const last7Days = new Date();
  last7Days.setDate(today.getDate() - 7);

  return {
    start_date: toLocalYMD(last7Days),
    end_date: toLocalYMD(today),
  };
};

export function SalesMetrics({
  period,
  dateRange,
  onPeriodChange,
  onDateRangeChange,
  sedeId,
  hideSummaryCards = false,
}: SalesMetricsProps) {
  const { user, isAuthenticated } = useAuth()
  const [loading, setLoading] = useState(true)
  const [showDateModal, setShowDateModal] = useState(false)
  const defaultDateRange = useMemo(() => getDefaultDateRange(), [])
  const effectiveDateRange = useMemo(
    () =>
      dateRange.start_date && dateRange.end_date
        ? dateRange
        : defaultDateRange,
    [dateRange, defaultDateRange]
  )
  const [tempDateRange, setTempDateRange] = useState<DateRange>(effectiveDateRange)
  const [currency, setCurrency] = useState<string>(getStoredCurrency("USD")) // 🆕 NUEVO: Estado para la moneda
  const [metrics, setMetrics] = useState({
    ventas_totales: 0,
    ventas_servicios: 0,
    ventas_productos: 0
  })
  const [error, setError] = useState<string | null>(null)

  const periodOptions = [
    { id: "today", label: "Hoy" },
    { id: "last_7_days", label: "7 días" },
    { id: "last_30_days", label: "30 días" },
    { id: "month", label: "Mes actual" },
    { id: "custom", label: "Rango personalizado" },
  ]

  useEffect(() => {
    setTempDateRange(effectiveDateRange)
  }, [effectiveDateRange])

  useEffect(() => {
    if (!dateRange.start_date || !dateRange.end_date) {
      onDateRangeChange(defaultDateRange)
    }
  }, [dateRange, defaultDateRange, onDateRangeChange])

  const loadMetrics = async () => {
    if (hideSummaryCards || !isAuthenticated || !user?.access_token) {
      console.log('⚠️ Usuario no autenticado')
      return
    }

    try {
      setLoading(true)
      setError(null)
      
      const targetSedeId = sedeId || (user.sede_id as string) || ""
      
      if (!targetSedeId) {
        console.error('❌ No hay sede definida')
        setError('No se pudo determinar la sede')
        return
      }

      const params: any = {
        period: period,
        sede_id: targetSedeId
      }

      // Si es rango personalizado, agregar fechas
      if (period === "custom") {
        if (!effectiveDateRange.start_date || !effectiveDateRange.end_date) {
          console.log("⚠️ Por favor selecciona un rango de fechas")
          return
        }
        params.start_date = effectiveDateRange.start_date
        params.end_date = effectiveDateRange.end_date
      }

      console.log('📤 Parámetros enviados a la API:', params)

      const data = await getSalesMetrics(user.access_token, params)

      console.log('📥 Respuesta COMPLETA de la API:', JSON.stringify(data, null, 2))

      // Verificar que la respuesta exista
      if (!data) {
        throw new Error('La API no devolvió respuesta')
      }

      // 🆕 NUEVO: Extraer la moneda de la sede desde la respuesta
      const sedeCurrency = normalizeCurrencyCode(data.moneda_sede || getStoredCurrency("USD"))
      console.log('💰 Moneda de la sede:', sedeCurrency)
      setCurrency(sedeCurrency)

      // 🆕 CAMBIADO: Extraer métricas usando la moneda correcta
      let ventasTotales = 0
      let ventasServicios = 0
      let ventasProductos = 0

      // Buscar las métricas con la moneda de la sede
      if (data.metricas_por_moneda && data.metricas_por_moneda[sedeCurrency]) {
        const metricas = data.metricas_por_moneda[sedeCurrency]
        ventasTotales = metricas.ventas_totales || 0
        ventasServicios = metricas.ventas_servicios || 0
        ventasProductos = metricas.ventas_productos || 0
        
        console.log(`✅ Métricas encontradas para ${sedeCurrency}:`, metricas)
      }
      // 🆕 FALLBACK: Si no hay datos en la moneda esperada, buscar cualquier moneda disponible
      else if (data.metricas_por_moneda) {
        const monedasDisponibles = Object.keys(data.metricas_por_moneda)
        console.log('⚠️ Monedas disponibles:', monedasDisponibles)
        
        if (monedasDisponibles.length > 0) {
          const primeraMoneda = monedasDisponibles[0]
          const metricas = data.metricas_por_moneda[primeraMoneda]
          
          console.log(`⚠️ Usando moneda alternativa: ${primeraMoneda}`, metricas)
          setCurrency(normalizeCurrencyCode(primeraMoneda))
          
          ventasTotales = metricas.ventas_totales || 0
          ventasServicios = metricas.ventas_servicios || 0
          ventasProductos = metricas.ventas_productos || 0
        } else {
          console.warn('⚠️ No hay métricas disponibles en ninguna moneda')
        }
      }
      // Si no hay metricas_por_moneda pero hay datos en raíz (estructura antigua)
      else if (data.ventas_totales !== undefined) {
        console.log('⚠️ Usando estructura antigua (métricas en raíz)')
        ventasTotales = data.ventas_totales || 0
        ventasServicios = data.ventas_servicios || 0
        ventasProductos = data.ventas_productos || 0
      }
      else {
        console.warn('❌ No se reconoció la estructura de la respuesta:', data)
      }
      
      setMetrics({
        ventas_totales: ventasTotales,
        ventas_servicios: ventasServicios,
        ventas_productos: ventasProductos
      })

      console.log('📊 Métricas finales:', { 
        ventasTotales, 
        ventasServicios, 
        ventasProductos,
        moneda: sedeCurrency
      })

    } catch (error: any) {
      console.error('❌ Error cargando métricas:', error)
      setError(`Error al cargar las métricas: ${error.message}`)
      // Resetear métricas a 0 en caso de error
      setMetrics({
        ventas_totales: 0,
        ventas_servicios: 0,
        ventas_productos: 0
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthenticated && !hideSummaryCards) {
      loadMetrics()
    }
  }, [hideSummaryCards, isAuthenticated, period, effectiveDateRange.start_date, effectiveDateRange.end_date, sedeId, user?.access_token])

  const handlePeriodChange = (newPeriod: string) => {
    if (newPeriod === "custom") {
      setTempDateRange(effectiveDateRange)
      setShowDateModal(true)
      return
    }

    onPeriodChange(newPeriod)
  }

  const handleApplyDateRange = () => {
    if (!tempDateRange.start_date || !tempDateRange.end_date) {
      console.log("⚠️ Por favor selecciona ambas fechas")
      return
    }
    
    if (new Date(tempDateRange.start_date) > new Date(tempDateRange.end_date)) {
      console.log("⚠️ La fecha de inicio no puede ser mayor a la fecha de fin")
      return
    }
    
    onDateRangeChange(tempDateRange)
    setShowDateModal(false)
    onPeriodChange("custom")
  }

  const formatDateDisplay = (dateString: string) => {
    if (!dateString) return ""
    return formatDateDMY(dateString)
  }

  const getPeriodDisplay = () => {
    if (period === "custom") {
      return `${formatDateDisplay(effectiveDateRange.start_date)} - ${formatDateDisplay(effectiveDateRange.end_date)}`
    }
    return periodOptions.find(p => p.id === period)?.label || "Período"
  }

  // Función para seleccionar rango rápido
  const setQuickDateRange = (days: number) => {
    const today = new Date()
    const startDate = new Date()
    startDate.setDate(today.getDate() - days)
    
    const newRange: DateRange = {
      start_date: toLocalYMD(startDate),
      end_date: toLocalYMD(today)
    }
    
    setTempDateRange(newRange)
  }

  // Modal de selección de fechas
  const DateRangeModal = () => {
    if (!showDateModal) return null

    const today = toLocalYMD(new Date())

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-lg w-full max-w-md mx-4 p-6">
          <div className="mb-6">
            <h3 className="text-xl font-bold text-gray-900">Seleccionar rango de fechas</h3>
            <p className="text-gray-700 mt-1">Elige las fechas para filtrar las métricas</p>
          </div>

          {/* Botones de rango rápido */}
          <div className="mb-6">
            <p className="text-sm text-gray-700 mb-3">Rangos rápidos:</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-gray-300 text-gray-800 hover:bg-gray-100"
                onClick={() => setQuickDateRange(7)}
              >
                7 días
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-gray-300 text-gray-800 hover:bg-gray-100"
                onClick={() => setQuickDateRange(30)}
              >
                30 días
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-gray-300 text-gray-800 hover:bg-gray-100"
                onClick={() => setQuickDateRange(90)}
              >
                90 días
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-gray-300 text-gray-800 hover:bg-gray-100"
                onClick={() => {
                  const today = new Date()
                  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
                  setTempDateRange({
                    start_date: toLocalYMD(firstDayOfMonth),
                    end_date: toLocalYMD(today)
                  })
                }}
              >
                Mes actual
              </Button>
            </div>
          </div>

          {/* Selectores de fecha */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-2">
                Fecha de inicio
              </label>
              <DatePicker
                value={tempDateRange.start_date}
                onChange={(v) => setTempDateRange(prev => ({ ...prev, start_date: v }))}
                max={tempDateRange.end_date || today}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-800 mb-2">
                Fecha de fin
              </label>
              <DatePicker
                value={tempDateRange.end_date}
                onChange={(v) => setTempDateRange(prev => ({ ...prev, end_date: v }))}
                min={tempDateRange.start_date}
                max={today}
              />
            </div>
          </div>

          {/* Resumen del rango */}
          <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-300">
            <p className="text-sm text-gray-800">
              <span className="font-medium">Rango seleccionado:</span>{" "}
              {formatDateDisplay(tempDateRange.start_date)} - {formatDateDisplay(tempDateRange.end_date)}
            </p>
            <p className="text-xs text-gray-600 mt-1">
              {tempDateRange.start_date && tempDateRange.end_date && (
                <>
                  Duración:{" "}
                  {Math.ceil(
                    (new Date(tempDateRange.end_date).getTime() - new Date(tempDateRange.start_date).getTime()) / 
                    (1000 * 60 * 60 * 24)
                  ) + 1} días
                </>
              )}
            </p>
          </div>

          {/* Botones de acción */}
          <div className="mt-6 flex gap-3">
            <Button
              className="flex-1 bg-black text-white hover:bg-gray-800"
              onClick={handleApplyDateRange}
            >
              Aplicar rango
            </Button>
            <Button
              variant="outline"
              className="flex-1 border-gray-300 text-gray-800 hover:bg-gray-100"
              onClick={() => setShowDateModal(false)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Modal de selección de fechas */}
      <DateRangeModal />

      {/* Filtro de período */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-600" />
          <span className="text-sm text-gray-600">Período:</span>
        </div>
        
        <div className="flex flex-wrap gap-1">
          {periodOptions.map((option) => (
            <Button
              key={option.id}
              size="sm"
              variant={period === option.id ? "default" : "outline"}
              className={`text-xs border-gray-300 ${period === option.id ? "bg-black text-white hover:bg-gray-800" : "text-gray-700 hover:bg-gray-100"}`}
              onClick={() => handlePeriodChange(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Mensaje de error */}
      {error && !hideSummaryCards && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-700">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 border-red-300 text-red-700 hover:bg-red-100"
            onClick={() => loadMetrics()}
          >
            Reintentar
          </Button>
        </div>
      )}

      {/* Métricas */}
      {!hideSummaryCards && (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Ventas Totales */}
        <Card className="border-gray-300 hover:border-gray-400 transition-colors">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 border border-gray-300 rounded-lg">
                <DollarSign className="w-4 h-4 text-gray-800" />
              </div>
              <h3 className="text-sm font-medium text-gray-700">Ventas Totales</h3>
            </div>
            
            {loading ? (
              <Skeleton className="h-8 w-32 bg-gray-200" />
            ) : (
              <p className="text-2xl font-bold text-black">
                {formatCurrencyMetric(metrics.ventas_totales, currency)}
              </p>
            )}
            
            <div className="mt-2 text-xs text-gray-500">
              Período: {getPeriodDisplay()}
            </div>
          </CardContent>
        </Card>

        {/* Ventas Servicios */}
        <Card className="border-gray-300 hover:border-gray-400 transition-colors">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 border border-gray-300 rounded-lg">
                <Users className="w-4 h-4 text-gray-800" />
              </div>
              <h3 className="text-sm font-medium text-gray-700">Servicios</h3>
            </div>
            
            {loading ? (
              <Skeleton className="h-8 w-32 bg-gray-200" />
            ) : (
              <>
                <p className="text-2xl font-bold text-black">
                  {formatCurrencyMetric(metrics.ventas_servicios, currency)}
                </p>
                <div className="mt-1 text-xs text-gray-500">
                  {metrics.ventas_totales > 0 && (
                    <span className="font-medium">
                      {Math.round((metrics.ventas_servicios / metrics.ventas_totales) * 100)}% del total
                    </span>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Ventas Productos */}
        <Card className="border-gray-300 hover:border-gray-400 transition-colors">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 border border-gray-300 rounded-lg">
                <Package className="w-4 h-4 text-gray-800" />
              </div>
              <h3 className="text-sm font-medium text-gray-700">Productos</h3>
            </div>
            
            {loading ? (
              <Skeleton className="h-8 w-32 bg-gray-200" />
            ) : (
              <>
                <p className="text-2xl font-bold text-black">
                  {formatCurrencyMetric(metrics.ventas_productos, currency)}
                </p>
                <div className="mt-1 text-xs text-gray-500">
                  {metrics.ventas_totales > 0 && (
                    <span className="font-medium">
                      {Math.round((metrics.ventas_productos / metrics.ventas_totales) * 100)}% del total
                    </span>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
      )}

      {/* Información del período */}
      {!loading && !hideSummaryCards && (
        <div className="text-center">
          <p className="text-xs text-gray-500">
            Mostrando datos para: {getPeriodDisplay()}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Última actualización: {new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      )}
    </div>
  )
}
