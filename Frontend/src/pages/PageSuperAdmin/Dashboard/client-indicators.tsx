"use client"

import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card"
import { Users, RefreshCw, AlertCircle, DollarSign, TrendingUp, TrendingDown } from "lucide-react"
import { formatMoney, extractNumericValue } from "./Api/formatMoney"
import { memo } from "react"
import { getStoredCurrency, resolveCurrencyLocale } from "../../../lib/currency"

// ACTUALIZA LA INTERFACE KPI para que coincida con analyticsApi.ts
interface KPI {
  valor: number | string;
  crecimiento: string | number; // Cambiado a string | number
}

interface ClientIndicatorsProps {
  nuevosClientes: KPI;
  tasaRecurrencia: KPI;
  tasaChurn: KPI;
  ticketPromedio: KPI;
  currency?: string;
}

export const ClientIndicators = memo(function ClientIndicators({ 
  nuevosClientes, 
  tasaRecurrencia, 
  tasaChurn, 
  ticketPromedio,
  currency = getStoredCurrency("USD"),
}: ClientIndicatorsProps) {
  
  const formatTicketPromedio = (value: number | string) => {
    if (typeof value === 'string') {
      const numericValue = extractNumericValue(value);
      return formatMoney(numericValue, currency, resolveCurrencyLocale(currency, "es-CO"));
    }
    return formatMoney(value, currency, resolveCurrencyLocale(currency, "es-CO"));
  };

  // Función segura para obtener el cambio como string
  const getSafeChange = (change: string | number): string => {
    if (typeof change === 'number') {
      return change > 0 ? `+${change}%` : `${change}%`;
    }
    return change || "0%";
  };

  // Función segura para determinar si es positivo
  const getIsPositive = (change: string | number): boolean => {
    const changeStr = getSafeChange(change);
    return changeStr.startsWith('+');
  };

  const indicators = [
    { 
      label: "Nuevos clientes", 
      value: nuevosClientes.valor, 
      change: getSafeChange(nuevosClientes.crecimiento), 
      positive: getIsPositive(nuevosClientes.crecimiento),
      icon: Users,
      isCurrency: false
    },
    { 
      label: "Recurrencia", 
      value: tasaRecurrencia.valor, 
      change: getSafeChange(tasaRecurrencia.crecimiento), 
      positive: getIsPositive(tasaRecurrencia.crecimiento),
      icon: RefreshCw,
      isCurrency: false
    },
    { 
      label: "Churn", 
      value: tasaChurn.valor, 
      change: getSafeChange(tasaChurn.crecimiento), 
      positive: !getIsPositive(tasaChurn.crecimiento), // al revés (menos churn es bueno)
      icon: AlertCircle,
      isCurrency: false
    },
    { 
      label: "Ticket promedio", 
      value: ticketPromedio.valor, 
      change: getSafeChange(ticketPromedio.crecimiento), 
      positive: getIsPositive(ticketPromedio.crecimiento),
      icon: DollarSign,
      isCurrency: true
    },
  ]

  return (
    <Card className="border border-gray-200">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-medium text-gray-900">Indicadores Clave</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        <div className="space-y-3">
          {indicators.map((indicator, index) => (
            <div key={index} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0 last:pb-0">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-gray-100 rounded">
                  <indicator.icon className="w-3.5 h-3.5 text-gray-700" />
                </div>
                <span className="text-sm text-gray-700 font-medium">{indicator.label}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-sm font-bold text-gray-900">
                  {indicator.isCurrency 
                    ? formatTicketPromedio(indicator.value)
                    : indicator.value}
                </span>
                <div className="flex items-center gap-1 mt-0.5">
                  {indicator.change && indicator.change !== "0%" && (
                    indicator.positive 
                      ? <TrendingUp className="w-3 h-3 text-green-600" />
                      : <TrendingDown className="w-3 h-3 text-red-600" />
                  )}
                  <span className={`text-xs font-medium ${
                    indicator.positive ? "text-green-600" : "text-red-600"
                  }`}>
                    {indicator.change || "0%"}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
})
