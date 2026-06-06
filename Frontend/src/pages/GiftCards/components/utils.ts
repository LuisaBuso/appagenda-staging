import { formatDateDMY } from "../../../lib/dateFormat";
import type { GiftCardStatus } from "../types";

export const NEVER_EXPIRES_LABEL = "No tiene vencimiento";
const ONE_YEAR_RANGE_MIN_DAYS = 360;
const ONE_YEAR_RANGE_MAX_DAYS = 370;

function toValidDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatMoney(value: number, currency: string): string {
  const normalizedCurrency = (currency || "COP").toUpperCase();
  const locale = normalizedCurrency === "USD" ? "en-US" : normalizedCurrency === "MXN" ? "es-MX" : "es-CO";

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: normalizedCurrency,
      maximumFractionDigits: 0,
    }).format(Number.isFinite(value) ? value : 0);
  } catch {
    return `${normalizedCurrency} ${(Number.isFinite(value) ? value : 0).toFixed(0)}`;
  }
}

export function formatGiftCardDate(value?: string | null): string {
  if (!value) return "-";
  return formatDateDMY(value, value);
}

export function getGiftCardValidityLabel(args: {
  fechaVencimiento?: string | null;
  fechaEmision?: string | null;
  createdAt?: string | null;
}): string {
  const fechaVencimiento = toValidDate(args.fechaVencimiento);
  if (!fechaVencimiento) return NEVER_EXPIRES_LABEL;

  const fechaEmision = toValidDate(args.fechaEmision) ?? toValidDate(args.createdAt);
  if (fechaEmision) {
    const diffMs = fechaVencimiento.getTime() - fechaEmision.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays >= ONE_YEAR_RANGE_MIN_DAYS && diffDays <= ONE_YEAR_RANGE_MAX_DAYS) {
      return `12 meses (${formatGiftCardDate(args.fechaVencimiento)})`;
    }
  }

  return `Personalizada (${formatGiftCardDate(args.fechaVencimiento)})`;
}

export function resolveGiftCardSedeName({
  sedeId,
  sedeNombre,
  sedeNamesById,
  fallbackSedeName,
}: {
  sedeId?: string | null;
  sedeNombre?: string | null;
  sedeNamesById?: Record<string, string>;
  fallbackSedeName?: string;
}): string {
  const directName = String(sedeNombre || "").trim();
  if (directName) {
    return directName;
  }

  const normalizedSedeId = String(sedeId || "").trim();
  if (normalizedSedeId) {
    const fromMap = String(sedeNamesById?.[normalizedSedeId] || "").trim();
    if (fromMap) {
      return fromMap;
    }
  }

  const fallbackName = String(fallbackSedeName || "").trim();
  return fallbackName || "—";
}

export function getStatusLabel(status: GiftCardStatus): string {
  switch (status) {
    case "activa":
      return "Activa";
    case "usada":
      return "Usada";
    case "cancelada":
      return "Cancelada";
    case "vencida":
      return "Activa";
    case "parcialmente_usada":
      return "Parcial";
    default:
      return status ? String(status) : "Sin estado";
  }
}

export function getStatusClasses(status: GiftCardStatus): string {
  switch (status) {
    case "activa":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "usada":
      return "bg-gray-100 text-gray-700 border-gray-300";
    case "cancelada":
      return "bg-red-50 text-red-700 border-red-200";
    case "vencida":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "parcialmente_usada":
      return "bg-gray-100 text-gray-700 border-gray-300";
    default:
      return "bg-gray-100 text-gray-700 border-gray-300";
  }
}

export function toPositiveNumber(value: string | number): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  const normalized = value.replace(/[^0-9.]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}
