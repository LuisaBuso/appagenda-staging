"use client"

import { Card } from "../../components/ui/card"
import { DollarSign, CreditCard, Wallet, Link as LinkIcon, Banknote, Globe, CheckCircle, Gift } from "lucide-react"
import { useEffect, useState } from "react"
import { normalizePaymentMethodForBackend, PAYROLL_PAYMENT_METHOD } from "../../lib/payment-methods"

interface PaymentMethodSelectorProps {
  selectedMethod: string  // Valor del backend
  onMethodChange: (method: string) => void
  amount: string | number
  paymentType: string
  currency?: string
  isDeposit?: boolean
  depositAmount?: number
  disabled?: boolean  // Nueva prop para deshabilitar selección
}

// 🔥 TIPO PARA MÉTODOS DE PAGO
interface PaymentMethod {
  id: string
  backendValue: string
  displayName: string
  icon: React.ReactNode
  description: string
  available: boolean
}

// 🔥 MÉTODOS DE PAGO CONFIGURABLES
const paymentMethodMap: PaymentMethod[] = [
  { 
    id: "link_pago",
    backendValue: "link_pago", 
    displayName: "Pago con link", 
    icon: <LinkIcon className="w-5 h-5" />,
    description: "Envía un link de pago al cliente",
    available: true
  },
  { 
    id: "tarjeta_credito",
    backendValue: "tarjeta_credito", 
    displayName: "Tarjeta de Crédito", 
    icon: <CreditCard className="w-5 h-5" />,
    description: "Pago con tarjeta de crédito",
    available: true
  },
  {
    id: "tarjeta_debito",
    backendValue: "tarjeta_debito",
    displayName: "Tarjeta de Débito",
    icon: <CreditCard className="w-5 h-5" />,
    description: "Pago con tarjeta de débito",
    available: true
  },
  {
    id: "giftcard",
    backendValue: "giftcard",
    displayName: "Gift Card",
    icon: <Gift className="w-5 h-5" />,
    description: "Pago con Gift Card",
    available: true
  },
  {
    id: "addi",
    backendValue: "addi",
    displayName: "Addi",
    icon: <Wallet className="w-5 h-5" />,
    description: "Pago con Addi",
    available: true
  },
  { 
    id: "efectivo",
    backendValue: "efectivo", 
    displayName: "Efectivo", 
    icon: <Banknote className="w-5 h-5" />,
    description: "Pago en efectivo en local",
    available: true
  },
  { 
    id: "transferencia",
    backendValue: "transferencia", 
    displayName: "Transferencia", 
    icon: <Wallet className="w-5 h-5" />,
    description: "Transferencia bancaria",
    available: true
  },
  {
    id: PAYROLL_PAYMENT_METHOD,
    backendValue: PAYROLL_PAYMENT_METHOD,
    displayName: "Descuento por nómina",
    icon: <Wallet className="w-5 h-5" />,
    description: "Descuento aplicado por nómina",
    available: true
  }
];

// 🔥 MÉTODOS LEGACY PARA MOSTRAR ETIQUETA CORRECTA EN DATOS ANTIGUOS
const legacyMethods: Record<string, PaymentMethod> = {
  tarjeta: {
    id: "tarjeta",
    backendValue: "tarjeta",
    displayName: "Tarjeta",
    icon: <CreditCard className="w-5 h-5" />,
    description: "Método anterior (compatibilidad)",
    available: true
  },
  descuento_nomina: {
    id: "descuento_nomina",
    backendValue: PAYROLL_PAYMENT_METHOD,
    displayName: "Descuento por nómina",
    icon: <Wallet className="w-5 h-5" />,
    description: "Método anterior (compatibilidad)",
    available: true
  }
}

// 🔥 OPCIONES ESPECIALES (con id incluido)
const specialMethods: Record<string, PaymentMethod> = {
  sin_pago: {
    id: "sin_pago",
    backendValue: "sin_pago",
    displayName: "Sin pago",
    icon: <div className="text-lg">📅</div>,
    description: "Reserva sin pago inmediato",
    available: true
  }
}

