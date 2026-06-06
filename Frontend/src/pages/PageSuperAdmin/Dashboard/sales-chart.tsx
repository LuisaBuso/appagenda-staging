"use client"

import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts"
import { ChartTooltip } from "../../../components/ui/chart"
import { formatMoney } from "./Api/formatMoney"
import { memo, useMemo } from "react"
import { getStoredCurrency, resolveCurrencyLocale } from "../../../lib/currency"

interface SalesChartProps {
  salesData: Array<{ [key: string]: any; value: number }>;
  formatCurrency?: (value: number) => string;
  title?: string;
  xAxisKey?: string;
}

export const SalesChart = memo(function SalesChart({ 
  salesData, 
  formatCurrency,
  title = "Tendencia de Ventas",
  xAxisKey = "month"
}: SalesChartProps) {
  const fallbackCurrency = getStoredCurrency("USD");
  const fallbackLocale = resolveCurrencyLocale(fallbackCurrency, "es-CO");
  
  const formatValue = useMemo(() => (value: number) => {
    if (formatCurrency) {
      return formatCurrency(value);
    }
    return formatMoney(value, fallbackCurrency, fallbackLocale);
  }, [fallbackCurrency, fallbackLocale, formatCurrency]);

  const defaultFormatYAxis = useMemo(() => (value: number) => {
    if (value >= 1000000) {
      return `$${Math.round(value / 1000000)}M`;
    } else if (value >= 1000) {
      return `$${Math.round(value / 1000)}K`;
    }
    return `$${value}`;
  }, []);

  const chartData = useMemo(() => salesData, [salesData]);

  const CustomTooltip = useMemo(() => function CustomTooltip({ active, payload, label }: any) {
    if (active && payload && payload.length) {
      const value = payload[0].value;
      const formattedValue = formatValue(value);
      
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-sm">
          <p className="text-sm font-semibold text-gray-900">{label}</p>
          <p className="text-base font-bold text-gray-900">{formattedValue}</p>
        </div>
      );
    }
    return null;
  }, [formatValue]);

  if (chartData.length === 0 || chartData.every(item => item.value === 0)) {
    return (
      <Card className="border border-gray-200">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium text-gray-900">{title}</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <div className="w-full h-32 bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-center mb-3">
              <div className="text-sm text-gray-500">No hay datos de ventas</div>
            </div>
            <p className="text-sm text-gray-500">Selecciona un período con datos disponibles</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border border-gray-200">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-medium text-gray-900">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-2 h-[200px]"> {/* AGREGAR h-[200px] aquí */}
        {/* ELIMINAR ChartContainer y usar directamente ResponsiveContainer */}
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#333333" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#333333" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis 
              dataKey={xAxisKey}
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: "#6b7280", fontSize: 12 }} 
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#6b7280", fontSize: 12 }}
              tickFormatter={defaultFormatYAxis}
            />
            <ChartTooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#333333"
              strokeWidth={2}
              fill="url(#colorValue)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
})
