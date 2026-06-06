export interface SedeCurrencyInput {
  sede_id?: string | null;
  nombre?: string | null;
  pais?: string | null;
  moneda?: string | null;
  es_internacional?: boolean | null;
}

const GUAYAQUIL_SEDE_IDS = new Set(["SD-28080"]);
const CURRENCY_LOCALES: Record<string, string> = {
  COP: "es-CO",
  USD: "en-US",
  MXN: "es-MX",
  EUR: "es-ES",
  PEN: "es-PE",
  ARS: "es-AR",
};

function normalizeText(value?: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function normalizeCurrencyCode(value?: string | null): string {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized || "USD";
}

export function resolveCurrencyFromCountry(country?: string | null, fallback: string = "USD"): string {
  const normalizedCountry = normalizeText(country);
  if (normalizedCountry.includes("colombia")) return "COP";
  if (normalizedCountry.includes("mexico")) return "MXN";
  if (normalizedCountry.includes("ecuador")) return "USD";
  if (!fallback) return "";
  return normalizeCurrencyCode(fallback);
}

export function getStoredCurrency(fallback: string = "USD"): string {
  if (typeof window === "undefined") {
    return normalizeCurrencyCode(fallback);
  }

  const sessionCurrency = sessionStorage.getItem("beaux-moneda");
  if (sessionCurrency) {
    return normalizeCurrencyCode(sessionCurrency);
  }

  const localCurrency = localStorage.getItem("beaux-moneda");
  if (localCurrency) {
    return normalizeCurrencyCode(localCurrency);
  }

  const sessionCountry = sessionStorage.getItem("beaux-pais");
  if (sessionCountry) {
    return resolveCurrencyFromCountry(sessionCountry, fallback);
  }

  const localCountry = localStorage.getItem("beaux-pais");
  if (localCountry) {
    return resolveCurrencyFromCountry(localCountry, fallback);
  }

  return normalizeCurrencyCode(fallback);
}

export function resolveCurrencyLocale(
  currency?: string | null,
  fallbackLocale: string = "es-CO"
): string {
  const normalizedCurrency = normalizeCurrencyCode(currency);
  return CURRENCY_LOCALES[normalizedCurrency] || fallbackLocale;
}

export function formatCurrencyNoDecimals(
  value: number,
  currency: string = "COP",
  locale?: string
): string {
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const resolvedLocale = locale || resolveCurrencyLocale(normalizedCurrency);
  const safeValue = Number.isFinite(value) ? value : 0;
  const roundedValue = Math.round(safeValue);

  try {
    return new Intl.NumberFormat(resolvedLocale, {
      style: "currency",
      currency: normalizedCurrency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(roundedValue);
  } catch {
    return `${normalizedCurrency} ${roundedValue.toLocaleString(resolvedLocale)}`;
  }
}

export function isGuayaquilSede(sede?: SedeCurrencyInput | null): boolean {
  if (!sede) return false;

  const sedeId = String(sede.sede_id ?? "").trim().toUpperCase();
  if (GUAYAQUIL_SEDE_IDS.has(sedeId)) return true;

  return normalizeText(sede.nombre).includes("guayaquil");
}

export function resolveCurrencyFromSede(
  sede?: SedeCurrencyInput | null,
  fallback: string = "USD"
): string {
  if (!sede) {
    return normalizeCurrencyCode(fallback);
  }

  const explicitCurrency = normalizeCurrencyCode(sede.moneda);
  if (sede.moneda && explicitCurrency) {
    return explicitCurrency;
  }

  const countryCurrency = resolveCurrencyFromCountry(sede.pais, "");
  if (countryCurrency) {
    return countryCurrency;
  }

  if (sede.es_internacional === true) return "USD";
  if (isGuayaquilSede(sede)) return "USD";

  return normalizeCurrencyCode(fallback);
}