export function PaymentMethodSelector({
  selectedMethod,
  onMethodChange,
  amount,
  paymentType,
  currency: propCurrency,
  isDeposit = false,
  depositAmount,
  disabled = false
}: PaymentMethodSelectorProps) {
  // 🔥 ESTADOS
  const [currency, setCurrency] = useState<string>("USD")
  const [loading, setLoading] = useState(true)
  const isCopCurrency = currency === "COP"
  const normalizedSelectedMethod = normalizePaymentMethodForBackend(selectedMethod)
  
  // 🔥 OBTENER MONEDA DEL USUARIO
  useEffect(() => {
    const getCurrency = () => {
      try {
        // 1. Prioridad: props
        if (propCurrency) {
          console.log("💰 Moneda desde props:", propCurrency)
          return propCurrency
        }
        
        // 2. SessionStorage específico
        if (typeof window !== 'undefined') {
          const storedCurrency = sessionStorage.getItem("beaux-moneda")
          if (storedCurrency) {
            console.log("💰 Moneda desde sessionStorage:", storedCurrency)
            return storedCurrency
          }
          
          // 3. Determinar por país
          const pais = sessionStorage.getItem("beaux-pais")
          if (pais) {
            if (pais === "Colombia") return "COP"
            if (pais === "México" || pais === "Mexico") return "MXN"
            if (pais === "Estados Unidos" || pais === "USA") return "USD"
          }
        }
        
        // 4. Default
        console.log("💰 Usando moneda por defecto: USD")
        return "USD"
      } catch (error) {
        console.error("❌ Error obteniendo moneda:", error)
        return "USD"
      }
    }
    
    const moneda = getCurrency()
    setCurrency(moneda.toUpperCase())
    setLoading(false)
  }, [propCurrency])
  
  // 🔥 OBTENER TODOS LOS MÉTODOS DISPONIBLES
  const getAllMethods = (): PaymentMethod[] => {
    const allMethods = paymentMethodMap.filter(
      (method) => isCopCurrency || method.backendValue !== "addi"
    )
    
    // Si es reserva sin pago, agregar opción especial
    if (paymentType.toLowerCase().includes("reserva") || selectedMethod === "sin_pago") {
      allMethods.unshift(specialMethods.sin_pago)
    }
    
    return allMethods
  }

  // 🔒 Addi solo aplica para sedes COP
  useEffect(() => {
    if (loading) return
    if (!isCopCurrency && normalizedSelectedMethod === "addi") {
      const fallbackMethod = paymentType.toLowerCase().includes("reserva") ? "sin_pago" : "efectivo"
      onMethodChange(fallbackMethod)
    }
  }, [loading, isCopCurrency, normalizedSelectedMethod, paymentType, onMethodChange])
  
  // 🔥 OBTENER MÉTODO ACTUAL
  const getCurrentMethod = (): PaymentMethod => {
    const allMethods = getAllMethods()
    return allMethods.find(m => m.backendValue === normalizedSelectedMethod) ||
           legacyMethods[selectedMethod] ||
           paymentMethodMap[0] // Fallback
  }
  
  // 🔥 FORMATEAR MONTO
  const formatAmount = (amount: string | number) => {
    if (loading) return "Cargando..."
    
    const amountNumber = typeof amount === "string" ? Number(amount) : amount
    
    if (isNaN(amountNumber)) {
      return "Monto inválido"
    }
    
    // Formato según moneda
    switch (currency) {
      case "COP":
        return `$${amountNumber.toLocaleString("es-CO", { maximumFractionDigits: 0 })} COP`
      case "MXN":
        return `$${amountNumber.toLocaleString("es-MX", { maximumFractionDigits: 0 })} MXN`
      case "USD":
      default:
        return `$${amountNumber.toLocaleString("en-US", { maximumFractionDigits: 0 })} USD`
    }
  }
  
  // 🔥 OBTENER PAÍS Y LOCAL
  const getLocationInfo = () => {
    if (typeof window === 'undefined') return "Cargando..."
    
    try {
      const pais = sessionStorage.getItem("beaux-pais") || "País no configurado"
      const local = sessionStorage.getItem("beaux-nombre_local") || "Local"
      
      return `${local} - ${pais}`
    } catch {
      return "Información no disponible"
    }
  }
  
  // 🔥 CALCULAR ABONO FIJO
  const calculateFixedDeposit = () => {
    if (depositAmount !== undefined) return depositAmount
    
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
  
  // 🔥 OBTENER NOMBRE DE MONEDA
  const getCurrencyName = () => {
    switch (currency) {
      case "COP":
        return "Pesos Colombianos"
      case "MXN":
        return "Pesos Mexicanos"
      case "USD":
        return "Dólares Americanos"
      default:
        return currency
    }
  }
  
  // 🔥 MANEJAR CAMBIO DE MÉTODO
  const handleMethodChange = (method: string) => {
    if (disabled) return
    
    console.log(`🎯 Cambiando método: ${method}`)
    onMethodChange(method)
  }
  
  const fixedDeposit = calculateFixedDeposit()
  const currentMethod = getCurrentMethod()
  const allMethods = getAllMethods()
  const formattedAmount = formatAmount(amount)
  
  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600">Cargando métodos de pago...</span>
        </div>
      </Card>
    )
  }
  
  return (
    <Card className="p-6 border-gray-200 shadow-sm">
      {/* 🔥 ENCABEZADO */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CreditCard className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-semibold text-gray-900">Método de pago</h3>
          </div>
          <p className="text-sm text-gray-600">
            Selecciona cómo deseas procesar el {isDeposit ? "abono" : "pago"}
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg border border-blue-200">
            <Globe className="w-4 h-4" />
            <span className="text-sm font-medium">{getCurrencyName()}</span>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border font-semibold ${
            isDeposit 
              ? 'bg-yellow-50 text-yellow-700 border-yellow-300' 
              : 'bg-green-50 text-green-700 border-green-300'
          }`}>
            <DollarSign className="w-4 h-4" />
            <span>{formattedAmount}</span>
          </div>
        </div>
      </div>
      
      {/* 🔥 RESUMEN DEL PAGO */}
      <div className="mb-6 p-4 rounded-xl bg-gray-50 border border-gray-200">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Ubicación</span>
              <span className="text-sm font-medium text-gray-900">{getLocationInfo()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Tipo</span>
              <span className={`text-sm font-semibold px-2 py-1 rounded ${
                paymentType.toLowerCase().includes("abono") 
                  ? "bg-yellow-100 text-yellow-800" 
                  : "bg-blue-100 text-blue-800"
              }`}>
                {paymentType}
              </span>
            </div>
          </div>
          
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Moneda</span>
              <span className="text-sm font-semibold text-gray-900">
                {currency}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Método actual</span>
              <span className="text-sm font-semibold text-green-700 flex items-center gap-1">
                {currentMethod.icon}
                {currentMethod.displayName}
              </span>
            </div>
          </div>
        </div>
        
        {/* 🔥 NOTA IMPORTANTE */}
        {isDeposit && (
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="text-sm text-yellow-800">
              <span className="font-semibold">📝 Nota:</span> Este es un abono de {formatAmount(fixedDeposit)}. 
              El saldo restante deberá pagarse en el local.
            </div>
          </div>
        )}
      </div>
      
      {/* 🔥 MÉTODOS DE PAGO */}
      <div className="mb-6">
        <h4 className="text-sm font-semibold text-gray-800 mb-4">
          Selecciona un método
        </h4>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {allMethods.map((method) => {
            const isSelected = normalizedSelectedMethod === method.backendValue
            const isDisabled = disabled || !method.available
            
            return (
              <button
                key={method.id}
                onClick={() => handleMethodChange(method.backendValue)}
                disabled={isDisabled}
                className={`
                  p-4 rounded-xl border-2 transition-all duration-200
                  flex items-center gap-4 text-left
                  ${isSelected 
                    ? 'border-blue-500 bg-blue-50 shadow-md ring-1 ring-blue-100' 
                    : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                  }
                  ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md'}
                `}
              >
                <div className={`
                  p-2.5 rounded-lg flex-shrink-0
                  ${isSelected ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'}
                `}>
                  {method.icon}
                </div>
                
                <div className="flex-1">
                  <div className="font-semibold text-gray-800">{method.displayName}</div>
                  {method.description && (
                    <div className="text-xs text-gray-600 mt-0.5">{method.description}</div>
                  )}
                </div>
                
                <div className="flex-shrink-0">
                  {isSelected ? (
                    <div className="flex items-center justify-center">
                      <CheckCircle className="w-5 h-5 text-blue-600" />
                    </div>
                  ) : (
                    <div className="w-5 h-5 border-2 border-gray-300 rounded-full"></div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>
      
      {/* 🔥 DETALLES FINALES */}
      <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
        <div className="text-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Monto a pagar:</span>
            <span className="font-bold text-lg text-gray-900">{formattedAmount}</span>
          </div>
          
          <div className="flex items-center justify-between pt-3 border-t border-gray-200">
            <div>
              <div className="text-gray-600">Método seleccionado</div>
              <div className="font-semibold text-green-700 flex items-center gap-2 mt-1">
                {currentMethod.icon}
                {currentMethod.displayName}
              </div>
            </div>
            
            <div className="text-right">
              <div className="text-gray-600">Tipo de transacción</div>
              <div className={`font-semibold ${
                isDeposit ? 'text-yellow-700' : 'text-blue-700'
              }`}>
                {isDeposit ? 'Abono' : 'Pago completo'}
              </div>
            </div>
          </div>
          
          {disabled && (
            <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-center">
              <div className="text-sm text-yellow-700">
                La selección de método de pago está deshabilitada para este tipo de proceso.
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
