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
import {
  getClientesAnalytics,
  getClientesNuevos,
  type ClientesAnalyticsResponse,
  type ClientesNuevosResponse,
} from "./clientesAnalyticsApi";
import { RefreshCw, Users, XCircle, Clock, CalendarX, Download, Search } from "lucide-react";
import { getCitas } from "../../../components/Quotes/citasApi";

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
  const [clientAnalytics, setClientAnalytics] = useState<ClientesAnalyticsResponse | null>(null);
  const [clientesNuevos, setClientesNuevos] = useState<ClientesNuevosResponse | null>(null);
  const [citasResumen, setCitasResumen] = useState<{ asistidas: number; canceladas: number; precitas: number; total: number } | null>(null);
  const [citasDetalle, setCitasDetalle] = useState<any[]>([]);
  const [citasSearch, setCitasSearch] = useState("");
  const [citasFilterEstado, setCitasFilterEstado] = useState("");
  const [citasFilterEstilista, setCitasFilterEstilista] = useState("");
  const [citasPage, setCitasPage] = useState(1);
  const CITAS_PER_PAGE = 10;

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

  const resolveEstado = (estado: string): string => {
    const v = (estado || "").toLowerCase().trim();
    if (v.includes("cancel")) return "cancelada";
    if (["pre-cita", "pre_cita", "precita", "pre_reservada"].some((s) => v.includes(s))) return "precita";
    if (v.includes("asistida") || v.includes("completada") || v.includes("finaliz") || v.includes("facturada")) return "asistida";
    if (v.includes("confirm")) return "confirmada";
    if (v.includes("no_asistio") || v.includes("no asistio")) return "cancelada";
    return v;
  };

  const loadCitasResumen = useCallback(async () => {
    if (!token) return;
    try {
      const range = buildInvoiceRange();
      const start = new Date(range.start_date);
      const end = new Date(range.end_date);
      const days: string[] = [];
      for (let d = new Date(start); d <= end && days.length <= 31; d.setDate(d.getDate() + 1)) {
        days.push(toLocalYMD(d));
      }
      if (days.length > 31) {
        setCitasResumen(null);
        return;
      }
      const effectiveSedeId = sedeId === "global" ? undefined : sedeId;
      const allCitas: any[] = [];

      const batchSize = 7;
      for (let i = 0; i < days.length; i += batchSize) {
        const batch = days.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (fecha) => {
            try {
              const res = await getCitas({ sede_id: effectiveSedeId, fecha }, token);
              const arr = Array.isArray((res as any)?.citas) ? (res as any).citas : Array.isArray(res) ? res : [];
              return arr;
            } catch { return []; }
          })
        );
        results.forEach((r) => allCitas.push(...r));
      }

      let asistidas = 0, canceladas = 0, precitas = 0;
      allCitas.forEach((c: any) => {
        const est = resolveEstado(c.estado || "");
        if (est === "asistida") asistidas++;
        else if (est === "cancelada") canceladas++;
        else if (est === "precita") precitas++;
      });
      setCitasResumen({ asistidas, canceladas, precitas, total: allCitas.length });
      setCitasDetalle(allCitas);
      setCitasPage(1);
    } catch {
      setCitasResumen(null);
      setCitasDetalle([]);
    }
  }, [token, sedeId, buildInvoiceRange]);

  useEffect(() => {
    loadCitasResumen();
  }, [loadCitasResumen]);

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

  // ── Mini-components (v2 design) ──────────────────────────

  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <div className="text-[11px] font-semibold uppercase tracking-[0.8px] text-[#9b9b97] mb-3.5 mt-8 first:mt-0">
      {children}
    </div>
  );

  const KPICard = ({ label, value, sub, change, featured, valueClassName, smallValue }: {
    label: string; value: string; sub?: string; change?: string; featured?: boolean; valueClassName?: string; smallValue?: boolean;
  }) => (
    <div className={`bg-white rounded-lg px-5 py-[18px] transition-shadow hover:shadow-[0_1px_3px_rgba(0,0,0,0.06)] ${featured ? "border border-[#0a0a0a]" : "border border-[#e8e8e6]"}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-[#9b9b97] mb-2.5">{label}</div>
      <div className={`${smallValue ? "text-[13px] tracking-[-0.2px] mt-1" : "text-[26px] tracking-[-1px]"} font-bold ${valueClassName || "text-[#0a0a0a]"}`}>{value}</div>
      {change && change !== "0%" && (
        <div className="text-[11.5px] mt-1 text-[#9b9b97]"><span className="text-[#16a34a] font-medium">↑ {change}</span> vs mes anterior</div>
      )}
      {sub && <div className="text-[11.5px] text-[#9b9b97] mt-1">{sub}</div>}
    </div>
  );

  const ClientMetric = ({ label, value, sub, smallValue }: { label: string; value: string; sub?: string; smallValue?: boolean }) => (
    <div className="bg-white rounded-lg px-5 py-[18px] border border-[#e8e8e6] transition-shadow hover:shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-[#9b9b97] mb-2.5">{label}</div>
      <div className={`${smallValue ? "text-[18px] tracking-[-0.5px]" : "text-[26px] tracking-[-1px]"} font-bold text-[#0a0a0a]`}>{value}</div>
      {sub && <div className="text-[11.5px] text-[#9b9b97] mt-1">{sub}</div>}
    </div>
  );

  const ProgressRow = ({ label, value, sub, barPct, barColor }: {
    label: React.ReactNode; value: React.ReactNode; sub?: string; barPct?: number; barColor?: string;
  }) => (
    <div className="flex flex-col gap-1.5 py-3.5 border-b border-[#e8e8e6] last:border-b-0">
      <div className="flex justify-between items-center text-[12.5px]">
        <span className="text-[#6b6b68]">{label}</span>
        <div className="text-right">
          <span className="font-semibold text-[12px] text-[#0a0a0a] font-sans">{value}</span>
          {sub && <span className="text-[11px] text-[#9b9b97] ml-1.5">{sub}</span>}
        </div>
      </div>
      {barPct !== undefined && (
        <div className="h-1 bg-[#f7f7f6] rounded-sm overflow-hidden">
          <div className="h-full rounded-sm transition-[width] duration-400" style={{ width: `${Math.max(2, barPct)}%`, background: barColor || "#0a0a0a" }} />
        </div>
      )}
    </div>
  );

  const RowItem = ({ name, value, sub, barPct }: {
    name: React.ReactNode; value: React.ReactNode; sub?: string; barPct?: number;
  }) => (
    <div className="flex justify-between items-center py-2.5 border-b border-[#e8e8e6] last:border-b-0">
      <span className="font-medium text-[12.5px] text-[#6b6b68] flex-shrink-0 flex items-center">{name}</span>
      {barPct !== undefined && (
        <div className="flex-1 mx-3 h-1 bg-[#f7f7f6] rounded-sm min-w-[40px] overflow-hidden">
          <div className="h-full bg-[#0a0a0a] rounded-sm" style={{ width: `${Math.max(2, barPct)}%` }} />
        </div>
      )}
      <div className="text-right">
        <span className="font-semibold text-[13px] text-[#0a0a0a]">{value}</span>
        {sub && <div className="text-[11px] text-[#9b9b97] leading-none mt-0.5">{sub}</div>}
      </div>
    </div>
  );

  const Card = ({ title, titleSub, children, scrollable, action, noPadBody }: {
    title: string; titleSub?: string; children: React.ReactNode; scrollable?: boolean; action?: React.ReactNode; noPadBody?: boolean;
  }) => (
    <div className="bg-white border border-[#e8e8e6] rounded-lg h-full flex flex-col overflow-hidden">
      <div className="flex justify-between items-center px-5 py-4 border-b border-[#e8e8e6] flex-shrink-0">
        <div>
          <div className="text-[13.5px] font-semibold text-[#0a0a0a]">{title}</div>
        </div>
        <div className="flex items-center gap-2">
          {titleSub && <span className="text-[11px] text-[#9b9b97] font-normal">{titleSub}</span>}
          {action}
        </div>
      </div>
      {scrollable
        ? <div className={`flex-1 overflow-y-auto min-h-0 ${noPadBody ? "" : "px-5 py-4"}`}>{children}</div>
        : <div className={noPadBody ? "" : "px-5 py-4"}>{children}</div>}
    </div>
  );

  // ── Derived values ───────────────────────────────────────
  const metricas = getMetricas();
  const pctServicios = metricas.ventas_totales > 0 ? Math.round((metricas.ventas_servicios / metricas.ventas_totales) * 100) : 0;
  const pctProductos = metricas.ventas_totales > 0 ? Math.round((metricas.ventas_productos / metricas.ventas_totales) * 100) : 0;
  const dias = dashboardData?.range?.dias || 1;
  const ventaPromDia = metricas.ventas_totales > 0 ? Math.round(metricas.ventas_totales / dias) : 0;
  const topServicioNombre = extendedMetrics?.topServicios?.[0]?.nombre ?? null;

  const paymentRows = [
    { name: "Transferencia", value: metricas.metodos_pago?.transferencia || 0 },
    { name: "Tarjeta de Crédito", value: metricas.metodos_pago?.tarjeta_credito || 0 },
    { name: "Tarjeta de Débito", value: metricas.metodos_pago?.tarjeta_debito || 0 },
    { name: "Efectivo", value: metricas.metodos_pago?.efectivo || 0 },
    { name: "Tarjeta", value: metricas.metodos_pago?.tarjeta || 0 },
    { name: "Addi", value: metricas.metodos_pago?.addi || 0 },
    { name: "Link de Pago", value: metricas.metodos_pago?.link_de_pago || 0 },
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

  // ── Render ───────────────────────────────────────────────

  // ── Donut SVG helper ──────────────────────────────────────
  const donutRadius = 30;
  const donutCircumference = 2 * Math.PI * donutRadius;
  const donutStroke = (pct: number) => (donutCircumference * pct) / 100;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-[#e8e8e6] border-t-[#0a0a0a] rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#6b6b68] text-sm">Cargando datos…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 bg-white rounded-lg border border-[#e8e8e6]">
        <p className="text-[#6b6b68] mb-4">{error}</p>
        <button
          onClick={loadData}
          className="inline-flex items-center gap-1.5 px-3.5 py-[7px] border border-[#e8e8e6] rounded-[5px] text-[12.5px] font-medium text-[#6b6b68] bg-white hover:bg-[#f7f7f6] hover:text-[#0a0a0a] transition-all"
        >
          <RefreshCw className="w-[13px] h-[13px]" /> Reintentar
        </button>
      </div>
    );
  }

  return (
    <>
      {/* ══ VENTAS ═══════════════════════════════════════════ */}
      <SectionTitle>Ventas</SectionTitle>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <KPICard featured label="Ventas totales" value={formatCurrency(metricas.ventas_totales)} change={metricas.crecimiento_ventas !== "0%" ? metricas.crecimiento_ventas : undefined} />
        <KPICard label="Servicios" value={formatCurrency(metricas.ventas_servicios)} sub={`${extendedMetrics?.topServicios.reduce((s, i) => s + i.cantidad, 0) || 0} servicios · ${pctServicios}%`} />
        <KPICard label="Productos" value={formatCurrency(metricas.ventas_productos)} sub={`${extendedMetrics?.topProductos.reduce((s, i) => s + i.cantidad, 0) || 0} ventas · ${pctProductos}%`} />
        <KPICard label="Transacciones" value={String(metricas.cantidad_ventas || 0)} sub={`Ticket prom: ${formatCurrency(metricas.ticket_promedio)}`} />
        <KPICard label="Venta promedio/día" value={formatCurrency(ventaPromDia)} sub={`${dias} días del período`} />
        <KPICard label="Top servicio" value={topServicioNombre ?? "—"} sub="por ingreso" smallValue />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        <Card title="Ventas cobradas por método de pago" titleSub="solo dinero recibido">
          {paymentRows.length > 0 ? (
            <>
              {paymentRows.map((row) => (
                <ProgressRow
                  key={row.name}
                  label={row.name}
                  value={formatCurrency(row.value)}
                  sub={`${Math.round((row.value / (totalPayments || 1)) * 100)}%`}
                  barPct={totalPayments > 0 ? (row.value / totalPayments) * 100 : 0}
                />
              ))}
              <div className="flex justify-between pt-3 text-[13px] font-semibold border-t border-[#e8e8e6] mt-1">
                <span className="text-[#6b6b68]">Total cobrado</span>
                <span className="text-[#0a0a0a] font-sans">{formatCurrency(totalPayments)}</span>
              </div>
            </>
          ) : (
            <p className="text-[12.5px] text-[#9b9b97] py-8 text-center">Sin datos de pagos para este período</p>
          )}
        </Card>

        <Card title="Top servicios por ingreso" titleSub={getPeriodDisplay()} scrollable>
          {extendedMetrics && extendedMetrics.topServicios.length > 0 ? (
            extendedMetrics.topServicios.map((s) => (
              <RowItem key={s.nombre} name={s.nombre} value={formatCurrency(s.total)} sub={`${s.cantidad} servicios`} />
            ))
          ) : (
            <p className="text-[12.5px] text-[#9b9b97] py-8 text-center">Sin datos de servicios para este período</p>
          )}
        </Card>
      </div>

      {/* ══ RESUMEN DE CITAS ═══════════════════════════════ */}
      {citasResumen && (
        <>
          <SectionTitle>Resumen de citas</SectionTitle>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
            {/* Asistidas */}
            <div className="bg-white border border-[#e8e8e6] rounded-lg px-5 py-5 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-[5px] bg-[#f7f7f6] text-[#0a0a0a] flex items-center justify-center flex-shrink-0">
                  <Users className="w-3.5 h-3.5" />
                </div>
                <span className="text-[12px] font-semibold uppercase tracking-[0.3px] text-[#6b6b68]">Asistidas</span>
              </div>
              <div className="text-[32px] font-semibold tracking-[-1.5px] text-[#0a0a0a] font-sans leading-none">{citasResumen.asistidas}</div>
              <div className="text-[11.5px] text-[#9b9b97]">{citasResumen.total > 0 ? `${Math.round((citasResumen.asistidas / citasResumen.total) * 100)}% del total` : "0% del total"}</div>
            </div>
            {/* Canceladas */}
            <div className="bg-white border border-[#e8e8e6] rounded-lg px-5 py-5 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-[5px] bg-[#f7f7f6] text-[#0a0a0a] flex items-center justify-center flex-shrink-0">
                  <XCircle className="w-3.5 h-3.5" />
                </div>
                <span className="text-[12px] font-semibold uppercase tracking-[0.3px] text-[#6b6b68]">Canceladas</span>
              </div>
              <div className="text-[32px] font-semibold tracking-[-1.5px] text-[#0a0a0a] font-sans leading-none">{citasResumen.canceladas}</div>
              <div className="text-[11.5px] text-[#9b9b97]">{citasResumen.total > 0 ? `${Math.round((citasResumen.canceladas / citasResumen.total) * 100)}% de cancelación` : "0% de cancelación"}</div>
            </div>
            {/* Precitas */}
            <div className="bg-white border border-[#e8e8e6] rounded-lg px-5 py-5 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-[5px] bg-[#f7f7f6] text-[#0a0a0a] flex items-center justify-center flex-shrink-0">
                  <Clock className="w-3.5 h-3.5" />
                </div>
                <span className="text-[12px] font-semibold uppercase tracking-[0.3px] text-[#6b6b68]">Precitas</span>
              </div>
              <div className="text-[32px] font-semibold tracking-[-1.5px] text-[#0a0a0a] font-sans leading-none">{citasResumen.precitas}</div>
              <div className="text-[11.5px] text-[#9b9b97]">pendientes de confirmar</div>
            </div>
            {/* Total */}
            <div className="bg-white border border-[#e8e8e6] rounded-lg px-5 py-5 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-[5px] bg-[#f7f7f6] text-[#0a0a0a] flex items-center justify-center flex-shrink-0">
                  <CalendarX className="w-3.5 h-3.5" />
                </div>
                <span className="text-[12px] font-semibold uppercase tracking-[0.3px] text-[#6b6b68]">Total citas</span>
              </div>
              <div className="text-[32px] font-semibold tracking-[-1.5px] text-[#0a0a0a] font-sans leading-none">{citasResumen.total}</div>
              <div className="text-[11.5px] text-[#9b9b97]">en el período</div>
            </div>
          </div>
        </>
      )}

      {/* ══ MÉTRICAS DE CLIENTES ════════════════════════════ */}
      <SectionTitle>Métricas de clientes</SectionTitle>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <ClientMetric label="Atendidos" value={String(clientesUnicos || metricas.cantidad_ventas || 0)} sub="este período" />
        <ClientMetric label="Nuevos" value={String(nuevosClientes)} sub={clientesUnicos > 0 ? `${Math.round((nuevosClientes / clientesUnicos) * 100)}% del total` : "este período"} />
        <ClientMetric label="Recurrentes" value={String(recurrentes)} sub={clientesUnicos > 0 ? `${pctRecurrentes}% del total` : "este período"} />
        <ClientMetric label="Recurrencia prom." value={clientAnalytics?.recurrencia?.texto ?? "–"} sub={clientAnalytics?.recurrencia ? `${clientAnalytics.recurrencia.clientes_recurrentes} clientes` : "datos no disponibles"} smallValue />
        <ClientMetric label="Ticket promedio" value={formatCurrency(metricas.ticket_promedio)} sub="por visita" />
        <ClientMetric label="LTV promedio" value={clientAnalytics?.ltv ? formatCurrency(clientAnalytics.ltv.ltv_promedio) : "–"} sub={clientAnalytics?.ltv ? `ticket prom: ${formatCurrency(clientAnalytics.ltv.ticket_promedio)}` : "datos no disponibles"} smallValue />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {/* Composición de clientes – SVG donut */}
        <Card title="Composición de clientes" titleSub="Meta retención: 85%">
          <div className="flex items-center gap-6 py-1">
            <svg className="flex-shrink-0" width="80" height="80" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r={donutRadius} fill="none" stroke="#f3f4f6" strokeWidth="12" />
              <circle
                cx="40" cy="40" r={donutRadius} fill="none" stroke="#0a0a0a" strokeWidth="12"
                strokeDasharray={`${donutStroke(pctRecurrentes)} ${donutCircumference - donutStroke(pctRecurrentes)}`}
                strokeDashoffset={donutCircumference * 0.25}
                transform="rotate(-90 40 40)"
              />
              <text x="40" y="44" textAnchor="middle" fontSize="11" fontWeight="600" fill="#0a0a0a">{pctRecurrentes}%</text>
            </svg>
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2 text-[12.5px]">
                <div className="w-2 h-2 rounded-full bg-[#0a0a0a] flex-shrink-0" />
                <span className="text-[#6b6b68]">Recurrentes</span>
                <span className="font-semibold font-sans ml-auto pl-3">{recurrentes}<span className="text-[11px] text-[#9b9b97] ml-1">· {pctRecurrentes}%</span></span>
              </div>
              <div className="flex items-center gap-2 text-[12.5px]">
                <div className="w-2 h-2 rounded-full bg-[#e8e8e6] flex-shrink-0" />
                <span className="text-[#6b6b68]">Nuevos</span>
                <span className="font-semibold font-sans ml-auto pl-3">{nuevosClientes}<span className="text-[11px] text-[#9b9b97] ml-1">· {clientesUnicos > 0 ? Math.round((nuevosClientes / clientesUnicos) * 100) : 0}%</span></span>
              </div>
            </div>
          </div>
        </Card>

        {/* Estado de la base – table with status dots */}
        <Card title="Estado de la base" titleSub={estadoBase ? `Total: ${estadoBase.total} clientes` : undefined}>
          {estadoBase ? (
            <>
              <table className="w-full border-collapse">
                <tbody>
                  <tr className="border-b border-[#e8e8e6]">
                    <td className="py-3 text-[13px] align-middle"><span className="inline-block w-1.5 h-1.5 rounded-full bg-[#16a34a] mr-1.5 align-middle" />Activos</td>
                    <td className="py-3 text-right align-middle"><span className="font-semibold font-sans text-[15px]">{estadoBase.activos}</span> <span className="text-[11px] text-[#9b9b97]">{estadoBase.total > 0 ? `${Math.round((estadoBase.activos / estadoBase.total) * 100)}%` : ""}</span></td>
                  </tr>
                  <tr className="border-b border-[#e8e8e6]">
                    <td className="py-3 text-[13px] align-middle"><span className="inline-block w-1.5 h-1.5 rounded-full bg-[#ea580c] mr-1.5 align-middle" />En riesgo</td>
                    <td className="py-3 text-right align-middle"><span className="font-semibold font-sans text-[15px]">{estadoBase.en_riesgo}</span> <span className="text-[11px] text-[#9b9b97]">{estadoBase.total > 0 ? `${Math.round((estadoBase.en_riesgo / estadoBase.total) * 100)}%` : ""}</span></td>
                  </tr>
                  <tr className="border-b border-[#e8e8e6]">
                    <td className="py-3 text-[13px] align-middle"><span className="inline-block w-1.5 h-1.5 rounded-full bg-[#6b7280] mr-1.5 align-middle" />Perdidos</td>
                    <td className="py-3 text-right align-middle"><span className="font-semibold font-sans text-[15px]">{estadoBase.perdidos}</span> <span className="text-[11px] text-[#9b9b97]">{estadoBase.total > 0 ? `${Math.round((estadoBase.perdidos / estadoBase.total) * 100)}%` : ""}</span></td>
                  </tr>
                  {estadoBase.sin_visita > 0 && (
                    <tr>
                      <td className="py-3 text-[13px] align-middle"><span className="inline-block w-1.5 h-1.5 rounded-full bg-[#d1d1cf] mr-1.5 align-middle" />Sin visita registrada</td>
                      <td className="py-3 text-right align-middle"><span className="font-semibold font-sans text-[15px]">{estadoBase.sin_visita}</span> <span className="text-[11px] text-[#9b9b97]">{estadoBase.total > 0 ? `${Math.round((estadoBase.sin_visita / estadoBase.total) * 100)}%` : ""}</span></td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="mt-2 text-[11.5px] text-[#9b9b97]">Total base · {estadoBase.total} clientes</div>
            </>
          ) : churnData.length > 0 ? (
            <table className="w-full border-collapse">
              <tbody>
                <tr className="border-b border-[#e8e8e6]">
                  <td className="py-3 text-[13px]"><span className="inline-block w-1.5 h-1.5 rounded-full bg-[#16a34a] mr-1.5 align-middle" />Activos (0–120 días)</td>
                  <td className="py-3 text-right"><span className="font-semibold font-sans text-[15px]">{churnActivos}</span></td>
                </tr>
                <tr className="border-b border-[#e8e8e6]">
                  <td className="py-3 text-[13px]"><span className="inline-block w-1.5 h-1.5 rounded-full bg-[#ea580c] mr-1.5 align-middle" />En riesgo (121–180 días)</td>
                  <td className="py-3 text-right"><span className="font-semibold font-sans text-[15px]">{churnEnRiesgo}</span></td>
                </tr>
                <tr>
                  <td className="py-3 text-[13px]"><span className="inline-block w-1.5 h-1.5 rounded-full bg-[#6b7280] mr-1.5 align-middle" />Perdidos (181+ días)</td>
                  <td className="py-3 text-right"><span className="font-semibold font-sans text-[15px]">{churnPerdidos}</span></td>
                </tr>
              </tbody>
            </table>
          ) : (
            <table className="w-full border-collapse">
              <tbody>
                <tr className="border-b border-[#e8e8e6]"><td className="py-3 text-[13px]"><span className="inline-block w-1.5 h-1.5 rounded-full bg-[#16a34a] mr-1.5 align-middle" />Activos</td><td className="py-3 text-right font-semibold font-sans text-[15px]">–</td></tr>
                <tr className="border-b border-[#e8e8e6]"><td className="py-3 text-[13px]"><span className="inline-block w-1.5 h-1.5 rounded-full bg-[#ea580c] mr-1.5 align-middle" />En riesgo</td><td className="py-3 text-right font-semibold font-sans text-[15px]">–</td></tr>
                <tr><td className="py-3 text-[13px]"><span className="inline-block w-1.5 h-1.5 rounded-full bg-[#6b7280] mr-1.5 align-middle" />Perdidos</td><td className="py-3 text-right font-semibold font-sans text-[15px]">–</td></tr>
              </tbody>
            </table>
          )}
          {!estadoBase && (<div className="mt-2 text-[11.5px] text-[#9b9b97]">Segmentación completa requiere módulo de analítica avanzada</div>)}
        </Card>

        {/* Nuevos clientes */}
        <Card title="Nuevos clientes" titleSub={clientesNuevos ? `${clientesNuevos.total} en el período` : undefined}>
          {clientesNuevos && clientesNuevos.clientes.length > 0 ? (
            <div className="flex flex-col">
              {clientesNuevos.clientes.slice(0, 6).map((c) => (
                <div key={c.cliente_id} className="flex items-center justify-between gap-3 py-[11px] border-b border-[#e8e8e6] last:border-b-0">
                  <div>
                    <div className="text-[13px] font-medium text-[#0a0a0a]">{c.nombre}</div>
                    <div className="text-[11px] text-[#9b9b97] mt-0.5">{c.fecha_creacion?.slice(0, 10)}</div>
                  </div>
                  <div className="text-[12px] font-sans text-[#6b6b68] whitespace-nowrap">{c.telefono}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12.5px] text-[#9b9b97] py-8 text-center">Sin nuevos clientes en este período</p>
          )}
        </Card>
      </div>

      {/* ══ RENDIMIENTO POR ESTILISTA ════════════════════════ */}
      <SectionTitle>Rendimiento por estilista</SectionTitle>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        <Card title="Ranking por ingreso generado" action={stylistsPath ? <button onClick={() => navigate(stylistsPath)} className="text-[11.5px] text-[#9b9b97] hover:text-[#0a0a0a] cursor-pointer transition-colors">Ver todos →</button> : undefined}>
          {extendedMetrics && extendedMetrics.topEstilistas.length > 0 ? (
            <div className="flex flex-col">
              {extendedMetrics.topEstilistas.map((est, idx) => {
                const maxTotal = extendedMetrics.topEstilistas[0]?.total || 1;
                return (
                  <div key={est.nombre} className="flex items-center gap-3 py-[11px] border-b border-[#e8e8e6] last:border-b-0">
                    <span className="w-5 text-[12px] text-[#9b9b97] font-sans flex-shrink-0">{idx + 1}</span>
                    <div className="w-7 h-7 rounded-full bg-[#f7f7f6] border border-[#e8e8e6] flex items-center justify-center text-[11px] font-semibold text-[#6b6b68] flex-shrink-0">{est.initials}</div>
                    <span className="flex-1 text-[13px] font-medium text-[#0a0a0a] truncate">{est.nombre}</span>
                    <span className="text-[11.5px] text-[#9b9b97] flex-shrink-0">{est.citas} citas</span>
                    <div className="w-20 h-1 bg-[#f7f7f6] rounded-sm overflow-hidden flex-shrink-0">
                      <div className="h-full bg-[#0a0a0a] rounded-sm" style={{ width: `${Math.max(2, (est.total / maxTotal) * 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[12.5px] text-[#9b9b97] py-8 text-center">Sin datos de estilistas para este período</p>
          )}
        </Card>

        <Card title="Productos más vendidos" action={productsPath ? <button onClick={() => navigate(productsPath)} className="text-[11.5px] text-[#9b9b97] hover:text-[#0a0a0a] cursor-pointer transition-colors">Ver todos →</button> : undefined}>
          {extendedMetrics && extendedMetrics.topProductos.length > 0 ? (
            <>
              {extendedMetrics.topProductos.map((p) => (
                <RowItem key={p.nombre} name={p.nombre} value={formatCurrency(p.total)} sub={`${p.cantidad} uds`} />
              ))}
              <div className="mt-3 text-[11.5px] text-[#9b9b97]">
                Venta prom. de producto por cita: {metricas.cantidad_ventas > 0 ? formatCurrency(metricas.ventas_productos / metricas.cantidad_ventas) : "–"}
              </div>
            </>
          ) : (
            <p className="text-[12.5px] text-[#9b9b97] py-8 text-center">Sin datos de productos para este período</p>
          )}
        </Card>
      </div>

      {/* ══ INFORME DETALLADO DE CITAS ═══════════════════════ */}
      {(() => {
        const STATUS_PILL: Record<string, { label: string; pillCls: string; dotCls: string }> = {
          asistida:   { label: "Asistida",   pillCls: "bg-[#f0fdf4] text-[#16a34a]", dotCls: "bg-[#16a34a]" },
          cancelada:  { label: "Cancelada",  pillCls: "bg-[#fff7ed] text-[#ea580c]", dotCls: "bg-[#ea580c]" },
          precita:    { label: "Precita",    pillCls: "bg-[#f3f4f6] text-[#6b7280]", dotCls: "bg-[#6b7280]" },
          confirmada: { label: "Confirmada", pillCls: "bg-[#eff6ff] text-[#2563eb]", dotCls: "bg-[#2563eb]" },
        };

        const q = citasSearch.toLowerCase();
        const filtered = citasDetalle.filter((c: any) => {
          const est = resolveEstado(c.estado || "");
          const matchQ = !q ||
            (c.cliente_nombre || c.nombre_cliente || "").toLowerCase().includes(q) ||
            (c.correo || c.cliente_correo || "").toLowerCase().includes(q) ||
            (c.estilista_nombre || c.profesional_nombre || "").toLowerCase().includes(q) ||
            (c.servicio_nombre || "").toLowerCase().includes(q);
          const matchEstado = !citasFilterEstado || est === citasFilterEstado;
          const matchEstilista = !citasFilterEstilista ||
            (c.estilista_nombre || c.profesional_nombre || "") === citasFilterEstilista;
          return matchQ && matchEstado && matchEstilista;
        });

        const totalPages = Math.max(1, Math.ceil(filtered.length / CITAS_PER_PAGE));
        const safePage = Math.min(citasPage, totalPages);
        const pageRows = filtered.slice((safePage - 1) * CITAS_PER_PAGE, safePage * CITAS_PER_PAGE);

        const estilistas = Array.from(new Set(
          citasDetalle.map((c: any) => c.estilista_nombre || c.profesional_nombre || "").filter(Boolean)
        )).sort();

        const exportCSV = () => {
          if (filtered.length === 0) return;
          const headers = ["Fecha", "Hora", "Cliente", "Correo", "Teléfono", "Estilista", "Servicio", "Estado"];
          const rows = filtered.map((c: any) => [
            c.fecha || "",
            c.hora || c.hora_inicio || "",
            c.cliente_nombre || c.nombre_cliente || "",
            c.correo || c.cliente_correo || "",
            c.telefono || c.cliente_telefono || "",
            c.estilista_nombre || c.profesional_nombre || "",
            c.servicio_nombre || (c.servicios_resumen || ""),
            c.estado || "",
          ].map((v: string) => `"${v.replace(/"/g, '""')}"`).join(","));
          const csv = [headers.join(","), ...rows].join("\n");
          const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `citas-${new Date().toISOString().slice(0, 10)}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        };

        return (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3.5">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.8px] text-[#9b9b97] mb-1">Informe detallado de citas</div>
                <div className="text-[12px] text-[#9b9b97]">Actualizado según el período seleccionado</div>
              </div>
              <button
                onClick={exportCSV}
                className="inline-flex items-center gap-1.5 px-3 py-[5px] border border-[#e8e8e6] rounded-[5px] text-[12px] font-medium text-[#6b6b68] bg-white hover:bg-[#f7f7f6] hover:text-[#0a0a0a] transition-all"
              >
                <Download className="w-3 h-3" />
                Exportar CSV
              </button>
            </div>

            <div className="bg-white border border-[#e8e8e6] rounded-lg overflow-hidden">
              {/* Toolbar */}
              <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#e8e8e6]">
                <div className="relative flex-1 max-w-[280px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-[13px] h-[13px] opacity-35 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Buscar por cliente, correo o estilista…"
                    value={citasSearch}
                    onChange={(e) => { setCitasSearch(e.target.value); setCitasPage(1); }}
                    className="w-full pl-[30px] pr-2.5 py-1.5 border border-[#e8e8e6] rounded-[5px] text-[12.5px] bg-[#f7f7f6] text-[#0a0a0a] outline-none focus:border-[#d1d1cf] focus:bg-white transition-colors"
                  />
                </div>
                <select
                  value={citasFilterEstado}
                  onChange={(e) => { setCitasFilterEstado(e.target.value); setCitasPage(1); }}
                  className="px-2.5 py-1.5 border border-[#e8e8e6] rounded-[5px] text-[12.5px] bg-[#f7f7f6] text-[#6b6b68] outline-none cursor-pointer"
                >
                  <option value="">Todos los estados</option>
                  <option value="asistida">Asistida</option>
                  <option value="cancelada">Cancelada</option>
                  <option value="precita">Precita</option>
                  <option value="confirmada">Confirmada</option>
                </select>
                <select
                  value={citasFilterEstilista}
                  onChange={(e) => { setCitasFilterEstilista(e.target.value); setCitasPage(1); }}
                  className="px-2.5 py-1.5 border border-[#e8e8e6] rounded-[5px] text-[12.5px] bg-[#f7f7f6] text-[#6b6b68] outline-none cursor-pointer"
                >
                  <option value="">Todas las estilistas</option>
                  {estilistas.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <span className="text-[12px] text-[#9b9b97] ml-auto whitespace-nowrap">
                  Mostrando {Math.min(filtered.length, safePage * CITAS_PER_PAGE)} de {filtered.length} citas
                </span>
              </div>

              {/* Table */}
              <table className="w-full border-collapse">
                <thead className="bg-[#f7f7f6]">
                  <tr>
                    {["Fecha", "Hora", "Cliente", "Correo electrónico", "Teléfono", "Estilista", "Servicio", "Estado"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.5px] text-[#9b9b97] whitespace-nowrap border-b border-[#e8e8e6] first:pl-5 last:pr-5">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length > 0 ? (
                    pageRows.map((c: any, i: number) => {
                      const est = resolveEstado(c.estado || "");
                      const pill = STATUS_PILL[est] || STATUS_PILL.precita;
                      return (
                        <tr key={i} className="hover:bg-[#f7f7f6] transition-colors">
                          <td className="px-4 py-[11px] text-[13px] border-b border-[#e8e8e6] first:pl-5 font-sans text-[12px] text-[#6b6b68]">{c.fecha || ""}</td>
                          <td className="px-4 py-[11px] text-[13px] border-b border-[#e8e8e6] font-sans text-[12px] text-[#6b6b68]">{c.hora || c.hora_inicio || ""}</td>
                          <td className="px-4 py-[11px] text-[13px] border-b border-[#e8e8e6] font-medium">{c.cliente_nombre || c.nombre_cliente || ""}</td>
                          <td className="px-4 py-[11px] text-[13px] border-b border-[#e8e8e6] text-[#6b6b68]">{c.correo || c.cliente_correo || ""}</td>
                          <td className="px-4 py-[11px] text-[13px] border-b border-[#e8e8e6] font-sans text-[12px] text-[#6b6b68]">{c.telefono || c.cliente_telefono || ""}</td>
                          <td className="px-4 py-[11px] text-[13px] border-b border-[#e8e8e6] text-[#6b6b68]">{c.estilista_nombre || c.profesional_nombre || ""}</td>
                          <td className="px-4 py-[11px] text-[13px] border-b border-[#e8e8e6] text-[#6b6b68]">{c.servicio_nombre || c.servicios_resumen || ""}</td>
                          <td className="px-4 py-[11px] text-[13px] border-b border-[#e8e8e6] last:pr-5">
                            <span className={`inline-flex items-center gap-[5px] px-2.5 py-[3px] rounded-full text-[11.5px] font-medium whitespace-nowrap ${pill.pillCls}`}>
                              <span className={`w-[5px] h-[5px] rounded-full ${pill.dotCls}`} />
                              {pill.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} className="px-5 py-10 text-center text-[13px] text-[#9b9b97]">
                        Sin datos de citas para este período
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-[#e8e8e6] text-[12px] text-[#9b9b97]">
                  <span>Página {safePage} de {totalPages}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setCitasPage((p) => Math.max(1, p - 1))}
                      disabled={safePage <= 1}
                      className="w-7 h-7 rounded-[5px] border border-[#e8e8e6] flex items-center justify-center text-[12px] text-[#6b6b68] bg-white hover:bg-[#f7f7f6] transition-all disabled:opacity-40"
                    >
                      ‹
                    </button>
                    {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                      let page: number;
                      if (totalPages <= 5) page = i + 1;
                      else if (safePage <= 3) page = i + 1;
                      else if (safePage >= totalPages - 2) page = totalPages - 4 + i;
                      else page = safePage - 2 + i;
                      return (
                        <button
                          key={page}
                          onClick={() => setCitasPage(page)}
                          className={`w-7 h-7 rounded-[5px] border flex items-center justify-center text-[12px] transition-all ${
                            page === safePage
                              ? "bg-[#0a0a0a] text-white border-[#0a0a0a]"
                              : "border-[#e8e8e6] text-[#6b6b68] bg-white hover:bg-[#f7f7f6]"
                          }`}
                        >
                          {page}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setCitasPage((p) => Math.min(totalPages, p + 1))}
                      disabled={safePage >= totalPages}
                      className="w-7 h-7 rounded-[5px] border border-[#e8e8e6] flex items-center justify-center text-[12px] text-[#6b6b68] bg-white hover:bg-[#f7f7f6] transition-all disabled:opacity-40"
                    >
                      ›
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </>
  );
}
