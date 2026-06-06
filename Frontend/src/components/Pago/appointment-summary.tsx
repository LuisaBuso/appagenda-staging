"use client"

import { Card } from "../../components/ui/card"
import { User, DollarSign, Calendar, Clock, MapPin, Scissors, CheckCircle } from "lucide-react"
import { useEffect, useState } from "react"

interface AppointmentSummaryProps {
  appointment: {
    client: string
    service: string
    professional: string
    date: string
    duration: string
    amount?: string | number
    currency?: string
    totalAmount?: number // 🔥 NUEVO: Total para calcular abono
  }
  isDeposit?: boolean // 🔥 NUEVO: Si es abono
  depositAmount?: number // 🔥 NUEVO: Monto del abono
}

export function AppointmentSummary({ 
  appointment, 
  isDeposit = false, 
  depositAmount 
}: AppointmentSummaryProps) {
  const [currency, setCurrency] = useState<string>("USD")
  const [formattedAmount, setFormattedAmount] = useState<string>("")
  const [formattedDeposit, setFormattedDeposit] = useState<string>("")
  const [formattedTotal, setFormattedTotal] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [locationInfo, setLocationInfo] = useState("")

  // 🔥 OBTENER MONEDA AUTOMÁTICAMENTE
  useEffect(() => {
    const getCurrency = () => {
      try {
        // 1. De props (prioridad)
        if (appointment.currency) return appointment.currency
        
        // 2. De sessionStorage
        if (typeof window !== 'undefined') {
          const storedCurrency = sessionStorage.getItem("beaux-moneda")
          if (storedCurrency) return storedCurrency
          
          // 3. Determinar por país
          const pais = sessionStorage.getItem("beaux-pais")
          if (pais === "Colombia") return "COP"
          if (pais === "México" || pais === "Mexico") return "MXN"
        }
        
        // 4. Default
        return "USD"
      } catch (error) {
        console.error("❌ Error obteniendo moneda:", error)
        return "USD"
      }
    }
    
    const moneda = getCurrency()
    setCurrency(moneda.toUpperCase())
  }, [appointment.currency])

  // 🔥 OBTENER INFORMACIÓN DE LA SEDE
  useEffect(() => {
    const getSedeInfo = () => {
      if (typeof window === 'undefined') return "Cargando..."
      
      try {
        const sedeNombre = sessionStorage.getItem("beaux-nombre_local") || "Sede"
        const pais = sessionStorage.getItem("beaux-pais") || "País"
        return `${sedeNombre} - ${pais}`
      } catch {
        return "Información no disponible"
      }
    }
    
    setLocationInfo(getSedeInfo())
  }, [])

  // 🔥 FORMATEAR MONTO
  const formatCurrency = (amount: number, currency: string) => {
    if (isNaN(amount)) return "Monto inválido"
    
    const amountNum = Math.abs(amount)
    
    switch (currency.toUpperCase()) {
      case "COP":
        return `$${amountNum.toLocaleString("es-CO", { maximumFractionDigits: 0 })} COP`
      case "MXN":
        return `$${amountNum.toLocaleString("es-MX", { maximumFractionDigits: 0 })} MXN`
      case "USD":
      default:
        return `$${amountNum.toLocaleString("en-US", { maximumFractionDigits: 0 })} USD`
    }
  }

  // 🔥 CALCULAR ABONO FIJO
  const calculateFixedDeposit = () => {
    switch (currency) {
      case "COP":
        return 50000 // ~$15 USD
      case "MXN":
        return 250 // ~$15 USD
      case "USD":
      default:
        return 15 // $15 USD
    }
  }

  // 🔥 EFECTO PARA FORMATEAR MONTOS
  useEffect(() => {
    if (!currency) return
    
    try {
      // Monto del servicio
      if (appointment.amount !== undefined) {
        const amountNum = typeof appointment.amount === "string" 
          ? parseFloat(appointment.amount) 
          : appointment.amount
        
        if (!isNaN(amountNum)) {
          setFormattedAmount(formatCurrency(amountNum, currency))
        }
      }
      
      // Monto total (para abonos)
      if (appointment.totalAmount !== undefined) {
        setFormattedTotal(formatCurrency(appointment.totalAmount, currency))
      }
      
      // Monto del abono
      if (isDeposit) {
        const deposit = depositAmount || calculateFixedDeposit()
        setFormattedDeposit(formatCurrency(deposit, currency))
      }
      
    } catch (error) {
      console.error("❌ Error formateando montos:", error)
      setFormattedAmount("Error en monto")
    }
    
    setLoading(false)
  }, [appointment.amount, appointment.totalAmount, currency, isDeposit, depositAmount])

  // 🔥 CALCULAR SI REQUIERE PAGO COMPLETO
  const requiresFullPayment = () => {
    if (!appointment.amount) return false
    
    const amountNum = typeof appointment.amount === "string" 
      ? parseFloat(appointment.amount) 
      : appointment.amount
    
    const fixedDeposit = calculateFixedDeposit()
    return amountNum <= fixedDeposit
  }

  // 🔥 OBTENER TEXTO DE ABONO


  const needsFullPayment = requiresFullPayment()

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600">Cargando resumen...</span>
        </div>
      </Card>
    )
  }

  return (
    <Card className="p-6 border-gray-200 shadow-sm">
      {/* 🔥 ENCABEZADO */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <h2 className="text-xl font-bold text-gray-900">Resumen de la cita</h2>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <div className="px-3 py-1 bg-blue-100 text-blue-800 text-sm font-semibold rounded-full">
              {currency}
            </div>
            <div className="text-sm text-gray-600">
              {locationInfo}
            </div>
          </div>
        </div>
        
        {isDeposit && formattedDeposit && (
          <div className="px-4 py-2 bg-yellow-50 border border-yellow-300 rounded-lg">
            <div className="text-sm font-semibold text-yellow-800">
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {/* 🔥 INFORMACIÓN DEL CLIENTE */}
        <div className="p-4 bg-white border border-gray-200 rounded-xl">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <User className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider">Cliente</div>
              <div className="font-semibold text-lg text-gray-900">{appointment.client}</div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div className="space-y-2">
              <div className="text-xs text-gray-500">Servicio</div>
              <div className="font-medium text-gray-900 flex items-center gap-2">
                <Scissors className="h-4 w-4 text-gray-400" />
                {appointment.service}
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="text-xs text-gray-500">Profesional</div>
              <div className="font-medium text-blue-700">{appointment.professional}</div>
            </div>
          </div>
        </div>

        {/* 🔥 INFORMACIÓN DEL SERVICIO */}
        <div className="p-4 bg-white border border-gray-200 rounded-xl">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <DollarSign className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider">Servicio</div>
              <div className="font-semibold text-lg text-gray-900">{appointment.service}</div>
            </div>
          </div>
          
          <div className="space-y-3 mt-4">
            {formattedAmount && (
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Valor del servicio</span>
                <span className="font-bold text-lg text-gray-900">
                  {formattedAmount}
                </span>
              </div>
            )}
            
            {isDeposit && formattedDeposit && (
              <div className="flex items-center justify-between pt-3 border-t border-gray-200">
                <span className="text-gray-600">Abono a pagar</span>
                <span className="font-bold text-xl text-yellow-700">
                  {formattedDeposit}
                </span>
              </div>
            )}
            
            {appointment.totalAmount && formattedTotal && isDeposit && !needsFullPayment && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Saldo pendiente</span>
                <span className="font-medium text-gray-700">
                  {formatCurrency(appointment.totalAmount - calculateFixedDeposit(), currency)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 🔥 INFORMACIÓN DE FECHA Y HORA */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-white border border-gray-200 rounded-xl">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Calendar className="h-5 w-5 text-purple-600" />
              </div>
              <div className="flex-1">
                <div className="text-xs text-gray-500">Fecha</div>
                <div className="font-semibold text-gray-900">{appointment.date}</div>
              </div>
            </div>
          </div>
          
          <div className="p-4 bg-white border border-gray-200 rounded-xl">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <Clock className="h-5 w-5 text-orange-600" />
              </div>
              <div className="flex-1">
                <div className="text-xs text-gray-500">Duración</div>
                <div className="font-semibold text-gray-900">{appointment.duration}</div>
              </div>
            </div>
          </div>
        </div>

        {/* 🔥 INFORMACIÓN DE UBICACIÓN */}
        <div className="p-4 bg-white border border-gray-200 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <MapPin className="h-5 w-5 text-red-600" />
            </div>
            <div className="flex-1">
              <div className="text-xs text-gray-500">Ubicación</div>
              <div className="font-semibold text-gray-900">{locationInfo}</div>
            </div>
          </div>
        </div>
      </div>

      {/* 🔥 NOTAS INFORMATIVAS */}
      <div className="mt-6 space-y-3">
        {needsFullPayment && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <div className="flex items-start gap-3">
              <div className="p-1 bg-blue-100 rounded">
                <DollarSign className="h-4 w-4 text-blue-600" />
              </div>
              <div className="text-sm text-blue-800">
                <div className="font-semibold mb-1">Pago completo requerido</div>
                <p>
                  Los servicios con valor igual o menor a {formatCurrency(calculateFixedDeposit(), currency)} 
                  requieren <strong>pago completo</strong> según políticas de la empresa.
                </p>
              </div>
            </div>
          </div>
        )}
        
        {isDeposit && !needsFullPayment && (
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
            <div className="flex items-start gap-3">
              <div className="p-1 bg-yellow-100 rounded">
                <Clock className="h-4 w-4 text-yellow-600" />
              </div>
              <div className="text-sm text-yellow-800">
                <div className="font-semibold mb-1">Información del abono</div>
                <p>
                  Este servicio requiere un abono de {formattedDeposit} para confirmar la reserva. 
                  El saldo restante deberá pagarse en el local antes del servicio.
                </p>
              </div>
            </div>
          </div>
        )}
        
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-center">
          <div className="text-xs text-gray-600">
            ℹ️ Reserva confirmada para {appointment.client} con {appointment.professional}
          </div>
        </div>
      </div>
    </Card>
  )
}
