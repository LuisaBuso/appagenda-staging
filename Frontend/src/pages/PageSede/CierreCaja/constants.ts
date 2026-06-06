export const CASH_PAYMENT_METHOD_OPTIONS = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "tarjeta_credito", label: "Tarjeta de crédito" },
  { value: "tarjeta_debito", label: "Tarjeta de débito" },
  { value: "link_de_pago", label: "Link de pago" },
  { value: "giftcard", label: "Gift Card" },
  { value: "addi", label: "Addi" },
  { value: "abono_transferencia", label: "Abono transferencia" },
  { value: "descuento_nomina", label: "Descuento nómina" },
  { value: "sin_pago", label: "Sin pago" },
  { value: "otros", label: "Otros" },
] as const;

export const CASH_EXPENSE_TYPE_OPTIONS = [
  { value: "compra_interna", label: "Compra interna" },
  { value: "gasto_operativo", label: "Gasto operativo" },
  { value: "retiro_caja", label: "Retiro de caja" },
  { value: "otro", label: "Otro" },
] as const;

export const CASH_INCOME_TYPE_OPTIONS = [
  { value: "ingreso_operativo", label: "Ingreso operativo" },
  { value: "abono_cliente", label: "Abono cliente" },
  { value: "ajuste_caja", label: "Ajuste de caja" },
  { value: "otro", label: "Otro" },
] as const;

export const DEFAULT_CASH_PAYMENT_METHOD = CASH_PAYMENT_METHOD_OPTIONS[0].value;

const CASH_PAYMENT_METHOD_BACKEND_ALIASES: Record<string, string> = {
  tarjeta: "otros",
  sin_pago: "otros",
};

export const normalizeCashPaymentMethodForBackend = (value: string): string =>
  CASH_PAYMENT_METHOD_BACKEND_ALIASES[value] ?? value;
export const DEFAULT_CASH_EXPENSE_TYPE = CASH_EXPENSE_TYPE_OPTIONS[1].value;
export const DEFAULT_CASH_INCOME_TYPE = CASH_INCOME_TYPE_OPTIONS[0].value;

const CASH_PAYMENT_METHOD_LABELS = Object.fromEntries(
  CASH_PAYMENT_METHOD_OPTIONS.map((option) => [option.value, option.label])
) as Record<string, string>;

const CASH_EXPENSE_TYPE_LABELS = Object.fromEntries(
  CASH_EXPENSE_TYPE_OPTIONS.map((option) => [option.value, option.label])
) as Record<string, string>;

const CASH_INCOME_TYPE_LABELS = Object.fromEntries(
  CASH_INCOME_TYPE_OPTIONS.map((option) => [option.value, option.label])
) as Record<string, string>;

export const getCashPaymentMethodLabel = (value?: string) => {
  const key = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  return CASH_PAYMENT_METHOD_LABELS[key] || "Otros";
};

export const getCashMovementTypeLabel = (
  movementKind: "ingreso" | "egreso",
  value?: string,
  fallback?: string
) => {
  const key = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  const labels = movementKind === "ingreso" ? CASH_INCOME_TYPE_LABELS : CASH_EXPENSE_TYPE_LABELS;
  return labels[key] || fallback || (movementKind === "ingreso" ? "Ingreso manual" : "Egreso");
};
