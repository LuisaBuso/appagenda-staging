import { useMemo } from "react";
import { Mail, Printer, X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import type { GiftCard } from "../types";
import { GiftCardStatusBadge } from "./GiftCardStatusBadge";
import { formatGiftCardDate, formatMoney, getGiftCardValidityLabel, resolveGiftCardSedeName } from "./utils";

interface GiftCardConfirmationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  giftCard: GiftCard | null;
  fallbackCurrency: string;
  beneficiaryEmail?: string;
  sedeNamesById?: Record<string, string>;
  fallbackSedeName?: string;
}

function escapeForHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function GiftCardConfirmationModal({
  open,
  onOpenChange,
  giftCard,
  fallbackCurrency,
  beneficiaryEmail,
  sedeNamesById,
  fallbackSedeName,
}: GiftCardConfirmationModalProps) {
  const currency = giftCard?.moneda || fallbackCurrency;
  const resolvedSedeName = useMemo(() => {
    if (!giftCard) return "—";

    return resolveGiftCardSedeName({
      sedeId: giftCard.sede_id,
      sedeNombre: giftCard.sede_nombre,
      sedeNamesById,
      fallbackSedeName,
    });
  }, [fallbackSedeName, giftCard, sedeNamesById]);

  const emailLink = useMemo(() => {
    if (!giftCard) return null;

    const destination = beneficiaryEmail?.trim() || "";
    const subject = encodeURIComponent(`Tu Gift Card ${giftCard.codigo}`);
    const body = encodeURIComponent(
      `Hola,\n\nCompartimos tu Gift Card ${giftCard.codigo}.\nSaldo disponible: ${formatMoney(
        Number(giftCard.saldo_disponible || 0),
        currency
      )}.\n\nGracias por tu compra.`
    );

    return `mailto:${destination}?subject=${subject}&body=${body}`;
  }, [beneficiaryEmail, currency, giftCard]);

  const validityLabel = useMemo(() => {
    if (!giftCard) return "-";
    return getGiftCardValidityLabel({
      fechaVencimiento: giftCard.fecha_vencimiento,
      fechaEmision: giftCard.fecha_emision,
      createdAt: giftCard.created_at,
    });
  }, [giftCard]);

  const handlePrint = () => {
    if (!giftCard) return;

    const popup = window.open("", "_blank", "width=720,height=840");
    if (!popup) return;

    const contenido = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Gift Card ${escapeForHtml(giftCard.codigo)}</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f4f6fb; margin: 0; padding: 28px; }
      .container { max-width: 640px; margin: 0 auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden; }
      .header { padding: 24px; background: linear-gradient(90deg, #111827, #1f2937); color: #fff; }
      .code { font-size: 30px; font-weight: 700; letter-spacing: 1px; margin-top: 8px; }
      .body { padding: 24px; color: #0f172a; }
      .row { display: flex; justify-content: space-between; border-bottom: 1px solid #e5e7eb; padding: 10px 0; }
      .row span:first-child { color: #475569; }
      .row span:last-child { font-weight: 600; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div>Gift Card creada exitosamente</div>
        <div class="code">${escapeForHtml(giftCard.codigo)}</div>
      </div>
      <div class="body">
        <div class="row"><span>Estado</span><span>${escapeForHtml(giftCard.estado || "activa")}</span></div>
        <div class="row"><span>Valor</span><span>${escapeForHtml(formatMoney(Number(giftCard.valor || 0), currency))}</span></div>
        <div class="row"><span>Beneficiario</span><span>${escapeForHtml(giftCard.beneficiario_nombre || giftCard.comprador_nombre || "Sin beneficiario")}</span></div>
        <div class="row"><span>Nombre sede</span><span>${escapeForHtml(resolvedSedeName)}</span></div>
        <div class="row"><span>Saldo disponible</span><span>${escapeForHtml(formatMoney(Number(giftCard.saldo_disponible || 0), currency))}</span></div>
        <div class="row"><span>Fecha emisión</span><span>${escapeForHtml(formatGiftCardDate(giftCard.fecha_emision || giftCard.created_at))}</span></div>
        <div class="row"><span>Vigencia</span><span>${escapeForHtml(validityLabel)}</span></div>
      </div>
    </div>
    <script>window.print(); window.close();</script>
  </body>
</html>`;

    popup.document.open();
    popup.document.write(contenido);
    popup.document.close();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-xl overflow-hidden rounded-xl border border-gray-300 bg-white p-0 shadow-xl"
      >
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
          <DialogHeader className="text-left">
            <DialogTitle className="text-2xl font-bold text-gray-900">Gift Card creada exitosamente</DialogTitle>
            <DialogDescription className="text-sm text-gray-600">
              El código fue emitido y ya se encuentra disponible para uso.
            </DialogDescription>
          </DialogHeader>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0 text-gray-600 hover:bg-gray-100"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Cerrar</span>
          </Button>
        </div>

        {giftCard ? (
          <div className="space-y-4 px-5 py-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Código</p>
              <p className="mt-1 text-3xl font-bold text-gray-900">{giftCard.codigo}</p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Estado</p>
                <div className="mt-1">
                  <GiftCardStatusBadge status={giftCard.estado} />
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Valor</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  {formatMoney(Number(giftCard.valor || 0), currency)}
                </p>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Beneficiario</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  {giftCard.beneficiario_nombre || giftCard.comprador_nombre || "Sin beneficiario"}
                </p>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Nombre Sede</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{resolvedSedeName}</p>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Saldo</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  {formatMoney(Number(giftCard.saldo_disponible || 0), currency)}
                </p>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Fecha emisión</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  {formatGiftCardDate(giftCard.fecha_emision || giftCard.created_at)}
                </p>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Vigencia</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{validityLabel}</p>
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter className="border-t border-gray-200 bg-white px-5 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={handlePrint}
            className="border-gray-300 text-gray-700 hover:bg-gray-100"
          >
            <Printer className="mr-2 h-4 w-4" />
            Imprimir
          </Button>
          <Button
            type="button"
            className="bg-black text-white hover:bg-gray-800"
            onClick={() => {
              if (!emailLink) return;
              window.location.href = emailLink;
            }}
          >
            <Mail className="mr-2 h-4 w-4" />
            Enviar por Email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
