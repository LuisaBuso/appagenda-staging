"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  Search,
  Loader2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Send,
  Check,
  AlertCircle,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { PageHeader } from "../../../components/Layout/PageHeader";
import { PeriodoSelector, type PeriodoId } from "../../../components/ui/PeriodoSelector";
import { FacturaDetailModal } from "./factura-detail-modal";
import type { Factura } from "../../../types/factura";
import { facturaService } from "./facturas";
import { formatDateDMY, parseDateToDate, formatLocalDate } from "../../../lib/dateFormat";
import { DEFAULT_PERIOD } from "../../../lib/period";
import { PaymentMethodsSummary } from "../../../components/SalesInvoiced/payment-methods-summary";
import {
  calculatePaymentMethodTotals,
  type PaymentMethodTotals,
} from "../../../lib/payment-methods-summary";
import { useAuth } from "../../../components/Auth/AuthContext";
import {
  emitElectronicInvoice,
  fetchElectronicInvoiceStatus,
} from "../../../lib/electronic-invoice";
import { resolveAllegraGate } from "../../../lib/allegra-fe";

type BillingPeriod =
  | "today"
  | "last_7_days"
  | "last_30_days"
  | "month"
  | "custom";

type DateRange = {
  start_date: string;
  end_date: string;
};

type FacturaFilters = {
  searchTerm: string;
  fecha_desde: string;
  fecha_hasta: string;
  period: BillingPeriod;
};

const PERIOD_OPTIONS: Array<{ id: BillingPeriod; label: string }> = [
  { id: "today", label: "Hoy" },
  { id: "last_7_days", label: "7 días" },
  { id: "last_30_days", label: "30 días" },
  { id: "month", label: "Mes actual" },
  { id: "custom", label: "Rango personalizado" },
];

const DEFAULT_BILLING_PERIOD = DEFAULT_PERIOD as BillingPeriod;
const SEARCH_DEBOUNCE_MS = 300;
const SINGLE_DAY_FALLBACK_WINDOW_DAYS = 90;
const SINGLE_DAY_FALLBACK_PAGE_SIZE = 200;
const SINGLE_DAY_FALLBACK_MAX_PAGES = 8;

const toIsoLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getDateRangeByPeriod = (
  period: BillingPeriod,
  customRange?: DateRange,
): DateRange => {
  const today = new Date();
  const todayYmd = toIsoLocalDate(today);

  if (period === "custom" && customRange?.start_date && customRange?.end_date) {
    return {
      start_date: customRange.start_date,
      end_date: customRange.end_date,
    };
  }

  if (period === "last_7_days") {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { start_date: toIsoLocalDate(start), end_date: todayYmd };
  }

  if (period === "last_30_days") {
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    return { start_date: toIsoLocalDate(start), end_date: todayYmd };
  }

  if (period === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start_date: toIsoLocalDate(start), end_date: todayYmd };
  }

  return { start_date: todayYmd, end_date: todayYmd };
};

const getDefaultCustomDateRange = (): DateRange =>
  getDateRangeByPeriod("last_7_days");

const getFacturaEffectiveDateSource = (factura: Factura) =>
  String(factura.fecha_comprobante || factura.fecha_pago || "").trim();

const getFacturaEffectiveDateYmd = (factura: Factura) => {
  const parsedDate = parseDateToDate(getFacturaEffectiveDateSource(factura));
  return parsedDate ? toIsoLocalDate(parsedDate) : "";
};

const getFacturaEffectiveTimestamp = (factura: Factura) => {
  const source = getFacturaEffectiveDateSource(factura);
  const directDate = source ? new Date(source) : null;

  if (directDate && !Number.isNaN(directDate.getTime())) {
    return directDate.getTime();
  }

  const parsedDate = parseDateToDate(source);
  return parsedDate ? parsedDate.getTime() : 0;
};

