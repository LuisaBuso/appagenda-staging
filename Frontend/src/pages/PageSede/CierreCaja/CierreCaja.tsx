"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Sidebar } from "../../../components/Layout/Sidebar";
import { PageHeader } from "../../../components/Layout/PageHeader";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { PeriodoSelector, type PeriodoId } from "../../../components/ui/PeriodoSelector";
import { DatePicker } from "../../../components/ui/DatePicker";
// import { Textarea } from "../../../components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { SedeDropdown } from "../../../components/ui/SedeDropdown";
import { Loader2 } from "lucide-react"; //Wallet +
import { cashService, getEfectivoDia } from "./api/cashService";
import type { CashCierre, CashEgreso, CashIngreso, CashResumen, CashReporteRaw } from "./types";
import { formatDateDMY, parseDateToDate, toBackendDate, formatLocalDate } from "../../../lib/dateFormat";
import { toast } from "../../../hooks/use-toast";
import { useAuth } from "../../../components/Auth/AuthContext";
import { giftcardsService } from "../../GiftCards/giftcardsService";
import type { GiftCard } from "../../GiftCards/types";
import { getSedes } from "../../../components/Branch/sedesApi";
import { formatSedeNombre } from "../../../lib/sede";
import { persistSedeContext } from "../../../lib/sede-context";
import {
  CASH_EXPENSE_TYPE_OPTIONS,
  CASH_INCOME_TYPE_OPTIONS,
  CASH_PAYMENT_METHOD_OPTIONS,
  DEFAULT_CASH_EXPENSE_TYPE,
  DEFAULT_CASH_INCOME_TYPE,
  DEFAULT_CASH_PAYMENT_METHOD,
  getCashMovementTypeLabel,
  getCashPaymentMethodLabel,
  normalizeCashPaymentMethodForBackend,
} from "./constants";

const toLocalDateString = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getToday = () => toLocalDateString(new Date());

type HeaderPeriod = "today" | "last_7_days" | "last_30_days" | "month" | "custom";

interface HeaderDateRange {
  start_date: string;
  end_date: string;
}



const getRangeByPeriod = (period: HeaderPeriod, customRange?: HeaderDateRange): HeaderDateRange => {
  const today = new Date();
  const todayYmd = toLocalDateString(today);

  if (period === "custom" && customRange?.start_date && customRange?.end_date) {
    return {
      start_date: customRange.start_date,
      end_date: customRange.end_date,
    };
  }

  if (period === "last_7_days") {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { start_date: toLocalDateString(start), end_date: todayYmd };
  }

  if (period === "last_30_days") {
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    return { start_date: toLocalDateString(start), end_date: todayYmd };
  }

  if (period === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start_date: toLocalDateString(start), end_date: todayYmd };
  }

  return { start_date: todayYmd, end_date: todayYmd };
};

const normalizeDateRange = (start?: string, end?: string) => {
  if (!start || !end) return { start, end };
  if (start > end) {
    return { start: end, end: start };
  }
  return { start, end };
};

const toNumber = (value: any): number => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const normalized = value.replace(/[^0-9.-]/g, "");
    const parsed = Number(normalized);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
};

const pickNumber = (source: any, keys: string[]): number | undefined => {
  if (!source) return undefined;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      return toNumber(source[key]);
    }
  }
  return undefined;
};

const unwrapData = (data: any) => data?.data ?? data?.result ?? data;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const pickArray = (...candidates: any[]): any[] => {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
};

  const formatDate = (dateString?: string) => formatDateDMY(dateString);
const hasClockTime = (value?: string) => {
  if (!value) return false;
  return /\d{2}:\d{2}/.test(value);
};

