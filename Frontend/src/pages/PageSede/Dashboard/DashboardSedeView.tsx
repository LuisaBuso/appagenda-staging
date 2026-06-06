"use client"

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toLocalYMD } from "../../../lib/dateFormat";
import {
  getVentasDashboard,
  getDashboard,
  getChurnClientes,
  type VentasDashboardResponse,
  type VentasMetricas,
  type DashboardResponse,
  type ChurnCliente,
  type Sede,
} from "./analyticsApi";
import { formatMoney, extractNumericValue } from "./formatMoney";
import {
  normalizeCurrencyCode,
  resolveCurrencyFromSede,
  resolveCurrencyFromCountry,
  resolveCurrencyLocale,
} from "../../../lib/currency";
import { facturaService } from "../Sales-invoiced/facturas";
import { CASH_PAYMENT_METHOD_OPTIONS } from "../CierreCaja/constants";
import { cashService } from "../CierreCaja/api/cashService";
import {
  getResumenFinanciero,
  crearEgresoMayor,
  crearIngresoMayor,
  crearEgresoMenor,
  crearTraslado,
  normalizeCategoria,
  normalizeMetodoPago,
  type ResumenFinanciero,
} from "./finanzasMovimientosApi";
import {
  getClientesAnalytics,
  getClientesNuevos,
  type ClientesAnalyticsResponse,
  type ClientesNuevosResponse,
} from "./clientesAnalyticsApi";
import { RefreshCw } from "lucide-react";
import { DatePicker } from "../../../components/ui/DatePicker";

interface DateRange {
  start_date: string;
  end_date: string;
}

interface ExtendedMetrics {
  topServicios: Array<{ nombre: string; total: number; cantidad: number }>;
  topProductos: Array<{ nombre: string; total: number; cantidad: number }>;
  topEstilistas: Array<{
    nombre: string;
    total: number;
    citas: number;
    ticketPromedio: number;
    initials: string;
  }>;
  clientesUnicos: number;
}

export interface DashboardSedeViewProps {
  token: string;
  sedeId: string;
  selectedPeriod: string;
  dateRange: DateRange;
  sedes: Sede[];
  monedaUsuario: string;
  getPeriodDisplay: () => string;
  userPais?: string;
  userMoneda?: string;
  stylistsPath?: string;
  productsPath?: string;
}

const createEmptyMetricas = (): VentasMetricas => ({
  ventas_totales: 0,
  cantidad_ventas: 0,
  ventas_servicios: 0,
  ventas_productos: 0,
  metodos_pago: {
    efectivo: 0,
    transferencia: 0,
    tarjeta: 0,
    tarjeta_credito: 0,
    tarjeta_debito: 0,
    addi: 0,
    link_de_pago: 0,
    sin_pago: 0,
    otros: 0,
  },
  ticket_promedio: 0,
  crecimiento_ventas: "0%",
});

const SALES_PAYMENT_METHODS = [
  "efectivo", "transferencia", "tarjeta", "tarjeta_credito",
  "tarjeta_debito", "addi", "link_de_pago", "sin_pago", "otros",
] as const;

const toSafeNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const normalizeItemType = (value: unknown): string =>
  String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const roundCurrencyMetric = (value: number): number =>
  Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;

const getInitials = (nombre: string): string => {
  const parts = (nombre || "").trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (nombre || "XX").slice(0, 2).toUpperCase();
};

const buildRealMetricasFromFacturas = (
  facturas: any[]
): Record<string, VentasMetricas> => {
  const metricasPorMoneda: Record<string, VentasMetricas> = {};

  facturas.forEach((factura) => {
    const moneda = normalizeCurrencyCode(factura.moneda || "COP");
    if (!metricasPorMoneda[moneda]) metricasPorMoneda[moneda] = createEmptyMetricas();

    const metricas = metricasPorMoneda[moneda];
    const totalVenta = Math.max(
      toSafeNumber(factura.total),
      toSafeNumber(factura.desglose_pagos?.total)
    );
    metricas.ventas_totales += totalVenta;
    metricas.cantidad_ventas += 1;

    (factura.items || []).forEach((item: any) => {
      const subtotal = toSafeNumber(item?.subtotal);
      const tipo = normalizeItemType(item?.tipo);
      if (tipo === "servicio") metricas.ventas_servicios += subtotal;
      else if (tipo === "producto") metricas.ventas_productos += subtotal;
    });

    const desglose = factura.desglose_pagos as Record<string, unknown> | undefined;
    if (!desglose) return;
    SALES_PAYMENT_METHODS.forEach((metodo) => {
      metricas.metodos_pago[metodo] =
        (metricas.metodos_pago[metodo] || 0) + toSafeNumber(desglose[metodo]);
    });
  });

  Object.values(metricasPorMoneda).forEach((metricas) => {
    metricas.ventas_totales = roundCurrencyMetric(metricas.ventas_totales);
    metricas.ventas_servicios = roundCurrencyMetric(metricas.ventas_servicios);
    metricas.ventas_productos = roundCurrencyMetric(metricas.ventas_productos);
    metricas.ticket_promedio =
      metricas.cantidad_ventas > 0
        ? roundCurrencyMetric(metricas.ventas_totales / metricas.cantidad_ventas)
        : 0;
    metricas.crecimiento_ventas = "0%";
    SALES_PAYMENT_METHODS.forEach((metodo) => {
      metricas.metodos_pago[metodo] = roundCurrencyMetric(metricas.metodos_pago[metodo] || 0);
    });
  });

  return metricasPorMoneda;
};

