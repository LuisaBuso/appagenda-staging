import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Skeleton } from "../../../../components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../../components/ui/table";
import { formatCurrencyNoDecimals, resolveCurrencyLocale } from "../../../../lib/currency";
import type { ProductRow } from "../super-admin-dashboard.utils";

interface ProductsDashboardTableProps {
  rows: ProductRow[];
  currency: string;
  loading?: boolean;
  note?: string | null;
}

const formatCurrency = (value: number, currency: string) =>
  formatCurrencyNoDecimals(value, currency, resolveCurrencyLocale(currency, "es-CO"));

export function ProductsDashboardTable({
  rows,
  currency,
  loading = false,
  note,
}: ProductsDashboardTableProps) {
  return (
    <Card className="border border-gray-200">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <CardTitle className="text-lg font-semibold text-gray-900">
            Dashboard de Productos
          </CardTitle>
          {note ? <p className="text-xs text-gray-500">{note}</p> : null}
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Unidades</TableHead>
                <TableHead>Ventas</TableHead>
                <TableHead>Participación %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: 6 }).map((_, index) => (
                    <TableRow key={`products-skeleton-${index}`}>
                      {Array.from({ length: 4 }).map((__, cellIndex) => (
                        <TableCell key={`products-skeleton-${index}-${cellIndex}`}>
                          <Skeleton className="h-4 w-full min-w-20" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : rows.length > 0
                  ? rows.slice(0, 8).map((row) => (
                      <TableRow key={row.productId} className="hover:bg-gray-50">
                        <TableCell className="font-medium text-gray-900">{row.producto}</TableCell>
                        <TableCell>{row.unidades}</TableCell>
                        <TableCell>{formatCurrency(row.ventas, currency)}</TableCell>
                        <TableCell>
                          <div className="flex min-w-[120px] items-center gap-3">
                            <div className="h-2 flex-1 rounded-full bg-gray-100">
                              <div
                                className="h-2 rounded-full bg-gray-500"
                                style={{ width: `${Math.min(100, Math.max(row.participacion, 4))}%` }}
                              />
                            </div>
                            <span className="text-sm text-gray-600">
                              {row.participacion.toFixed(row.participacion >= 10 ? 0 : 1)}%
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  : (
                    <TableRow>
                      <TableCell colSpan={4} className="py-10 text-center text-sm text-gray-500">
                        No hay ventas de productos disponibles para este período.
                      </TableCell>
                    </TableRow>
                  )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
