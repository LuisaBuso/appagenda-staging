const DMY_REGEX = /^(\d{2})-(\d{2})-(\d{4})$/;
const YMD_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const BACKEND_DATE_KEYS = new Set([
  "start_date",
  "end_date",
  "fecha_inicio",
  "fecha_fin",
  "fecha_desde",
  "fecha_hasta",
]);

const pad = (value: number) => String(value).padStart(2, "0");

const LONG_DATE_FORMATTER_ES = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export const toDMY = (date: Date): string => {
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
};

export const toLocalYMD = (date: Date = new Date()): string => {
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const parseDateToDate = (input?: string | number | Date): Date | null => {
  if (!input) return null;

  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }

  if (typeof input === "number") {
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const raw = String(input).trim();
  if (!raw) return null;

  const dateOnly = raw.split("T")[0];
  const dmyMatch = dateOnly.match(DMY_REGEX);
  if (dmyMatch) {
    const [, dd, mm, yyyy] = dmyMatch;
    const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const ymdMatch = dateOnly.match(YMD_REGEX);
  if (ymdMatch) {
    const [, yyyy, mm, dd] = ymdMatch;
    const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatDateDMY = (
  input?: string | number | Date,
  fallback: string = "-"
): string => {
  const date = parseDateToDate(input);
  if (!date) return fallback;
  return toDMY(date);
};

export const formatLongDateEs = (
  input?: string | number | Date,
  fallback: string = "-"
): string => {
  const date = parseDateToDate(input);
  if (!date) return fallback;
  return LONG_DATE_FORMATTER_ES.format(date);
};

export const toBackendDate = (input?: string | number | Date): string => {
  if (input === undefined || input === null) return "";
  const raw = String(input).trim();
  if (!raw) return "";

  const date = parseDateToDate(raw);
  return date ? toLocalYMD(date) : raw;
};

// ✅ FIX: Parse fecha de string sin timezone offset
// Evita desplazamiento de un mes causado por timezone
// Ejemplo: '2026-06-01' siempre crea June 1st, nunca May 31st
export const parseLocalDate = (dateString: string): Date | null => {
  if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;
  const [year, month, day] = dateString.split('-').map(Number);
  // IMPORTANTE: new Date(year, month-1, day) sin hora crea fecha en hora local
  // No usar new Date(dateString) que interpreta como UTC
  return new Date(year, month - 1, day);
};

// ✅ FIX: Format fecha a string YYYY-MM-DD en hora local (nunca UTC)
export const formatLocalDate = (date: Date): string => {
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const normalizeBackendDateParams = <T extends Record<string, any> | undefined>(
  params?: T
): T => {
  if (!params) return params as T;

  const normalized = Object.entries(params).reduce<Record<string, any>>((acc, [key, value]) => {
    if (
      BACKEND_DATE_KEYS.has(key.toLowerCase()) &&
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      acc[key] = toBackendDate(value);
      return acc;
    }

    acc[key] = value;
    return acc;
  }, {});

  return normalized as T;
};
