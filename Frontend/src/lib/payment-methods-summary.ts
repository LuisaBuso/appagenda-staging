import type { Factura } from "../types/factura";

export interface PaymentMethodTotals {
  efectivo: number;
  transferencia: number;
  tarjetas: number;
  linkPagos: number;
}

export const EMPTY_PAYMENT_METHOD_TOTALS: PaymentMethodTotals = {
  efectivo: 0,
  transferencia: 0,
  tarjetas: 0,
  linkPagos: 0,
};

type PaymentBucket = keyof PaymentMethodTotals;
type FacturaLike = Partial<Factura>;

const SUMMARY_CANDIDATE_KEYS = [
  "summary",
  "totals",
  "payment_summary",
  "payment_totals",
  "paymentMethods",
  "payment_methods",
  "metodos_pago",
  "metodosPago",
  "resumen_metodos_pago",
  "resumenPago",
];

const AMOUNT_CANDIDATE_KEYS = [
  "total",
  "monto",
  "amount",
  "value",
  "valor",
];

const IGNORED_KEYS = new Set([
  "total",
  "subtotal",
  "grand_total",
  "sin_pago",
  "none",
  "other",
  "otros",
]);

const createEmptyTotals = (): PaymentMethodTotals => ({
  ...EMPTY_PAYMENT_METHOD_TOTALS,
});

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const normalizeToken = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
};

const toAmount = (value: unknown): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const cleaned = value.trim().replace(/[^0-9,.-]/g, "");
    if (!cleaned) return 0;

    const normalized =
      cleaned.includes(".") && cleaned.includes(",")
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(",", ".");

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
};

const isNumericLike = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  return /[0-9]/.test(value);
};

const normalizePaymentMethod = (rawMethod: unknown): PaymentBucket | null => {
  const method = normalizeToken(rawMethod);
  if (!method) return null;

  if (
    method.includes("efectivo") ||
    method === "cash" ||
    method.startsWith("cash_")
  ) {
    return "efectivo";
  }

  if (method.includes("transfer")) {
    return "transferencia";
  }

  if (
    method.includes("link") ||
    method.includes("paylink") ||
    method.includes("paymentlink") ||
    method.includes("payment_link") ||
    method.includes("addi")
  ) {
    return "linkPagos";
  }

  if (
    method.includes("tarjeta") ||
    method.includes("card") ||
    method.includes("credito") ||
    method.includes("debito") ||
    method.includes("credit") ||
    method.includes("debit")
  ) {
    return "tarjetas";
  }

  return null;
};

const addToTotals = (
  totals: PaymentMethodTotals,
  bucket: PaymentBucket,
  value: number
) => {
  if (!Number.isFinite(value)) return;
  totals[bucket] += value;
};

const mergeTotals = (
  target: PaymentMethodTotals,
  source: PaymentMethodTotals
) => {
  target.efectivo += source.efectivo;
  target.transferencia += source.transferencia;
  target.tarjetas += source.tarjetas;
  target.linkPagos += source.linkPagos;
};

const extractAmountFromRecord = (record: Record<string, unknown>): number | null => {
  for (const amountKey of AMOUNT_CANDIDATE_KEYS) {
    if (!(amountKey in record)) continue;
    const amount = toAmount(record[amountKey]);
    if (Number.isFinite(amount)) {
      return amount;
    }
  }

  return null;
};

const mapTotalsFromArray = (
  source: unknown[]
): { totals: PaymentMethodTotals; hasMatches: boolean } => {
  const totals = createEmptyTotals();
  let hasMatches = false;

  source.forEach((item) => {
    if (!isRecord(item)) return;

    const method =
      normalizePaymentMethod(
        item.metodo ??
          item.method ??
          item.metodo_pago ??
          item.payment_method ??
          item.paymentMethod ??
          item.name ??
          item.nombre
      ) ?? null;

    if (!method) return;

    const amount = toAmount(
      item.monto ?? item.amount ?? item.total ?? item.value ?? item.valor
    );

    if (!isNumericLike(item.monto ?? item.amount ?? item.total ?? item.value ?? item.valor)) {
      return;
    }

    addToTotals(totals, method, amount);
    hasMatches = true;
  });

  return { totals, hasMatches };
};

const mapTotalsFromObject = (
  source: Record<string, unknown>
): { totals: PaymentMethodTotals; hasMatches: boolean } => {
  const totals = createEmptyTotals();
  let hasMatches = false;

  Object.entries(source).forEach(([rawKey, rawValue]) => {
    const key = normalizeToken(rawKey);
    if (!key || IGNORED_KEYS.has(key)) return;

    if (Array.isArray(rawValue)) {
      const arrayTotals = mapTotalsFromArray(rawValue);
      if (!arrayTotals.hasMatches) return;
      mergeTotals(totals, arrayTotals.totals);
      hasMatches = true;
      return;
    }

    if (isRecord(rawValue)) {
      const bucketFromKey = normalizePaymentMethod(key);
      if (bucketFromKey) {
        const nestedAmount = extractAmountFromRecord(rawValue);
        if (nestedAmount !== null) {
          addToTotals(totals, bucketFromKey, nestedAmount);
          hasMatches = true;
          return;
        }
      }

      const nestedTotals = mapTotalsFromObject(rawValue);
      if (!nestedTotals.hasMatches) return;
      mergeTotals(totals, nestedTotals.totals);
      hasMatches = true;
      return;
    }

    const bucket = normalizePaymentMethod(key);
    if (!bucket || !isNumericLike(rawValue)) return;
    addToTotals(totals, bucket, toAmount(rawValue));
    hasMatches = true;
  });

  return { totals, hasMatches };
};

export const extractPaymentMethodTotalsFromApiSummary = (
  response: unknown
): PaymentMethodTotals | null => {
  if (!isRecord(response)) return null;

  const direct = mapTotalsFromObject(response);
  if (direct.hasMatches) {
    return direct.totals;
  }

  for (const key of SUMMARY_CANDIDATE_KEYS) {
    const candidate = response[key];

    if (isRecord(candidate)) {
      const mapped = mapTotalsFromObject(candidate);
      if (mapped.hasMatches) return mapped.totals;
      continue;
    }

    if (Array.isArray(candidate)) {
      const mapped = mapTotalsFromArray(candidate);
      if (mapped.hasMatches) return mapped.totals;
    }
  }

  return null;
};

export const calculatePaymentMethodTotals = (
  rows: FacturaLike[] = []
): PaymentMethodTotals => {
  const totals = createEmptyTotals();

  rows.forEach((row) => {
    if (!isRecord(row)) return;
    const genericRow = row as Record<string, unknown>;

    const desglose = row.desglose_pagos;
    if (isRecord(desglose)) {
      const fromBreakdown = mapTotalsFromObject(desglose);
      if (fromBreakdown.hasMatches) {
        mergeTotals(totals, fromBreakdown.totals);
        return;
      }
    }

    const historial = row.historial_pagos;
    if (Array.isArray(historial)) {
      const fromHistory = mapTotalsFromArray(historial);
      if (fromHistory.hasMatches) {
        mergeTotals(totals, fromHistory.totals);
        return;
      }
    }

    const method = normalizePaymentMethod(
      row.metodo_pago ??
        genericRow.paymentMethod ??
        genericRow.method ??
        genericRow.metodo
    );

    if (!method) return;

    const amount = toAmount(
      row.total ?? row.monto ?? genericRow.amount ?? genericRow.value
    );
    addToTotals(totals, method, amount);
  });

  return totals;
};
