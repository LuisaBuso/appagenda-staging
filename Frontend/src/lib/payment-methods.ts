export const PAYROLL_PAYMENT_METHOD = "descuento_nomina" as const;

export const PAYMENT_METHOD_OPTIONS: { id: string; label: string }[] = [
  { id: "efectivo",           label: "Efectivo" },
  { id: "transferencia",      label: "Transferencia" },
  { id: "tarjeta",            label: "Tarjeta" },
  { id: "tarjeta_credito",    label: "Tarjeta Crédito" },
  { id: "tarjeta_debito",     label: "Tarjeta Débito" },
  { id: "sin_pago",           label: "Sin pago" },
  { id: "otros",              label: "Otros" },
  { id: "addi",               label: "Addi" },
  { id: "giftcard",           label: "Gift Card" },
  { id: "link_de_pago",       label: "Link de pago" },
  { id: "descuento_nomina",   label: "Desc. nómina" },
  { id: "abono_transferencia",label: "Abono transf." },
];

const LEGACY_PAYMENT_METHOD_MAP: Record<string, string> = {
  descuento_por_nomina: PAYROLL_PAYMENT_METHOD,
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  tarjeta_credito: "Tarjeta de crédito",
  tarjeta_debito: "Tarjeta de débito",
  giftcard: "Gift Card",
  addi: "Addi",
  link_pago: "Link de pago",
  link_de_pago: "Link de pago",
  sin_pago: "Sin pago",
  otros: "Otros",
  abono_transferencia: "Abono transferencia",
  descuento_nomina: "Descuento nómina",
  descuento_por_nomina: "Descuento nómina",
};

export const normalizePaymentMethodForBackend = (
  method: string | null | undefined
): string => {
  const normalized = String(method ?? "").trim();
  if (!normalized) return normalized;
  return LEGACY_PAYMENT_METHOD_MAP[normalized] || normalized;
};

export const getPaymentMethodLabel = (
  method: string | null | undefined
): string => {
  const normalized = normalizePaymentMethodForBackend(method);
  return PAYMENT_METHOD_LABELS[normalized] || PAYMENT_METHOD_LABELS[String(method ?? "").trim()] || normalized;
};