const parseBackendDateTime = (value?: string | number | Date): Date | null => {
  if (value === undefined || value === null || value === "") return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const normalized = raw.includes(" ") ? raw.replace(" ", "T") : raw;
  const hasTime = hasClockTime(normalized);
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const candidate = hasTime && !hasTimezone ? `${normalized}Z` : normalized;

  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatTimeLabel = (value?: string) => {
  const parsed = parseBackendDateTime(value);
  if (!parsed) return "--";
  return parsed
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toUpperCase();
};

const formatTableDate = (value?: string) => {
  const parsed = parseBackendDateTime(value);
  if (!parsed) return "--";

  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = parsed.getFullYear();
  return `${day}/${month}/${year}`;
};

const formatHeaderDate = (value?: string) => {
  if (!value) return "--";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return formatDate(value);

  const monthIndex = Number(month) - 1;
  const baseDate = new Date(Number(year), monthIndex, Number(day));
  if (Number.isNaN(baseDate.getTime())) return formatDate(value);

  const monthName = baseDate.toLocaleDateString("es-CO", { month: "long" });
  const capitalizedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  return `${day} ${capitalizedMonth} ${year}`;
};

const normalizePaymentMethod = (value?: string) => getCashPaymentMethodLabel(value);

const normalizePaymentMethodKey = (value?: string) => {
  return String(value || "otros")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
};

const TOTAL_INCOME_KEYS = [
  "total_general",
  "grand_total",
  "ingresos_total",
  "total_ingresos",
  "ventas_totales",
  "total_vendido",
  "ingresos",
];

const TOTAL_OTHER_METHODS_KEYS = [
  "total",
  "total_general",
  "otros_metodos_total",
  "total_otros_metodos",
];

const TOTAL_CASH_EXPENSE_KEYS = [
  "total_efectivo",
  "egresos_efectivo",
  "cash_total",
  "total",
];

const EXPECTED_CASH_KEYS = [
  "efectivo_esperado",
  "efectivo_en_caja",
  "efectivo_total",
  "saldo",
  "balance",
];

// El backend hoy usa algunas llaves reales como `giftcard` y `link_de_pago`
// dentro de `ingresos_otros_metodos`, así que aquí aliasamos esos nombres
// además de las variantes documentadas para no perder montos.
const PAYMENT_METHOD_ALIASES = {
  efectivo: ["efectivo", "cash"],
  tarjetas: [
    "tarjeta",
    "tarjetas",
    "tarjeta_credito",
    "tarjeta_debito",
    "credit_card",
    "debit_card",
    "card",
    "cards",
    "pos",
    "dataphone",
  ],
  transferencias: ["transferencia", "transferencias", "bank_transfer", "transfer"],
  linkPagos: ["link_de_pago", "link_de_pagos", "link_pago", "link_pagos", "payment_link", "paylink"],
  creditoEmpleados: [
    "credito_empleados",
    "credito_empleado",
    "employee_credit",
    "employee_credits",
    "descuento_por_nomina",
    "decuento_por_nomina",
  ],
  abonos: ["abono", "abonos"],
  giftCards: ["giftcard", "gift_card", "giftcards", "gift_cards"],
  addi: ["addi"],
} as const;

const getObjectAmount = (value: unknown): number => {
  if (isRecord(value)) {
    return (
      pickNumber(value, ["total", "monto", "valor", "amount", "importe"]) ?? 0
    );
  }

  return toNumber(value);
};

const sumRecordAmounts = (
  source: unknown,
  ignoredKeys: string[] = [],
): number => {
  if (!isRecord(source)) return 0;

  const ignored = new Set(ignoredKeys.map((key) => normalizePaymentMethodKey(key)));

  return Object.entries(source).reduce((sum, [rawKey, rawValue]) => {
    const key = normalizePaymentMethodKey(rawKey);
    if (!key || ignored.has(key)) {
      return sum;
    }

    return sum + getObjectAmount(rawValue);
  }, 0);
};

const getAmountByAliases = (source: unknown, aliases: readonly string[]): number => {
  if (!isRecord(source)) return 0;

  const aliasSet = new Set(aliases.map((alias) => normalizePaymentMethodKey(alias)));

  return Object.entries(source).reduce((sum, [rawKey, rawValue]) => {
    const key = normalizePaymentMethodKey(rawKey);
    if (!aliasSet.has(key)) {
      return sum;
    }

    return sum + getObjectAmount(rawValue);
  }, 0);
};

const matchesAlias = (value: string, aliases: readonly string[]) => {
  return aliases.some((alias) => normalizePaymentMethodKey(alias) === value);
};

const getCashReportNodes = (data: any) => {
  const root = unwrapData(data) || {};
  const dataNode = unwrapData(root?.data) || root?.data || {};
  const resultNode = unwrapData(root?.result) || root?.result || {};
  const summary =
    unwrapData(root?.resumen) ||
    unwrapData(root?.summary) ||
    root?.resumen ||
    root?.summary ||
    root;
  const periodTotals =
    root?.totales ?? summary?.totales ?? dataNode?.totales ?? resultNode?.totales ?? {};
  const ingresosEfectivo =
    summary?.ingresos_efectivo ??
    root?.ingresos_efectivo ??
    dataNode?.ingresos_efectivo ??
    resultNode?.ingresos_efectivo ??
    {};
  const ingresosOtrosMetodos =
    summary?.ingresos_otros_metodos ??
    root?.ingresos_otros_metodos ??
    dataNode?.ingresos_otros_metodos ??
    resultNode?.ingresos_otros_metodos ??
    {};
  const egresos =
    summary?.egresos ??
    root?.egresos ??
    dataNode?.egresos ??
    resultNode?.egresos ??
    {};

  return { root, summary, dataNode, resultNode, periodTotals, ingresosEfectivo, ingresosOtrosMetodos, egresos };
};

const extractCashReportMetrics = (data: any) => {
  const { root, summary, dataNode, resultNode, periodTotals, ingresosEfectivo, ingresosOtrosMetodos, egresos } =
    getCashReportNodes(data);

  const efectivo =
    pickNumber(ingresosEfectivo, ["total", "efectivo_total", "total_efectivo"]) ?? 0;
  const otrosMetodosTotal =
    pickNumber(ingresosOtrosMetodos, TOTAL_OTHER_METHODS_KEYS) ??
    sumRecordAmounts(ingresosOtrosMetodos, TOTAL_OTHER_METHODS_KEYS);
  const totalRecibido =
    pickNumber(periodTotals, TOTAL_INCOME_KEYS) ??
    pickNumber(summary, TOTAL_INCOME_KEYS) ??
    pickNumber(root, TOTAL_INCOME_KEYS) ??
    (efectivo + otrosMetodosTotal);
  const abonos = getAmountByAliases(ingresosOtrosMetodos, PAYMENT_METHOD_ALIASES.abonos);
  const tarjetas = getAmountByAliases(ingresosOtrosMetodos, PAYMENT_METHOD_ALIASES.tarjetas);
  const transferencias = getAmountByAliases(
    ingresosOtrosMetodos,
    PAYMENT_METHOD_ALIASES.transferencias,
  );
  const linkPagos = getAmountByAliases(ingresosOtrosMetodos, PAYMENT_METHOD_ALIASES.linkPagos);
  const creditoEmpleados = getAmountByAliases(
    ingresosOtrosMetodos,
    PAYMENT_METHOD_ALIASES.creditoEmpleados,
  );
  const giftCards = getAmountByAliases(ingresosOtrosMetodos, PAYMENT_METHOD_ALIASES.giftCards);
  const addi = getAmountByAliases(ingresosOtrosMetodos, PAYMENT_METHOD_ALIASES.addi);
  const egresosEfectivo =
    pickNumber(egresos, TOTAL_CASH_EXPENSE_KEYS) ??
    pickNumber(summary, TOTAL_CASH_EXPENSE_KEYS) ??
    pickNumber(root, TOTAL_CASH_EXPENSE_KEYS) ??
    0;
  const efectivoEsperado =
    pickNumber(root, EXPECTED_CASH_KEYS) ??
    pickNumber(summary, EXPECTED_CASH_KEYS) ??
    pickNumber(dataNode, EXPECTED_CASH_KEYS) ??
    pickNumber(resultNode, EXPECTED_CASH_KEYS);

  return {
    totalRecibido,
    abonos,
    egresosEfectivo,
    efectivoEsperado,
    paymentMethods: {
      efectivo,
      tarjetas,
      transferencias,
      linkPagos,
      creditoEmpleados,
      giftCards,
      addi,
    },
  };
};

const parseGiftcardPaymentMethod = (notes?: string) => {
  if (!notes) return "otros";
  const match = notes.match(/metodo\s+de\s+pago\s*:\s*([a-zA-Z_]+)/i);
  return match?.[1]?.toLowerCase() || "otros";
};

const extractGiftcardCode = (value?: string) => {
  if (!value) return undefined;
  const match = value.match(/gift\s*card\s*([a-zA-Z0-9-]+)/i);
  return match?.[1]?.toUpperCase();
};

const toTimestamp = (value?: string) => {
  const parsed = parseBackendDateTime(value);
  if (!parsed) return 0;
  return parsed.getTime();
};

const toComparableDate = (value?: string) => {
  const parsed = parseDateToDate(value);
  return parsed ? toLocalDateString(parsed) : "";
};

const isWithinDateRange = (value: string | undefined, start: string, end: string) => {
  const comparable = toComparableDate(value);
  if (!comparable) return false;
  return comparable >= start && comparable <= end;
};

const buildRangeVariants = (start: string, end: string) => {
  const legacyStart = toBackendDate(start);
  const legacyEnd = toBackendDate(end);
  const variants: Array<{
    params: { fecha_inicio: string; fecha_fin: string };
    options?: { preserveDateParams?: boolean };
  }> = [
    {
      params: {
        fecha_inicio: start,
        fecha_fin: end,
      },
      options: { preserveDateParams: true },
    },
  ];

  if (legacyStart !== start || legacyEnd !== end) {
    variants.push({
      params: {
        fecha_inicio: legacyStart,
        fecha_fin: legacyEnd,
      },
    });
  }

  return variants;
};

const mergeCashRecords = <T extends { id: string; fecha?: string; creado_en?: string }>(records: T[]) => {
  const deduplicated = new Map<string, T>();

  for (const record of records) {
    const key = String(record.id);
    const current = deduplicated.get(key);
    if (!current) {
      deduplicated.set(key, record);
      continue;
    }

    const currentTimestamp = toTimestamp(current.creado_en || current.fecha);
    const nextTimestamp = toTimestamp(record.creado_en || record.fecha);
    if (nextTimestamp >= currentTimestamp) {
      deduplicated.set(key, record);
    }
  }

  return Array.from(deduplicated.values()).sort((a, b) => {
    return toTimestamp(b.creado_en || b.fecha) - toTimestamp(a.creado_en || a.fecha);
  });
};

const normalizeGiftcardIngresos = (giftcards: GiftCard[], start: string, end: string): CashIngreso[] => {
  return giftcards
    .filter((giftcard) => isWithinDateRange(giftcard.fecha_emision || giftcard.created_at, start, end))
    .map((giftcard, index) => {
      const parsedMetodo = parseGiftcardPaymentMethod((giftcard as any)?.notas || "");
      return {
        id: `giftcard-${giftcard.codigo || giftcard._id || index}`,
        sede_id: giftcard.sede_id,
        monto: toNumber(giftcard.valor ?? (giftcard as any)?.saldo_disponible ?? 0),
        motivo: giftcard.codigo ? `Venta Gift Card ${giftcard.codigo}` : "Venta Gift Card",
        concepto: giftcard.codigo ? `Venta Gift Card ${giftcard.codigo}` : "Venta Gift Card",
        tipo: "giftcard",
        metodo_pago: parsedMetodo,
        fecha: giftcard.fecha_emision ?? giftcard.created_at ?? getToday(),
        creado_en: giftcard.created_at ?? giftcard.fecha_emision,
      };
    })
    .filter((ingreso) => ingreso.monto > 0);
};

const SECTION_CARD_CLASS = "border-gray-300 bg-white shadow-sm";
const METRIC_CARD_CLASS = "border-gray-300 bg-white transition-colors hover:border-gray-400";
const TABLE_WRAPPER_CLASS = "overflow-x-auto rounded-lg border border-gray-300";
const TABLE_HEAD_CLASS = "bg-gray-50 text-left text-sm font-medium text-gray-700";
const TABLE_HEAD_CELL_CLASS = "px-4 py-3";
const TABLE_CELL_CLASS = "px-4 py-3";
const FIELD_LABEL_CLASS = "mb-2 block text-sm font-medium text-gray-700";
const INPUT_CLASS =
  "h-10 rounded-md border-gray-300 bg-white text-gray-900 shadow-sm focus-visible:border-gray-500 focus-visible:ring-1 focus-visible:ring-gray-500";
const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-gray-500";
const PRIMARY_BUTTON_CLASS = "bg-black text-white hover:bg-gray-800";
const OUTLINE_BUTTON_CLASS = "border-gray-300 text-gray-800 hover:bg-gray-100";
const INFO_PANEL_CLASS = "rounded-lg border border-gray-300 bg-gray-50 p-3 text-sm text-gray-600";
const BADGE_BASE_CLASS = "inline-flex rounded-full border px-2 py-1 text-xs font-medium";
const FORM_GRID_CLASS = "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4";

export default function CierreCajaPage() {
  const { user } = useAuth();
  const [moneda, setMoneda] = useState("COP");
  const [sedeId, setSedeId] = useState<string | null>(null);
  const [sedeNombre, setSedeNombre] = useState<string | null>(null);
  const monedaSede = String(moneda || "COP").toUpperCase();

  const today = useMemo(() => getToday(), []);
  const [, setPeriodoSeleccionado] = useState<HeaderPeriod>("today");
  const [fechaDesde, setFechaDesde] = useState(today);
  const [fechaHasta, setFechaHasta] = useState(today);
  const [periodoActivo, setPeriodoActivo] = useState<PeriodoId>("hoy");
  const [rangoAplicado, setRangoAplicado] = useState<{ from: Date; to: Date } | undefined>(undefined);

  const PERIODO_TO_HEADER: Record<PeriodoId, HeaderPeriod> = {
    hoy: "today",
    "7dias": "last_7_days",
    mes: "month",
    "30dias": "last_30_days",
    rango: "custom",
  };

  const [, setResumen] = useState<CashResumen>({
    ingresos: 0,
    egresos: 0,
    balance: 0,
    moneda: "COP",
  });
  const [ingresos, setIngresos] = useState<CashIngreso[]>([]);
  const [egresos, setEgresos] = useState<CashEgreso[]>([]);
  const [cierres, setCierres] = useState<CashCierre[]>([]);
  const [giftcardIngresos, setGiftcardIngresos] = useState<CashIngreso[]>([]);

  const [loadingResumen, setLoadingResumen] = useState(false);
  const [loadingIngresos, setLoadingIngresos] = useState(false);
  const [loadingEgresos, setLoadingEgresos] = useState(false);
  const [loadingCierres, setLoadingCierres] = useState(false);
  const [loadingGiftcards, setLoadingGiftcards] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const [activeAction, setActiveAction] = useState<"ingreso" | "egreso" | "apertura" | "cierre" | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reportePeriodo, setReportePeriodo] = useState<CashReporteRaw | null>(null);
  const [descargandoReporte, setDescargandoReporte] = useState(false);

  // Form states
  const [ingresoMonto, setIngresoMonto] = useState("");
  const [ingresoMetodoPago, setIngresoMetodoPago] = useState<string>(DEFAULT_CASH_PAYMENT_METHOD);
  const [ingresoTipo, setIngresoTipo] = useState<string>(DEFAULT_CASH_INCOME_TYPE);
  const [ingresoMotivo, setIngresoMotivo] = useState("");
  const [ingresoMotivoEdicion, setIngresoMotivoEdicion] = useState("");
  const [ingresoFecha, setIngresoFecha] = useState(getToday());
  const [editingIngresoId, setEditingIngresoId] = useState<string | null>(null);

  const [egresoMonto, setEgresoMonto] = useState("");
  const [egresoMotivo, setEgresoMotivo] = useState("");
  const [egresoMotivoEdicion, setEgresoMotivoEdicion] = useState("");
  const [egresoFecha, setEgresoFecha] = useState(getToday());
  const [egresoMetodoPago, setEgresoMetodoPago] = useState<string>(DEFAULT_CASH_PAYMENT_METHOD);
  const [egresoTipo, setEgresoTipo] = useState<string>(DEFAULT_CASH_EXPENSE_TYPE);
  const [editingEgresoId, setEditingEgresoId] = useState<string | null>(null);
  const isEditingEgreso = Boolean(editingEgresoId);

  const [efectivoEnCaja, setEfectivoEnCaja] = useState<number | null>(null);
  const [loadingEfectivoEnCaja, setLoadingEfectivoEnCaja] = useState(false);

  const [aperturaMonto, setAperturaMonto] = useState("");
  const [aperturaNota, setAperturaNota] = useState("");
  const [aperturaFecha, setAperturaFecha] = useState(getToday());

  const [cierreNota, setCierreNota] = useState("");
  const [cierreFecha, setCierreFecha] = useState(getToday());
  const [cierreEfectivoContado, setCierreEfectivoContado] = useState("");
  const [sedesOptions, setSedesOptions] = useState<Array<{ id: string; nombre: string }>>([]);
  const [loadingSedes, setLoadingSedes] = useState(false);

  const normalizedRole = useMemo(() => String(user?.role || "").toLowerCase(), [user?.role]);
  const canEditMovimientos = useMemo(
    () => ["admin_sede", "adminsede", "admin", "super_admin", "superadmin"].includes(normalizedRole),
    [normalizedRole]
  );
  const isSuperAdmin = useMemo(
    () => normalizedRole === "super_admin" || normalizedRole === "superadmin",
    [normalizedRole]
  );

  const applySedeSelection = useCallback(
    (nextSedeId: string, nextSedeNombre?: string | null) => {
      const resolvedId = String(nextSedeId || "").trim();
      if (!resolvedId) return;

      const resolvedName = formatSedeNombre(nextSedeNombre, resolvedId);

      setSedeId(resolvedId);
      setSedeNombre(resolvedName);

      persistSedeContext({ activeSedeId: resolvedId });
      if (typeof window !== "undefined") {
        sessionStorage.setItem("beaux-sede_id", resolvedId);
        localStorage.setItem("beaux-sede_id", resolvedId);
        sessionStorage.setItem("beaux-nombre_local", resolvedName);
        localStorage.setItem("beaux-nombre_local", resolvedName);
      }
    },
    []
  );

  useEffect(() => {
    const resolvedSedeId = String(
      user?.sede_id ||
        sessionStorage.getItem("beaux-sede_id") ||
        localStorage.getItem("beaux-sede_id") ||
        ""
    ).trim();
    const resolvedSedeNombre = String(
      user?.nombre_local ||
        sessionStorage.getItem("beaux-nombre_local") ||
        localStorage.getItem("beaux-nombre_local") ||
        ""
    ).trim();
    const resolvedMoneda = String(
      user?.moneda ||
        sessionStorage.getItem("beaux-moneda") ||
        localStorage.getItem("beaux-moneda") ||
        "COP"
    ).trim();

    setSedeId(resolvedSedeId || null);
    setSedeNombre(resolvedSedeNombre || null);
    setMoneda((resolvedMoneda || "COP").toUpperCase());
  }, [user?.sede_id, user?.nombre_local, user?.moneda]);

  useEffect(() => {
    if (!isSuperAdmin || !user?.access_token) return;

    let isMounted = true;

    const loadSedes = async () => {
      try {
        setLoadingSedes(true);
        const sedes = await getSedes(user.access_token);
        const mapped =
          (Array.isArray(sedes) ? sedes : [])
            .map((sede) => {
              const id = String(
                (sede as any).sede_id || (sede as any).unique_id || (sede as any)._id || ""
              ).trim();
              if (!id) return null;
              return { id, nombre: formatSedeNombre((sede as any).nombre, id) };
            })
            .filter(Boolean) as Array<{ id: string; nombre: string }>;

        if (!isMounted) return;

        const hasCurrent = sedeId
          ? mapped.some((item) => item.id === sedeId)
          : false;
        const nextOptions = hasCurrent || !sedeId
          ? mapped
          : [{ id: sedeId as string, nombre: sedeNombre || sedeId }, ...mapped];

        setSedesOptions(nextOptions);

        if (!sedeId && nextOptions.length > 0) {
          applySedeSelection(nextOptions[0].id, nextOptions[0].nombre);
        }
      } catch (err) {
        if (isMounted) {
          setSedesOptions([]);
        }
      } finally {
        if (isMounted) {
          setLoadingSedes(false);
        }
      }
    };

    void loadSedes();

    return () => {
      isMounted = false;
    };
  }, [isSuperAdmin, user?.access_token, applySedeSelection, sedeId, sedeNombre]);

  const handleSedeChange = (value: string) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return;
    const option = sedesOptions.find((item) => item.id === trimmed);
    applySedeSelection(trimmed, option?.nombre || trimmed);
  };

  const handlePeriodChange = (newPeriod: HeaderPeriod) => {
    const range = getRangeByPeriod(newPeriod);
    const normalized = normalizeDateRange(range.start_date, range.end_date);
    if (!normalized.start || !normalized.end) return;
    setPeriodoSeleccionado(newPeriod);
    setFechaDesde(normalized.start);
    setFechaHasta(normalized.end);
  };

  const handlePeriodoChange = (periodo: PeriodoId, fechas?: { from: Date; to: Date }) => {
    setPeriodoActivo(periodo);
    const headerPeriod = PERIODO_TO_HEADER[periodo];
    if (periodo === "rango" && fechas) {
      setRangoAplicado(fechas);
      // ✅ DEBUG: Verify custom range dates
      console.log('[CierreCaja] Custom range applied:', {
        from: fechas.from,
        to: fechas.to,
        from_month: fechas.from.getMonth(),
        to_month: fechas.to.getMonth(),
        formatted_from: formatLocalDate(fechas.from),
        formatted_to: formatLocalDate(fechas.to),
      });
      const normalized = normalizeDateRange(formatLocalDate(fechas.from), formatLocalDate(fechas.to));
      if (normalized.start && normalized.end) {
        setPeriodoSeleccionado("custom");
        setFechaDesde(normalized.start);
        setFechaHasta(normalized.end);
      }
    } else {
      handlePeriodChange(headerPeriod);
    }
  };

  const displayDateRange = useMemo(() => {
    if (!fechaDesde || !fechaHasta) return "--";
    if (fechaDesde === fechaHasta) return formatHeaderDate(fechaHasta);
    return `${formatDate(fechaDesde)} - ${formatDate(fechaHasta)}`;
  }, [fechaDesde, fechaHasta]);

  const cierreDiferencia = useMemo(() => {
    if (efectivoEnCaja === null || !cierreEfectivoContado.trim()) {
      return null;
    }

    const contado = toNumber(cierreEfectivoContado);
    if (Number.isNaN(contado)) {
      return null;
    }

    return Number((contado - efectivoEnCaja).toFixed(2));
  }, [cierreEfectivoContado, efectivoEnCaja]);

  const formatMoney = (value: number) => {
    const locale = monedaSede === "USD" ? "en-US" : monedaSede === "MXN" ? "es-MX" : "es-CO";
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: monedaSede,
        minimumFractionDigits: 0,
      }).format(value);
    } catch (error) {
      return `${monedaSede} ${value.toFixed(0)}`;
    }
  };

  const normalizeResumen = (data: CashReporteRaw): CashResumen => {
    const root = unwrapData(data) || {};
    const summary = root?.resumen ?? root?.summary ?? root;
    const periodTotals = root?.totales;
    const metrics = extractCashReportMetrics(data);

    const ingresos =
      metrics.totalRecibido ??
      pickNumber(periodTotals, ["ingresos", "total_ingresos", "ventas", "total_ventas"]) ??
      pickNumber(summary, [
        "ingresos_total",
        "total_ingresos",
        "ventas_totales",
        "total_ventas",
        "ingresos",
      ]) ??
      0;

    const egresos =
      metrics.egresosEfectivo ??
      pickNumber(periodTotals, ["egresos", "total_egresos"]) ??
      pickNumber(summary, [
        "egresos_total",
        "total_egresos",
        "egresos",
        "gastos",
      ]) ??
      0;

    const balance =
      metrics.efectivoEsperado ??
      pickNumber(periodTotals, ["neto", "balance", "saldo"]) ??
      pickNumber(summary, ["balance", "saldo", "neto", "total_balance"]) ??
      (ingresos - egresos);

    return {
      ingresos,
      egresos,
      balance,
      moneda: summary?.moneda ?? root?.moneda ?? monedaSede,
    };
  };

  const normalizeEgresos = (data: any): CashEgreso[] => {
    const root = unwrapData(data);
    const lista = pickArray(
      root?.egresos,
      root?.items,
      root?.data,
      root?.results,
      root?.rows,
      root?.movimientos,
      root?.egresos?.items,
      root?.egresos?.data,
      root?.data?.egresos,
      root
    );

    return lista.map((item, index) => {
      return {
        id: item._id || item.id || item.egreso_id || String(index),
        sede_id: item.sede_id,
        monto: toNumber(item.monto ?? item.valor ?? item.total ?? item.importe ?? 0),
        motivo:
          item.motivo ??
          item.nota ??
          item.descripcion ??
          item.concepto ??
          item.observacion ??
          "Sin motivo",
        concepto: item.concepto ?? item.descripcion ?? item.motivo ?? item.nota,
        tipo: item.tipo ?? item.tipo_movimiento,
        metodo_pago: item.metodo_pago ?? item.medio_pago ?? item.medio ?? "efectivo",
        fecha:
          item.fecha ??
          item.created_at ??
          item.creado_en ??
          item.fecha_creacion ??
          item.fecha_egreso ??
          getToday(),
        creado_en: item.creado_en ?? item.created_at ?? item.fecha_creacion,
      };
    });
  };

  const formatSignedMoney = (value: number) => {
    if (value < 0) return `-${formatMoney(Math.abs(value))}`;
    return formatMoney(value);
  };

  const formatTrendMoney = (value: number) => {
    if (value > 0) return `↑ ${formatMoney(value)}`;
    if (value < 0) return `↓ ${formatMoney(Math.abs(value))}`;
    return formatMoney(0);
  };

  const normalizeIngresos = (data: any): CashIngreso[] => {
    const root = unwrapData(data);
    const lista = pickArray(
      root?.ingresos,
      root?.items,
      root?.data,
      root?.results,
      root?.rows,
      root?.movimientos,
      root?.ingresos?.items,
      root?.ingresos?.data,
      root?.data?.ingresos,
      root
    );

    return lista.map((item, index) => {
      return {
        id: item._id || item.id || item.ingreso_id || String(index),
        sede_id: item.sede_id,
        monto: toNumber(item.monto ?? item.valor ?? item.total ?? item.importe ?? 0),
        motivo:
          item.motivo ??
          item.descripcion ??
          item.concepto ??
          item.nota ??
          item.observacion ??
          "Ingreso manual",
        tipo: item.tipo ?? item.tipo_movimiento ?? item.categoria ?? "otro",
        metodo_pago: item.metodo_pago ?? item.metodo ?? item.medio_pago ?? item.medio ?? "otros",
        fecha:
          item.fecha ??
          item.created_at ??
          item.creado_en ??
          item.fecha_creacion ??
          item.fecha_ingreso ??
          getToday(),
        creado_en: item.creado_en ?? item.created_at ?? item.fecha_creacion,
      };
    });
  };

  const normalizeCierres = (data: any): CashCierre[] => {
    const root = unwrapData(data);
    const lista =
      root?.cierres ?? root?.items ?? root?.data ?? (Array.isArray(root) ? root : []);

    if (!Array.isArray(lista)) return [];

    return lista.map((item, index) => {
      const ingresos = toNumber(
        item.ingresos_total ?? item.total_ingresos ?? item.ventas_totales ?? item.ingresos ?? 0
      );
      const egresos = toNumber(
        item.egresos_total ?? item.total_egresos ?? item.egresos ?? item.gastos ?? 0
      );

      return {
        id: item._id || item.id || item.cierre_id || String(index),
        sede_id: item.sede_id,
        fecha_apertura: item.fecha_apertura ?? item.apertura ?? item.fecha_inicio ?? item.fecha,
        fecha_cierre: item.fecha_cierre ?? item.cierre ?? item.fecha_fin ?? item.fecha,
        ingresos,
        egresos,
        balance: toNumber(item.balance ?? item.saldo ?? ingresos - egresos),
        notas: item.notas ?? item.observaciones ?? item.nota,
        estado: item.estado ?? item.status,
      };
    });
  };

  const normalizeEfectivoEnCaja = (data: any): number => {
    const root = unwrapData(data) || {};
    const dataNode = unwrapData(root?.data) || root?.data;
    const resultNode = unwrapData(root?.result) || root?.result;
    const resumenNode = unwrapData(root?.resumen) || root?.resumen;
    const efectivoCalculado =
      toNumber(root?.efectivo_inicial) +
      toNumber(root?.ingresos_efectivo?.total) -
      toNumber(root?.egresos?.total);

    const efectivo =
      pickNumber(root, [
        "efectivo",
        "efectivo_esperado",
        "efectivo_total",
        "efectivo_en_caja",
        "saldo",
      ]) ??
      pickNumber(resumenNode, [
        "efectivo",
        "efectivo_esperado",
        "efectivo_total",
        "efectivo_en_caja",
        "saldo",
      ]) ??
      pickNumber(dataNode, [
        "efectivo",
        "efectivo_esperado",
        "efectivo_total",
        "efectivo_en_caja",
        "saldo",
      ]) ??
      pickNumber(resultNode, [
        "efectivo",
        "efectivo_esperado",
        "efectivo_total",
        "efectivo_en_caja",
        "saldo",
      ]) ??
      efectivoCalculado ??
      0;

    return toNumber(efectivo);
  };

  const loadEfectivoEnCaja = useCallback(async () => {
    if (!sedeId) return;

    const token = String(
      user?.access_token ||
        user?.token ||
        sessionStorage.getItem("access_token") ||
        localStorage.getItem("access_token") ||
        ""
    ).trim();
    if (!token) {
      setEfectivoEnCaja(null);
      return;
    }

    setLoadingEfectivoEnCaja(true);

    try {
      const data = await getEfectivoDia(token, {
        sede_id: sedeId,
        fecha: cierreFecha,
      });
      const efectivo = normalizeEfectivoEnCaja(data);
      setEfectivoEnCaja(efectivo);
    } catch {
      setEfectivoEnCaja(null);
    } finally {
      setLoadingEfectivoEnCaja(false);
    }
  }, [cierreFecha, sedeId, user?.access_token, user?.token]);

  const loadResumen = async () => {
    if (!sedeId) return;
    const { start, end } = normalizeDateRange(fechaDesde, fechaHasta);
    if (!start || !end) return;
    setLoadingResumen(true);
    setError(null);

    try {
      const reporte = await cashService.getReportePeriodo({
        sede_id: sedeId,
        fecha_inicio: start,
        fecha_fin: end,
      });
      setResumen(normalizeResumen(reporte));
      setReportePeriodo(reporte);
    } catch (err) {
      if (start === end) {
        try {
          const efectivo = await cashService.getEfectivoDia({
            sede_id: sedeId,
            fecha: start,
          });
          setResumen(normalizeResumen(efectivo));
          setReportePeriodo(efectivo);
        } catch (innerErr) {
          setResumen({ ingresos: 0, egresos: 0, balance: 0, moneda: monedaSede });
          setReportePeriodo(null);
          setError("No se pudieron cargar los ingresos del período");
        }
      } else {
        setResumen({ ingresos: 0, egresos: 0, balance: 0, moneda: monedaSede });
        setReportePeriodo(null);
        setError("No se pudieron cargar los ingresos del período");
      }
    } finally {
      setLoadingResumen(false);
    }
  };

  const loadEgresos = async () => {
    if (!sedeId) return;
    const { start, end } = normalizeDateRange(fechaDesde, fechaHasta);
    if (!start || !end) return;
    setLoadingEgresos(true);
    setError(null);

    try {
      const responses = await Promise.allSettled(
        buildRangeVariants(start, end).map(({ params, options }) =>
          cashService.getEgresos(
            {
              sede_id: sedeId,
              ...params,
            },
            options
          )
        )
      );

      const successful = responses.flatMap((response) => {
        return response.status === "fulfilled" ? normalizeEgresos(response.value) : [];
      });

      if (successful.length === 0 && responses.every((response) => response.status === "rejected")) {
        throw new Error("No se pudieron cargar los egresos");
      }

      const egresosNormalizados = mergeCashRecords(successful).filter((egreso) =>
        isWithinDateRange(egreso.fecha || egreso.creado_en, start, end)
      );
      setEgresos(egresosNormalizados);
    } catch (err) {
      setEgresos([]);
      setError("No se pudieron cargar los egresos");
    } finally {
      setLoadingEgresos(false);
    }
  };

  const loadIngresos = async () => {
    if (!sedeId) return;
    const { start, end } = normalizeDateRange(fechaDesde, fechaHasta);
    if (!start || !end) return;
    setLoadingIngresos(true);
    setError(null);

    try {
      const responses = await Promise.allSettled(
        buildRangeVariants(start, end).map(({ params, options }) =>
          cashService.getIngresos(
            {
              sede_id: sedeId,
              ...params,
            },
            options
          )
        )
      );

      const successful = responses.flatMap((response) => {
        return response.status === "fulfilled" ? normalizeIngresos(response.value) : [];
      });

      if (successful.length === 0 && responses.every((response) => response.status === "rejected")) {
        throw new Error("No se pudieron cargar los ingresos");
      }

      const ingresosNormalizados = mergeCashRecords(successful).filter((ingreso) =>
        isWithinDateRange(ingreso.fecha || ingreso.creado_en, start, end)
      );
      setIngresos(ingresosNormalizados);
    } catch (err) {
      setIngresos([]);
      setError("No se pudieron cargar los ingresos registrados");
    } finally {
      setLoadingIngresos(false);
    }
  };

  const loadGiftcardVentas = async () => {
    if (!sedeId) return;
    const { start, end } = normalizeDateRange(fechaDesde, fechaHasta);
    if (!start || !end) return;

    const token = String(
      user?.access_token ||
        user?.token ||
        sessionStorage.getItem("access_token") ||
        localStorage.getItem("access_token") ||
        ""
    ).trim();
    if (!token) {
      setGiftcardIngresos([]);
      return;
    }

    setLoadingGiftcards(true);
    try {
      const response = await giftcardsService.getGiftCardsBySede(token, sedeId, {
        page: 1,
        limit: 400,
      });
      const lista = Array.isArray(response.giftcards) ? response.giftcards : [];
      const normalizados = normalizeGiftcardIngresos(lista, start, end);
      setGiftcardIngresos(normalizados);
    } catch (err) {
      setGiftcardIngresos([]);
    } finally {
      setLoadingGiftcards(false);
    }
  };

  const loadCierres = async () => {
    if (!sedeId) return;
    setLoadingCierres(true);

    try {
      const result = await cashService.getCierres({
        sede_id: sedeId,
      });
      setCierres(normalizeCierres(result));
    } catch (err) {
      setCierres([]);
    } finally {
      setLoadingCierres(false);
    }
  };

  const loadAll = async () => {
    await Promise.all([
      loadResumen(),
      loadIngresos(),
      loadEgresos(),
      loadCierres(),
      loadEfectivoEnCaja(),
      loadGiftcardVentas(),
    ]);
  };

  useEffect(() => {
    if (sedeId) {
      loadAll();
    }
  }, [sedeId, fechaDesde, fechaHasta]);

  useEffect(() => {
    if (sedeId) {
      loadEfectivoEnCaja();
    }
  }, [sedeId, loadEfectivoEnCaja]);

  const handleCreateIngreso = async () => {
    if (!sedeId) return;

    const montoValue = toNumber(ingresoMonto);
    const isEditing = Boolean(editingIngresoId);
    if (!montoValue || montoValue <= 0) {
      setError("El monto del ingreso debe ser mayor a 0");
      return;
    }

    if (!ingresoMotivo.trim()) {
      setError("El motivo del ingreso es obligatorio");
      return;
    }

    const motivoEdicionIngreso = ingresoMotivoEdicion.trim();
    if (isEditing && !motivoEdicionIngreso) {
      setError("Debes especificar el motivo de la edición del ingreso para auditoría.");
      return;
    }

    setLoadingAction(true);
    setActiveAction("ingreso");
    setError(null);
    setSuccess(null);

    try {
      const fechaIngresoDMY = formatDateDMY(ingresoFecha);

      const payloadIngreso = {
        sede_id: sedeId,
        monto: montoValue,
        tipo: ingresoTipo,
        metodo_pago: normalizeCashPaymentMethodForBackend(ingresoMetodoPago),
        motivo: ingresoMotivo.trim(),
        fecha: fechaIngresoDMY,
        moneda: monedaSede,
      };

      const responseIngreso = isEditing && editingIngresoId
        ? await cashService.updateIngreso(editingIngresoId, {
            ...payloadIngreso,
            motivo_edicion: motivoEdicionIngreso,
          })
        : await cashService.createIngreso(payloadIngreso);

      const ingresoRegistradoId = String(
        responseIngreso?.ingreso_id || responseIngreso?.id || editingIngresoId || `tmp-ingreso-${Date.now()}`
      );
      setIngresos((prev) => {
        const nuevoIngreso: CashIngreso = {
          id: ingresoRegistradoId,
          sede_id: sedeId,
          monto: montoValue,
          motivo: ingresoMotivo.trim(),
          concepto: ingresoMotivo.trim(),
          tipo: ingresoTipo,
          metodo_pago: ingresoMetodoPago,
          fecha: ingresoFecha,
          creado_en: responseIngreso?.creado_en || new Date().toISOString(),
          motivo_edicion: isEditing ? motivoEdicionIngreso : undefined,
        };
        const filtered = isEditing
          ? prev.filter((item) => String(item.id) !== String(editingIngresoId))
          : prev;
        return [nuevoIngreso, ...filtered];
      });

      resetIngresoForm();
      setEditingIngresoId(null);
      setSuccess(isEditing ? "Ingreso actualizado correctamente" : "Ingreso registrado correctamente");
      toast({
        title: isEditing ? "Ingreso actualizado" : "Ingreso registrado",
        description: "El ingreso manual se guardó correctamente.",
      });
      await loadResumen();
      await loadEfectivoEnCaja();
    } catch (err: any) {
      setError(
        err?.message ||
          (isEditing ? "No se pudo actualizar el ingreso" : "No se pudo registrar el ingreso")
      );
    } finally {
      setLoadingAction(false);
      setActiveAction(null);
    }
  };

  const startEditEgreso = (egresoId: string) => {
    const target = egresos.find((item) => String(item.id) === egresoId);
    if (!target) return;

    setEditingEgresoId(String(target.id));
    setEgresoMonto(String(Math.abs(target.monto || 0)));
    setEgresoMotivo(target.concepto || target.motivo || "");
    setEgresoMotivoEdicion("");
    setEgresoMetodoPago(target.metodo_pago || DEFAULT_CASH_PAYMENT_METHOD);
    setEgresoTipo(target.tipo || DEFAULT_CASH_EXPENSE_TYPE);
    setEgresoFecha(toBackendDate(target.fecha || target.creado_en || getToday()));
    setError(null);
    setSuccess(null);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const startEditIngreso = (ingresoId: string) => {
    const target = ingresos.find((item) => String(item.id) === ingresoId);
    if (!target) return;

    setEditingIngresoId(String(target.id));
    setIngresoMonto(String(Math.abs(target.monto || 0)));
    setIngresoMotivo(target.concepto || target.motivo || "");
    setIngresoMotivoEdicion("");
    setIngresoMetodoPago(target.metodo_pago || DEFAULT_CASH_PAYMENT_METHOD);
    setIngresoTipo(target.tipo || DEFAULT_CASH_INCOME_TYPE);
    setIngresoFecha(toBackendDate(target.fecha || target.creado_en || getToday()));
    setError(null);
    setSuccess(null);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleCreateEgreso = async () => {
    if (!sedeId) return;

    const montoValue = toNumber(egresoMonto);
    const motivo = egresoMotivo.trim();
    const motivoEdicion = egresoMotivoEdicion.trim();
    const isEditing = Boolean(editingEgresoId);

    if (!montoValue || montoValue <= 0) {
      setError("El monto del egreso debe ser mayor a 0");
      return;
    }

    if (!motivo) {
      setError("El motivo del egreso es obligatorio");
      return;
    }

    if (isEditing && !motivoEdicion) {
      setError("Debes especificar el motivo de la edición para trazabilidad.");
      return;
    }

    setLoadingAction(true);
    setActiveAction("egreso");
    setError(null);
    setSuccess(null);

    try {
      const fechaEgresoDMY = formatDateDMY(egresoFecha);

      const payloadBase = {
        sede_id: sedeId,
        monto: montoValue,
        valor: montoValue,
        efectivo: montoValue,
        metodo_pago: normalizeCashPaymentMethodForBackend(egresoMetodoPago),
        motivo,
        descripcion: motivo,
        nota: motivo,
        tipo: egresoTipo,
        concepto: motivo,
        fecha: fechaEgresoDMY,
        moneda: monedaSede,
      };

      const response = isEditing && editingEgresoId
        ? await cashService.updateEgreso(editingEgresoId, {
            ...payloadBase,
            motivo_edicion: motivoEdicion,
          })
        : await cashService.createEgreso(payloadBase);

      const egresoRegistradoId = String(
        response?.egreso_id || response?.id || editingEgresoId || `tmp-egreso-${Date.now()}`
      );

      setEgresos((prev) => {
        const nuevoEgreso: CashEgreso = {
          id: egresoRegistradoId,
          sede_id: sedeId,
          monto: montoValue,
          motivo,
          concepto: motivo,
          tipo: egresoTipo,
          metodo_pago: egresoMetodoPago,
          fecha: egresoFecha,
          creado_en: response?.creado_en || new Date().toISOString(),
          motivo_edicion: motivoEdicion || undefined,
        };

        const filtered = isEditing
          ? prev.filter((item) => String(item.id) !== String(editingEgresoId))
          : prev.filter((item) => String(item.id) !== egresoRegistradoId);
        return [nuevoEgreso, ...filtered];
      });

      resetEgresoForm();
      setEditingEgresoId(null);
      setSuccess(isEditing ? "Egreso actualizado correctamente" : "Egreso registrado correctamente");
      await loadResumen();
      await loadEfectivoEnCaja();
    } catch (err: any) {
      setError(
        err?.message ||
          (isEditing ? "No se pudo actualizar el egreso" : "No se pudo registrar el egreso")
      );
    } finally {
      setLoadingAction(false);
      setActiveAction(null);
    }
  };

  const handleCierreCaja = async () => {
    if (!sedeId) {
      setError("No se encontró la sede actual para cerrar caja");
      return;
    }

    if (efectivoEnCaja === null) {
      setError("No se pudo obtener el efectivo en caja desde backend. Actualiza e intenta de nuevo.");
      return;
    }

    if (!cierreEfectivoContado.trim()) {
      setError("Debes ingresar el efectivo contado para cerrar caja");
      return;
    }

    const efectivoContadoValue = toNumber(cierreEfectivoContado);
    if (Number.isNaN(efectivoContadoValue) || efectivoContadoValue < 0) {
      setError("El efectivo contado debe ser mayor o igual a 0");
      return;
    }

    const diferencia = Number((efectivoContadoValue - efectivoEnCaja).toFixed(2));

    setLoadingAction(true);
    setActiveAction("cierre");
    setError(null);
    setSuccess(null);

    try {
      await cashService.cierreCaja({
        sede_id: sedeId,
        fecha: toBackendDate(cierreFecha),
        moneda: monedaSede,
        observaciones: cierreNota.trim() || undefined,
        efectivo_contado: efectivoContadoValue,
        efectivo_sistema: efectivoEnCaja,
        diferencia,
      });

      setCierreNota("");
      setCierreEfectivoContado("");
      setSuccess("Caja cerrada correctamente");
      toast({
        title: "Cierre realizado",
        description: "La caja se cerró usando el efectivo calculado por backend.",
      });

      await loadAll();
    } catch (err: any) {
      setError(err?.message || "No se pudo cerrar la caja");
    } finally {
      setLoadingAction(false);
      setActiveAction(null);
    }
  };

  const handleApertura = async () => {
    if (!sedeId) {
      setError("No se encontró la sede actual para abrir caja");
      return;
    }

    if (!aperturaFecha) {
      setError("Debes seleccionar la fecha de apertura");
      return;
    }

    const montoValue = toNumber(aperturaMonto);
    if (!montoValue || montoValue <= 0) {
      setError("El monto inicial debe ser mayor a 0");
      return;
    }

    setLoadingAction(true);
    setActiveAction("apertura");
    setError(null);
    setSuccess(null);

    try {
      await cashService.aperturaCaja({
        sede_id: sedeId,
        monto_inicial: montoValue,
        efectivo_inicial: montoValue,
        efectivo: montoValue,
        notas: aperturaNota.trim() || undefined,
        observaciones: aperturaNota.trim() || undefined,
        moneda: monedaSede,
        fecha: toBackendDate(aperturaFecha),
        fecha_apertura: toBackendDate(aperturaFecha),
      });

      setAperturaMonto("");
      setAperturaNota("");
      setAperturaFecha(getToday());
      setSuccess("Caja abierta correctamente");
      toast({
        title: "Caja abierta",
        description: "La apertura de caja se registró correctamente.",
      });

      await loadAll();
    } catch (err: any) {
      setError(err?.message || "No se pudo abrir la caja");
    } finally {
      setLoadingAction(false);
      setActiveAction(null);
    }
  };

  // const handleCierre = async () => {
  //   if (!sedeId) return;

  //   const efectivoContadoValue = toNumber(cierreEfectivoContado);
  //   if (Number.isNaN(efectivoContadoValue) || efectivoContadoValue < 0) {
  //     setError("El efectivo contado debe ser mayor o igual a 0");
  //     return;
  //   }

  //   setLoadingAction(true);
  //   setError(null);
  //   setSuccess(null);

  //   try {
  //     const totalIngresos = resumen.ingresos || 0;
  //     const totalEgresos = resumen.egresos || egresosTotal;
  //     const efectivoEsperado = resumen.balance || balanceCalculado;

  //     await cashService.cierreCaja({
  //       sede_id: sedeId,
  //       fecha: cierreFecha,
  //       notas: cierreNota.trim() || undefined,
  //       observaciones: cierreNota.trim() || undefined,
  //       moneda: monedaSede,
  //       ingresos_total: totalIngresos,
  //       total_ingresos: totalIngresos,
  //       total_ventas: totalIngresos,
  //       efectivo_total: totalIngresos,
  //       efectivo_recibido: totalIngresos,
  //       egresos_total: totalEgresos,
  //       total_egresos: totalEgresos,
  //       balance: efectivoEsperado,
  //       saldo: efectivoEsperado,
  //       efectivo_esperado: efectivoEsperado,
  //       efectivo_cierre: efectivoEsperado,
  //       efectivo_final: efectivoEsperado,
  //       efectivo_contado: efectivoContadoValue,
  //     });

  //     setCierreNota("");
  //     setSuccess("Caja cerrada correctamente");
  //     await loadAll();
  //   } catch (err: any) {
  //     setError(err?.message || "No se pudo cerrar la caja");
  //   } finally {
  //     setLoadingAction(false);
  //   }
  // };

  const giftcardVentasUnicas = useMemo(() => {
    if (!giftcardIngresos.length) return [];

    const existingCodes = new Set(
      ingresos
        .map((ingreso) =>
          extractGiftcardCode(
            `${ingreso.motivo ?? ""} ${ingreso.concepto ?? ""} ${ingreso.id ?? ""}`
          )
        )
        .filter((code): code is string => Boolean(code))
        .map((code) => code.toUpperCase())
    );

    return giftcardIngresos.filter((ingreso) => {
      const code = extractGiftcardCode(
        `${ingreso.motivo ?? ""} ${ingreso.concepto ?? ""} ${ingreso.id ?? ""}`
      );
      if (code && existingCodes.has(code.toUpperCase())) {
        return false;
      }
      return true;
    });
  }, [giftcardIngresos, ingresos]);

  const ingresosConGiftcards = useMemo(() => {
    if (!giftcardVentasUnicas.length) return ingresos;
    return mergeCashRecords([...ingresos, ...giftcardVentasUnicas]);
  }, [giftcardVentasUnicas, ingresos]);

  const localPaymentMethodTotals = useMemo(() => {
    const totals = {
      efectivo: 0,
      tarjetas: 0,
      transferencias: 0,
      linkPagos: 0,
      creditoEmpleados: 0,
      abonos: 0,
      giftCards: 0,
      addi: 0,
    };

    const addIngreso = (bucket: keyof typeof totals, amount: number) => {
      totals[bucket] = Number((totals[bucket] + amount).toFixed(2));
    };

    ingresosConGiftcards.forEach((ingreso) => {
      const methodKey = normalizePaymentMethodKey(ingreso.metodo_pago);
      const amount = ingreso.monto || 0;

      if (matchesAlias(methodKey, PAYMENT_METHOD_ALIASES.efectivo)) {
        addIngreso("efectivo", amount);
        return;
      }
      if (matchesAlias(methodKey, PAYMENT_METHOD_ALIASES.tarjetas)) {
        addIngreso("tarjetas", amount);
        return;
      }
      if (matchesAlias(methodKey, PAYMENT_METHOD_ALIASES.transferencias)) {
        addIngreso("transferencias", amount);
        return;
      }
      if (matchesAlias(methodKey, PAYMENT_METHOD_ALIASES.linkPagos)) {
        addIngreso("linkPagos", amount);
        return;
      }
      if (matchesAlias(methodKey, PAYMENT_METHOD_ALIASES.creditoEmpleados)) {
        addIngreso("creditoEmpleados", amount);
        return;
      }
      if (matchesAlias(methodKey, PAYMENT_METHOD_ALIASES.abonos) || ingreso.tipo === "abono_cliente") {
        addIngreso("abonos", amount);
        return;
      }
      if (matchesAlias(methodKey, PAYMENT_METHOD_ALIASES.giftCards) || ingreso.tipo === "giftcard") {
        addIngreso("giftCards", amount);
        return;
      }
      if (matchesAlias(methodKey, PAYMENT_METHOD_ALIASES.addi)) {
        addIngreso("addi", amount);
      }
    });

    return totals;
  }, [ingresosConGiftcards]);

  const egresosEfectivoLocal = useMemo(() => {
    return egresos.reduce((sum, egreso) => {
      const methodKey = normalizePaymentMethodKey(egreso.metodo_pago);
      const isCashExpense =
        !methodKey ||
        methodKey === "otros" ||
        matchesAlias(methodKey, PAYMENT_METHOD_ALIASES.efectivo);
      return isCashExpense ? sum + Math.abs(egreso.monto || 0) : sum;
    }, 0);
  }, [egresos]);

  const reportMetrics = useMemo(() => extractCashReportMetrics(reportePeriodo), [reportePeriodo]);
  const hasReportMetrics = reportePeriodo !== null;

  const totalRecibidoDisplay = useMemo(() => {
    if (hasReportMetrics) {
      return reportMetrics.totalRecibido;
    }

    return (
      localPaymentMethodTotals.efectivo +
      localPaymentMethodTotals.tarjetas +
      localPaymentMethodTotals.transferencias +
      localPaymentMethodTotals.linkPagos +
      localPaymentMethodTotals.creditoEmpleados +
      localPaymentMethodTotals.abonos +
      localPaymentMethodTotals.giftCards +
      localPaymentMethodTotals.addi
    );
  }, [hasReportMetrics, localPaymentMethodTotals, reportMetrics.totalRecibido]);

  const abonosTotal = useMemo(() => {
    return hasReportMetrics ? reportMetrics.abonos : localPaymentMethodTotals.abonos;
  }, [hasReportMetrics, localPaymentMethodTotals.abonos, reportMetrics.abonos]);

  const egresosEfectivoDisplay = useMemo(() => {
    return hasReportMetrics ? reportMetrics.egresosEfectivo : egresosEfectivoLocal;
  }, [egresosEfectivoLocal, hasReportMetrics, reportMetrics.egresosEfectivo]);

  const efectivoEsperadoDisplay = useMemo(() => {
    return hasReportMetrics ? reportMetrics.efectivoEsperado ?? efectivoEnCaja : efectivoEnCaja;
  }, [efectivoEnCaja, hasReportMetrics, reportMetrics.efectivoEsperado]);

  type MovimientoDia = {
    id: string;
    tipo: "ingreso" | "egreso";
    etiquetaTipo: string;
    detalle: string;
    motivoEdicion?: string;
    medio: string;
    monto: number;
    fecha: string;
    timestamp: number;
    orden: number;
    editable?: boolean;
  };

  const movimientosDia = useMemo<MovimientoDia[]>(() => {
    const ingresosNormalizados: MovimientoDia[] = ingresosConGiftcards.map((ingreso, index) => {
      const fechaMovimiento = ingreso.creado_en || ingreso.fecha;
      const metodo = String(ingreso.metodo_pago || "").toLowerCase();
      const isGiftcard = ingreso.tipo === "giftcard" || String(ingreso.id).startsWith("giftcard-");

      return {
        id: `ingreso-${ingreso.id}`,
        tipo: "ingreso",
        etiquetaTipo:
          isGiftcard
            ? "Venta Gift Card"
            : metodo === "abonos"
              ? "Abono"
              : getCashMovementTypeLabel("ingreso", ingreso.tipo, "Ingreso manual"),
        detalle:
          ingreso.motivo ||
          ingreso.concepto ||
          (isGiftcard ? "Venta Gift Card" : "Ingreso manual"),
        motivoEdicion: ingreso.motivo_edicion,
        medio: normalizePaymentMethod(ingreso.metodo_pago),
        monto: ingreso.monto || 0,
        fecha: formatTableDate(fechaMovimiento),
        timestamp: toTimestamp(fechaMovimiento),
        orden: index,
        editable: !isGiftcard,
      };
    });

    const egresosNormalizados: MovimientoDia[] = egresos.map((egreso, index) => {
      const fechaMovimiento = egreso.creado_en || egreso.fecha;
      return {
        id: `egreso-${egreso.id}`,
        tipo: "egreso",
        etiquetaTipo: getCashMovementTypeLabel("egreso", egreso.tipo, "Egreso"),
        detalle: egreso.concepto || egreso.motivo || "Egreso",
        motivoEdicion: egreso.motivo_edicion,
        medio: normalizePaymentMethod(egreso.metodo_pago),
        monto: -Math.abs(egreso.monto || 0),
        fecha: formatTableDate(fechaMovimiento),
        timestamp: toTimestamp(fechaMovimiento),
        orden: index,
      };
    });

    return [...ingresosNormalizados, ...egresosNormalizados].sort((a, b) => {
      const aHasTimestamp = a.timestamp > 0;
      const bHasTimestamp = b.timestamp > 0;

      if (aHasTimestamp && bHasTimestamp && a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }
      if (aHasTimestamp !== bHasTimestamp) {
        return aHasTimestamp ? -1 : 1;
      }
      if (a.orden !== b.orden) {
        return a.orden - b.orden;
      }
      return a.id.localeCompare(b.id);
    });
  }, [egresos, ingresosConGiftcards]);

  const movimientosConSaldo = useMemo(() => {
    let saldoAcumulado = 0;
    return movimientosDia.map((movimiento) => {
      saldoAcumulado = Number((saldoAcumulado + movimiento.monto).toFixed(2));
      return {
        ...movimiento,
        saldo_esperado: saldoAcumulado,
      };
    });
  }, [movimientosDia]);

  const saldosPorMedio = useMemo(() => {
    const efectivo = hasReportMetrics
      ? reportMetrics.paymentMethods.efectivo
      : localPaymentMethodTotals.efectivo;
    const tarjetas = hasReportMetrics
      ? reportMetrics.paymentMethods.tarjetas
      : localPaymentMethodTotals.tarjetas;
    const transferencias = hasReportMetrics
      ? reportMetrics.paymentMethods.transferencias
      : localPaymentMethodTotals.transferencias;
    const linkPagos = hasReportMetrics
      ? reportMetrics.paymentMethods.linkPagos
      : localPaymentMethodTotals.linkPagos;
    const creditoEmpleados = hasReportMetrics
      ? reportMetrics.paymentMethods.creditoEmpleados
      : localPaymentMethodTotals.creditoEmpleados;
    const abonos = hasReportMetrics ? reportMetrics.abonos : localPaymentMethodTotals.abonos;
    const giftcardsMetodo = hasReportMetrics
      ? reportMetrics.paymentMethods.giftCards
      : localPaymentMethodTotals.giftCards;
    const addi = hasReportMetrics
      ? reportMetrics.paymentMethods.addi
      : localPaymentMethodTotals.addi;
    const total = totalRecibidoDisplay;

    return {
      izquierda: [
        { label: "Efectivo", value: efectivo, trend: true },
        { label: "Tarjetas", value: tarjetas, trend: true },
        { label: "Transferencias", value: transferencias, trend: true },
        { label: "Total", value: total, trend: false, total: true },
      ],
      derecha: [
        { label: "Link de pago", value: linkPagos, trend: true },
        { label: "Crédito empleados", value: creditoEmpleados, trend: false },
        { label: "Abonos", value: abonos, trend: false },
        { label: "Gift Cards", value: giftcardsMetodo, trend: false },
        { label: "Addi", value: addi, trend: false },
      ],
    };
  }, [hasReportMetrics, localPaymentMethodTotals, reportMetrics, totalRecibidoDisplay]);

  const reporteResumen = useMemo(() => {
    if (!reportePeriodo) return null;
    const root = unwrapData(reportePeriodo) || {};
    const totales = root?.totales || {};
    const periodo = root?.periodo || {};
    const cierresReporte = Array.isArray(root?.cierres) ? root.cierres : [];

    return {
      inicio: String(periodo?.inicio || fechaDesde || ""),
      fin: String(periodo?.fin || fechaHasta || ""),
      ingresos: toNumber(totales?.ingresos),
      egresos: toNumber(totales?.egresos),
      neto: toNumber(totales?.neto),
      diferencias: toNumber(totales?.diferencias_acumuladas),
      cierres: cierresReporte,
    };
  }, [reportePeriodo, fechaDesde, fechaHasta]);

  const showManualCashForms = true;

  const handleDescargarReporte = async () => {
    if (!sedeId) return;
    const { start, end } = normalizeDateRange(fechaDesde, fechaHasta);
    if (!start || !end) return;

    setDescargandoReporte(true);
    setError(null);

    try {
      const { blob, filename } = await cashService.getReporteExcel({
        sede_id: sedeId,
        fecha_inicio: start,
        fecha_fin: end,
      });
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = filename || `reporte_caja_${start}${start !== end ? `_a_${end}` : ""}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
      setError(err?.message || "No se pudo descargar el reporte en Excel");
    } finally {
      setDescargandoReporte(false);
    }
  };

  const cajaAbiertaDesde = useMemo(() => {
    const ultimoCierre = [...cierres].sort((a, b) => {
      const bTime = toTimestamp(b.fecha_apertura || b.fecha_cierre);
      const aTime = toTimestamp(a.fecha_apertura || a.fecha_cierre);
      return bTime - aTime;
    })[0];

    const desdeCierre = formatTimeLabel(ultimoCierre?.fecha_apertura);
    if (desdeCierre !== "--") return desdeCierre;

    const primerMovimiento = [...movimientosDia]
      .filter((movimiento) => movimiento.timestamp > 0)
      .sort((a, b) => a.timestamp - b.timestamp)[0];

    if (!primerMovimiento?.timestamp) return "--";
    return formatTimeLabel(new Date(primerMovimiento.timestamp).toISOString());
  }, [cierres, movimientosDia]);

  const resetIngresoForm = () => {
    setEditingIngresoId(null);
    setIngresoMonto("");
    setIngresoMetodoPago(DEFAULT_CASH_PAYMENT_METHOD);
    setIngresoTipo(DEFAULT_CASH_INCOME_TYPE);
    setIngresoMotivo("");
    setIngresoMotivoEdicion("");
    setIngresoFecha(getToday());
    setError(null);
  };

  const resetEgresoForm = () => {
    setEditingEgresoId(null);
    setEgresoMonto("");
    setEgresoMotivo("");
    setEgresoMotivoEdicion("");
    setEgresoMetodoPago(DEFAULT_CASH_PAYMENT_METHOD);
    setEgresoTipo(DEFAULT_CASH_EXPENSE_TYPE);
    setEgresoFecha(getToday());
    setError(null);
  };


  return (
    <div className="flex flex-col h-screen bg-white">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8">
          <div className="space-y-6">
            <PageHeader title="Cierre de Caja" />
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
            {success && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                {success}
              </div>
            )}

            <Card className={SECTION_CARD_CLASS}>
              <CardContent className="p-6">
                <div className="grid gap-4 xl:grid-cols-[minmax(240px,320px)_minmax(0,1fr)_auto] xl:items-end">
                  <div>
                    <label className={FIELD_LABEL_CLASS}>Sede</label>
                    {isSuperAdmin ? (
                      <SedeDropdown
                        value={sedeId ?? ""}
                        onChange={handleSedeChange}
                        options={sedesOptions.map((o) => ({ sede_id: o.id, nombre: o.nombre }))}
                        disabled={loadingSedes}
                        size="md"
                        align="left"
                        className="w-full [&>button]:w-full [&>button]:h-10 [&>button]:justify-between"
                      />
                    ) : (
                      <div className="flex h-10 items-center rounded-md border border-gray-300 bg-gray-50 px-3 text-sm text-gray-900 shadow-sm">
                        {sedeNombre ? `Caja Sede ${sedeNombre}` : "Caja de la sede"}
                      </div>
                    )}
                  </div>

                  <div>
                    <PeriodoSelector
                      periodoActivo={periodoActivo}
                      onPeriodoChange={handlePeriodoChange}
                      rangoAplicado={rangoAplicado}
                    />
                  </div>

                  <div className="rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 xl:min-w-[250px] xl:justify-self-end">
                    <p className="text-sm font-medium text-gray-900">{displayDateRange}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      Caja abierta desde: {loadingCierres ? "..." : cajaAbiertaDesde}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card className={METRIC_CARD_CLASS}>
                <CardContent className="p-6">
                  <p className="text-sm font-medium text-gray-700">Dinero recibido hoy</p>
                  <p className="mt-2 text-2xl font-bold text-black">
                    {loadingResumen ? "..." : formatMoney(totalRecibidoDisplay)}
                  </p>
                </CardContent>
              </Card>

              <Card className={METRIC_CARD_CLASS}>
                <CardContent className="p-6">
                  <p className="text-sm font-medium text-gray-700">Abonos recibidos</p>
                  <p className="mt-2 text-2xl font-bold text-black">
                    {loadingResumen ? "..." : formatMoney(abonosTotal)}
                  </p>
                </CardContent>
              </Card>

              <Card className={METRIC_CARD_CLASS}>
                <CardContent className="p-6">
                  <p className="text-sm font-medium text-gray-700">Egresos</p>
                  <p className="mt-2 text-2xl font-bold text-black">
                    {loadingResumen ? "..." : formatSignedMoney(-Math.abs(egresosEfectivoDisplay))}
                  </p>
                </CardContent>
              </Card>

              <Card className={METRIC_CARD_CLASS}>
                <CardContent className="p-6">
                  <p className="text-sm font-medium text-gray-700">Efectivo en caja</p>
                  <p className="mt-2 text-2xl font-bold text-black">
                    {loadingResumen && efectivoEsperadoDisplay === null
                      ? "..."
                      : efectivoEsperadoDisplay === null
                        ? "--"
                        : formatMoney(efectivoEsperadoDisplay)}
                  </p>
                </CardContent>
              </Card>
            </div>

              <Card className={SECTION_CARD_CLASS}>
                <CardHeader className="border-b border-gray-200 pb-3">
                  <CardTitle className="text-xl font-semibold text-gray-900">Saldos por medio de pago</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-3 pt-6 md:grid-cols-2 md:gap-4">
                  <div className="space-y-3 md:border-r md:border-gray-200 md:pr-4">
                    {saldosPorMedio.izquierda.map((item) => (
                      <div
                        key={`left-${item.label}`}
                        className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 ${
                          item.total ? "border-gray-300 bg-gray-50" : "border-gray-200 bg-white"
                        }`}
                      >
                        <span className={`text-gray-700 ${item.total ? "text-base font-semibold" : "text-sm"}`}>
                          {item.label}
                        </span>
                        <span className={`font-semibold text-gray-900 ${item.total ? "text-lg" : "text-base"}`}>
                          {item.trend ? formatTrendMoney(item.value) : formatMoney(item.value)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3">
                    {saldosPorMedio.derecha.map((item) => (
                      <div
                        key={`right-${item.label}`}
                        className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3"
                      >
                        <span className="text-sm text-gray-700">{item.label}</span>
                        <span className="text-base font-semibold text-gray-900">
                          {item.trend ? formatTrendMoney(item.value) : formatMoney(item.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card className={SECTION_CARD_CLASS}>
                  <CardHeader className="border-b border-gray-200 pb-3">
                    <CardTitle className="text-xl font-semibold text-gray-900">Abrir caja</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-6">
                    <div className={FORM_GRID_CLASS}>
                      <div>
                        <label className={FIELD_LABEL_CLASS}>Fecha de apertura</label>
                        <DatePicker value={aperturaFecha} onChange={(v) => setAperturaFecha(v)} />
                      </div>
                      <div>
                        <label className={FIELD_LABEL_CLASS}>Monto inicial</label>
                        <Input
                          type="number"
                          min="0"
                          value={aperturaMonto}
                          onChange={(e) => setAperturaMonto(e.target.value)}
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className={FIELD_LABEL_CLASS}>Observaciones</label>
                        <Input value={aperturaNota} onChange={(e) => setAperturaNota(e.target.value)} className={INPUT_CLASS} placeholder="Opcional" />
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 md:flex-row md:items-center md:justify-between">
                      <div className="md:max-w-[70%]">
                        <div className={INFO_PANEL_CLASS}>
                          El monto inicial se registra como efectivo de apertura.
                        </div>
                      </div>
                      <Button
                        onClick={handleApertura}
                        disabled={loadingAction || !aperturaMonto.trim()}
                        className={`w-full md:w-auto md:min-w-[180px] ${PRIMARY_BUTTON_CLASS}`}
                      >
                        {loadingAction && activeAction === "apertura" ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Abriendo caja...
                          </>
                        ) : (
                          "Abrir caja"
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card className={SECTION_CARD_CLASS}>
                  <CardHeader className="border-b border-gray-200 pb-3">
                    <CardTitle className="text-xl font-semibold text-gray-900">Cierre de caja</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-6">
                    <div className={FORM_GRID_CLASS}>
                      <div>
                        <label className={FIELD_LABEL_CLASS}>Fecha de cierre</label>
                        <DatePicker value={cierreFecha} onChange={(v) => setCierreFecha(v)} />
                      </div>
                      <div>
                        <label className={FIELD_LABEL_CLASS}>Efectivo contado</label>
                        <Input
                          type="number"
                          min="0"
                          value={cierreEfectivoContado}
                          onChange={(e) => setCierreEfectivoContado(e.target.value)}
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className={FIELD_LABEL_CLASS}>Observaciones</label>
                        <Input value={cierreNota} onChange={(e) => setCierreNota(e.target.value)} className={INPUT_CLASS} placeholder="Opcional" />
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 md:flex-row md:items-center md:justify-between">
                      <div className="md:max-w-[70%]">
                        <div className={INFO_PANEL_CLASS}>
                          <div className="flex items-center justify-between gap-3">
                            <span>Diferencia</span>
                            <span
                              className={`font-semibold ${
                                cierreDiferencia === null
                                  ? "text-gray-700"
                                  : cierreDiferencia > 0
                                    ? "text-green-700"
                                    : "text-gray-900"
                              }`}
                            >
                              {cierreDiferencia === null ? "--" : formatMoney(cierreDiferencia)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <Button
                        onClick={handleCierreCaja}
                        disabled={
                          loadingAction || loadingEfectivoEnCaja || efectivoEnCaja === null || !cierreEfectivoContado.trim()
                        }
                        className={`w-full md:w-auto md:min-w-[180px] ${PRIMARY_BUTTON_CLASS}`}
                      >
                        {loadingAction && activeAction === "cierre" ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Cerrando caja...
                          </>
                        ) : (
                          "Cerrar caja"
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {reporteResumen ? (
                <Card className={SECTION_CARD_CLASS}>
                  <CardHeader className="border-b border-gray-200 pb-3">
                    <CardTitle className="text-xl font-semibold text-gray-900">Reporte del cierre</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-6">
                    <p className="text-sm text-gray-600">
                      Período: {formatDate(reporteResumen.inicio)} - {formatDate(reporteResumen.fin)}
                    </p>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <p className="text-sm text-gray-600">Ingresos</p>
                        <p className="mt-1 text-lg font-semibold text-gray-900">{formatMoney(reporteResumen.ingresos)}</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <p className="text-sm text-gray-600">Egresos</p>
                        <p className="mt-1 text-lg font-semibold text-gray-900">{formatSignedMoney(-Math.abs(reporteResumen.egresos))}</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <p className="text-sm text-gray-600">Neto</p>
                        <p className="mt-1 text-lg font-semibold text-gray-900">{formatMoney(reporteResumen.neto)}</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <p className="text-sm text-gray-600">Diferencias</p>
                        <p className="mt-1 text-lg font-semibold text-gray-900">{formatMoney(reporteResumen.diferencias)}</p>
                      </div>
                    </div>

                    {reporteResumen.cierres.length > 0 ? (
                      <div className={INFO_PANEL_CLASS}>
                        Último cierre: {String(reporteResumen.cierres[0]?.cierre_id || "--")} | Estado: {" "}
                        {String(reporteResumen.cierres[0]?.estado || "--")}
                      </div>
                    ) : null}

                    <div className="flex justify-end">
                      <Button
                        type="button"
                        onClick={handleDescargarReporte}
                        disabled={descargandoReporte}
                        className={PRIMARY_BUTTON_CLASS}
                      >
                        {descargandoReporte ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Descargando...
                          </>
                        ) : (
                          "Descargar reporte Excel"
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {showManualCashForms ? (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card className={SECTION_CARD_CLASS}>
                <CardHeader className="border-b border-gray-200 pb-3">
                  <CardTitle className="text-xl font-semibold text-gray-900">
                    {isEditingEgreso ? "Editar egreso" : "Registrar egreso"}
                  </CardTitle>
                  {isEditingEgreso ? (
                    <p className="text-sm text-gray-500">Estás editando un egreso existente.</p>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-4 pt-6">
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                      <div className="lg:col-span-2">
                          <label className={FIELD_LABEL_CLASS}>Concepto</label>
                          <Input
                            value={egresoMotivo}
                            onChange={(e) => {
                              setEgresoMotivo(e.target.value);
                              if (error && e.target.value.trim()) setError(null);
                            }}
                            className={INPUT_CLASS}
                          />
                        </div>
                        <div>
                          <label className={FIELD_LABEL_CLASS}>Cantidad</label>
                          <Input
                            type="number"
                            min="0"
                            value={egresoMonto}
                            onChange={(e) => setEgresoMonto(e.target.value)}
                            className={INPUT_CLASS}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div>
                          <label className={FIELD_LABEL_CLASS}>Método de pago</label>
                          <select
                            value={egresoMetodoPago}
                            onChange={(e) => setEgresoMetodoPago(e.target.value)}
                            className={SELECT_CLASS}
                          >
                            {CASH_PAYMENT_METHOD_OPTIONS.map((option) => (
                              <option key={`egreso-metodo-${option.value}`} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className={FIELD_LABEL_CLASS}>Tipo</label>
                          <select
                            value={egresoTipo}
                            onChange={(e) => setEgresoTipo(e.target.value)}
                            className={SELECT_CLASS}
                          >
                            {CASH_EXPENSE_TYPE_OPTIONS.map((option) => (
                              <option key={`egreso-tipo-${option.value}`} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className={FIELD_LABEL_CLASS}>Fecha</label>
                          <DatePicker value={egresoFecha} onChange={(v) => setEgresoFecha(v)} />
                        </div>
                      </div>

                      {isEditingEgreso ? (
                        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                          <label className={FIELD_LABEL_CLASS}>
                            Motivo de edición (obligatorio para auditoría)
                          </label>
                          <Input
                            value={egresoMotivoEdicion}
                            onChange={(e) => {
                              setEgresoMotivoEdicion(e.target.value);
                              if (error && e.target.value.trim()) setError(null);
                            }}
                            placeholder="Ej: Corrección de monto, ajuste de método de pago, error de digitación..."
                            className={INPUT_CLASS}
                          />
                        </div>
                      ) : null}
                    </div>

                    <div className="flex items-center justify-end gap-2 border-t border-gray-200 pt-4">
                      <Button variant="outline" onClick={resetEgresoForm} className={`min-w-24 ${OUTLINE_BUTTON_CLASS}`}>
                        Cancelar
                      </Button>
                      <Button
                        onClick={handleCreateEgreso}
                        disabled={
                          loadingAction ||
                          !egresoMotivo.trim() ||
                          (isEditingEgreso && !egresoMotivoEdicion.trim())
                        }
                        className={`min-w-24 ${PRIMARY_BUTTON_CLASS}`}
                      >
                        {loadingAction && activeAction === "egreso" ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {isEditingEgreso ? "Actualizando..." : "Guardando..."}
                          </>
                        ) : isEditingEgreso ? (
                          "Actualizar"
                        ) : (
                          "Guardar"
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card className={SECTION_CARD_CLASS}>
                  <CardHeader className="border-b border-gray-200 pb-3">
                    <CardTitle className="text-xl font-semibold text-gray-900">
                      {editingIngresoId ? "Editar ingreso manual" : "Registrar ingreso manual"}
                    </CardTitle>
                    {editingIngresoId ? (
                      <p className="text-sm text-gray-500">Estás editando un ingreso existente.</p>
                    ) : null}
                </CardHeader>
                <CardContent className="space-y-4 pt-6">
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                        <div className="lg:col-span-2">
                          <label className={FIELD_LABEL_CLASS}>Concepto</label>
                          <Input
                            value={ingresoMotivo}
                            onChange={(e) => {
                              setIngresoMotivo(e.target.value);
                              if (error && e.target.value.trim()) setError(null);
                            }}
                            className={INPUT_CLASS}
                          />
                        </div>
                        <div>
                          <label className={FIELD_LABEL_CLASS}>Cantidad</label>
                          <Input
                            type="number"
                            min="0"
                            value={ingresoMonto}
                            onChange={(e) => setIngresoMonto(e.target.value)}
                            className={INPUT_CLASS}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div>
                          <label className={FIELD_LABEL_CLASS}>Método de pago</label>
                          <select
                            value={ingresoMetodoPago}
                            onChange={(e) => setIngresoMetodoPago(e.target.value)}
                            className={SELECT_CLASS}
                          >
                            {CASH_PAYMENT_METHOD_OPTIONS.map((option) => (
                              <option key={`ingreso-metodo-${option.value}`} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className={FIELD_LABEL_CLASS}>Tipo</label>
                          <select
                            value={ingresoTipo}
                            onChange={(e) => setIngresoTipo(e.target.value)}
                            className={SELECT_CLASS}
                          >
                            {CASH_INCOME_TYPE_OPTIONS.map((option) => (
                              <option key={`ingreso-tipo-${option.value}`} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className={FIELD_LABEL_CLASS}>Fecha</label>
                          <DatePicker value={ingresoFecha} onChange={(v) => setIngresoFecha(v)} />
                        </div>
                      </div>

                      {editingIngresoId ? (
                        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                          <label className={FIELD_LABEL_CLASS}>
                            Motivo de edición (obligatorio para auditoría)
                          </label>
                          <Input
                            value={ingresoMotivoEdicion}
                            onChange={(e) => {
                              setIngresoMotivoEdicion(e.target.value);
                              if (error && e.target.value.trim()) setError(null);
                            }}
                            placeholder="Ej: Corrección de monto, método de pago, error de digitación..."
                            className={INPUT_CLASS}
                          />
                        </div>
                      ) : null}
                    </div>

                      <div className="flex items-center justify-end gap-2 border-t border-gray-200 pt-4">
                        <Button variant="outline" onClick={resetIngresoForm} className={`min-w-24 ${OUTLINE_BUTTON_CLASS}`}>
                          Cancelar
                        </Button>
                        <Button
                          onClick={handleCreateIngreso}
                          disabled={
                            loadingAction ||
                            !ingresoMotivo.trim() ||
                            (Boolean(editingIngresoId) && !ingresoMotivoEdicion.trim())
                          }
                          className={`min-w-24 ${PRIMARY_BUTTON_CLASS}`}
                        >
                          {loadingAction && activeAction === "ingreso" ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              {editingIngresoId ? "Actualizando..." : "Guardando..."}
                            </>
                          ) : editingIngresoId ? (
                            "Actualizar"
                          ) : (
                            "Guardar"
                          )}
                        </Button>
                      </div>
                  </CardContent>
                </Card>
              </div>
              ) : null}

              <Card className={SECTION_CARD_CLASS}>
                <CardHeader className="border-b border-gray-200 pb-3">
                  <CardTitle className="text-xl font-semibold text-gray-900">Movimientos del día</CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className={TABLE_WRAPPER_CLASS}>
                    <table className="min-w-full text-sm">
                      <thead className={TABLE_HEAD_CLASS}>
                        <tr>
                          <th className={TABLE_HEAD_CELL_CLASS}>Fecha</th>
                          <th className={TABLE_HEAD_CELL_CLASS}>Tipo</th>
                          <th className={TABLE_HEAD_CELL_CLASS}>Concepto</th>
                          <th className={TABLE_HEAD_CELL_CLASS}>Motivo edición</th>
                          <th className={TABLE_HEAD_CELL_CLASS}>Medio</th>
                          <th className={`${TABLE_HEAD_CELL_CLASS} text-right`}>Monto</th>
                          <th className={`${TABLE_HEAD_CELL_CLASS} text-right`}>Efectivo esperado</th>
                          <th className={`${TABLE_HEAD_CELL_CLASS} text-right`}>Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 text-gray-700">
                        {loadingIngresos || loadingEgresos || loadingGiftcards ? (
                          <tr>
                            <td colSpan={8} className="px-4 py-6 text-center text-sm text-gray-500">
                              Cargando movimientos...
                            </td>
                          </tr>
                        ) : movimientosConSaldo.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-4 py-6 text-center text-sm text-gray-500">
                              No hay movimientos registrados para el día.
                            </td>
                          </tr>
                        ) : (
                          movimientosConSaldo.map((movimiento) => (
                            <tr key={movimiento.id} className="hover:bg-gray-50">
                              <td className={`${TABLE_CELL_CLASS} font-medium text-gray-900`}>{movimiento.fecha}</td>
                              <td className={TABLE_CELL_CLASS}>
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`${BADGE_BASE_CLASS} ${
                                      movimiento.tipo === "egreso"
                                        ? "border-red-200 bg-red-100 text-red-700"
                                        : "border-green-200 bg-green-100 text-green-700"
                                    }`}
                                  >
                                    {movimiento.tipo === "egreso" ? "Egreso" : "Ingreso"}
                                  </span>
                                  <span className={`${BADGE_BASE_CLASS} border-gray-300 bg-gray-100 text-gray-700`}>
                                    {movimiento.etiquetaTipo}
                                  </span>
                                </div>
                              </td>
                              <td className={TABLE_CELL_CLASS}>{movimiento.detalle}</td>
                              <td className={`${TABLE_CELL_CLASS} text-xs text-gray-600`}>
                                {movimiento.motivoEdicion ? (
                                  <span className={`${BADGE_BASE_CLASS} max-w-[220px] border-yellow-200 bg-yellow-50 text-yellow-800`}>
                                    {movimiento.motivoEdicion}
                                  </span>
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </td>
                              <td className={TABLE_CELL_CLASS}>{movimiento.medio}</td>
                              <td className={`${TABLE_CELL_CLASS} text-right font-semibold text-gray-900`}>
                                {formatSignedMoney(movimiento.monto)}
                              </td>
                              <td className={`${TABLE_CELL_CLASS} text-right font-semibold text-gray-900`}>
                                {formatMoney(movimiento.saldo_esperado)}
                              </td>
                              <td className={`${TABLE_CELL_CLASS} text-right`}>
                                {canEditMovimientos && movimiento.editable !== false ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      movimiento.tipo === "egreso"
                                        ? startEditEgreso(movimiento.id.replace(/^egreso-/, ""))
                                        : startEditIngreso(movimiento.id.replace(/^ingreso-/, ""))
                                    }
                                    className={OUTLINE_BUTTON_CLASS}
                                  >
                                    Editar
                                  </Button>
                                ) : null}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
