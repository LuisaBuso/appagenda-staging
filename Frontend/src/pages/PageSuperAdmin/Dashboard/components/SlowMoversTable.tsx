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
import { formatDateDMY } from "../../../../lib/dateFormat";
import type { SlowMoverRow } from "../super-admin-dashboard.utils";

interface SlowMoversTableProps {
  rows: SlowMoverRow[];
  loading?: boolean;
  note?: string | null;
}

export function SlowMoversTable({
  rows,
  loading = false,
  note,
}: SlowMoversTableProps) {
  return (
    <Card className="border border-gray-200">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <CardTitle className="text-lg font-semibold text-gray-900">Slow Movers</CardTitle>
          <p className="text-xs text-gray-500">{note || "Productos con baja rotación en 30 días"}</p>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Ventas 30 días</TableHead>
                <TableHead>Última venta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: 6 }).map((_, index) => (
                    <TableRow key={`slow-skeleton-${index}`}>
                      {Array.from({ length: 3 }).map((__, cellIndex) => (
                        <TableCell key={`slow-skeleton-${index}-${cellIndex}`}>
                          <Skeleton className="h-4 w-full min-w-20" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : rows.length > 0
                  ? rows.slice(0, 8).map((row) => (
                      <TableRow key={row.productId} className="hover:bg-gray-50">
                        <TableCell className="font-medium text-gray-900">{row.producto}</TableCell>
                        <TableCell>{row.ventas30Dias}</TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {row.ultimaVentaConocida && row.ultimaVenta
                            ? formatDateDMY(row.ultimaVenta)
                            : "Sin venta en 30 días"}
                        </TableCell>
                      </TableRow>
                    ))
                  : (
                    <TableRow>
                      <TableCell colSpan={3} className="py-10 text-center text-sm text-gray-500">
                        No hay productos para evaluar baja rotación.
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
