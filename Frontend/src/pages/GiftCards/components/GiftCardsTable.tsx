import { Loader2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import type { GiftCard } from "../types";
import { GiftCardStatusBadge } from "./GiftCardStatusBadge";
import { formatGiftCardDate, formatMoney, resolveGiftCardSedeName } from "./utils";

interface GiftCardsTableProps {
  giftCards: GiftCard[];
  currency: string;
  isFetching: boolean;
  sedeNamesById?: Record<string, string>;
  fallbackSedeName?: string;
}

export function GiftCardsTable({
  giftCards,
  currency,
  isFetching,
  sedeNamesById,
  fallbackSedeName,
}: GiftCardsTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-300 bg-white shadow-sm">
      {isFetching ? (
        <div className="flex items-center justify-end border-b border-gray-200 px-5 py-3 text-xs text-gray-500">
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          Actualizando...
        </div>
      ) : null}

      <Table className="text-sm">
        <TableHeader>
          <TableRow className="bg-gray-50 hover:bg-gray-50">
            <TableHead className="px-5 text-xs font-semibold uppercase tracking-wide text-gray-600">Código</TableHead>
            <TableHead className="px-5 text-xs font-semibold uppercase tracking-wide text-gray-600">Nombre Sede</TableHead>
            <TableHead className="px-5 text-xs font-semibold uppercase tracking-wide text-gray-600">Cliente comprador</TableHead>
            <TableHead className="px-5 text-xs font-semibold uppercase tracking-wide text-gray-600">Beneficiario</TableHead>
            <TableHead className="px-5 text-xs font-semibold uppercase tracking-wide text-gray-600">Valor inicial</TableHead>
            <TableHead className="px-5 text-xs font-semibold uppercase tracking-wide text-gray-600">Saldo actual</TableHead>
            <TableHead className="px-5 text-xs font-semibold uppercase tracking-wide text-gray-600">Fecha emisión</TableHead>
            <TableHead className="px-5 text-xs font-semibold uppercase tracking-wide text-gray-600">Estado</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {giftCards.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="px-5 py-14 text-center text-sm text-gray-500">
                No se encontraron Gift Cards con los filtros aplicados.
              </TableCell>
            </TableRow>
          ) : (
            giftCards.map((giftCard) => (
              <TableRow key={giftCard._id || giftCard.codigo} className="h-16 hover:bg-gray-50">
                <TableCell className="px-5 py-4 align-middle font-semibold text-gray-900">{giftCard.codigo}</TableCell>
                <TableCell className="px-5 py-4 align-middle font-medium text-gray-900">
                  {resolveGiftCardSedeName({
                    sedeId: giftCard.sede_id,
                    sedeNombre: giftCard.sede_nombre,
                    sedeNamesById,
                    fallbackSedeName,
                  })}
                </TableCell>
                <TableCell className="px-5 py-4 align-middle text-gray-700">
                  <div className="font-semibold text-gray-900">{giftCard.comprador_nombre?.trim() || "Sin comprador"}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    {giftCard.comprador_email?.trim() || "-"}
                  </div>
                </TableCell>
                <TableCell className="px-5 py-4 align-middle text-gray-700">
                  <div className="font-medium text-gray-900">
                    {giftCard.beneficiario_nombre?.trim() || giftCard.comprador_nombre?.trim() || "Sin beneficiario"}
                  </div>
                </TableCell>
                <TableCell className="px-5 py-4 align-middle font-medium text-gray-900">
                  {formatMoney(Number(giftCard.valor || 0), giftCard.moneda || currency)}
                </TableCell>
                <TableCell className="px-5 py-4 align-middle font-medium text-gray-900">
                  {formatMoney(
                    Number(giftCard.saldo_disponible || 0) + Number(giftCard.saldo_reservado || 0),
                    giftCard.moneda || currency
                  )}
                </TableCell>
                <TableCell className="px-5 py-4 align-middle text-gray-700">
                  {formatGiftCardDate(giftCard.fecha_emision || giftCard.created_at)}
                </TableCell>
                <TableCell className="px-5 py-4 align-middle">
                  <GiftCardStatusBadge status={giftCard.estado} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