const normalizeSearchValue = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const isValidDateRange = (range: DateRange) => {
  if (!range.start_date || !range.end_date) return false;

  const start = new Date(`${range.start_date}T00:00:00`);
  const end = new Date(`${range.end_date}T00:00:00`);

  return (
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime()) &&
    start.getTime() <= end.getTime()
  );
};

const sortFacturasByDateDesc = (items: Factura[]) =>
  [...items].sort(
    (a, b) => getFacturaEffectiveTimestamp(b) - getFacturaEffectiveTimestamp(a),
  );

const dedupeFacturas = (items: Factura[]) => {
  const uniqueFacturas = new Map<string, Factura>();

  items.forEach((factura) => {
    const key = [
      factura.venta_id || factura.identificador,
      factura.numero_comprobante,
      getFacturaEffectiveDateSource(factura),
    ].join("|");

    if (!uniqueFacturas.has(key)) {
      uniqueFacturas.set(key, factura);
    }
  });

  return Array.from(uniqueFacturas.values());
};

const matchesFacturaSearch = (factura: Factura, searchTerm: string) => {
  const normalizedTerm = normalizeSearchValue(searchTerm);
  if (!normalizedTerm) return true;

  return [
    factura.nombre_cliente,
    factura.cedula_cliente,
    factura.email_cliente,
    factura.numero_comprobante,
  ]
    .map(normalizeSearchValue)
    .some((value) => value.includes(normalizedTerm));
};

const buildClientPagination = (
  page: number,
  pageSize: number,
  total: number,
) => {
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
  const current = totalPages > 0 ? Math.min(Math.max(page, 1), totalPages) : 1;
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = total === 0 ? 0 : Math.min(current * pageSize, total);

  return {
    page: current,
    limit: pageSize,
    total,
    total_pages: totalPages,
    has_next: totalPages > 0 && current < totalPages,
    has_prev: current > 1,
    showing: total === 0 ? 0 : to - from + 1,
    from,
    to,
  };
};

