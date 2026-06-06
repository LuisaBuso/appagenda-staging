import { CreditCard } from "lucide-react";
import {
  EMPTY_PAYMENT_METHOD_TOTALS,
  type PaymentMethodTotals,
} from "../../lib/payment-methods-summary";

interface PaymentMethodsSummaryProps {
  totals?: PaymentMethodTotals | null;
  loading?: boolean;
  formatAmount: (amount: number) => string;
  className?: string;
}

const PAYMENT_METHOD_ITEMS: Array<{
  key: keyof PaymentMethodTotals;
  label: string;
}> = [
  { key: "efectivo", label: "Efectivo" },
  { key: "transferencia", label: "Transferencia" },
  { key: "tarjetas", label: "Tarjetas" },
  { key: "linkPagos", label: "Link de pagos" },
];

export function PaymentMethodsSummary({
  totals,
  loading = false,
  formatAmount,
  className = "",
}: PaymentMethodsSummaryProps) {
  const safeTotals = totals ?? EMPTY_PAYMENT_METHOD_TOTALS;

  return (
    <div className={`rounded-lg border border-gray-200 bg-white p-2.5 md:p-3 ${className}`}>
      <div className="mb-2 flex items-center gap-2">
        <CreditCard className="h-3.5 w-3.5 text-gray-900" />
        <h2 className="text-sm font-semibold text-gray-900">Métodos de Pago</h2>
      </div>

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        {PAYMENT_METHOD_ITEMS.map((item) => (
          <div
            key={item.key}
            className="rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-3 text-center md:px-3"
          >
            {loading ? (
              <div className="space-y-1.5">
                <div className="mx-auto h-2.5 w-2.5 animate-pulse rounded-full bg-gray-300" />
                <div className="mx-auto h-3 w-20 animate-pulse rounded bg-gray-300" />
                <div className="mx-auto h-5 w-24 animate-pulse rounded bg-gray-300" />
              </div>
            ) : (
              <>
                <div className="mx-auto mb-1.5 h-2.5 w-2.5 rounded-full bg-gray-500" />
                <p className="text-base font-semibold text-gray-900 md:text-lg">{item.label}</p>
                <p className="mt-1 text-xl font-bold text-gray-900 md:text-2xl">
                  {formatAmount(safeTotals[item.key] || 0)}
                </p>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
