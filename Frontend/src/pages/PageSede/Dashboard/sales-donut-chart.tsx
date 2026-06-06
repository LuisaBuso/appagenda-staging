"use client"

import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card"
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts"
import { ChartContainer } from "../../../components/ui/chart"
import { formatMoney } from "./formatMoney"
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

export function SalesDonutChart({ donutData, formatCurrency, title = "Distribución de Ventas" }: SalesDonutChartProps) {
  const fallbackCurrency = getStoredCurrency("USD");
  const fallbackLocale = resolveCurrencyLocale(fallbackCurrency, "es-CO");
  
  const formatValue = (value: number) => {
    if (formatCurrency) {
      return formatCurrency(value);
    }
    return formatMoney(value, fallbackCurrency, fallbackLocale);
  };

  const total = donutData.reduce((sum, item) => sum + item.value, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col lg:flex-row items-center lg:items-start gap-8">
          <ChartContainer
            config={{
              servicios: { label: "Servicios", color: "oklch(0.7 0.25 280)" },
              productos: { label: "Productos", color: "oklch(0.8 0.15 280)" },
            }}
            className="h-[160px] w-[160px]"
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie 
                  data={donutData} 
                  cx="50%" 
                  cy="50%" 
                  innerRadius={50} 
                  outerRadius={80} 
                  paddingAngle={0} 
                  dataKey="value"
                >
                  {donutData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </ChartContainer>

          <div className="flex-1">
            <div className="mb-4">
              <div className="text-sm text-gray-600">Total de ventas</div>
              <div className="text-2xl font-bold text-gray-900">
                {formatValue(total)}
              </div>
            </div>
            
            <div className="space-y-3">
              {donutData.map((item, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                    <div>
                      <div className="text-sm font-medium">{item.name}</div>
                      <div className="text-xs text-gray-500">
                        {total > 0 ? `${((item.value / total) * 100).toFixed(1)}%` : '0%'}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold">{formatValue(item.value)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