export function VentasFacturadasList() {
  const { user, activeSedeId } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [period, setPeriod] = useState<BillingPeriod>(DEFAULT_BILLING_PERIOD);
  const [dateRange, setDateRange] = useState<DateRange>(() =>
    getDefaultCustomDateRange(),
  );
  const [periodoActivo, setPeriodoActivo] = useState<PeriodoId>("hoy");
  const [rangoAplicado, setRangoAplicado] = useState<{ from: Date; to: Date } | undefined>(undefined);

  const PERIODO_TO_BILLING: Record<PeriodoId, BillingPeriod> = {
    hoy: "today",
    "7dias": "last_7_days",
    mes: "month",
    "30dias": "last_30_days",
    rango: "custom",
  };
  const [selectedFactura, setSelectedFactura] = useState<Factura | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [limit] = useState(50);
  const [paymentSummary, setPaymentSummary] =
    useState<PaymentMethodTotals | null>(null);
  const [feStatusById, setFeStatusById] = useState<
    Record<
      string,
      { status: "idle" | "loading" | "success" | "error"; message?: string }
    >
  >({});
  const latestRequestIdRef = useRef(0);
  const previousFiltersKeyRef = useRef<string | null>(null);
  const clientSearchCacheRef = useRef(new Map<string, Factura[]>());

  const activeSedeNombre =
    (typeof window !== "undefined"
      ? sessionStorage.getItem("beaux-nombre_local") ||
        localStorage.getItem("beaux-nombre_local")
      : null) ||
    user?.nombre_local ||
    "";

  const allegraGate = useMemo(
    () =>
      resolveAllegraGate({
        sedeId: activeSedeId,
        sedeNombre: activeSedeNombre,
      }),
    [activeSedeId, activeSedeNombre],
  );
  const allegraEnabled = allegraGate.allowed;
  const authToken = user?.access_token;

  const buildFilters = (
    nextSearchTerm: string,
    nextPeriod: BillingPeriod,
    nextDateRange: DateRange,
  ): FacturaFilters => {
    const effectiveRange = getDateRangeByPeriod(nextPeriod, nextDateRange);

    return {
      searchTerm: nextSearchTerm.trim(),
      fecha_desde: effectiveRange.start_date,
      fecha_hasta: effectiveRange.end_date,
      period: nextPeriod,
    };
  };

  const activeFilters = useMemo(() => {
    if (period === "custom" && !isValidDateRange(dateRange)) {
      return null;
    }

    return buildFilters(debouncedSearchTerm, period, dateRange);
  }, [debouncedSearchTerm, period, dateRange]);

  const activeFiltersKey = useMemo(
    () => JSON.stringify(activeFilters ?? null),
    [activeFilters],
  );


  const cargarFacturasFechaEfectiva = async (
    filtros: FacturaFilters,
  ): Promise<Factura[]> => {
    if (!filtros.fecha_desde || filtros.fecha_desde !== filtros.fecha_hasta) {
      return [];
    }

    const targetDate = filtros.fecha_desde;
    const fallbackStart = new Date(`${targetDate}T00:00:00`);

    if (Number.isNaN(fallbackStart.getTime())) {
      return [];
    }

    fallbackStart.setDate(
      fallbackStart.getDate() - SINGLE_DAY_FALLBACK_WINDOW_DAYS,
    );

    const collectedFacturas: Factura[] = [];

    for (
      let currentPage = 1;
      currentPage <= SINGLE_DAY_FALLBACK_MAX_PAGES;
      currentPage += 1
    ) {
      const result = await facturaService.buscarFacturas({
        searchTerm: "",
        fecha_desde: toIsoLocalDate(fallbackStart),
        fecha_hasta: filtros.fecha_hasta,
        page: currentPage,
        limit: SINGLE_DAY_FALLBACK_PAGE_SIZE,
      });

      collectedFacturas.push(...((result.facturas as Factura[]) || []));

      if (!result.pagination?.has_next) {
        break;
      }
    }

    return sortFacturasByDateDesc(
      dedupeFacturas(
        collectedFacturas.filter(
          (factura) => getFacturaEffectiveDateYmd(factura) === targetDate,
        ),
      ),
    );
  };

  const cargarFacturasRangoCompleto = async (
    filtros: FacturaFilters,
  ): Promise<Factura[]> => {
    if (filtros.fecha_desde && filtros.fecha_desde === filtros.fecha_hasta) {
      return cargarFacturasFechaEfectiva(filtros);
    }

    const collectedFacturas: Factura[] = [];
    let page = 1;

    while (true) {
      const result = await facturaService.buscarFacturas({
        searchTerm: "",
        fecha_desde: filtros.fecha_desde,
        fecha_hasta: filtros.fecha_hasta,
        page,
        limit: SINGLE_DAY_FALLBACK_PAGE_SIZE,
      });

      collectedFacturas.push(...((result.facturas as Factura[]) || []));

      if (!result.pagination?.has_next) {
        break;
      }

      page += 1;
    }

    return sortFacturasByDateDesc(dedupeFacturas(collectedFacturas));
  };

  const cargarFacturasBusquedaCliente = async (
    page: number,
    filtros: FacturaFilters,
  ) => {
    const rangeCacheKey = `${filtros.period}:${filtros.fecha_desde}:${filtros.fecha_hasta}`;
    let facturasDelRango = clientSearchCacheRef.current.get(rangeCacheKey);

    if (!facturasDelRango) {
      facturasDelRango = await cargarFacturasRangoCompleto(filtros);
      clientSearchCacheRef.current.set(rangeCacheKey, facturasDelRango);
    }

    const filteredFacturas = facturasDelRango.filter((factura) =>
      matchesFacturaSearch(factura, filtros.searchTerm),
    );
    const clientPagination = buildClientPagination(
      page,
      limit,
      filteredFacturas.length,
    );
    const startIndex = (clientPagination.page - 1) * limit;

    return {
      facturas: filteredFacturas.slice(startIndex, startIndex + limit),
      pagination: clientPagination,
      paymentSummary: calculatePaymentMethodTotals(filteredFacturas),
    };
  };

  const cargarFacturas = async (
    page: number = 1,
    filtros: FacturaFilters,
  ) => {
    const requestId = ++latestRequestIdRef.current;

    try {
      setIsLoading(true);
      setError(null);

      let result:
        | Awaited<ReturnType<typeof facturaService.buscarFacturas>>
        | {
            facturas: Factura[];
            pagination: ReturnType<typeof buildClientPagination>;
            paymentSummary: PaymentMethodTotals;
          };

      if (filtros.searchTerm.trim().length > 0) {
        result = await cargarFacturasBusquedaCliente(page, filtros);
      } else if (
        filtros.fecha_desde &&
        filtros.fecha_desde === filtros.fecha_hasta
      ) {
        const filteredFacturas = await cargarFacturasFechaEfectiva(filtros);
        const clientPagination = buildClientPagination(
          page,
          limit,
          filteredFacturas.length,
        );
        const startIndex = (clientPagination.page - 1) * limit;

        result = {
          facturas: filteredFacturas.slice(startIndex, startIndex + limit),
          pagination: clientPagination,
          paymentSummary: calculatePaymentMethodTotals(filteredFacturas),
        };
      } else {
        result = await facturaService.buscarFacturas({
          searchTerm: "",
          fecha_desde: filtros.fecha_desde,
          fecha_hasta: filtros.fecha_hasta,
          page,
          limit,
        });
      }

      if (requestId !== latestRequestIdRef.current) {
        return;
      }

      setFacturas(result.facturas as Factura[]);
      setPagination(result.pagination);
      setPaymentSummary(result.paymentSummary || null);
      setCurrentPage(page);
    } catch (err) {
      if (requestId !== latestRequestIdRef.current) {
        return;
      }

      console.error("Error cargando facturas:", err);
      setError("Error al cargar las facturas. Por favor, intenta nuevamente.");
      setFacturas([]);
      setPagination(null);
      setPaymentSummary(null);
    } finally {
      if (requestId === latestRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [searchTerm]);

  useEffect(() => {
    if (!activeFilters) return;

    const filtersChanged = previousFiltersKeyRef.current !== activeFiltersKey;
    previousFiltersKeyRef.current = activeFiltersKey;

    if (filtersChanged && currentPage !== 1) {
      setCurrentPage(1);
      return;
    }

    void cargarFacturas(currentPage, activeFilters);
  }, [currentPage, activeFiltersKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    clientSearchCacheRef.current.clear();
  }, [activeSedeId]);

  useEffect(() => {
    if (!allegraEnabled || !authToken || facturas.length === 0) return;

    const abortController = new AbortController();
    let isMounted = true;

    const entries = facturas
      .map((factura) => {
        const saleId =
          (factura as any).venta_id || (factura as any)._id || null;
        const invoiceId =
          (factura as any).electronic_invoice_id ||
          (factura as any).factura_id ||
          null;
        const statusKey = saleId || invoiceId || factura.identificador;
        const knownStatus = (factura as any).electronic_invoice_status;

        return { saleId, invoiceId, statusKey, knownStatus };
      })
      .filter((entry) => entry.statusKey);

    if (entries.length === 0) return;

    const preload: Record<
      string,
      { status: "idle" | "loading" | "success" | "error"; message?: string }
    > = {};

    entries.forEach(({ statusKey, knownStatus }) => {
      const mapped = mapBackendFeStatusToUi(knownStatus);
      if (mapped) {
        preload[statusKey] = mapped;
      }
    });

    const fetchStatuses = async () => {
      const updates: typeof preload = { ...preload };

      await Promise.all(
        entries.map(async ({ saleId, invoiceId, statusKey }) => {
          if (updates[statusKey]) return;

          try {
            const result = await fetchElectronicInvoiceStatus({
              saleId,
              invoiceId,
              token: authToken,
              sedeId: activeSedeId,
              signal: abortController.signal,
            });

            const mapped = mapBackendFeStatusToUi(
              result.status,
              result.provider,
            );

            if (mapped) {
              updates[statusKey] = mapped;
            }
          } catch (err) {
            console.warn("No se pudo obtener estado FE:", err);
          }
        }),
      );

      if (isMounted && Object.keys(updates).length > 0) {
        setFeStatusById((prev) => ({ ...prev, ...updates }));
      }
    };

    void fetchStatuses();

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [facturas, allegraEnabled, authToken, activeSedeId]);

  const handlePeriodoChange = (periodo: PeriodoId, fechas?: { from: Date; to: Date }) => {
    setPeriodoActivo(periodo);
    const billing = PERIODO_TO_BILLING[periodo];
    setPeriod(billing);
    if (periodo === "rango" && fechas) {
      setRangoAplicado(fechas);
      // ✅ DEBUG: Verify custom range dates
      console.log('[VentasFacturadas] Custom range applied:', {
        from: fechas.from,
        to: fechas.to,
        formatted_from: formatLocalDate(fechas.from),
        formatted_to: formatLocalDate(fechas.to),
      });
      setDateRange({
        start_date: formatLocalDate(fechas.from),
        end_date: formatLocalDate(fechas.to),
      });
    }
  };

  const irAPagina = (pagina: number) => {
    if (pagina >= 1 && pagina <= (pagination?.total_pages || 1)) {
      setCurrentPage(pagina);
    }
  };

  const irPrimeraPagina = () => {
    irAPagina(1);
  };

  const irUltimaPagina = () => {
    irAPagina(pagination?.total_pages || 1);
  };

  const irPaginaAnterior = () => {
    irAPagina(currentPage - 1);
  };

  const irPaginaSiguiente = () => {
    irAPagina(currentPage + 1);
  };

  const handleRowClick = (factura: Factura) => {
    setSelectedFactura(factura);
    setIsModalOpen(true);
  };

  const formatDate = (dateString: string) =>
    formatDateDMY(dateString, dateString);
  const getPeriodLabel = (selectedPeriod?: BillingPeriod | null) =>
    PERIOD_OPTIONS.find((option) => option.id === selectedPeriod)?.label ||
    "Rango aplicado";
  const appliedPeriodSummary = (() => {
    if (!activeFilters) return null;

    const periodLabel = getPeriodLabel(activeFilters.period);

    if (activeFilters.fecha_desde && activeFilters.fecha_hasta) {
      return `${periodLabel}: ${formatDate(activeFilters.fecha_desde)} - ${formatDate(activeFilters.fecha_hasta)}`;
    }

    if (activeFilters.fecha_desde) {
      return `${periodLabel}: ${formatDate(activeFilters.fecha_desde)}`;
    }

    if (activeFilters.fecha_hasta) {
      return `${periodLabel}: ${formatDate(activeFilters.fecha_hasta)}`;
    }

    return activeFilters.period ? periodLabel : null;
  })();

  const getCurrencyLocale = (currency: string) => {
    if (currency === "USD") return "en-US";
    if (currency === "MXN") return "es-MX";
    return "es-CO";
  };

  const formatCurrency = (amount: number, currency: string) => {
    const safeCurrency = (currency || "COP").toUpperCase();
    const safeAmount = Number.isFinite(amount) ? amount : 0;
    return `${safeCurrency} ${Math.round(safeAmount).toLocaleString(getCurrencyLocale(safeCurrency))}`;
  };

  const mapBackendFeStatusToUi = (
    status?: string | null,
    providerLabel?: string | null,
  ):
    | { status: "idle" | "loading" | "success" | "error"; message?: string }
    | null => {
    const normalized = String(status ?? "")
      .trim()
      .toLowerCase();

    if (!normalized) return null;

    if (
      ["submitted", "stamped", "sent", "success", "approved"].some((value) =>
        normalized.includes(value),
      )
    ) {
      const provider =
        providerLabel && providerLabel.trim().length > 0
          ? providerLabel.trim()
          : null;

      return {
        status: "success",
        message: provider
          ? `Enviada (${provider})`
          : "Factura electrónica enviada",
      };
    }

    return null;
  };

  const updateFeStatus = (
    key: string,
    next: {
      status: "idle" | "loading" | "success" | "error";
      message?: string;
    },
  ) => {
    setFeStatusById((prev) => ({ ...prev, [key]: next }));
  };

  const handleSendFe = async (event: MouseEvent, factura: Factura) => {
    event.stopPropagation();

    const saleId = (factura as any).venta_id || (factura as any)._id || null;
    const invoiceId = (factura as any).factura_id || null;
    const statusKey = saleId || invoiceId || factura.identificador;

    if (!statusKey) return;

    if (!allegraEnabled) {
      updateFeStatus(statusKey, {
        status: "error",
        message: allegraGate.reason || "FE disponible solo en sede El Poblado",
      });
      return;
    }

    if (!saleId && !invoiceId) {
      updateFeStatus(statusKey, {
        status: "error",
        message: "Falta sale_id o factura_id para enviar FE",
      });
      return;
    }

    if (!authToken) {
      updateFeStatus(statusKey, {
        status: "error",
        message: "No hay token de autenticación",
      });
      return;
    }

    try {
      updateFeStatus(statusKey, { status: "loading" });
      const result = await emitElectronicInvoice({
        saleId,
        invoiceId,
        token: authToken,
        sedeId: activeSedeId,
      });

      const backendStatus =
        (result.data as any)?.electronic_invoice?.status ||
        (result.data as any)?.status ||
        null;
      const mappedStatus =
        mapBackendFeStatusToUi(
          backendStatus,
          (result.data as any)?.electronic_invoice?.provider ||
            (result.data as any)?.provider ||
            null,
        ) || {
          status: "success",
          message: result.message,
        };

      updateFeStatus(statusKey, {
        status: mappedStatus.status,
        message: mappedStatus.message || result.message,
      });

      setFacturas((prev) =>
        prev.map((item) => {
          const itemSaleId = (item as any).venta_id || (item as any)._id || "";
          const itemInvoiceId =
            (item as any).electronic_invoice_id ||
            (item as any).factura_id ||
            "";
          const matches =
            itemSaleId === saleId ||
            itemInvoiceId === invoiceId ||
            item.identificador === factura.identificador;

          if (!matches) return item;

          return {
            ...item,
            electronic_invoice_status: backendStatus || "submitted",
            electronic_invoice_id:
              (result.data as any)?.invoice_id ||
              (result.data as any)?.electronic_invoice?.invoice_id ||
              (result.data as any)?.electronic_invoice?._id ||
              itemInvoiceId ||
              null,
          };
        }),
      );
    } catch (error) {
      updateFeStatus(statusKey, {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "No fue posible enviar la factura electrónica",
      });
    }
  };

  const getStatusBadgeClass = (estado: string) => {
    const normalized = String(estado || "")
      .trim()
      .toLowerCase();

    if (normalized === "pagado") {
      return "bg-green-100 text-green-800";
    }

    if (normalized === "abonado") {
      return "bg-amber-100 text-amber-800";
    }

    return "bg-yellow-100 text-yellow-800";
  };

  const summaryCurrency = (facturas[0]?.moneda || "COP").toUpperCase();

  const formatSummaryCurrency = (amount: number) => {
    const safeAmount = Number.isFinite(amount) ? amount : 0;
    return `$ ${Math.round(safeAmount).toLocaleString(getCurrencyLocale(summaryCurrency))}`;
  };

  const paymentTotals = useMemo(() => {
    if (paymentSummary) {
      return paymentSummary;
    }

    // TODO: Sin agregados del backend, estos totales reflejan las filas cargadas en la página actual.
    return calculatePaymentMethodTotals(facturas);
  }, [paymentSummary, facturas]);

  const getPaginasParaMostrar = () => {
    if (!pagination) return [];

    const paginas = [];
    const totalPages = pagination.total_pages;
    const current = currentPage;

    let inicio = Math.max(1, current - 2);
    let fin = Math.min(totalPages, current + 2);

    if (current <= 3) {
      fin = Math.min(5, totalPages);
    }

    if (current >= totalPages - 2) {
      inicio = Math.max(1, totalPages - 4);
    }

    for (let i = inicio; i <= fin; i++) {
      paginas.push(i);
    }

    return paginas;
  };
  return (
    <>
      <div className="space-y-6">
        <PageHeader title="Ventas Facturadas" />

        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          {/* Row: buscador + período en la misma línea */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Buscar cliente, cédula..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-9 pl-8 text-sm"
              />
            </div>
            <PeriodoSelector
              periodoActivo={periodoActivo}
              onPeriodoChange={handlePeriodoChange}
              rangoAplicado={rangoAplicado}
            />
          </div>

          {/* Rango aplicado — solo cuando hay info útil */}
          {appliedPeriodSummary && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
              <Calendar className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              <span>{appliedPeriodSummary}</span>
            </div>
          )}
        </div>

        <PaymentMethodsSummary
          totals={paymentTotals}
          loading={isLoading}
          formatAmount={formatSummaryCurrency}
        />

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            <span className="ml-2 text-gray-600">Cargando facturas...</span>
          </div>
        )}

        {error && !isLoading && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-red-700">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() =>
                activeFilters && void cargarFacturas(currentPage, activeFilters)
              }
            >
              Reintentar
            </Button>
          </div>
        )}

        {!isLoading && !error && (
          <div className="rounded-lg border bg-white">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b bg-gray-50">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">
                      Fecha pago
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">
                      Cliente
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">
                      Local
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">
                      Profesional
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">
                      N° Comprobante
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">
                      Método pago
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">
                      Total
                    </th>
                    {allegraEnabled && (
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">
                        FE
                      </th>
                    )}
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">
                      Estado
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {facturas.length === 0 ? (
                    <tr>
                      <td
                        colSpan={allegraEnabled ? 9 : 8}
                        className="px-6 py-12 text-center text-gray-500"
                      >
                        No se encontraron facturas con los filtros aplicados.
                      </td>
                    </tr>
                  ) : (
                    facturas.map((factura) => (
                      <tr
                        key={`${factura.identificador}-${factura.fecha_pago}`}
                        onClick={() => handleRowClick(factura)}
                        className="cursor-pointer transition-colors hover:bg-gray-50"
                      >
                        <td className="px-6 py-4 text-sm text-gray-700">
                          {formatDate(
                            factura.fecha_comprobante || factura.fecha_pago,
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700">
                          {factura.nombre_cliente}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700">
                          {factura.local}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700">
                          {factura.profesional_nombre}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700">
                          {factura.numero_comprobante}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700 capitalize">
                          {factura.metodo_pago}
                        </td>
                        <td className="px-6 py-4 text-sm font-semibold text-gray-900">
                          {formatCurrency(factura.total, factura.moneda)}
                        </td>
                        {allegraEnabled && (
                          <td className="px-6 py-4 text-sm text-gray-700">
                            {(() => {
                              const saleId =
                                (factura as any).venta_id ||
                                (factura as any)._id ||
                                null;
                              const invoiceId =
                                (factura as any).factura_id || null;
                              const statusKey =
                                saleId || invoiceId || factura.identificador;
                              const feState =
                                feStatusById[statusKey]?.status || "idle";
                              const feMessage =
                                feStatusById[statusKey]?.message;
                              const disabled =
                                isLoading ||
                                feState === "loading" ||
                                (!saleId && !invoiceId);

                              return (
                                <div className="space-y-1">
                                  <Button
                                    size="sm"
                                    variant={
                                      feState === "success"
                                        ? "default"
                                        : "outline"
                                    }
                                    className={`h-8 px-3 ${
                                      feState === "success"
                                        ? "bg-black hover:bg-gray-900 text-white"
                                        : ""
                                    }`}
                                    disabled={disabled}
                                    onClick={(event) =>
                                      void handleSendFe(event, factura)
                                    }
                                    title={
                                      !saleId && !invoiceId
                                        ? "Falta sale_id o factura_id"
                                        : "Enviar factura electrónica"
                                    }
                                  >
                                    {feState === "loading" ? (
                                      <>
                                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                        Enviando...
                                      </>
                                    ) : feState === "success" ? (
                                      <>
                                        <Check className="mr-1.5 h-3.5 w-3.5" />
                                        Enviada
                                      </>
                                    ) : feState === "error" ? (
                                      <>
                                        <AlertCircle className="mr-1.5 h-3.5 w-3.5" />
                                        Reintentar
                                      </>
                                    ) : (
                                      <>
                                        <Send className="mr-1.5 h-3.5 w-3.5" />
                                        FE
                                      </>
                                    )}
                                  </Button>

                                  {allegraEnabled && !saleId && !invoiceId && (
                                    <p className="text-[11px] text-gray-500">
                                      Falta sale_id o factura_id
                                    </p>
                                  )}
                                  {feState === "error" && feMessage && (
                                    <p className="text-[11px] text-red-600">
                                      {feMessage}
                                    </p>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                        )}
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${getStatusBadgeClass(factura.estado)}`}
                          >
                            {factura.estado}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!isLoading && !error && pagination && pagination.total_pages > 1 && (
          <div className="flex flex-col items-center justify-between gap-4 py-4 sm:flex-row">
            <div className="text-sm text-gray-600">
              Mostrando <span className="font-semibold">{pagination.from}</span>{" "}
              a <span className="font-semibold">{pagination.to}</span> de{" "}
              <span className="font-semibold">{pagination.total}</span> facturas
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={irPrimeraPagina}
                  disabled={currentPage === 1 || isLoading}
                  className="h-8 w-8"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={irPaginaAnterior}
                  disabled={!pagination.has_prev || isLoading}
                  className="h-8 w-8"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                {getPaginasParaMostrar().map((pagina) => (
                  <Button
                    key={pagina}
                    variant={pagina === currentPage ? "default" : "outline"}
                    size="icon"
                    onClick={() => irAPagina(pagina)}
                    disabled={isLoading}
                    className={`h-8 w-8 ${pagina === currentPage ? "bg-gray-900 text-white hover:bg-gray-800" : ""}`}
                  >
                    {pagina}
                  </Button>
                ))}

                <Button
                  variant="outline"
                  size="icon"
                  onClick={irPaginaSiguiente}
                  disabled={!pagination.has_next || isLoading}
                  className="h-8 w-8"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={irUltimaPagina}
                  disabled={currentPage === pagination.total_pages || isLoading}
                  className="h-8 w-8"
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {!isLoading &&
          !error &&
          (!pagination || pagination.total_pages <= 1) && (
            <div className="flex flex-col items-center justify-between gap-4 text-sm text-gray-600 sm:flex-row">
              <div>
                {pagination ? (
                  <>
                    Mostrando {pagination.showing} de {pagination.total}{" "}
                    facturas
                  </>
                ) : (
                  `Mostrando ${facturas.length} facturas`
                )}
              </div>
            </div>
          )}
      </div>

      {selectedFactura && (
        <FacturaDetailModal
          factura={selectedFactura}
          open={isModalOpen}
          onOpenChange={setIsModalOpen}
        />
      )}
    </>
  );
}
