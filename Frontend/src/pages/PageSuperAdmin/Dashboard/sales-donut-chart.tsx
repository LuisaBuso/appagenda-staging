"use client"

import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card"
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts"
import { formatMoney } from "./Api/formatMoney"
import { memo, useMemo } from "react"
import { getStoredCurrency, resolveCurrencyLocale } from "../../../lib/currency"

interface DonutDataItem {
  name: string;
  value: number;
  color: string;
}

interface SalesDonutChartProps {
  donutData: DonutDataItem[];
  formatCurrency?: (value: number) => string;
  title?: string;
}

const DEFAULT_COLORS = {
  Servicios: "#333333",
  Productos: "#666666",
  Ventas: "#333333",
  default: "#888888"
};

export const SalesDonutChart = memo(function SalesDonutChart({ 
  donutData, 
  formatCurrency,
  title = "Distribución de Ventas"
}: SalesDonutChartProps) {
  const fallbackCurrency = getStoredCurrency("USD");
  const fallbackLocale = resolveCurrencyLocale(fallbackCurrency, "es-CO");
  
  const formatValue = useMemo(() => (value: number) => {
    if (formatCurrency) {
      return formatCurrency(value);
    }
    return formatMoney(value, fallbackCurrency, fallbackLocale);
  }, [fallbackCurrency, fallbackLocale, formatCurrency]);

  const { total, enhancedData } = useMemo(() => {
    const totalValue = donutData.reduce((sum, item) => sum + item.value, 0);
    
    const enhanced = donutData.map(item => ({
      ...item,
      color: DEFAULT_COLORS[item.name as keyof typeof DEFAULT_COLORS] || DEFAULT_COLORS.default,
      percentage: totalValue > 0 ? (item.value / totalValue) * 100 : 0
    }));

    return { total: totalValue, enhancedData: enhanced };
  }, [donutData]);

  if (donutData.length === 0 || total === 0) {
    return (
      <Card className="border border-gray-200">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium text-gray-900">{title}</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <div className="w-24 h-24 rounded-full bg-gray-100 border-8 border-gray-200 flex items-center justify-center mb-3">
              <span className="text-sm text-gray-500">Sin datos</span>
            </div>
            <p className="text-sm text-gray-500">No hay datos de ventas disponibles</p>
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
      <CardContent className="p-4 pt-2">
        <div className="flex flex-col lg:flex-row items-center lg:items-start gap-6">
          {/* ELIMINAR ChartContainer y usar div simple */}
          <div className="h-[160px] w-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={enhancedData} 
                  cx="50%" 
                  cy="50%" 
                  innerRadius={50} 
                  outerRadius={80} 
                  paddingAngle={0} 
                  dataKey="value"
                >
                  {enhancedData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="flex-1">
            <div className="mb-4">
              <div className="text-sm text-gray-600">Total de ventas</div>
              <div className="text-2xl font-bold text-gray-900">
                {formatValue(total)}
              </div>
            </div>
            
            <div className="space-y-3">
              {enhancedData.map((item, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div 
                      className="h-3 w-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{item.name}</div>
                      <div className="text-xs text-gray-500">{item.percentage.toFixed(1)}%</div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-semibold text-gray-900">{formatValue(item.value)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
})