const buildExtendedMetrics = (facturas: any[]): ExtendedMetrics => {
  const serviciosMap: Record<string, { total: number; cantidad: number }> = {};
  const productosMap: Record<string, { total: number; cantidad: number }> = {};
  const estilistasMap: Record<string, { nombre: string; total: number; citas: number }> = {};
  const clientesSet = new Set<string>();

  facturas.forEach((factura) => {
    if (factura.cliente_id) clientesSet.add(factura.cliente_id);

    const profNombre =
      (factura.profesional_nombre as string | null | undefined) ||
      (factura.vendido_por as string | null | undefined) ||   // ← sin condición tipo_venta
      null;

    const profKey =
      (factura.profesional_id as string | null | undefined) ||
      profNombre ||
      "sin_asignar";

      if (!estilistasMap[profKey]) {
        estilistasMap[profKey] = {
          nombre: profNombre || "Sin asignar",
          total: 0,
          citas: 0,
        };
      } else if (
        estilistasMap[profKey].nombre === "Sin asignar" &&
        profNombre
      ) {
        estilistasMap[profKey].nombre = profNombre;
      }

      const totalFactura = Math.max(
        toSafeNumber(factura.total),
        toSafeNumber(factura.desglose_pagos?.total)
      );
      estilistasMap[profKey].total += totalFactura;
      estilistasMap[profKey].citas += 1;

    (factura.items || []).forEach((item: any) => {
      const tipo = normalizeItemType(item?.tipo);
      const nombre = String(item?.nombre || "").trim() || "Sin nombre";
      const subtotal = toSafeNumber(item?.subtotal);
      const cantidad = toSafeNumber(item?.cantidad) || 1;

      if (tipo === "servicio") {
        if (!serviciosMap[nombre]) serviciosMap[nombre] = { total: 0, cantidad: 0 };
        serviciosMap[nombre].total += subtotal;
        serviciosMap[nombre].cantidad += cantidad;
      } else if (tipo === "producto") {
        if (!productosMap[nombre]) productosMap[nombre] = { total: 0, cantidad: 0 };
        productosMap[nombre].total += subtotal;
        productosMap[nombre].cantidad += cantidad;
      }
    });
  });

  return {
    topServicios: Object.entries(serviciosMap)
      .map(([nombre, data]) => ({ nombre, ...data }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 9),
    topProductos: Object.entries(productosMap)
      .map(([nombre, data]) => ({ nombre, ...data }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 7),
    topEstilistas: Object.values(estilistasMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 6)
      .map((est) => ({
        ...est,
        ticketPromedio: est.citas > 0 ? est.total / est.citas : 0,
        initials: getInitials(est.nombre),
      })),
    clientesUnicos: clientesSet.size,
  };
};

export function DashboardSedeView({
  token,
  sedeId,
  selectedPeriod,
  dateRange,
  sedes,
  monedaUsuario,
  getPeriodDisplay,
  userPais,
  stylistsPath = "/sede/stylists",
  productsPath = "/sede/products",
}: DashboardSedeViewProps) {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboardData, setDashboardData] = useState<VentasDashboardResponse | null>(null);
  const [realMetricasByCurrency, setRealMetricasByCurrency] = useState<Record<string, VentasMetricas> | null>(null);
  const [extendedMetrics, setExtendedMetrics] = useState<ExtendedMetrics | null>(null);
  const [analyticsKPIs, setAnalyticsKPIs] = useState<DashboardResponse | null>(null);
  const [churnData, setChurnData] = useState<ChurnCliente[]>([]);
  const [resumenFinanciero, setResumenFinanciero] = useState<ResumenFinanciero | null>(null);
  const egresoMayorCat = (cat: string): number =>
  resumenFinanciero?.pl?.egresos_mayor_por_categoria?.[cat] ?? 0;
  const [loadingResumen, setLoadingResumen] = useState(false);
  const [clientAnalytics, setClientAnalytics] = useState<ClientesAnalyticsResponse | null>(null);
  const [clientesNuevos, setClientesNuevos] = useState<ClientesNuevosResponse | null>(null);

  const [financialTab, setFinancialTab] = useState<"ventas" | "pl" | "cajas" | "traslados" | "registrar" | "cierre">("ventas");
  const [registrarSubTab, setRegistrarSubTab] = useState<"egreso-mayor" | "ingreso-mayor" | "traslado" | "egreso-menor" | "devolucion" | "propina" | "nomina">("egreso-mayor");
  const [transferDir, setTransferDir] = useState<"menor-mayor" | "mayor-menor">("menor-mayor");
  const [registrarLoading, setRegistrarLoading] = useState(false);
  const [registrarError, setRegistrarError] = useState<string | null>(null);
  const [registrarSuccess, setRegistrarSuccess] = useState<string | null>(null);

  // ── Cierre de caja state ──
  const [cierreContado, setCierreContado] = useState("");
  const [cierreObservaciones, setCierreObservaciones] = useState("");
  const [cierreLoading, setCierreLoading] = useState(false);
  const [cierreError, setCierreError] = useState<string | null>(null);
  const [cierreSuccess, setCierreSuccess] = useState<string | null>(null);
  const [cierreHoy, setCierreHoy] = useState<any | null>(null);
  const [cierresHistorial, setCierresHistorial] = useState<any[]>([]);
  const [loadingCierres, setLoadingCierres] = useState(false);

  type MovimientoManual = {
    id: string; fecha: string; caja: string; tipo: string;
    concepto: string; categoria: string; monto: number; esEgreso: boolean;
  };

  const lsMovKey = (sid: string) => `finanzas_movimientos_${sid}`;

  const readMovimientosLS = (sid: string): MovimientoManual[] => {
    try {
      const raw = localStorage.getItem(lsMovKey(sid));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  };

  // Sede efectiva para el formulario "Registrar" — cuando sedeId es "global"
  // el usuario elige la sede dentro del formulario mismo.
  const [registrarSedeId, setRegistrarSedeId] = useState<string>(
    sedeId !== "global" ? sedeId : ""
  );

  const [movimientosManuales, setMovimientosManuales] = useState<MovimientoManual[]>(
    () => sedeId !== "global" ? readMovimientosLS(sedeId) : []
  );

  // Sincroniza registrarSedeId cuando cambia la sede del header
  useEffect(() => {
    if (sedeId !== "global") {
      setRegistrarSedeId(sedeId);
    } else {
      // En modo global: si aún no hay sede seleccionada, pre-seleccionar la primera disponible
      setRegistrarSedeId((prev) => prev || (sedes.length > 0 ? sedes[0].sede_id : ""));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sedeId, sedes]);

  // Recarga la lista desde localStorage cuando cambia la sede efectiva del formulario
  useEffect(() => {
    if (registrarSedeId) setMovimientosManuales(readMovimientosLS(registrarSedeId));
    else setMovimientosManuales([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registrarSedeId]);

  // Persiste la lista en localStorage cada vez que se modifica
  useEffect(() => {
    if (!registrarSedeId) return;
    try {
      localStorage.setItem(lsMovKey(registrarSedeId), JSON.stringify(movimientosManuales));
    } catch { /* quota exceeded – ignorar */ }
  }, [movimientosManuales, registrarSedeId]);

  const resolveToday = () => toLocalYMD(new Date());

  const [egresoMayorForm, setEgresoMayorForm] = useState({
    concepto: "", monto: "", categoria: "", metodo: CASH_PAYMENT_METHOD_OPTIONS[0].value,
    fecha: resolveToday(), referencia: "", observaciones: "",
  });
  const [ingresoMayorForm, setIngresoMayorForm] = useState({
    concepto: "", monto: "", tipo: "", metodo: CASH_PAYMENT_METHOD_OPTIONS[0].value,
    fecha: resolveToday(), referencia: "", observaciones: "",
  });
  const [trasladoForm, setTrasladoForm] = useState({
    monto: "", fecha: resolveToday(), concepto: "", observaciones: "",
  });
  const [egresoMenorForm, setEgresoMenorForm] = useState({
    concepto: "", monto: "", categoria: "Gasto operativo",
    fecha: resolveToday(), observaciones: "",
  });

  const resolveMetricasByCurrency = useCallback(
    (metricasPorMoneda?: VentasDashboardResponse["metricas_por_moneda"]) => {
      const fallbackCurrency = normalizeCurrencyCode(monedaUsuario);
      if (!metricasPorMoneda || Object.keys(metricasPorMoneda).length === 0)
        return { metricas: undefined, moneda: fallbackCurrency };

      const sedeActual = sedeId === "global" ? undefined : sedes.find((s) => s.sede_id === sedeId);
      const sedeCurrency = resolveCurrencyFromSede(sedeActual, fallbackCurrency);
      const countryCurrency = resolveCurrencyFromCountry(userPais, sedeCurrency);

      const candidates = Array.from(
        new Set(
          [sedeCurrency, countryCurrency, fallbackCurrency, "COP", "USD", "MXN"]
            .map((c) => normalizeCurrencyCode(c))
            .filter(Boolean)
        )
      );

      for (const currency of candidates) {
        if (metricasPorMoneda[currency]) return { metricas: metricasPorMoneda[currency], moneda: currency };
      }

      const [firstCurrency] = Object.keys(metricasPorMoneda);
      if (!firstCurrency) return { metricas: undefined, moneda: fallbackCurrency };
      return { metricas: metricasPorMoneda[firstCurrency], moneda: normalizeCurrencyCode(firstCurrency) };
    },
    [monedaUsuario, sedeId, sedes, userPais]
  );

  const getActiveDashboardCurrency = useCallback((): string => {
    const src = realMetricasByCurrency !== null ? realMetricasByCurrency : dashboardData?.metricas_por_moneda;
    const { moneda } = resolveMetricasByCurrency(src);
    return moneda;
  }, [realMetricasByCurrency, dashboardData, resolveMetricasByCurrency]);

  const formatCurrency = useCallback(
    (value: number | string): string => {
      try {
        const activeCurrency = getActiveDashboardCurrency();
        const locale = resolveCurrencyLocale(activeCurrency, "es-CO");
        if (typeof value === "string") return formatMoney(extractNumericValue(value), activeCurrency, locale);
        return formatMoney(value, activeCurrency, locale);
      } catch {
        return formatMoney(0, "COP", "es-CO");
      }
    },
    [getActiveDashboardCurrency]
  );

  const getMetricas = useCallback(() => {
    const fallbackCurrency = getActiveDashboardCurrency();
    const src = realMetricasByCurrency !== null ? realMetricasByCurrency : dashboardData?.metricas_por_moneda;
    if (!src || Object.keys(src).length === 0) return { ...createEmptyMetricas(), moneda: fallbackCurrency };
    const { metricas, moneda } = resolveMetricasByCurrency(src);
    if (!metricas) return { ...createEmptyMetricas(), moneda };
    return { ...metricas, moneda };
  }, [realMetricasByCurrency, dashboardData, getActiveDashboardCurrency, resolveMetricasByCurrency]);

  const buildDashboardParams = useCallback(() => {
    if (selectedPeriod === "custom") {
      if (!dateRange.start_date || !dateRange.end_date) throw new Error("Por favor selecciona un rango de fechas");
      return { start_date: dateRange.start_date, end_date: dateRange.end_date, period: "custom" };
    }
    if (selectedPeriod === "today") return { period: "today" };
    return { period: selectedPeriod };
  }, [selectedPeriod, dateRange]);

  const buildInvoiceRange = useCallback((): DateRange => {
    const today = new Date();
    const todayYmd = toLocalYMD(today);
    if (selectedPeriod === "custom" && dateRange.start_date && dateRange.end_date)
      return { start_date: dateRange.start_date, end_date: dateRange.end_date };
    if (selectedPeriod === "last_7_days") {
      const start = new Date(today); start.setDate(start.getDate() - 6);
      return { start_date: toLocalYMD(start), end_date: todayYmd };
    }
    if (selectedPeriod === "last_30_days") {
      const start = new Date(today); start.setDate(start.getDate() - 29);
      return { start_date: toLocalYMD(start), end_date: todayYmd };
    }
    if (selectedPeriod === "month") {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start_date: toLocalYMD(start), end_date: todayYmd };
    }
    return { start_date: todayYmd, end_date: todayYmd };
  }, [selectedPeriod, dateRange]);

  const aggregateMetricasByCurrency = (responses: VentasDashboardResponse[]) => {
    const aggregated: Record<string, VentasMetricas> = {};
    responses.forEach((response) => {
      Object.entries(response.metricas_por_moneda || {}).forEach(([currency, metricas]) => {
        const c = normalizeCurrencyCode(currency);
        if (!aggregated[c]) aggregated[c] = createEmptyMetricas();
        const t = aggregated[c];
        t.ventas_totales += metricas.ventas_totales || 0;
        t.cantidad_ventas += metricas.cantidad_ventas || 0;
        t.ventas_servicios += metricas.ventas_servicios || 0;
        t.ventas_productos += metricas.ventas_productos || 0;
        SALES_PAYMENT_METHODS.forEach((m) => {
          t.metodos_pago[m] = (t.metodos_pago[m] || 0) + (metricas.metodos_pago?.[m] || 0);
        });
      });
    });
    Object.values(aggregated).forEach((m) => {
      m.ticket_promedio = m.cantidad_ventas > 0 ? m.ventas_totales / m.cantidad_ventas : 0;
      m.crecimiento_ventas = "0%";
    });
    return aggregated;
  };

  const loadChurnData = useCallback(async (startDate?: string, endDate?: string) => {
    if (!token) return;
    try {
      let finalStart = startDate;
      let finalEnd = endDate;
      if (!startDate || !endDate) {
        const today = new Date();
        const ago = new Date(); ago.setDate(today.getDate() - 30);
        finalStart = toLocalYMD(ago);
        finalEnd = toLocalYMD(today);
      }
      const params: Record<string, string | undefined> = { start_date: finalStart, end_date: finalEnd };
      if (sedeId !== "global") params.sede_id = sedeId;
      const data = await getChurnClientes(token, params);
      if (data.clientes && Array.isArray(data.clientes)) setChurnData(data.clientes.slice(0, 10));
      else setChurnData([]);
    } catch {
      setChurnData([]);
    }
  }, [token, sedeId]);

  const loadResumenFinanciero = useCallback(async () => {
    if (!token || !sedeId || sedeId === "global") return;
    setLoadingResumen(true);
    try {
      const range = buildInvoiceRange();
      const data = await getResumenFinanciero(token, {
        sede_id: sedeId,
        fecha_inicio: range.start_date,
        fecha_fin: range.end_date,
      });
      setResumenFinanciero(data);
    } catch {
      // Silencioso: el dashboard muestra "–" si no hay datos
      setResumenFinanciero(null);
    } finally {
      setLoadingResumen(false);
    }
  }, [token, sedeId, buildInvoiceRange]);

  useEffect(() => {
    loadResumenFinanciero();
  }, [loadResumenFinanciero]);

  // ── Cierre de caja: load & submit ──
  const loadCierres = useCallback(async () => {
    if (!sedeId || sedeId === "global") return;
    setLoadingCierres(true);
    try {
      const today = resolveToday();
      const range = buildInvoiceRange();
      const data = await cashService.getCierres({
        sede_id: sedeId,
        fecha_inicio: range.start_date,
        fecha_fin: range.end_date,
      });
      const list = Array.isArray(data) ? data : data?.cierres ?? [];
      setCierresHistorial(list);
      const todayCierre = list.find((c: any) => c.fecha === today || c.fecha?.startsWith(today));
      setCierreHoy(todayCierre ?? null);
    } catch {
      setCierresHistorial([]);
      setCierreHoy(null);
    } finally {
      setLoadingCierres(false);
    }
  }, [sedeId, buildInvoiceRange]);

  useEffect(() => {
    if (financialTab === "cierre" || financialTab === "cajas") loadCierres();
  }, [financialTab, loadCierres]);

  const handleGuardarCierre = async () => {
    const contado = parseFloat(cierreContado.replace(/[^0-9.-]/g, ""));
    if (isNaN(contado) || contado < 0) {
      setCierreError("Ingresa el monto contado físicamente");
      return;
    }
    setCierreLoading(true);
    setCierreError(null);
    setCierreSuccess(null);
    try {
      await cashService.cierreCaja({
        sede_id: sedeId,
        fecha: resolveToday(),
        efectivo_contado: contado,
        observaciones: cierreObservaciones || undefined,
      });
      setCierreSuccess("Cierre de caja guardado correctamente");
      setCierreContado("");
      setCierreObservaciones("");
      loadCierres();
      setTimeout(() => setCierreSuccess(null), 5000);
    } catch (err: any) {
      setCierreError(err?.message || "No se pudo guardar el cierre de caja");
    } finally {
      setCierreLoading(false);
    }
  };

  const loadClientAnalytics = useCallback(async () => {
    if (!token) return;
    const effectiveSedeId = sedeId === "global" ? undefined : sedeId;
    const range = buildInvoiceRange();
    const [analytics, nuevos] = await Promise.all([
      getClientesAnalytics(token, effectiveSedeId),
      getClientesNuevos(token, {
        fecha_inicio: range.start_date,
        fecha_fin: range.end_date,
        sede_id: effectiveSedeId,
      }),
    ]);
    setClientAnalytics(analytics);
    setClientesNuevos(nuevos);
  }, [token, sedeId, buildInvoiceRange]);

  useEffect(() => {
    loadClientAnalytics();
  }, [loadClientAnalytics]);

  const loadData = useCallback(async () => {
    if (!token || !sedeId) return;
    try {
      setLoading(true);
      setError(null);
      setRealMetricasByCurrency(null);
      setExtendedMetrics(null);

      const baseParams = buildDashboardParams();

      if (sedeId === "global") {
        const sedesIds = sedes.map((s) => String(s.sede_id ?? "").trim()).filter(Boolean);
        if (sedesIds.length === 0) { setDashboardData(null); setChurnData([]); return; }

        const responses = await Promise.all(
          sedesIds.map(async (sid) => {
            try { return await getVentasDashboard(token, { ...baseParams, sede_id: sid, sede_header_id: sid }); }
            catch { return null; }
          })
        );
        const valid = responses.filter((r): r is VentasDashboardResponse => Boolean(r?.metricas_por_moneda));
        if (valid.length === 0) throw new Error("No se pudieron cargar métricas para las sedes.");

        const baseRange = valid.find((r) => r.range)?.range;
        setDashboardData({
          success: true,
          descripcion: `Vista global de ${valid.length} sede(s)`,
          range: baseRange,
          usuario: { sede_asignada: "global", nombre_sede: "Vista Global" },
          metricas_por_moneda: aggregateMetricasByCurrency(valid),
        });
        await loadChurnData(baseRange?.start, baseRange?.end);

        try {
          const invoiceRange = buildInvoiceRange();
          const facturasArrays = await Promise.all(
            sedesIds.map(async (sid) => {
              try { return await facturaService.getVentasBySedeAllPages(sid, invoiceRange.start_date, invoiceRange.end_date); }
              catch { return []; }
            })
          );
          const todasFacturas = facturasArrays.flat();
          if (todasFacturas.length > 0) {
            setRealMetricasByCurrency(buildRealMetricasFromFacturas(todasFacturas));
            setExtendedMetrics(buildExtendedMetrics(todasFacturas));
          }
        } catch { /* silent */ }
      } else {
        const params = { ...baseParams, sede_id: sedeId, sede_header_id: sedeId };
        const [ventasData] = await Promise.all([
          getVentasDashboard(token, params).catch(() => null),
        ]);
        if (ventasData?.success) setDashboardData(ventasData);
        else if (ventasData) setDashboardData(ventasData);

        try {
          const invoiceRange = buildInvoiceRange();
          const facturas = await facturaService.getVentasBySedeAllPages(
            sedeId, invoiceRange.start_date, invoiceRange.end_date
          );
          setRealMetricasByCurrency(buildRealMetricasFromFacturas(facturas));
          setExtendedMetrics(buildExtendedMetrics(facturas));
        } catch { setRealMetricasByCurrency(null); setExtendedMetrics(null); }

        try {
          const analyticsParams: Record<string, string | undefined> = { sede_id: sedeId };
          if (selectedPeriod !== "custom") analyticsParams.period = selectedPeriod;
          const kpis = await getDashboard(token, analyticsParams);
          setAnalyticsKPIs(kpis);
        } catch { setAnalyticsKPIs(null); }

        await loadChurnData(ventasData?.range?.start, ventasData?.range?.end);
      }
    } catch (err: any) {
      setError(`Error al cargar datos: ${err?.message || "Error desconocido"}`);
      setDashboardData(null);
    } finally {
      setLoading(false);
    }
  }, [token, sedeId, selectedPeriod, buildDashboardParams, buildInvoiceRange, sedes, loadChurnData]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleEgresoMayor = async () => {
    const concepto = egresoMayorForm.concepto.trim();
    const monto = parseFloat(egresoMayorForm.monto.replace(/[̀-ͯ]/g, ""));
    if (!concepto) { setRegistrarError("El concepto es requerido"); return; }
    if (!monto || monto <= 0) { setRegistrarError("El monto debe ser mayor a 0"); return; }
    if (!egresoMayorForm.categoria) { setRegistrarError("La categoría es requerida"); return; }
    setRegistrarLoading(true); setRegistrarError(null); setRegistrarSuccess(null);
    try {
      const fecha = egresoMayorForm.fecha || resolveToday();
      await crearEgresoMayor(token, {
        sede_id: registrarSedeId || sedeId,
        fecha,
        concepto,
        monto,
        categoria: normalizeCategoria("egreso-mayor", egresoMayorForm.categoria),
        metodo_pago: normalizeMetodoPago(egresoMayorForm.metodo),
        referencia_factura: egresoMayorForm.referencia || undefined,
        observaciones: egresoMayorForm.observaciones || undefined,
      });
      setMovimientosManuales((prev) => [{
        id: `em-${Date.now()}`, fecha, caja: "Caja Mayor", tipo: "Egreso",
        concepto, categoria: egresoMayorForm.categoria || "Sin categoría", monto, esEgreso: true,
      }, ...prev].slice(0, 10));
      setEgresoMayorForm({ concepto: "", monto: "", categoria: "", metodo: CASH_PAYMENT_METHOD_OPTIONS[0].value, fecha: resolveToday(), referencia: "", observaciones: "" });
      setRegistrarSuccess("Egreso de Caja Mayor registrado correctamente");
      setTimeout(() => setRegistrarSuccess(null), 3000);
      loadResumenFinanciero();
    } catch (err: any) {
      setRegistrarError(err?.message || "No se pudo registrar el egreso");
    } finally { setRegistrarLoading(false); }
  };

  const handleIngresoMayor = async () => {
    const concepto = ingresoMayorForm.concepto.trim();
    const monto = parseFloat(ingresoMayorForm.monto.replace(/[̀-ͯ]/g, ""));
    if (!concepto) { setRegistrarError("El concepto es requerido"); return; }
    if (!monto || monto <= 0) { setRegistrarError("El monto debe ser mayor a 0"); return; }
    if (!ingresoMayorForm.tipo) { setRegistrarError("El tipo de ingreso es requerido"); return; }
    setRegistrarLoading(true); setRegistrarError(null); setRegistrarSuccess(null);
    try {
      const fecha = ingresoMayorForm.fecha || resolveToday();
      await crearIngresoMayor(token, {
        sede_id: registrarSedeId || sedeId,
        fecha,
        concepto,
        monto,
        categoria: normalizeCategoria("ingreso-mayor", ingresoMayorForm.tipo),
        metodo_pago: normalizeMetodoPago(ingresoMayorForm.metodo),
        referencia_factura: ingresoMayorForm.referencia || undefined,
        observaciones: ingresoMayorForm.observaciones || undefined,
      });
      setMovimientosManuales((prev) => [{
        id: `im-${Date.now()}`, fecha, caja: "Caja Mayor", tipo: "Ingreso",
        concepto, categoria: ingresoMayorForm.tipo || "Sin tipo", monto, esEgreso: false,
      }, ...prev].slice(0, 10));
      setIngresoMayorForm({ concepto: "", monto: "", tipo: "", metodo: CASH_PAYMENT_METHOD_OPTIONS[0].value, fecha: resolveToday(), referencia: "", observaciones: "" });
      setRegistrarSuccess("Ingreso de Caja Mayor registrado correctamente");
      setTimeout(() => setRegistrarSuccess(null), 3000);
      loadResumenFinanciero();
    } catch (err: any) {
      setRegistrarError(err?.message || "No se pudo registrar el ingreso");
    } finally { setRegistrarLoading(false); }
  };

  const handleTraslado = async () => {
    const monto = parseFloat(trasladoForm.monto.replace(/[̀-ͯ]/g, ""));
    const concepto = trasladoForm.concepto.trim() || (transferDir === "menor-mayor" ? "Traslado Caja Menor a Caja Mayor" : "Traslado Caja Mayor a Caja Menor");
    if (!monto || monto <= 0) { setRegistrarError("El monto debe ser mayor a 0"); return; }
    setRegistrarLoading(true); setRegistrarError(null); setRegistrarSuccess(null);
    try {
      const fecha = trasladoForm.fecha || resolveToday();
      const [cajaOrigen, cajaDestino] = transferDir === "menor-mayor"
        ? (["caja_menor", "caja_mayor"] as const)
        : (["caja_mayor", "caja_menor"] as const);
      await crearTraslado(token, {
        sede_id: registrarSedeId || sedeId,
        fecha,
        concepto,
        monto,
        caja_origen: cajaOrigen,
        caja_destino: cajaDestino,
        observaciones: trasladoForm.observaciones || undefined,
      });
      setMovimientosManuales((prev) => [{
        id: `tr-${Date.now()}`, fecha,
        caja: `${cajaOrigen === "caja_menor" ? "Caja Menor" : "Caja Mayor"} → ${cajaDestino === "caja_mayor" ? "Caja Mayor" : "Caja Menor"}`,
        tipo: "Traslado", concepto, categoria: "Traslado entre cajas", monto, esEgreso: false,
      }, ...prev].slice(0, 10));
      setTrasladoForm({ monto: "", fecha: resolveToday(), concepto: "", observaciones: "" });
      setRegistrarSuccess("Traslado registrado correctamente");
      setTimeout(() => setRegistrarSuccess(null), 3000);
      loadResumenFinanciero();
    } catch (err: any) {
      setRegistrarError(err?.message || "No se pudo registrar el traslado");
    } finally { setRegistrarLoading(false); }
  };

  const handleEgresoMenor = async () => {
    const concepto = egresoMenorForm.concepto.trim();
    const monto = parseFloat(egresoMenorForm.monto.replace(/[̀-ͯ]/g, ""));
    if (!concepto) { setRegistrarError("El concepto es requerido"); return; }
    if (!monto || monto <= 0) { setRegistrarError("El monto debe ser mayor a 0"); return; }
    setRegistrarLoading(true); setRegistrarError(null); setRegistrarSuccess(null);
    try {
      const fecha = egresoMenorForm.fecha || resolveToday();
      await crearEgresoMenor(token, {
        sede_id: registrarSedeId || sedeId,
        fecha,
        concepto,
        monto,
        categoria: normalizeCategoria("egreso-menor", egresoMenorForm.categoria),
        metodo_pago: "efectivo",
        observaciones: egresoMenorForm.observaciones || undefined,
      });
      setMovimientosManuales((prev) => [{
        id: `emen-${Date.now()}`, fecha, caja: "Caja Menor", tipo: "Egreso",
        concepto, categoria: egresoMenorForm.categoria || "Gasto operativo", monto, esEgreso: true,
      }, ...prev].slice(0, 10));
      setEgresoMenorForm({ concepto: "", monto: "", categoria: "Gasto operativo", fecha: resolveToday(), observaciones: "" });
      setRegistrarSuccess("Egreso de Caja Menor registrado correctamente");
      setTimeout(() => setRegistrarSuccess(null), 3000);
      loadResumenFinanciero();
    } catch (err: any) {
      setRegistrarError(err?.message || "No se pudo registrar el egreso");
    } finally { setRegistrarLoading(false); }
  };

  // ── Mini-components ──────────────────────────────────────

  const SectionTitle = ({ children, note }: { children: React.ReactNode; note?: string }) => (
    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.6px] text-slate-400 mt-[22px] mb-2.5">
      <span>{children}</span>
      {note && (
        <span className="text-[10px] font-normal normal-case tracking-normal text-slate-400 italic ml-2">{note}</span>
      )}
      <div className="flex-1 h-px bg-slate-200" />
    </div>
  );

  const KPICard = ({ label, value, sub, change, featured, valueClassName }: {
    label: string; value: string; sub?: string; change?: string; featured?: boolean; valueClassName?: string;
  }) => (
    <div className={`bg-white rounded-[10px] px-4 py-3.5 ${featured ? "border-2 border-slate-800" : "border border-slate-200"}`}>
      <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-[0.4px] mb-1.5">{label}</div>
      <div className={`text-[22px] font-bold tracking-tight ${valueClassName || "text-slate-800"}`}>{value}</div>
      {change && change !== "0%" && (
        <div className="text-[10px] font-semibold mt-0.5 text-slate-800">↑ {change} vs mes anterior</div>
      )}
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );

  const ClientMetric = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="p-3 border border-slate-200 rounded-lg text-center bg-white">
      <div className="text-[9px] text-slate-400 font-semibold uppercase tracking-[0.3px] mb-1">{label}</div>
      <div className="text-[22px] font-bold text-slate-800">{value}</div>
      {sub && <div className="text-[9px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );

  const RowItem = ({ name, value, sub, barPct }: {
    name: React.ReactNode; value: React.ReactNode; sub?: string; barPct?: number;
  }) => (
    <div className="flex justify-between items-center py-2 text-xs border-b border-slate-100 last:border-b-0">
      <span className="font-medium text-slate-700 flex-shrink-0 flex items-center">{name}</span>
      {barPct !== undefined && (
        <div className="flex-1 mx-3 h-1 bg-slate-100 rounded min-w-[40px]">
          <div className="h-full bg-slate-800 rounded" style={{ width: `${Math.max(2, barPct)}%` }} />
        </div>
      )}
      <div className="text-right">
        <span className="font-bold text-[13px] text-slate-800">{value}</span>
        {sub && <div className="text-[10px] text-slate-400 leading-none mt-0.5">{sub}</div>}
      </div>
    </div>
  );

  const Card = ({ title, titleSub, children, scrollable, action }: {
    title: string; titleSub?: string; children: React.ReactNode; scrollable?: boolean; action?: React.ReactNode;
  }) => (
    <div className="bg-white border border-slate-200 rounded-[10px] p-[18px] h-full flex flex-col">
      <div className="text-[13px] font-bold mb-3 flex justify-between items-center text-slate-800 flex-shrink-0">
        <span>{title}</span>
        <div className="flex items-center gap-2">
          {titleSub && <span className="text-[10px] text-slate-400 font-medium">{titleSub}</span>}
          {action}
        </div>
      </div>
      {scrollable ? <div className="flex-1 overflow-y-auto min-h-0">{children}</div> : children}
    </div>
  );

  // ── Derived values ───────────────────────────────────────
  const metricas = getMetricas();
  const pctServicios = metricas.ventas_totales > 0 ? Math.round((metricas.ventas_servicios / metricas.ventas_totales) * 100) : 0;
  const pctProductos = metricas.ventas_totales > 0 ? Math.round((metricas.ventas_productos / metricas.ventas_totales) * 100) : 0;
  const dias = dashboardData?.range?.dias || 1;
  const ventaPromDia = metricas.ventas_totales > 0 ? Math.round(metricas.ventas_totales / dias) : 0;
  const saldoCajaMenorReal =
  (metricas.metodos_pago?.efectivo ?? 0)
  + (resumenFinanciero?.traslados.mayor_a_menor ?? 0)
  - (resumenFinanciero?.pl.egresos_menor_total ?? 0)
  - (resumenFinanciero?.traslados.menor_a_mayor ?? 0);

  const saldoConsolidadoReal =
  saldoCajaMenorReal + (resumenFinanciero?.cajas.caja_mayor ?? 0);

  const totalServicios = extendedMetrics?.topServicios.reduce((s, i) => s + i.cantidad, 0) || 0;
  const totalProductosVendidos = extendedMetrics?.topProductos.reduce((s, i) => s + i.cantidad, 0) || 0;

  const paymentRows = [
    { name: "Transferencia", value: metricas.metodos_pago?.transferencia || 0 },
    { name: "Tarjeta de Crédito", value: metricas.metodos_pago?.tarjeta_credito || 0 },
    { name: "Tarjeta de Débito", value: metricas.metodos_pago?.tarjeta_debito || 0 },
    { name: "Efectivo", value: metricas.metodos_pago?.efectivo || 0 },
    { name: "Tarjeta", value: metricas.metodos_pago?.tarjeta || 0 },
    { name: "Addi", value: metricas.metodos_pago?.addi || 0 },
    { name: "Link de Pago",       value: metricas.metodos_pago?.link_de_pago     || 0 },
    { name: "Sin Pago", value: metricas.metodos_pago?.sin_pago || 0 },
    { name: "Otros", value: metricas.metodos_pago?.otros || 0 },
  ].filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const totalPayments = paymentRows.reduce((s, r) => s + r.value, 0);

  const clientesUnicos = extendedMetrics?.clientesUnicos || 0;
  const nuevosClientes =
    typeof analyticsKPIs?.kpis?.nuevos_clientes?.valor === "number"
      ? analyticsKPIs.kpis.nuevos_clientes.valor
      : 0;
  const recurrentes = Math.max(0, clientesUnicos - nuevosClientes);
  const pctRecurrentes = clientAnalytics?.recurrencia?.pct_recurrentes
    ?? (clientesUnicos > 0 ? Math.round((recurrentes / clientesUnicos) * 100) : 0);
  const estadoBase = clientAnalytics?.estado_base ?? null;
  const churnActivos = estadoBase ? estadoBase.activos : churnData.filter((c) => c.dias_inactivo >= 0 && c.dias_inactivo <= 120).length;
  const churnEnRiesgo = estadoBase ? estadoBase.en_riesgo : churnData.filter((c) => c.dias_inactivo >= 121 && c.dias_inactivo <= 180).length;
  const churnPerdidos = estadoBase ? estadoBase.perdidos : churnData.filter((c) => c.dias_inactivo > 180).length;

  const isSpecificSede = sedeId !== "global";

  // ── Render ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500 text-sm">Cargando datos…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
        <p className="text-slate-500 mb-4">{error}</p>
        <button
          onClick={loadData}
          className="flex items-center gap-2 mx-auto px-4 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50"
        >
          <RefreshCw className="w-4 h-4" /> Reintentar
        </button>
      </div>
    );
  }

  return (
    <>
      {/* ══ ESTADO FINANCIERO DE LA OPERACIÓN ═══════════════ */}
      <SectionTitle note="→ Contabilidad real, NO flujo de caja">
        Estado financiero de la operación
      </SectionTitle>

      <div className="flex gap-0 mb-4 border-b border-slate-200 items-center">
            <button
              onClick={() => setFinancialTab("ventas")}
              className={`px-4 py-2.5 text-[13.5px] font-medium border-b-2 transition-colors ${
                financialTab === "ventas"
                  ? "text-slate-800 font-semibold border-slate-800"
                  : "text-slate-500 border-transparent hover:text-slate-700"
              }`}
            >
              Ventas
            </button>
            <span className="text-[10px] font-bold uppercase tracking-[0.6px] text-slate-400 px-3 mx-1 border-r border-slate-200 self-center">Estado Financiero</span>
            {([
              { id: "pl" as const, label: "Estado de Resultados" },
              { id: "cajas" as const, label: "Cajas" },
              { id: "traslados" as const, label: "Traslados" },
              { id: "registrar" as const, label: "Registrar movimientos" },
              { id: "cierre" as const, label: "Cierre de caja" },
            ]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFinancialTab(tab.id)}
                className={`px-4 py-2.5 text-[13.5px] font-medium border-b-2 transition-colors ${
                  financialTab === tab.id
                    ? "text-slate-800 font-semibold border-slate-800"
                    : "text-slate-500 border-transparent hover:text-slate-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
            <span className="ml-auto text-[11px] text-slate-400 italic">→ Contabilidad real, NO flujo de caja</span>
          </div>

          {financialTab === "ventas" && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-3.5">
                <KPICard featured label="Ventas Totales" value={formatCurrency(metricas.ventas_totales)} change={metricas.crecimiento_ventas !== "0%" ? metricas.crecimiento_ventas : undefined} />
                <KPICard label="Servicios" value={formatCurrency(metricas.ventas_servicios)} sub={`${extendedMetrics?.topServicios.reduce((s, i) => s + i.cantidad, 0) || 0} servicios · ${pctServicios}%`} />
                <KPICard label="Productos" value={formatCurrency(metricas.ventas_productos)} sub={`${extendedMetrics?.topProductos.reduce((s, i) => s + i.cantidad, 0) || 0} ventas · ${pctProductos}%`} />
                <KPICard label="Transacciones" value={String(metricas.cantidad_ventas || 0)} sub={`Ticket prom: ${formatCurrency(metricas.ticket_promedio)}`} />
                <KPICard label="Venta Promedio/Día" value={formatCurrency(ventaPromDia)} sub={`${dias} días del período`} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 mb-3.5">
                <Card title="Ventas cobradas por método de pago" titleSub="solo dinero recibido">
                  {paymentRows.length > 0 ? (
                    <>
                      {paymentRows.map((row) => (
                        <RowItem
                          key={row.name}
                          name={row.name}
                          value={formatCurrency(row.value)}
                          sub={`${Math.round((row.value / (totalPayments || 1)) * 100)}%`}
                          barPct={totalPayments > 0 ? (row.value / totalPayments) * 100 : 0}
                        />
                      ))}
                      <div className="flex justify-between pt-2.5 text-[13px] font-bold border-t-2 border-slate-200 mt-1">
                        <span>Total cobrado</span>
                        <span>{formatCurrency(totalPayments)}</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-slate-400 py-4 text-center">Sin datos de pagos para este período</p>
                  )}
                </Card>

                <Card title="Top servicios por ingreso" titleSub={getPeriodDisplay()} scrollable>
                  {extendedMetrics && extendedMetrics.topServicios.length > 0 ? (
                    extendedMetrics.topServicios.map((s) => (
                      <RowItem key={s.nombre} name={s.nombre} value={formatCurrency(s.total)} sub={`${s.cantidad} servicios`} />
                    ))
                  ) : (
                    <p className="text-xs text-slate-400 py-4 text-center">Sin datos de servicios para este período</p>
                  )}
                </Card>
              </div>
            </>
          )}

          {financialTab === "pl" && (
            <>
              <div className="p-3.5 bg-slate-50 border border-slate-100 rounded-lg text-[11px] text-slate-500 leading-relaxed mb-4">
                <span className="font-semibold text-slate-700">Estado de Resultados (P&L)</span> — Rentabilidad real de la operación. Los traslados entre cajas NO aparecen aquí. Comisiones, arriendo y nómina SÍ aparecen aunque se paguen desde caja mayor.
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-3.5">
                <KPICard featured label="Ingresos Ventas" value={formatCurrency(metricas.ventas_totales)} sub="Servicios + Productos" />
                <KPICard label="Ingresos Extras" value={loadingResumen ? "…" : resumenFinanciero ? formatCurrency(resumenFinanciero.pl.ingresos) : "–"} sub="Movimientos manuales" />
                <KPICard label="Egresos Manuales" value={loadingResumen ? "…" : resumenFinanciero ? formatCurrency(resumenFinanciero.pl.egresos) : "–"} sub="Caja mayor + menor" />
                <KPICard label="Devoluciones" value={`-${formatCurrency(0)}`} valueClassName="text-red-600" sub="Reduce ingresos" />
                <KPICard label="Total Ventas Netas" value={formatCurrency(metricas.ventas_totales)} sub="Servicios + Productos" />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
                <Card title="Estado de Resultados" titleSub={getPeriodDisplay()}>
                  <div className="text-[10px] font-bold uppercase tracking-[0.5px] text-slate-400 pt-1 mb-1">Ingresos operacionales</div>
                  <RowItem name={<>Servicios <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-blue-50 text-blue-600 border border-blue-200 ml-1.5">Auto · Facturación</span></>} value={formatCurrency(metricas.ventas_servicios)} />
                  <RowItem name={<>Productos vendidos <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-blue-50 text-blue-600 border border-blue-200 ml-1.5">Auto · Facturación</span></>} value={formatCurrency(metricas.ventas_productos)} />
                  <RowItem name={<>Devoluciones a clientes <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-slate-100 text-slate-500 border border-slate-200 ml-1.5">Manual</span></>} value={<span className="text-red-600">-{formatCurrency(0)}</span>} />
                  <div className="flex justify-between pt-2 pb-1 text-[13px] font-bold border-t border-slate-200 mt-1">
                    <span>Total ingresos</span><span>{formatCurrency(metricas.ventas_totales)}</span>
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.5px] text-slate-400 mt-3 mb-1">Costos directos</div>
                  <RowItem name={<>Comisiones estilistas <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-blue-50 text-blue-600 border border-blue-200 ml-1.5">Auto · Citas</span></>} value={<span className="text-slate-400">—</span>} />
                  <RowItem name={<>Insumos usados <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-slate-100 text-slate-500 border border-slate-200 ml-1.5">Manual · Caja Mayor</span></>} value={<span className="text-slate-400">—</span>} />
                  <div className="flex justify-between pt-2 pb-1 text-[13px] font-bold border-t border-slate-200 mt-1">
                    <span>Utilidad bruta</span><span className="text-slate-400">—</span>
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.5px] text-slate-400 mt-3 mb-1">Gastos fijos</div>
                  <RowItem name={<>Arriendo ...</>}value={loadingResumen ? "…" : egresoMayorCat("arriendo") > 0 ? <span className="text-red-600">-{formatCurrency(egresoMayorCat("arriendo"))}</span>: <span className="text-slate-400">—</span>} />
                  <RowItem name={<>Nómina administrativa ...</>}value={loadingResumen ? "…" : egresoMayorCat("nomina") > 0 ? <span className="text-red-600">-{formatCurrency(egresoMayorCat("nomina"))}</span> : <span className="text-slate-400">—</span>} />
                  <RowItem name={<>Servicios públicos ...</>} value={loadingResumen ? "…" : egresoMayorCat("servicios_publicos") > 0 ? <span className="text-red-600">-{formatCurrency(egresoMayorCat("servicios_publicos"))}</span> : <span className="text-slate-400">—</span>} />
                  <RowItem name={<>Impuestos ...</>} value={loadingResumen ? "…" : egresoMayorCat("impuestos") > 0 ? <span className="text-red-600">-{formatCurrency(egresoMayorCat("impuestos"))}</span> : <span className="text-slate-400">—</span>} />
                  <RowItem name={<>Otros gastos fijos <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-slate-100 text-slate-500 border border-slate-200 ml-1.5">Manual · Caja Mayor</span></>} value={<span className="text-slate-400">—</span>} />
                  <div className="text-[10px] font-bold uppercase tracking-[0.5px] text-slate-400 mt-3 mb-1">Gastos variables</div>
                  <RowItem name={<>Gastos operativos caja menor ...</>} value={loadingResumen ? "…" : resumenFinanciero ? <span className="text-red-600">-{formatCurrency(resumenFinanciero.pl.egresos_menor_total ?? 0)}</span> : <span className="text-slate-400">—</span>} />
                  <RowItem name={<>Propinas estilistas <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-slate-100 text-slate-500 border border-slate-200 ml-1.5">Pass-through</span></>} value={<span className="text-slate-400">—</span>} />
                  <div className="flex justify-between pt-2 pb-1 text-[13px] font-bold border-t border-slate-200 mt-1">
                    <span>Total egresos manuales</span>
                    <span>{loadingResumen ? "…" : resumenFinanciero ? formatCurrency(resumenFinanciero.pl.egresos) : "–"}</span>
                  </div>
                  <div className="flex justify-between pt-3 text-[16px] font-bold text-slate-800 border-t-2 border-slate-800 mt-1">
                    <span>Utilidad neta estimada</span>
                    <span className={resumenFinanciero && resumenFinanciero.pl.utilidad < 0 ? "text-red-600" : "text-green-600"}>
                      {loadingResumen ? "…" : resumenFinanciero ? formatCurrency(resumenFinanciero.pl.utilidad) : "–"}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">* Parcial — faltan comisiones, arriendo y nómina por registrar</div>
                  {resumenFinanciero?.pl.aclaracion && (
                    <div className="mt-1 text-[10px] text-slate-400 italic">{resumenFinanciero.pl.aclaracion}</div>
                  )}
                </Card>

                <div className="flex flex-col gap-3.5">
                  <Card title="Gastos por categoría" titleSub="% del total">
                    {(["Comisiones", "Arriendo", "Nómina admin", "Insumos", "Impuestos", "Servicios públicos", "Gastos operativos", "Devoluciones", "Otros"]).map((name) => (
                      <RowItem key={name} name={name} barPct={0} value="–" sub="—%" />
                    ))}
                  </Card>
                  <Card title="Origen de los datos">
                    <div className="text-[11px] text-slate-500 leading-relaxed space-y-2.5">
                      <div><span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase border border-slate-200 text-slate-400">Auto · Facturación</span> — Se calcula automáticamente de las ventas cobradas en el módulo de Facturación.</div>
                      <div><span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase border border-slate-200 text-slate-400">Auto · Citas</span> — Se calcula automáticamente del % de comisión configurado por estilista.</div>
                      <div><span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase border border-slate-200 text-slate-400">Auto · Caja Menor</span> — Viene de los egresos registrados por recepción en la caja del punto de venta.</div>
                      <div><span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase border border-dashed border-slate-300 text-slate-500">Manual · Caja Mayor</span> — Lo registra el administrador en la pestaña <span className="font-semibold text-slate-700">"Registrar movimientos"</span>.</div>
                    </div>
                  </Card>
                </div>
              </div>
            </>
          )}

          {financialTab === "cajas" && (
            <>
              <div className="p-3.5 bg-slate-50 border border-slate-100 rounded-lg text-[11px] text-slate-500 leading-relaxed mb-4">
                <span className="font-semibold text-slate-700">Caja Menor</span> = efectivo en la sede. <span className="font-semibold text-slate-700">Caja Mayor</span> = cuenta principal del negocio.
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 mb-3.5">
                <Card title="Caja Menor" titleSub="Efectivo en sede · Auto + manual">
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {[
                      ["Saldo", loadingResumen ? "…" : resumenFinanciero ? formatCurrency(saldoCajaMenorReal) : "–"],
                      ["Entradas", formatCurrency(metricas.metodos_pago?.efectivo ?? 0)],
                      ["Traslados →", loadingResumen ? "…" : resumenFinanciero ? formatCurrency(resumenFinanciero.traslados.menor_a_mayor) : "–"],
                    ].map(([lbl, val]) => (
                      <div key={lbl} className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-2.5">
                        <div className="text-[9px] text-slate-400 font-semibold uppercase tracking-[0.4px] mb-1">{lbl}</div>
                        <div className="text-[17px] font-bold text-slate-800">{val}</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.5px] text-slate-400 mb-1">Entradas</div>
                  <RowItem name={<>Cobros efectivo <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-blue-50 text-blue-600 border border-blue-200 ml-1.5">Auto</span></>} value={formatCurrency(metricas.metodos_pago?.efectivo ?? 0)} />
                  <RowItem name={<>Anticipos efectivo <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-blue-50 text-blue-600 border border-blue-200 ml-1.5">Tránsito</span></>} value={<span className="text-slate-400">—</span>} />
                  <RowItem name={<span className="text-slate-400">⇄ Recibido de Caja Mayor <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-slate-100 text-slate-500 border border-slate-200 ml-1.5">Manual</span></span>} value={loadingResumen ? "…" : resumenFinanciero ? formatCurrency(resumenFinanciero.traslados.mayor_a_menor) : "–"} />
                  <div className="text-[10px] font-bold uppercase tracking-[0.5px] text-slate-400 mt-3 mb-1">Salidas</div>
                  <RowItem name={<>Gastos operativos <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-slate-100 text-slate-500 border border-slate-200 ml-1.5">Manual · Recepción</span></>} value={<span className="text-slate-400">—</span>} />
                  <RowItem name={<>Propinas estilistas <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-slate-100 text-slate-500 border border-slate-200 ml-1.5">Pass-through</span></>} value={<span className="text-slate-400">—</span>} />
                  <RowItem name={<>Devoluciones a clientes <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-slate-100 text-slate-500 border border-slate-200 ml-1.5">Manual</span></>} value={<span className="text-slate-400">—</span>} />
                  <RowItem name={<span className="text-slate-400">⇄ Entregas a Caja Mayor <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-slate-100 text-slate-500 border border-slate-200 ml-1.5">Manual</span></span>} value={loadingResumen ? "…" : resumenFinanciero ? formatCurrency(resumenFinanciero.traslados.menor_a_mayor) : "–"} />
                  <div className="border-t border-slate-200 mt-2" />
                  <div className="flex justify-between pt-3 text-[14px] font-bold text-slate-800">
                    <span>Saldo caja menor</span>
                    <span>{loadingResumen ? "…" : resumenFinanciero ? formatCurrency(saldoCajaMenorReal) : "–"}</span>
                  </div>
                </Card>

                <Card title="Caja Mayor" titleSub="Cuenta principal · Auto + manual">
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {[
                      ["Saldo", loadingResumen ? "…" : resumenFinanciero ? formatCurrency(resumenFinanciero.cajas.caja_mayor) : "–"],
                      ["Entradas digitales", formatCurrency( (metricas.metodos_pago?.transferencia  ?? 0) + (metricas.metodos_pago?.tarjeta  ?? 0) + (metricas.metodos_pago?.tarjeta_credito ?? 0) + (metricas.metodos_pago?.tarjeta_debito  ?? 0) + (metricas.metodos_pago?.addi ?? 0) + (metricas.metodos_pago?.sin_pago ?? 0) + (metricas.metodos_pago?.otros ?? 0))],
                      ["Traslados →", loadingResumen ? "…" : resumenFinanciero ? formatCurrency(resumenFinanciero.traslados.mayor_a_menor) : "–"],
                    ].map(([lbl, val]) => (
                      <div key={lbl} className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-2.5">
                        <div className="text-[9px] text-slate-400 font-semibold uppercase tracking-[0.4px] mb-1">{lbl}</div>
                        <div className="text-[17px] font-bold text-slate-800">{val}</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.5px] text-slate-400 mb-1">Entradas</div>
                  <RowItem name={<>Efectivo <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-blue-50 text-blue-600 border border-blue-200 ml-1.5">Auto</span></>} value={formatCurrency(metricas.metodos_pago?.efectivo ?? 0)} />
                  <RowItem name={<>Transferencia <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-blue-50 text-blue-600 border border-blue-200 ml-1.5">Auto</span></>} value={formatCurrency(metricas.metodos_pago?.transferencia ?? 0)} />
                  <RowItem name={<>Tarjeta <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-blue-50 text-blue-600 border border-blue-200 ml-1.5">Auto</span></>} value={formatCurrency(metricas.metodos_pago?.tarjeta ?? 0)} />
                  <RowItem name={<>Tarjeta de crédito <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-blue-50 text-blue-600 border border-blue-200 ml-1.5">Auto</span></>} value={formatCurrency(metricas.metodos_pago?.tarjeta_credito ?? 0)} />
                  <RowItem name={<>Tarjeta de débito <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-blue-50 text-blue-600 border border-blue-200 ml-1.5">Auto</span></>} value={formatCurrency(metricas.metodos_pago?.tarjeta_debito ?? 0)} />
                  <RowItem name={<>Link de Pago <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-blue-50 text-blue-600 border border-blue-200 ml-1.5">Auto</span></>} value={formatCurrency(metricas.metodos_pago?.link_de_pago ?? 0)} />
                  <RowItem name={<>Gift Card <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-blue-50 text-blue-600 border border-blue-200 ml-1.5">Auto</span></>} value={<span className="text-slate-400">—</span>} />
                  <RowItem name={<>Addi <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-blue-50 text-blue-600 border border-blue-200 ml-1.5">Auto</span></>} value={formatCurrency(metricas.metodos_pago?.addi ?? 0)} />
                  <RowItem name={<>Abono transferencia <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-blue-50 text-blue-600 border border-blue-200 ml-1.5">Auto</span></>} value={<span className="text-slate-400">—</span>} />
                  <RowItem name={<>Descuento nómina <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-blue-50 text-blue-600 border border-blue-200 ml-1.5">Auto</span></>} value={<span className="text-slate-400">—</span>} />
                  <RowItem name={<>Sin pago <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-blue-50 text-blue-600 border border-blue-200 ml-1.5">Auto</span></>} value={formatCurrency(metricas.metodos_pago?.sin_pago ?? 0)} />
                  <RowItem name={<>Otros <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-blue-50 text-blue-600 border border-blue-200 ml-1.5">Auto</span></>} value={formatCurrency(metricas.metodos_pago?.otros ?? 0)} />
                  <RowItem name={<>Anticipos digital <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-blue-50 text-blue-600 border border-blue-200 ml-1.5">Tránsito</span></>} value={<span className="text-slate-400">—</span>} />
                  <RowItem name={<>Ingresos manuales <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-slate-100 text-slate-500 border border-slate-200 ml-1.5">Manual · Admin</span></>} value={loadingResumen ? "…" : resumenFinanciero ? formatCurrency(resumenFinanciero.pl.ingresos) : "–"} />
                  <RowItem name={<span className="text-slate-400">⇄ Recibido de Caja Menor <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-slate-100 text-slate-500 border border-slate-200 ml-1.5">Manual</span></span>} value={loadingResumen ? "…" : resumenFinanciero ? formatCurrency(resumenFinanciero.traslados.menor_a_mayor) : "–"} />
                  <div className="text-[10px] font-bold uppercase tracking-[0.5px] text-slate-400 mt-3 mb-1">Salidas</div>
                  <RowItem name={<>Egresos manuales <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-slate-100 text-slate-500 border border-slate-200 ml-1.5">Manual · Admin</span></>} value={loadingResumen ? "…" : resumenFinanciero ? formatCurrency(resumenFinanciero.pl.egresos) : "–"} />
                  <RowItem name={<>Nómina administrativa <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-slate-100 text-slate-500 border border-slate-200 ml-1.5">Manual · Admin</span></>} value={<span className="text-slate-400">—</span>} />
                  <RowItem name={<>Devoluciones a clientes <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-slate-100 text-slate-500 border border-slate-200 ml-1.5">Manual</span></>} value={<span className="text-slate-400">—</span>} />
                  <RowItem name={<span className="text-slate-400">⇄ Base a Caja Menor <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-slate-100 text-slate-500 border border-slate-200 ml-1.5">Manual</span></span>} value={loadingResumen ? "…" : resumenFinanciero ? formatCurrency(resumenFinanciero.traslados.mayor_a_menor) : "–"} />
                  <div className="border-t border-slate-200 mt-2" />
                  <div className={`flex justify-between pt-3 text-[14px] font-bold ${resumenFinanciero && resumenFinanciero.cajas.caja_mayor < 0 ? "text-red-600" : "text-slate-800"}`}>
                    <span>Saldo caja mayor</span>
                    <span>{loadingResumen ? "…" : resumenFinanciero ? formatCurrency(resumenFinanciero.cajas.caja_mayor) : "–"}</span>
                  </div>
                </Card>
              </div>

              <Card title="Posición consolidada">
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="bg-white border border-slate-200 rounded-[10px] px-4 py-3.5">
                    <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-[0.4px] mb-1.5">Caja Menor</div>
                    <div className="text-[22px] font-bold text-slate-800">
                      {loadingResumen ? "…" : resumenFinanciero ? formatCurrency(saldoCajaMenorReal) : "–"}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Efectivo en sede</div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-[10px] px-4 py-3.5">
                    <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-[0.4px] mb-1.5">Caja Mayor</div>
                    <div className="text-[22px] font-bold text-slate-800">
                      {loadingResumen ? "…" : resumenFinanciero ? formatCurrency(resumenFinanciero.cajas.caja_mayor) : "–"}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Cuenta principal</div>
                  </div>
                  <div className="bg-white border-2 border-slate-800 rounded-[10px] px-4 py-3.5">
                    <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-[0.4px] mb-1.5">Total consolidado</div>
                    <div className="text-[22px] font-bold text-slate-800">
                      {loadingResumen ? "…" : resumenFinanciero ? formatCurrency(saldoConsolidadoReal) : "–"}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Los traslados no cambian este número</div>
                  </div>
                </div>
              </Card>
              <div className="mt-4">
                <div className="bg-white border border-slate-200 rounded-[10px] p-[18px]">
                  <div className="text-[13px] font-bold mb-4 text-slate-800">Historial de cierres de caja</div>
                  {loadingCierres ? (
                    <div className="py-6 text-center text-[11px] text-slate-400">Cargando historial…</div>
                  ) : cierresHistorial.length > 0 ? (
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          {["Fecha", "Sede", "Responsable", "Sistema esperaba", "Contado", "Diferencia", "Estado", "Nota", ""].map((h) => (
                            <th key={h} className="text-left text-[9px] font-bold uppercase tracking-[0.5px] text-slate-400 pb-2 border-b border-slate-200">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cierresHistorial.map((c: any, idx: number) => {
                          const diff = c.diferencia ?? ((c.efectivo_contado ?? 0) - (c.efectivo_esperado ?? 0));
                          const isOpen = !c.efectivo_contado && c.efectivo_contado !== 0;
                          return (
                            <tr key={c.cierre_id || idx} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                              <td className="py-2.5 text-[12px] text-slate-600">{c.fecha}</td>
                              <td className="py-2.5 text-[11px] text-slate-500">{c.sede_nombre || sedes.find((s) => s.sede_id === c.sede_id)?.nombre || "—"}</td>
                              <td className="py-2.5 text-[11px] text-slate-500 max-w-[120px] truncate">{c.cerrado_por_nombre || c.cerrado_por || "—"}</td>
                              <td className="py-2.5 text-[12px] text-slate-800 tabular-nums">{formatCurrency(c.efectivo_esperado ?? 0)}</td>
                              <td className="py-2.5 text-[12px] text-slate-800 tabular-nums">{isOpen ? "—" : formatCurrency(c.efectivo_contado ?? 0)}</td>
                              <td className="py-2.5 text-[12px] font-semibold tabular-nums">
                                {isOpen ? <span className="text-slate-400">—</span> :
                                  diff === 0 ? <span className="text-slate-400">$ 0</span> :
                                  diff > 0 ? <span className="text-green-600">+{formatCurrency(diff)}</span> :
                                  <span className="text-red-600">-{formatCurrency(Math.abs(diff))}</span>}
                              </td>
                              <td className="py-2.5">
                                <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                                  isOpen ? "bg-blue-50 text-blue-600 border border-blue-200" :
                                  diff === 0 ? "bg-green-50 text-green-600 border border-green-200" :
                                  "bg-amber-50 text-amber-600 border border-amber-200"
                                }`}>
                                  {isOpen ? "Abierto" : diff === 0 ? "Cuadrado" : "Con diferencia"}
                                </span>
                              </td>
                              <td className="py-2.5 text-[11px] text-slate-500 max-w-[180px] truncate">{c.observaciones || "—"}</td>
                              <td className="py-2.5">
                                {!isOpen && (
                                  <button
                                    onClick={async () => {
                                      try {
                                        const { blob, filename } = await cashService.getReporteExcel({
                                          sede_id: c.sede_id || sedeId,
                                          fecha: c.fecha,
                                        });
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement("a");
                                        a.href = url;
                                        a.download = filename || `cierre-${c.fecha}.xlsx`;
                                        document.body.appendChild(a);
                                        a.click();
                                        document.body.removeChild(a);
                                        URL.revokeObjectURL(url);
                                      } catch {
                                        alert("No se pudo descargar el reporte");
                                      }
                                    }}
                                    className="px-2.5 py-1 border border-slate-200 rounded text-[10px] font-medium text-slate-600 hover:bg-slate-100 whitespace-nowrap"
                                  >
                                    ↓ Excel
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="py-6 text-center text-[11px] text-slate-400">No hay cierres de caja registrados para este período. Usa la pestaña "Cierre de caja" para ejecutar un cierre.</div>
                  )}
                </div>
              </div>
            </>
          )}

          {financialTab === "traslados" && (
            <>
              <div className="p-3.5 bg-slate-50 border border-slate-100 rounded-lg text-[11px] text-slate-500 leading-relaxed mb-4">
                <span className="font-semibold text-slate-700">Traslados entre cajas = movimientos internos.</span> No son ingresos ni gastos. El total del negocio no cambia. Solo redistribuyen el dinero entre Caja Menor y Caja Mayor.
              </div>
              <div className="grid grid-cols-3 gap-2.5 mb-4">
                <KPICard label="Menor → Mayor" value={loadingResumen ? "…" : resumenFinanciero ? formatCurrency(resumenFinanciero.traslados.menor_a_mayor) : "–"} sub="Entregas" />
                <KPICard label="Mayor → Menor" value={loadingResumen ? "…" : resumenFinanciero ? formatCurrency(resumenFinanciero.traslados.mayor_a_menor) : "–"} sub="Envíos de base" />
                <KPICard featured label="Neto Trasladado" value={loadingResumen ? "…" : resumenFinanciero ? formatCurrency(resumenFinanciero.traslados.menor_a_mayor - resumenFinanciero.traslados.mayor_a_menor) : "–"} sub="de Menor a Mayor" />
              </div>
              <Card title="Registro de traslados" action={<button onClick={() => { setFinancialTab("registrar"); setRegistrarSubTab("traslado"); }} className="px-3 py-1.5 bg-slate-800 text-white rounded-md text-[11px] font-semibold hover:bg-slate-700">+ Registrar traslado</button>}>
                {(() => {
                  const trasladosMov = movimientosManuales.filter((m) => m.tipo === "Traslado");
                  return trasladosMov.length > 0 ? (
                    <table className="w-full border-collapse">
                      <thead><tr>{["Fecha", "Dirección", "Monto", "Registrado por", "Observaciones"].map((h, i) => (<th key={i} className="text-left text-[9px] font-bold uppercase tracking-[0.5px] text-slate-400 pb-2 border-b border-slate-200">{h}</th>))}</tr></thead>
                      <tbody>{trasladosMov.map((m) => (
                        <tr key={m.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                          <td className="py-2.5 text-[12px] text-slate-600">{m.fecha}</td>
                          <td className="py-2.5"><span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">{m.caja}</span></td>
                          <td className="py-2.5 text-[12px] font-semibold text-slate-800 tabular-nums">{formatCurrency(m.monto)}</td>
                          <td className="py-2.5 text-[11px] text-slate-500">–</td>
                          <td className="py-2.5 text-[11px] text-slate-500">{m.concepto || "–"}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  ) : (<div className="py-8 text-center text-[11px] text-slate-400">No hay traslados registrados para este período. Regístralos en "Registrar movimientos".</div>);
                })()}
              </Card>
            </>
          )}

          {financialTab === "registrar" && (
            <>
              <div className="text-[12px] text-slate-500 leading-relaxed mb-4">
                Aquí el administrador registra los movimientos que <span className="font-semibold text-slate-700">no pasan por la caja registradora</span>: arriendo, nómina, comisiones, impuestos, proveedores, ingresos extras, devoluciones a clientes y traslados entre cajas.
              </div>
              {!isSpecificSede && sedes.length > 0 && (
                <div className="mb-4 flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Sede para este movimiento</label>
                  <select
                    value={registrarSedeId}
                    onChange={(e) => setRegistrarSedeId(e.target.value)}
                    className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800 max-w-xs"
                  >
                    <option value="">Seleccionar sede...</option>
                    {sedes.map((s) => (
                      <option key={s.sede_id} value={s.sede_id}>{s.nombre || s.sede_id}</option>
                    ))}
                  </select>
                </div>
              )}
              {registrarError && (
                <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-700">{registrarError}</div>
              )}
              {registrarSuccess && (
                <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg text-[11px] text-green-700">{registrarSuccess}</div>
              )}
              {registrarSedeId && <div className="flex gap-1.5 mb-4 flex-wrap">
                {([
                  { id: "egreso-mayor" as const, label: "Egreso Caja Mayor" },
                  { id: "ingreso-mayor" as const, label: "Ingreso Caja Mayor" },
                  { id: "traslado" as const, label: "Traslado entre cajas" },
                  { id: "egreso-menor" as const, label: "Egreso Caja Menor" },
                  { id: "devolucion" as const, label: "Devolución a cliente" },
                  { id: "propina" as const, label: "Propina estilista" },
                  { id: "nomina" as const, label: "Nómina administrativa" },
                ]).map((st) => (
                  <button
                    key={st.id}
                    onClick={() => setRegistrarSubTab(st.id)}
                    className={`px-4 py-2 border rounded-lg text-[11px] font-medium transition-colors ${
                      registrarSubTab === st.id
                        ? "bg-slate-800 text-white border-slate-800"
                        : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>}

              {registrarSedeId && registrarSubTab === "egreso-mayor" && (
                <div className="bg-white border border-slate-200 rounded-[10px] p-5 mb-4">
                  <div className="text-[14px] font-bold text-slate-800 mb-1">Registrar egreso — Caja Mayor</div>
                  <div className="text-[11px] text-slate-500 mb-4 leading-relaxed">Para gastos que se pagan desde la cuenta principal: arriendo, nómina, comisiones, impuestos, proveedores, servicios públicos.</div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Concepto</label><input value={egresoMayorForm.concepto} onChange={(e) => setEgresoMayorForm((f) => ({ ...f, concepto: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="Ej: Arriendo local abril 2026" /></div>
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Monto</label><input value={egresoMayorForm.monto} onChange={(e) => setEgresoMayorForm((f) => ({ ...f, monto: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="$0" /></div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Categoría de gasto</label>
                      <select value={egresoMayorForm.categoria} onChange={(e) => setEgresoMayorForm((f) => ({ ...f, categoria: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800">
                        <option value="">Seleccionar categoría...</option>
                        <option>Arriendo</option><option>Nómina administrativa</option><option>Comisiones estilistas</option><option>Servicios públicos</option><option>Impuestos</option><option>Insumos / Proveedores</option><option>Mantenimiento</option><option>Marketing y publicidad</option><option>Software y herramientas</option><option>Otro gasto fijo</option><option>Otro gasto operativo</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Método de pago</label>
                      <select value={egresoMayorForm.metodo} onChange={(e) => setEgresoMayorForm((f) => ({ ...f, metodo: e.target.value as typeof f.metodo }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800">
                        {CASH_PAYMENT_METHOD_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Fecha</label><DatePicker value={egresoMayorForm.fecha} onChange={(v) => setEgresoMayorForm((f) => ({ ...f, fecha: v }))} /></div>
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Referencia / N° factura</label><input value={egresoMayorForm.referencia} onChange={(e) => setEgresoMayorForm((f) => ({ ...f, referencia: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="Opcional" /></div>
                    <div className="flex flex-col gap-1 col-span-2"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Observaciones</label><textarea value={egresoMayorForm.observaciones} onChange={(e) => setEgresoMayorForm((f) => ({ ...f, observaciones: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[12px] resize-y min-h-[56px] leading-relaxed focus:outline-none focus:border-slate-800" placeholder="Detalles adicionales..." /></div>
                  </div>
                  <div className="flex gap-2 justify-end mt-4">
                    <button onClick={() => setEgresoMayorForm({ concepto: "", monto: "", categoria: "", metodo: CASH_PAYMENT_METHOD_OPTIONS[0].value, fecha: resolveToday(), referencia: "", observaciones: "" })} className="px-4 py-2 border border-slate-200 rounded-md text-[12px] font-semibold text-slate-500 hover:bg-slate-50">Cancelar</button>
                    <button onClick={handleEgresoMayor} disabled={registrarLoading} className="px-4 py-2 bg-slate-800 text-white rounded-md text-[12px] font-semibold hover:bg-slate-700 disabled:opacity-60">{registrarLoading ? "Registrando..." : "Registrar egreso"}</button>
                  </div>
                </div>
              )}

              {registrarSedeId && registrarSubTab === "ingreso-mayor" && (
                <div className="bg-white border border-slate-200 rounded-[10px] p-5 mb-4">
                  <div className="text-[14px] font-bold text-slate-800 mb-1">Registrar ingreso — Caja Mayor</div>
                  <div className="text-[11px] text-slate-500 mb-4 leading-relaxed">Para ingresos que no vienen de ventas a clientes: devoluciones de proveedores, intereses bancarios, ingresos extraordinarios.</div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Concepto</label><input value={ingresoMayorForm.concepto} onChange={(e) => setIngresoMayorForm((f) => ({ ...f, concepto: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="Ej: Devolución proveedor XYZ" /></div>
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Monto</label><input value={ingresoMayorForm.monto} onChange={(e) => setIngresoMayorForm((f) => ({ ...f, monto: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="$0" /></div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Tipo de ingreso</label>
                      <select value={ingresoMayorForm.tipo} onChange={(e) => setIngresoMayorForm((f) => ({ ...f, tipo: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800">
                        <option value="">Seleccionar tipo...</option><option>Devolución de proveedor</option><option>Intereses bancarios</option><option>Ingreso extraordinario</option><option>Ajuste contable</option><option>Otro</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Método</label>
                      <select value={ingresoMayorForm.metodo} onChange={(e) => setIngresoMayorForm((f) => ({ ...f, metodo: e.target.value as typeof f.metodo }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800">
                        {CASH_PAYMENT_METHOD_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Fecha</label><DatePicker value={ingresoMayorForm.fecha} onChange={(v) => setIngresoMayorForm((f) => ({ ...f, fecha: v }))} /></div>
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Referencia</label><input value={ingresoMayorForm.referencia} onChange={(e) => setIngresoMayorForm((f) => ({ ...f, referencia: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="Opcional" /></div>
                    <div className="flex flex-col gap-1 col-span-2"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Observaciones</label><textarea value={ingresoMayorForm.observaciones} onChange={(e) => setIngresoMayorForm((f) => ({ ...f, observaciones: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[12px] resize-y min-h-[56px] leading-relaxed focus:outline-none focus:border-slate-800" placeholder="Detalles adicionales..." /></div>
                  </div>
                  <div className="flex gap-2 justify-end mt-4">
                    <button onClick={() => setIngresoMayorForm({ concepto: "", monto: "", tipo: "", metodo: CASH_PAYMENT_METHOD_OPTIONS[0].value, fecha: resolveToday(), referencia: "", observaciones: "" })} className="px-4 py-2 border border-slate-200 rounded-md text-[12px] font-semibold text-slate-500 hover:bg-slate-50">Cancelar</button>
                    <button onClick={handleIngresoMayor} disabled={registrarLoading} className="px-4 py-2 bg-slate-800 text-white rounded-md text-[12px] font-semibold hover:bg-slate-700 disabled:opacity-60">{registrarLoading ? "Registrando..." : "Registrar ingreso"}</button>
                  </div>
                </div>
              )}

              {registrarSedeId && registrarSubTab === "traslado" && (
                <div className="bg-white border border-slate-200 rounded-[10px] p-5 mb-4">
                  <div className="text-[14px] font-bold text-slate-800 mb-1">Registrar traslado entre cajas</div>
                  <div className="text-[11px] text-slate-500 mb-4 leading-relaxed">Para mover dinero entre Caja Menor y Caja Mayor. No es un gasto ni un ingreso — no afecta el P&L.</div>
                  <div className="flex items-center gap-2.5 p-3 bg-slate-50 border border-slate-100 rounded-lg mb-4">
                    <div className="flex-1 text-center bg-white border border-slate-200 rounded-md px-3 py-2.5">
                      <div className="text-[9px] text-slate-400 font-semibold uppercase tracking-[0.3px]">Origen</div>
                      <div className="text-[14px] font-bold text-slate-800 mt-0.5">{transferDir === "menor-mayor" ? "Caja Menor" : "Caja Mayor"}</div>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-slate-300 text-xl">→</span>
                      <button onClick={() => setTransferDir((d) => d === "menor-mayor" ? "mayor-menor" : "menor-mayor")} className="text-[9px] text-slate-500 underline hover:text-slate-700">Invertir</button>
                    </div>
                    <div className="flex-1 text-center bg-white border border-slate-200 rounded-md px-3 py-2.5">
                      <div className="text-[9px] text-slate-400 font-semibold uppercase tracking-[0.3px]">Destino</div>
                      <div className="text-[14px] font-bold text-slate-800 mt-0.5">{transferDir === "menor-mayor" ? "Caja Mayor" : "Caja Menor"}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Monto a trasladar</label><input value={trasladoForm.monto} onChange={(e) => setTrasladoForm((f) => ({ ...f, monto: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="$0" /></div>
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Fecha</label><DatePicker value={trasladoForm.fecha} onChange={(v) => setTrasladoForm((f) => ({ ...f, fecha: v }))} /></div>
                    <div className="flex flex-col gap-1 col-span-2"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Concepto</label><input value={trasladoForm.concepto} onChange={(e) => setTrasladoForm((f) => ({ ...f, concepto: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="Ej: Entrega excedente diario" /></div>
                    <div className="flex flex-col gap-1 col-span-2"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Observaciones</label><textarea value={trasladoForm.observaciones} onChange={(e) => setTrasladoForm((f) => ({ ...f, observaciones: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[12px] resize-y min-h-[56px] leading-relaxed focus:outline-none focus:border-slate-800" placeholder="Opcional" /></div>
                  </div>
                  <div className="flex gap-2 justify-end mt-4">
                    <button onClick={() => setTrasladoForm({ monto: "", fecha: resolveToday(), concepto: "", observaciones: "" })} className="px-4 py-2 border border-slate-200 rounded-md text-[12px] font-semibold text-slate-500 hover:bg-slate-50">Cancelar</button>
                    <button onClick={handleTraslado} disabled={registrarLoading} className="px-4 py-2 bg-slate-800 text-white rounded-md text-[12px] font-semibold hover:bg-slate-700 disabled:opacity-60">{registrarLoading ? "Registrando..." : "Registrar traslado"}</button>
                  </div>
                </div>
              )}

              {registrarSedeId && registrarSubTab === "egreso-menor" && (
                <div className="bg-white border border-slate-200 rounded-[10px] p-5 mb-4">
                  <div className="text-[14px] font-bold text-slate-800 mb-1">Registrar egreso — Caja Menor</div>
                  <div className="text-[11px] text-slate-500 mb-4 leading-relaxed">Para gastos pequeños del día a día: almuerzos, domicilios, propinas, papelería.</div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Concepto</label><input value={egresoMenorForm.concepto} onChange={(e) => setEgresoMenorForm((f) => ({ ...f, concepto: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="Ej: Almuerzo Delcy" /></div>
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Monto</label><input value={egresoMenorForm.monto} onChange={(e) => setEgresoMenorForm((f) => ({ ...f, monto: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="$0" /></div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Categoría</label>
                      <select value={egresoMenorForm.categoria} onChange={(e) => setEgresoMenorForm((f) => ({ ...f, categoria: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800">
                        <option>Gasto operativo</option><option>Propina</option><option>Alimentación</option><option>Domicilio / mensajería</option><option>Papelería / insumos menores</option><option>Otro</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Fecha</label><DatePicker value={egresoMenorForm.fecha} onChange={(v) => setEgresoMenorForm((f) => ({ ...f, fecha: v }))} /></div>
                    <div className="flex flex-col gap-1 col-span-2"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Observaciones</label><textarea value={egresoMenorForm.observaciones} onChange={(e) => setEgresoMenorForm((f) => ({ ...f, observaciones: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[12px] resize-y min-h-[56px] leading-relaxed focus:outline-none focus:border-slate-800" placeholder="Opcional" /></div>
                  </div>
                  <div className="flex gap-2 justify-end mt-4">
                    <button onClick={() => setEgresoMenorForm({ concepto: "", monto: "", categoria: "Gasto operativo", fecha: resolveToday(), observaciones: "" })} className="px-4 py-2 border border-slate-200 rounded-md text-[12px] font-semibold text-slate-500 hover:bg-slate-50">Cancelar</button>
                    <button onClick={handleEgresoMenor} disabled={registrarLoading} className="px-4 py-2 bg-slate-800 text-white rounded-md text-[12px] font-semibold hover:bg-slate-700 disabled:opacity-60">{registrarLoading ? "Registrando..." : "Registrar egreso"}</button>
                  </div>
                </div>
              )}

              {registrarSedeId && registrarSubTab === "devolucion" && (
                <div className="bg-white border border-slate-200 rounded-[10px] p-5 mb-4">
                  <div className="text-[14px] font-bold text-slate-800 mb-1">Registrar devolución a cliente</div>
                  <div className="text-[11px] text-slate-500 mb-4 leading-relaxed">Reduce los ingresos del P&L. No es un gasto operativo. Debe vincularse a la venta original.</div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Número de venta</label><input className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="Ej: SD-26470" /></div>
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Monto a devolver</label><input className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="$ 0" /></div>
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Sale de</label><select className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800"><option>Caja Menor (efectivo)</option><option>Caja Mayor (transferencia)</option></select></div>
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Motivo</label><select className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800"><option>Cliente insatisfecha</option><option>Servicio no realizado</option><option>Error de cobro</option><option>Otro</option></select></div>
                    <div className="flex flex-col gap-1 col-span-2"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Observaciones</label><textarea className="px-3 py-2 border border-slate-200 rounded-md text-[12px] resize-y min-h-[56px] leading-relaxed focus:outline-none focus:border-slate-800" placeholder="Describe el motivo con detalle" /></div>
                  </div>
                  <div className="flex gap-2 justify-end mt-4"><button className="px-4 py-2 border border-slate-200 rounded-md text-[12px] font-semibold text-slate-500 hover:bg-slate-50">Cancelar</button><button className="px-4 py-2 bg-slate-800 text-white rounded-md text-[12px] font-semibold hover:bg-slate-700">Registrar devolución</button></div>
                </div>
              )}
              {registrarSedeId && registrarSubTab === "propina" && (
                <div className="bg-white border border-slate-200 rounded-[10px] p-5 mb-4">
                  <div className="text-[14px] font-bold text-slate-800 mb-1">Registrar propina — estilista</div>
                  <div className="text-[11px] text-slate-500 mb-4 leading-relaxed">Pass-through: no afecta el P&L. Si la propina llegó digital, primero se hace un traslado Caja Mayor → Caja Menor.</div>
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg mb-4 text-[11px] text-amber-700"><span className="font-semibold text-slate-800">⚠ Importante:</span> Si la propina fue pagada por tarjeta o transferencia, primero registra el traslado Caja Mayor → Caja Menor antes de continuar.</div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Estilista</label><select className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800"><option>Seleccionar estilista...</option></select></div>
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Monto</label><input className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="$ 0" /></div>
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Método original de la propina</label><select className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800"><option>Efectivo (ya estaba en Caja Menor)</option><option>Digital — traslado ya registrado</option></select></div>
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Fecha</label><DatePicker value={resolveToday()} onChange={() => {}} /></div>
                  </div>
                  <div className="flex gap-2 justify-end mt-4"><button className="px-4 py-2 border border-slate-200 rounded-md text-[12px] font-semibold text-slate-500 hover:bg-slate-50">Cancelar</button><button className="px-4 py-2 bg-slate-800 text-white rounded-md text-[12px] font-semibold hover:bg-slate-700">Registrar propina</button></div>
                </div>
              )}
              {registrarSedeId && registrarSubTab === "nomina" && (
                <div className="bg-white border border-slate-200 rounded-[10px] p-5 mb-4">
                  <div className="text-[14px] font-bold text-slate-800 mb-1">Registrar nómina administrativa</div>
                  <div className="text-[11px] text-slate-500 mb-4 leading-relaxed">Personal administrativo: recepción, coordinadores, limpieza. Aparece en el P&L como gasto fijo.</div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Nombre del empleado</label><input className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="Ej: María González – Recepción" /></div>
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Monto</label><input className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="$ 0" /></div>
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Sale de</label><select className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800"><option>Caja Mayor (transferencia)</option><option>Caja Menor (efectivo)</option></select></div>
                    <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Período que cubre</label><select className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800"><option>Primera quincena</option><option>Segunda quincena</option><option>Mes completo</option><option>Otro</option></select></div>
                    <div className="flex flex-col gap-1 col-span-2"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Observaciones</label><textarea className="px-3 py-2 border border-slate-200 rounded-md text-[12px] resize-y min-h-[56px] leading-relaxed focus:outline-none focus:border-slate-800" placeholder="Opcional" /></div>
                  </div>
                  <div className="flex gap-2 justify-end mt-4"><button className="px-4 py-2 border border-slate-200 rounded-md text-[12px] font-semibold text-slate-500 hover:bg-slate-50">Cancelar</button><button className="px-4 py-2 bg-slate-800 text-white rounded-md text-[12px] font-semibold hover:bg-slate-700">Registrar nómina</button></div>
                </div>
              )}

              {(() => {
                // TODO: [PENDIENTE BACKEND] Conectar endpoint específico para historial de
                // devoluciones, propinas y nómina cuando estén disponibles.
                const isPendingTab = registrarSubTab === "devolucion" || registrarSubTab === "propina" || registrarSubTab === "nomina";

                if (isPendingTab) {
                  const pendingLabel: Record<string, string> = {
                    devolucion: "Devoluciones a clientes",
                    propina:    "Propinas estilistas",
                    nomina:     "Nómina administrativa",
                  };
                  return (
                    <Card title={`Últimos ${pendingLabel[registrarSubTab] ?? "movimientos"}`} titleSub="historial">
                      <div className="py-8 text-center">
                        <p className="text-[12px] text-slate-500">Sin registros disponibles</p>
                        <p className="text-[10px] text-slate-400 mt-1">El historial estará disponible cuando se conecte el endpoint correspondiente.</p>
                      </div>
                    </Card>
                  );
                }

                const movFiltrados = movimientosManuales.filter((m) => {
                  if (registrarSubTab === "egreso-mayor")  return m.tipo === "Egreso"   && m.caja === "Caja Mayor";
                  if (registrarSubTab === "ingreso-mayor") return m.tipo === "Ingreso"  && m.caja === "Caja Mayor";
                  if (registrarSubTab === "traslado")      return m.tipo === "Traslado";
                  if (registrarSubTab === "egreso-menor")  return m.tipo === "Egreso"   && m.caja === "Caja Menor";
                  return false;
                });
                const tabLabel: Record<string, string> = {
                  "egreso-mayor":  "Egresos Caja Mayor",
                  "ingreso-mayor": "Ingresos Caja Mayor",
                  "traslado":      "Traslados entre cajas",
                  "egreso-menor":  "Egresos Caja Menor",
                };
                return (
                  <Card title={`Últimos ${tabLabel[registrarSubTab] ?? "movimientos"}`} titleSub="10 más recientes" scrollable>
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          {["Fecha", "Caja", "Tipo", "Concepto", "Categoría", "Monto"].map((h, i) => (
                            <th key={i} className={`text-left text-[9px] font-bold uppercase tracking-[0.5px] text-slate-400 pb-2 border-b border-slate-200 ${i === 5 ? "text-right" : ""}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {movFiltrados.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-8 text-center text-[11px] text-slate-400">
                              No hay movimientos registrados aún.
                            </td>
                          </tr>
                        ) : movFiltrados.map((m) => (
                          <tr key={m.id} className="border-b border-slate-100 last:border-0">
                            <td className="py-2.5 text-[11px] text-slate-600">{m.fecha}</td>
                            <td className="py-2.5 text-[11px] text-slate-600">{m.caja}</td>
                            <td className="py-2.5">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${m.tipo === "Egreso" ? "bg-red-50 text-red-600" : m.tipo === "Ingreso" ? "bg-green-50 text-green-600" : "bg-blue-50 text-blue-600"}`}>{m.tipo}</span>
                            </td>
                            <td className="py-2.5 text-[11px] text-slate-700 font-medium max-w-[160px] truncate">{m.concepto}</td>
                            <td className="py-2.5 text-[11px] text-slate-500">{m.categoria}</td>
                            <td className="py-2.5 text-[11px] text-right font-semibold text-slate-800">{formatMoney(m.monto, monedaUsuario)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                );
              })()}
            </>
          )}

          {financialTab === "cierre" && (
            <>
              {loadingCierres ? (
                <div className="py-12 text-center text-[11px] text-slate-400">Cargando datos de cierre…</div>
              ) : cierreHoy ? (
                /* ── Cierre ya realizado hoy ── */
                <div className="max-w-[640px]">
                  <div className="text-[17px] font-semibold text-slate-800 mb-1">Cierre de caja — {cierreHoy.fecha}</div>
                  <div className="text-[13px] text-slate-400 mb-5">{cierreHoy.sede_nombre || sedes.find((s) => s.sede_id === sedeId)?.nombre || "Sede"} · Cierre registrado</div>
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg mb-5">
                    <div className="text-[13px] font-semibold text-green-700 mb-2">✓ Cierre del día completado</div>
                    <div className="grid grid-cols-2 gap-3 text-[12px]">
                      <div><span className="text-slate-500">Esperado:</span> <span className="font-semibold text-slate-800">{formatCurrency(cierreHoy.efectivo_esperado ?? 0)}</span></div>
                      <div><span className="text-slate-500">Contado:</span> <span className="font-semibold text-slate-800">{formatCurrency(cierreHoy.efectivo_contado ?? 0)}</span></div>
                      <div><span className="text-slate-500">Diferencia:</span> <span className={`font-semibold ${(cierreHoy.diferencia ?? 0) === 0 ? "text-slate-400" : (cierreHoy.diferencia ?? 0) > 0 ? "text-green-600" : "text-red-600"}`}>{(cierreHoy.diferencia ?? 0) > 0 ? "+" : ""}{formatCurrency(cierreHoy.diferencia ?? 0)}</span></div>
                      <div><span className="text-slate-500">Estado:</span> <span className="font-semibold text-slate-800">{cierreHoy.estado ?? "cerrado"}</span></div>
                    </div>
                    {cierreHoy.observaciones && <div className="mt-2 text-[11px] text-slate-500">Obs: {cierreHoy.observaciones}</div>}
                    {cierreHoy.cerrado_por_nombre && <div className="mt-1 text-[10px] text-slate-400">Por: {cierreHoy.cerrado_por_nombre}</div>}
                  </div>
                </div>
              ) : (
                /* ── Formulario de cierre ── */
                <div className="max-w-[640px]">
                  <div className="text-[17px] font-semibold text-slate-800 mb-1">Cierre de caja — {resolveToday()}</div>
                  <div className="text-[13px] text-slate-400 mb-5">{sedes.find((s) => s.sede_id === sedeId)?.nombre || "Sede"} · Cuenta lo que hay físicamente en el cajón y compáralo con lo que el sistema espera.</div>

                  {cierreError && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-700">{cierreError}</div>}
                  {cierreSuccess && <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg text-[11px] text-green-700">{cierreSuccess}</div>}

                  <div className="grid grid-cols-2 gap-3 mb-5">
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                      <div className="text-[10px] font-bold uppercase tracking-[0.5px] text-slate-400 mb-1">El sistema esperaba</div>
                      <div className="text-[18px] font-bold text-slate-800">{formatCurrency(metricas.metodos_pago?.efectivo ?? 0)}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">Cobros efectivo - gastos - traslados</div>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                      <div className="text-[10px] font-bold uppercase tracking-[0.5px] text-slate-400 mb-1">Desglose del sistema</div>
                      <div className="text-[12px] text-slate-500 mt-1 leading-[1.8]">
                        Cobros efectivo: <span className="font-semibold text-slate-800">{formatCurrency(metricas.metodos_pago?.efectivo ?? 0)}</span><br />
                        Gastos operativos: <span className="font-semibold text-slate-800">-{formatCurrency(0)}</span><br />
                        Traslados a Mayor: <span className="font-semibold text-slate-800">-{loadingResumen ? "…" : resumenFinanciero ? formatCurrency(resumenFinanciero.traslados.menor_a_mayor) : "–"}</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 mb-5">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">¿Cuánto contaste físicamente?</label>
                      <input
                        value={cierreContado}
                        onChange={(e) => setCierreContado(e.target.value)}
                        className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800"
                        placeholder="$ 0"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Diferencia</label>
                      {(() => {
                        const contadoNum = parseFloat(cierreContado.replace(/[^0-9.-]/g, ""));
                        const esperado = metricas.metodos_pago?.efectivo ?? 0;
                        if (isNaN(contadoNum) || !cierreContado.trim()) {
                          return <div className="px-3 py-2 border border-slate-200 rounded-md text-[15px] font-bold text-slate-400 bg-slate-50">—</div>;
                        }
                        const diff = contadoNum - esperado;
                        const color = diff === 0 ? "text-slate-400" : diff > 0 ? "text-green-600" : "text-red-600";
                        return <div className={`px-3 py-2 border border-slate-200 rounded-md text-[15px] font-bold bg-slate-50 ${color}`}>{diff > 0 ? "+" : ""}{formatCurrency(diff)}</div>;
                      })()}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 mb-5">
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Observaciones generales (opcional)</label>
                    <textarea
                      value={cierreObservaciones}
                      onChange={(e) => setCierreObservaciones(e.target.value)}
                      className="px-3 py-2 border border-slate-200 rounded-md text-[12px] resize-y min-h-[56px] leading-relaxed focus:outline-none focus:border-slate-800"
                      placeholder="Novedades del día, situaciones especiales..."
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => { setCierreContado(""); setCierreObservaciones(""); setCierreError(null); }}
                      className="px-4 py-2 border border-slate-200 rounded-md text-[12px] font-semibold text-slate-500 hover:bg-slate-50"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleGuardarCierre}
                      disabled={cierreLoading}
                      className="px-4 py-2 bg-slate-800 text-white rounded-md text-[12px] font-semibold hover:bg-slate-700 disabled:opacity-60"
                    >
                      {cierreLoading ? "Guardando…" : "Guardar cierre"}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Historial de cierres ── */}
              {cierresHistorial.length > 0 && (
                <div className="mt-6">
                  <Card title="Historial de cierres recientes" titleSub={`${cierresHistorial.length} registros`}>
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          {["Fecha", "Esperado", "Contado", "Diferencia", "Estado", "Observaciones"].map((h, i) => (
                            <th key={i} className="text-left text-[9px] font-bold uppercase tracking-[0.5px] text-slate-400 pb-2 border-b border-slate-200">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cierresHistorial.slice(0, 10).map((c: any, idx: number) => {
                          const diff = c.diferencia ?? ((c.efectivo_contado ?? 0) - (c.efectivo_esperado ?? 0));
                          return (
                            <tr key={c.cierre_id || idx} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                              <td className="py-2.5 text-[12px] text-slate-600">{c.fecha}</td>
                              <td className="py-2.5 text-[12px] text-slate-800 tabular-nums">{formatCurrency(c.efectivo_esperado ?? 0)}</td>
                              <td className="py-2.5 text-[12px] text-slate-800 tabular-nums">{formatCurrency(c.efectivo_contado ?? 0)}</td>
                              <td className={`py-2.5 text-[12px] font-semibold tabular-nums ${diff === 0 ? "text-slate-400" : diff > 0 ? "text-green-600" : "text-red-600"}`}>
                                {diff === 0 ? "$0" : `${diff > 0 ? "+" : ""}${formatCurrency(diff)}`}
                              </td>
                              <td className="py-2.5">
                                <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                                  diff === 0 ? "bg-green-50 text-green-600 border border-green-200" :
                                  "bg-amber-50 text-amber-600 border border-amber-200"
                                }`}>
                                  {diff === 0 ? "Cuadrado" : "Con diferencia"}
                                </span>
                              </td>
                              <td className="py-2.5 text-[11px] text-slate-500 max-w-[160px] truncate">{c.observaciones || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </Card>
                </div>
              )}
            </>
          )}

      {/* ══ MÉTRICAS DE CLIENTES ════════════════════════════ */}
      <SectionTitle>Métricas de clientes</SectionTitle>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 mb-3.5">
        <ClientMetric label="Clientes atendidos" value={String(clientesUnicos || metricas.cantidad_ventas || 0)} sub="este período" />
        <ClientMetric label="Nuevos" value={String(nuevosClientes)} sub={clientesUnicos > 0 ? `${Math.round((nuevosClientes / clientesUnicos) * 100)}% del total` : "este período"} />
        <ClientMetric label="Recurrentes" value={String(recurrentes)} sub={clientesUnicos > 0 ? `${pctRecurrentes}% del total` : "este período"} />
        <ClientMetric label="Recurrencia prom." value={clientAnalytics?.recurrencia?.texto ?? "–"} sub={clientAnalytics?.recurrencia ? `${clientAnalytics.recurrencia.clientes_recurrentes} clientes` : "datos no disponibles"} />
        <ClientMetric label="Ticket promedio" value={formatCurrency(metricas.ticket_promedio)} sub="por visita" />
        <ClientMetric label="LTV promedio" value={clientAnalytics?.ltv ? formatCurrency(clientAnalytics.ltv.ltv_promedio) : "–"} sub={clientAnalytics?.ltv ? `ticket prom: ${formatCurrency(clientAnalytics.ltv.ticket_promedio)}` : "datos no disponibles"} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-3.5">
        <Card title="Composición de clientes">
          <div className="flex items-center gap-5">
            <div className="w-[90px] h-[90px] rounded-full relative flex-shrink-0" style={{ background: `conic-gradient(#1E293B 0% ${pctRecurrentes}%, #E2E8F0 ${pctRecurrentes}% 100%)` }}>
              <div className="absolute inset-[18px] rounded-full bg-white flex items-center justify-center flex-col">
                <span className="text-base font-bold text-slate-800">{pctRecurrentes}%</span>
                <span className="text-[8px] text-slate-400">recurrentes</span>
              </div>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-1.5 text-[11px] mb-1.5"><div className="w-2 h-2 rounded-sm bg-slate-800" /><span>Recurrentes: {recurrentes}</span></div>
              <div className="flex items-center gap-1.5 text-[11px] mb-1.5"><div className="w-2 h-2 rounded-sm bg-slate-200" /><span>Nuevos: {nuevosClientes}</span></div>
              <div className="mt-2.5 text-[10px] text-slate-400">Meta retención: 85%</div>
            </div>
          </div>
        </Card>

        <Card title="Estado de la base">
          {estadoBase ? (
            <>
              <RowItem name="Activos" value={String(estadoBase.activos)} sub={estadoBase.total > 0 ? `${Math.round((estadoBase.activos / estadoBase.total) * 100)}% del total` : undefined} />
              <RowItem name="En riesgo" value={String(estadoBase.en_riesgo)} sub={estadoBase.total > 0 ? `${Math.round((estadoBase.en_riesgo / estadoBase.total) * 100)}% del total` : undefined} />
              <RowItem name="Perdidos" value={String(estadoBase.perdidos)} sub={estadoBase.total > 0 ? `${Math.round((estadoBase.perdidos / estadoBase.total) * 100)}% del total` : undefined} />
              {estadoBase.sin_visita > 0 && (<RowItem name="Sin visita registrada" value={String(estadoBase.sin_visita)} />)}
              <div className="mt-1.5 text-[10px] text-slate-400">Total base: {estadoBase.total} clientes</div>
            </>
          ) : churnData.length > 0 ? (
            <>
              <RowItem name="Activos (0–120 días)" value={String(churnActivos)} sub="detectados" />
              <RowItem name="En riesgo (121–180 días)" value={String(churnEnRiesgo)} sub="detectados" />
              <RowItem name="Perdidos (181+ días)" value={String(churnPerdidos)} sub="detectados" />
            </>
          ) : (
            <>
              <RowItem name="Activos" value="–" />
              <RowItem name="En riesgo" value="–" />
              <RowItem name="Perdidos" value="–" />
            </>
          )}
          {!estadoBase && (<div className="mt-1.5 text-[10px] text-slate-400">Segmentación completa requiere módulo de analítica avanzada</div>)}
        </Card>

        <Card title="Nuevos clientes">
          {clientesNuevos && clientesNuevos.clientes.length > 0 ? (
            <>
              <div className="text-[10px] text-slate-400 mb-2">{clientesNuevos.total} nuevos en el período</div>
              <div className="space-y-1">
                {clientesNuevos.clientes.slice(0, 6).map((c) => (
                  <div key={c.cliente_id} className="flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-b-0">
                    <div>
                      <div className="font-medium text-slate-800">{c.nombre}</div>
                      <div className="text-[10px] text-slate-400">{c.fecha_creacion?.slice(0, 10)}</div>
                    </div>
                    <div className="text-[10px] text-slate-500 text-right">{c.telefono}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-400 py-4 text-center">Sin nuevos clientes en este período</p>
          )}
        </Card>
      </div>

      {/* ══ RENDIMIENTO POR ESTILISTA ════════════════════════ */}
      <SectionTitle>Rendimiento por estilista</SectionTitle>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 mb-3.5">
        <Card title="Ranking por ingreso generado" titleSub="servicios + productos" scrollable action={<button onClick={() => navigate(stylistsPath)} className="text-[11px] text-slate-500 hover:text-slate-800 font-medium transition-colors">Ver todos →</button>}>
          {extendedMetrics && extendedMetrics.topEstilistas.length > 0 ? (
            extendedMetrics.topEstilistas.map((est, idx) => (
              <div key={est.nombre} className="flex items-center gap-2.5 py-2 border-b border-slate-100 last:border-b-0">
                <span className="text-[11px] font-bold text-slate-400 w-4">{idx + 1}</span>
                <div className="w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">{est.initials}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-slate-800 truncate">{est.nombre}</div>
                  <div className="text-[10px] text-slate-500">{est.citas} citas · Ticket prom: {formatCurrency(est.ticketPromedio)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[13px] font-bold text-slate-800">{formatCurrency(est.total)}</div>
                  <div className="text-[9px] text-slate-400">{metricas.ventas_totales > 0 ? `${Math.round((est.total / metricas.ventas_totales) * 100)}%` : "–"}</div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-400 py-4 text-center">Sin datos de estilistas para este período</p>
          )}
        </Card>

        <Card title="Productos más vendidos" action={<button onClick={() => navigate(productsPath)} className="text-[11px] text-slate-500 hover:text-slate-800 font-medium transition-colors">Ver todos →</button>}>
          {extendedMetrics && extendedMetrics.topProductos.length > 0 ? (
            <>
              {extendedMetrics.topProductos.map((p) => (
                <RowItem key={p.nombre} name={p.nombre} value={formatCurrency(p.total)} sub={`${p.cantidad} uds`} />
              ))}
              <div className="mt-2 text-[10px] text-slate-400">
                Venta prom. de producto por cita: {metricas.cantidad_ventas > 0 ? formatCurrency(metricas.ventas_productos / metricas.cantidad_ventas) : "–"}
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-400 py-4 text-center">Sin datos de productos para este período</p>
          )}
        </Card>
      </div>
    </>
  );
}
