import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
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
import { formatSedeNombre } from "../../../../lib/sede";
import type { FranchiseRow } from "../super-admin-dashboard.utils";

interface FranchiseSalesTableProps {
  rows: FranchiseRow[];
  loading?: boolean;
  pageSize?: number;
}

const formatRowCurrency = (value: number, currency: string) => {
  return formatCurrencyNoDecimals(value, currency, resolveCurrencyLocale(currency, "es-CO"));
};

export function FranchiseSalesTable({
  rows,
  loading = false,
  pageSize = 6,
}: FranchiseSalesTableProps) {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [rows.length, pageSize]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedRows = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return rows.slice(startIndex, startIndex + pageSize);
  }, [currentPage, pageSize, rows]);

  return (
    <Card className="border border-gray-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-semibold text-gray-900">
          Ventas por Franquicias / Sedes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead>Sede</TableHead>
                <TableHead>Ventas Totales</TableHead>
                <TableHead>Citas Realizadas</TableHead>
                <TableHead>Ventas Productos</TableHead>
                <TableHead>Ticket Promedio</TableHead>
                <TableHead>Clientes Atendidos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: pageSize }).map((_, index) => (
                    <TableRow key={`franchise-skeleton-${index}`}>
                      {Array.from({ length: 6 }).map((__, cellIndex) => (
                        <TableCell key={`franchise-skeleton-${index}-${cellIndex}`}>
                          <Skeleton className="h-4 w-full min-w-20" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : paginatedRows.length > 0
                  ? paginatedRows.map((row) => (
                      <TableRow key={row.sedeId} className="hover:bg-gray-50">
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">
                              {formatSedeNombre(row.sede)}
                            </span>
                            {row.isPartial ? (
                              <Badge
                                variant="outline"
                                className="border-gray-300 bg-gray-50 text-[10px] text-gray-600"
                              >
                                Parcial
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="font-medium text-gray-900">
                          {formatRowCurrency(row.ventasTotales, row.currency)}
                        </TableCell>
                        <TableCell>{row.citasRealizadas}</TableCell>
                        <TableCell>{formatRowCurrency(row.ventasProductos, row.currency)}</TableCell>
                        <TableCell>{formatRowCurrency(row.ticketPromedio, row.currency)}</TableCell>
                        <TableCell>{row.clientesAtendidos}</TableCell>
                      </TableRow>
                    ))
                  : (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-gray-500">
                        No hay sedes con datos para el período seleccionado.
                      </TableCell>
                    </TableRow>
                  )}
            </TableBody>
          </Table>
        </div>

        {!loading && rows.length > pageSize ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-gray-500">
              Mostrando {(currentPage - 1) * pageSize + 1} a{" "}
              {Math.min(currentPage * pageSize, rows.length)} de {rows.length} sedes
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-gray-300"
                disabled={currentPage === 1}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              >
                Anterior
              </Button>
              <span className="text-sm text-gray-600">
                Página {currentPage} de {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="border-gray-300"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              >
                Siguiente
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
