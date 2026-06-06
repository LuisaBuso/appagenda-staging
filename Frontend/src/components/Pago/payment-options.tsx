"use client"

import { useEffect, useState } from "react"
import { DollarSign, AlertCircle, CreditCard, ShieldCheck } from "lucide-react"

interface PaymentOptionsProps {
    selectedType: "deposit" | "full"
    onTypeChange: (type: "deposit" | "full") => void
    depositAmount: string
    onDepositAmountChange: (amount: string) => void
    totalAmount: number
    fixedDeposit?: number
    canHaveDeposit?: boolean
    currency?: string
}

export function PaymentOptions({
    selectedType,
    onTypeChange,
    depositAmount,
    onDepositAmountChange,
    totalAmount,
    fixedDeposit,
    canHaveDeposit = true,
    currency: propCurrency
}: PaymentOptionsProps) {
    const [currency, setCurrency] = useState<string>("USD")
    const [isInitialized, setIsInitialized] = useState(false)
    
    // 🔥 OBTENER MONEDA AUTOMÁTICAMENTE
    useEffect(() => {
        const getCurrency = () => {
            // 1. De props (prioridad más alta)
            if (propCurrency) return propCurrency
            
            // 2. De sessionStorage
            if (typeof window !== 'undefined') {
                const storedCurrency = sessionStorage.getItem("beaux-moneda")
                if (storedCurrency) return storedCurrency
                
                // 3. Determinar por país
                const pais = sessionStorage.getItem("beaux-pais")
                if (pais === "Colombia") return "COP"
                if (pais === "México" || pais === "Mexico") return "MXN"
            }
            
            return "USD"
        }
        
        const detectedCurrency = getCurrency().toUpperCase()
        setCurrency(detectedCurrency)
        setIsInitialized(true)
    }, [propCurrency])
    
    // 🔥 SI HAY ABONO FIJO Y SE PERMITE, USAR ESE VALOR
    useEffect(() => {
        if (isInitialized && fixedDeposit && canHaveDeposit) {
            onDepositAmountChange(fixedDeposit.toString())
        }
    }, [fixedDeposit, canHaveDeposit, onDepositAmountChange, isInitialized])

    // 🔥 SI NO SE PERMITE ABONO, FORZAR PAGO COMPLETO
    useEffect(() => {
        if (isInitialized && !canHaveDeposit && selectedType === "deposit") {
            onTypeChange("full")
        }
    }, [canHaveDeposit, selectedType, onTypeChange, isInitialized])

    // 🔥 CALCULAR SI REQUIERE PAGO COMPLETO (servicios económicos)
    const requiresFullPayment = () => {
        if (!isInitialized) return false
        
        const fixedDepositAmount = getFixedDepositByCurrency()
        return totalAmount <= fixedDepositAmount
    }

    // 🔥 FORMATEAR MONTO
    const formatAmount = (amount: number, showCurrency = true) => {
        if (!isInitialized) return `$${amount}`
        
        switch (currency) {
            case "COP":
                return `$${amount.toLocaleString("es-CO", { maximumFractionDigits: 0 })}${showCurrency ? ' COP' : ''}`
            case "MXN":
                return `$${amount.toLocaleString("es-MX", { maximumFractionDigits: 0 })}${showCurrency ? ' MXN' : ''}`
            case "USD":
            default:
                return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}${showCurrency ? ' USD' : ''}`
        }
    }

    // 🔥 CALCULAR ABONO FIJO SEGÚN MONEDA
    const getFixedDepositByCurrency = () => {
        if (fixedDeposit) return fixedDeposit
        
        // 🔥 ABONO FIJO CONVERSIÓN
        switch (currency) {
            case "COP":
                return 50000 // $15 USD aprox
            case "MXN":
                return 250 // $15 USD aprox
            case "USD":
            default:
                return 15 // $15 USD fijo
        }
    }

    // 🔥 CALCULAR EL MÍNIMO RECOMENDADO (30%)
    const getMinimumRecommended = () => {
        return Math.round(totalAmount * 0.3)
    }

    // 🔥 MANEJAR CAMBIO EN INPUT DE ABONO
    const handleDepositChange = (value: string) => {
        const numValue = parseFloat(value) || 0
        
        // Validar que no sea mayor al total
        if (numValue > totalAmount) {
            onDepositAmountChange(totalAmount.toString())
        } else {
            onDepositAmountChange(value)
        }
    }

    const fixedDepositAmount = getFixedDepositByCurrency()
    const needsFullPayment = requiresFullPayment()
    const minimumRecommended = getMinimumRecommended()

    // 🔥 DETERMINAR SI SE PUEDE MOSTRAR ABONO
    const showDepositOption = canHaveDeposit && !needsFullPayment && totalAmount > fixedDepositAmount

    return (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg">
                        <CreditCard className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Opciones de pago</h2>
                        <p className="text-sm text-gray-600">Selecciona cómo quieres procesar el pago</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-800 rounded-full text-sm font-medium">
                    <DollarSign className="w-4 h-4" />
                    <span>{currency}</span>
                </div>
            </div>
            
            <div className="space-y-4">
                {/* 🔥 OPCIÓN DE ABONO */}
                {showDepositOption && (
                    <button
                        onClick={() => onTypeChange("deposit")}
                        className={`w-full p-5 text-left rounded-xl border-2 transition-all duration-200 ${
                            selectedType === "deposit" 
                                ? 'border-blue-500 bg-blue-50 shadow-sm ring-1 ring-blue-100' 
                                : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50'
                        }`}
                    >
                        <div className="flex items-start justify-between">
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                        selectedType === "deposit" 
                                            ? 'bg-blue-500 border-blue-500' 
                                            : 'border-gray-300'
                                    }`}>
                                        {selectedType === "deposit" && (
                                            <div className="w-2 h-2 rounded-full bg-white"></div>
                                        )}
                                    </div>
                                    <div className="font-semibold text-gray-900 text-lg">Abono</div>
                                </div>
                                <div className="ml-7 space-y-1">
                                    <div className="text-sm text-gray-600">
                                        {fixedDepositAmount 
                                            ? `Abono fijo de ${formatAmount(fixedDepositAmount)}`
                                            : `Reserva con abono personalizado`
                                        }
                                    </div>
                                    <div className="text-xs text-blue-600 font-medium">
                                        Saldo pendiente: {formatAmount(totalAmount - fixedDepositAmount)}
                                    </div>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-lg font-bold text-blue-600">
                                    {formatAmount(fixedDepositAmount, false)}
                                </div>
                                <div className="text-xs text-gray-500">del total</div>
                            </div>
                        </div>
                    </button>
                )}

                {/* 🔥 OPCIÓN DE PAGO COMPLETO */}
                <button
                    onClick={() => onTypeChange("full")}
                    className={`w-full p-5 text-left rounded-xl border-2 transition-all duration-200 ${
                        selectedType === "full" 
                            ? 'border-green-500 bg-green-50 shadow-sm ring-1 ring-green-100' 
                            : 'border-gray-200 bg-white hover:border-green-300 hover:bg-green-50'
                    }`}
                >
                    <div className="flex items-start justify-between">
                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                    selectedType === "full" 
                                        ? 'bg-green-500 border-green-500' 
                                        : 'border-gray-300'
                                }`}>
                                    {selectedType === "full" && (
                                        <div className="w-2 h-2 rounded-full bg-white"></div>
                                    )}
                                </div>
                                <div className="font-semibold text-gray-900 text-lg">Pago completo</div>
                            </div>
                            <div className="ml-7">
                                <div className="text-sm text-gray-600">
                                    Paga el total del servicio ahora
                                </div>
                                {needsFullPayment && (
                                    <div className="text-xs text-green-700 font-medium mt-1">
                                        (Requerido para servicios de {formatAmount(fixedDepositAmount, false)} o menos)
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-lg font-bold text-green-600">
                                {formatAmount(totalAmount, false)}
                            </div>
                            <div className="text-xs text-gray-500">monto total</div>
                        </div>
                    </div>
                </button>
            </div>

            {/* 🔥 INPUT PARA ABONO PERSONALIZADO (solo si no hay fijo y se seleccionó abono) */}
            {selectedType === "deposit" && !fixedDeposit && showDepositOption && (
                <div className="mt-6 p-5 bg-blue-50 rounded-xl border border-blue-200">
                    <div className="flex items-center gap-2 mb-3">
                        <DollarSign className="w-4 h-4 text-blue-600" />
                        <label className="block text-sm font-semibold text-blue-900">
                            Monto del abono
                        </label>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="px-4 py-3 bg-white border border-blue-300 rounded-lg font-medium text-blue-700 min-w-[80px] text-center">
                            {currency}
                        </div>
                        <input
                            type="number"
                            value={depositAmount}
                            onChange={(e) => handleDepositChange(e.target.value)}
                            onBlur={() => {
                                const value = parseFloat(depositAmount) || 0
                                if (value < minimumRecommended) {
                                    onDepositAmountChange(minimumRecommended.toString())
                                }
                            }}
                            className="flex-1 border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg font-medium"
                            placeholder="0"
                            min="0"
                            max={totalAmount}
                            step="0.01"
                        />
                    </div>
                    
                    <div className="mt-4 grid grid-cols-3 gap-2">
                        <button
                            onClick={() => handleDepositChange(minimumRecommended.toString())}
                            className="text-xs bg-white border border-blue-300 text-blue-700 px-3 py-2 rounded-lg hover:bg-blue-100 transition-colors"
                        >
                            30%: {formatAmount(minimumRecommended, false)}
                        </button>
                        <button
                            onClick={() => handleDepositChange(fixedDepositAmount.toString())}
                            className="text-xs bg-white border border-blue-300 text-blue-700 px-3 py-2 rounded-lg hover:bg-blue-100 transition-colors"
                        >
                            Fijo: {formatAmount(fixedDepositAmount, false)}
                        </button>
                        <button
                            onClick={() => handleDepositChange(totalAmount.toString())}
                            className="text-xs bg-white border border-blue-300 text-blue-700 px-3 py-2 rounded-lg hover:bg-blue-100 transition-colors"
                        >
                            100%: {formatAmount(totalAmount, false)}
                        </button>
                    </div>
                    
                    <div className="mt-4 p-3 bg-white rounded-lg border border-blue-200">
                        <div className="flex items-center gap-2 text-sm font-medium text-blue-900 mb-1">
                            <ShieldCheck className="w-4 h-4" />
                            Recomendaciones
                        </div>
                        <div className="text-xs text-blue-700 space-y-1">
                            <div>• Mínimo recomendado: {formatAmount(minimumRecommended)} (30%)</div>
                            <div>• Abono sugerido: {formatAmount(fixedDepositAmount)}</div>
                            <div>• Monto máximo: {formatAmount(totalAmount)}</div>
                        </div>
                    </div>
                </div>
            )}

            {/* 🔥 INFORMACIÓN ADICIONAL */}
            <div className="mt-6 space-y-3">
                {needsFullPayment && (
                    <div className="p-4 bg-yellow-50 border border-yellow-300 rounded-xl">
                        <div className="flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-yellow-700 flex-shrink-0 mt-0.5" />
                            <div className="text-sm text-yellow-800">
                                <div className="font-semibold mb-1">Pago completo requerido</div>
                                <p>
                                    Los servicios con valor igual o menor a {formatAmount(fixedDepositAmount)} 
                                    requieren <strong className="font-semibold">pago completo</strong> 
                                    por políticas de la empresa.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {!showDepositOption && totalAmount > fixedDepositAmount && (
                    <div className="p-4 bg-gray-50 border border-gray-300 rounded-xl">
                        <div className="flex items-start gap-3">
                            <div className="p-1 bg-gray-200 rounded">
                                <DollarSign className="w-4 h-4 text-gray-700" />
                            </div>
                            <div className="text-sm text-gray-700">
                                <div className="font-medium mb-1">Información de pagos</div>
                                <p>
                                    Este servicio no aplica para abono. 
                                    Se requiere <strong className="font-semibold">pago completo</strong> 
                                    de {formatAmount(totalAmount)} al momento de la reserva.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* 🔥 RESUMEN DE TARIFAS */}
                <div className="p-4 bg-gray-50 border border-gray-300 rounded-xl">
                    <div className="text-xs font-medium text-gray-700 mb-2">Tarifas de abono ({currency})</div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="space-y-1">
                            <div className="text-gray-600">Servicios económicos:</div>
                            <div className="font-semibold">Pago completo requerido</div>
                        </div>
                        <div className="space-y-1 text-right">
                            <div className="text-gray-600">Abono fijo:</div>
                            <div className="font-semibold">{formatAmount(fixedDepositAmount)}</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* 🔥 ESTADO ACTUAL */}
            <div className="mt-6 pt-4 border-t border-gray-200">
                <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Opción seleccionada:</span>
                    <span className="font-semibold">
                        {selectedType === "deposit" 
                            ? `Abono de ${formatAmount(fixedDepositAmount)}` 
                            : `Pago completo de ${formatAmount(totalAmount)}`
                        }
                    </span>
                </div>
            </div>
        </div>
    )
}
