// src/pages/Dashboard/client-indicators.tsx
"use client"

import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card"
import { Users, RefreshCw, AlertCircle, DollarSign } from "lucide-react"
import { formatMoney, extractNumericValue } from "./formatMoney"
import { getStoredCurrency, resolveCurrencyLocale } from "../../../lib/currency"

interface KPI {
  valor: number | string;
  crecimiento: string | number | null | undefined;
}

interface ClientIndicatorsProps {
  nuevosClientes: KPI;
  tasaRecurrencia: KPI;
  tasaChurn: KPI;
  ticketPromedio: KPI;
  currency?: string;
}

export function ClientIndicators({ 
  nuevosClientes, 
  tasaRecurrencia, 
  tasaChurn, 
  ticketPromedio,
  currency = getStoredCurrency("USD"),
}: ClientIndicatorsProps) {

  // --- SAFE METHOD ---
  const isPositiveChange = (value: KPI["crecimiento"]) => {
    if (!value) return false;
    const str = String(value).trim();
    if (str.startsWith("+")) return true;
    if (str.startsWith("-")) return false;

    // Si no trae signo, lo interpretamos como número
    const num = parseFloat(str.replace("%", ""));
    return num > 0;
  };

  const formatTicketPromedio = (value: number | string) => {
    const numericValue =
      typeof value === "string" ? extractNumericValue(value) : value;
    return formatMoney(numericValue, currency, resolveCurrencyLocale(currency, "es-CO"));
  };

  const safeChange = (value: KPI["crecimiento"]) =>
    value == null ? "0%" : String(value);

  const indicators = [
    {
      label: "Nuevos clientes", 
      value: nuevosClientes.valor, 
      change: safeChange(nuevosClientes.crecimiento),
      positive: isPositiveChange(nuevosClientes.crecimiento),
      icon: Users,
      isCurrency: false
    },
    { 
      label: "Recurrencia", 
      value: tasaRecurrencia.valor, 
      change: safeChange(tasaRecurrencia.crecimiento),
      positive: isPositiveChange(tasaRecurrencia.crecimiento),
      icon: RefreshCw,
      isCurrency: false
    },
    { 
      label: "Churn", 
      value: tasaChurn.valor, 
      change: safeChange(tasaChurn.crecimiento),
      positive: !isPositiveChange(tasaChurn.crecimiento), // al revés (menos churn es bueno)
      icon: AlertCircle,
      isCurrency: false
    },
    { 
      label: "Ticket promedio", 
      value: ticketPromedio.valor, 
      change: safeChange(ticketPromedio.crecimiento),
      positive: isPositiveChange(ticketPromedio.crecimiento),
      icon: DollarSign,
      isCurrency: true
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Indicadores Clave</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {indicators.map((indicator, index) => (
            <div key={index} className="flex items-center justify-between border-b pb-3 last:border-0 last:pb-0">
              <span className="text-sm text-gray-600 flex items-center gap-2">
                <indicator.icon className="w-4 h-4" />
                {indicator.label}
              </span>
              <div className="flex items-center gap-2">
                <span className="font-semibold">
                  {indicator.isCurrency 
                    ? formatTicketPromedio(indicator.value)
                    : indicator.value}
                </span>
                <span className={`text-xs ${indicator.positive ? "text-green-600" : "text-red-600"}`}>
                  {indicator.change}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
