"use client"

import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts"
import { ChartContainer } from "../../../components/ui/chart"
import { formatMoney } from "./formatMoney"
import { getStoredCurrency, resolveCurrencyLocale } from "../../../lib/currency"

// INTERFAZ CORREGIDA - acepta cualquier clave string
interface SalesDataPoint {
  [key: string]: string | number;
  value: number;
}

interface SalesChartProps {
  salesData: SalesDataPoint[];
  formatCurrency?: (value: number) => string;
  title?: string;
  xAxisKey?: string;  // Clave para el eje X
  yAxisLabel?: string;
  color?: string;
  showGrid?: boolean;
  height?: number;
}

export function SalesChart({ 
  salesData, 
  formatCurrency, 
  title = "Tendencia de Ventas",
  xAxisKey = "label", // Valor por defecto más genérico
  yAxisLabel = "Ventas",
  color = "oklch(0.65 0.25 280)",
  height = 200
}: SalesChartProps) {
  const fallbackCurrency = getStoredCurrency("USD");
  const fallbackLocale = resolveCurrencyLocale(fallbackCurrency, "es-CO");
  
  // Función para formatear valores del eje Y
  const formatYAxis = (value: number) => {
    if (value >= 1000000) {
      return `$${Math.round(value / 1000000)}M`;
    } else if (value >= 1000) {
      return `$${Math.round(value / 1000)}K`;
    }
    return `$${value}`;
  };

  // Función para tooltip personalizado
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const value = payload[0].value;
      const formattedValue = formatCurrency 
        ? formatCurrency(value)
        : formatMoney(value, fallbackCurrency, fallbackLocale);
      
      return (
        <div className="bg-white p-3 border rounded-lg shadow-lg">
          <p className="font-semibold text-gray-900">{label}</p>
          <p className="text-blue-600 font-bold">{formattedValue}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={{
            value: {
              label: yAxisLabel,
              color: color,
            },
          }}
          style={{ height: `${height}px` }}
          className="w-full"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={salesData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis 
                dataKey={xAxisKey}  // Usa la clave dinámica
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: "#6b7280", fontSize: 12 }} 
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#6b7280", fontSize: 12 }}
                tickFormatter={formatYAxis}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                fill="url(#colorValue)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
