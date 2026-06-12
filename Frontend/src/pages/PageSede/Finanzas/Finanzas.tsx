"use client"

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Sidebar } from "../../../components/Layout/Sidebar";
import { useAuth } from "../../../components/Auth/AuthContext";
import { formatSedeNombre } from "../../../lib/sede";
import { formatDateDMY, toLocalYMD } from "../../../lib/dateFormat";
import {
  getVentasDashboard,
  getSedes,
  type VentasDashboardResponse,
  type VentasMetricas,
  type Sede,
} from "../Dashboard/analyticsApi";
import { formatMoney, extractNumericValue } from "../Dashboard/formatMoney";
import {
  normalizeCurrencyCode,
  getStoredCurrency,
  resolveCurrencyFromSede,
  resolveCurrencyFromCountry,
  resolveCurrencyLocale,
} from "../../../lib/currency";
import { facturaService } from "../Sales-invoiced/facturas";
import {
  getResumenFinanciero,
  crearEgresoMayor,
  crearIngresoMayor,
  crearEgresoMenor,
  crearTraslado,
  normalizeCategoria,
  normalizeMetodoPago,
  type ResumenFinanciero,
} from "../Dashboard/finanzasMovimientosApi";
import { cashService } from "../CierreCaja/api/cashService";
import { CASH_PAYMENT_METHOD_OPTIONS } from "../CierreCaja/constants";
import { RefreshCw } from "lucide-react";
import { SedeDropdown } from "../../../components/ui/SedeDropdown";
import type { PeriodoId } from "../../../components/ui/PeriodoSelector";
import { DatePicker } from "../../../components/ui/DatePicker";
import { toast } from "sonner";

interface DateRange {
  start_date: string;
  end_date: string;
}


const normalizeSedeId = (value: string | null | undefined) =>
  String(value ?? "").trim();

type FinanzasTab = "estado-financiero" | "cierre-caja";
type FinancialSubTab = "pl" | "cajas" | "traslados" | "registrar";
type RegistrarSubTab = "egreso-mayor" | "ingreso-mayor" | "traslado" | "egreso-menor" | "devolucion" | "propina" | "nomina";

interface MovimientoManual {
  id: string;
  fecha: string;
  tipo: string;
  caja: string;
  concepto: string;
  categoria: string;
  monto: number;
}

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

const createEmptyMetricas = (): VentasMetricas => ({
  ventas_totales: 0,
  cantidad_ventas: 0,
  ventas_servicios: 0,
  ventas_productos: 0,
  metodos_pago: {
    efectivo: 0, transferencia: 0, tarjeta: 0, tarjeta_credito: 0,
    tarjeta_debito: 0, addi: 0, link_de_pago: 0, sin_pago: 0, otros: 0,
  },
  ticket_promedio: 0,
  crecimiento_ventas: "0%",
});

const buildRealMetricasFromFacturas = (facturas: any[]): Record<string, VentasMetricas> => {
  const metricasPorMoneda: Record<string, VentasMetricas> = {};
  facturas.forEach((factura) => {
    const moneda = normalizeCurrencyCode(factura.moneda || "COP");
    if (!metricasPorMoneda[moneda]) metricasPorMoneda[moneda] = createEmptyMetricas();
    const m = metricasPorMoneda[moneda];
    const totalVenta = Math.max(toSafeNumber(factura.total), toSafeNumber(factura.desglose_pagos?.total));
    m.ventas_totales += totalVenta;
    m.cantidad_ventas += 1;
    (factura.items || []).forEach((item: any) => {
      const subtotal = toSafeNumber(item?.subtotal);
      const tipo = normalizeItemType(item?.tipo);
      if (tipo === "servicio") m.ventas_servicios += subtotal;
      else if (tipo === "producto") m.ventas_productos += subtotal;
    });
    const desglose = factura.desglose_pagos as Record<string, unknown> | undefined;
    if (!desglose) return;
    SALES_PAYMENT_METHODS.forEach((metodo) => {
      m.metodos_pago[metodo] = (m.metodos_pago[metodo] || 0) + toSafeNumber(desglose[metodo]);
    });
  });
  Object.values(metricasPorMoneda).forEach((m) => {
    m.ventas_totales = roundCurrencyMetric(m.ventas_totales);
    m.ventas_servicios = roundCurrencyMetric(m.ventas_servicios);
    m.ventas_productos = roundCurrencyMetric(m.ventas_productos);
    m.ticket_promedio = m.cantidad_ventas > 0 ? roundCurrencyMetric(m.ventas_totales / m.cantidad_ventas) : 0;
    m.crecimiento_ventas = "0%";
    SALES_PAYMENT_METHODS.forEach((metodo) => { m.metodos_pago[metodo] = roundCurrencyMetric(m.metodos_pago[metodo] || 0); });
  });
  return metricasPorMoneda;
};

const resolveToday = () => toLocalYMD(new Date());

export default function FinanzasPage() {
  const { user, isAuthenticated, activeSedeId, setActiveSedeId } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [loadingSedes, setLoadingSedes] = useState(true);
  const [selectedSede, setSelectedSede] = useState<string>("");
  const [periodoActivo] = useState<PeriodoId>("mes");
  const [dateRange, setDateRange] = useState<DateRange>({ start_date: "", end_date: "" });

  const [reloadNonce, setReloadNonce] = useState(0);


  // Financial data state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboardData, setDashboardData] = useState<VentasDashboardResponse | null>(null);
  const [realMetricasByCurrency, setRealMetricasByCurrency] = useState<Record<string, VentasMetricas> | null>(null);
  const [resumenFinanciero, setResumenFinanciero] = useState<ResumenFinanciero | null>(null);
  const egresoMayorCat = (cat: string): number => resumenFinanciero?.pl?.egresos_mayor_por_categoria?.[cat] ?? 0;
  const [loadingResumen, setLoadingResumen] = useState(false);
  const [cierresHistorial, setCierresHistorial] = useState<any[]>([]);
  const [loadingCierres, setLoadingCierres] = useState(false);
  const [movimientosManuales, _setMovimientosManuales] = useState<MovimientoManual[]>([]);

  // Tab state
  const activeTab: FinanzasTab = searchParams.get("tab") === "cierre-caja" ? "cierre-caja" : "estado-financiero";
  const [financialTab, setFinancialTab] = useState<FinancialSubTab>("pl");
  const [registrarSubTab, setRegistrarSubTab] = useState<RegistrarSubTab>("egreso-mayor");

  // Registrar forms
  const [registrarSedeId, setRegistrarSedeId] = useState<string>("");
  const [registrarLoading, setRegistrarLoading] = useState(false);
  const [registrarError, setRegistrarError] = useState<string | null>(null);
  const [registrarSuccess, setRegistrarSuccess] = useState<string | null>(null);
  const [egresoMayorForm, setEgresoMayorForm] = useState({ concepto: "", monto: "", categoria: "", metodo: CASH_PAYMENT_METHOD_OPTIONS[0].value, fecha: resolveToday(), referencia: "", observaciones: "" });
  const [ingresoMayorForm, setIngresoMayorForm] = useState({ concepto: "", monto: "", tipo: "", metodo: CASH_PAYMENT_METHOD_OPTIONS[0].value, fecha: resolveToday(), referencia: "", observaciones: "" });
  const [trasladoForm, setTrasladoForm] = useState({ monto: "", fecha: resolveToday(), concepto: "", observaciones: "" });
  const [transferDir, setTransferDir] = useState<"menor-mayor" | "mayor-menor">("menor-mayor");
  const [egresoMenorForm, setEgresoMenorForm] = useState({ concepto: "", monto: "", categoria: "Gasto operativo", fecha: resolveToday(), observaciones: "" });
  const [devolucionForm, setDevolucionForm] = useState({ numeroVenta: "", monto: "", saleDe: "caja_menor", motivo: "Cliente insatisfecha", observaciones: "" });
  const [propinaForm, setPropinaForm] = useState({ estilista: "", monto: "", metodoOriginal: "efectivo", fecha: resolveToday() });
  const [nominaForm, setNominaForm] = useState({ empleado: "", monto: "", saleDe: "caja_mayor", periodo: "Primera quincena", observaciones: "" });

  // Local period filters per section
  type LocalPeriodo = 'mes_actual' | 'rango';
  const [filtroResultados, setFiltroResultados] = useState<LocalPeriodo>('mes_actual');
  const [rangoResultados, setRangoResultados] = useState<{ from: Date; to: Date } | null>(null);
  const [filtroCierres, setFiltroCierres] = useState<LocalPeriodo>('mes_actual');
  const [rangoCierres, setRangoCierres] = useState<{ from: Date; to: Date } | null>(null);
  const [filtroTraslados, setFiltroTraslados] = useState<LocalPeriodo>('mes_actual');
  const [rangoTraslados, setRangoTraslados] = useState<{ from: Date; to: Date } | null>(null);
  const [filtroMovimientos, setFiltroMovimientos] = useState<LocalPeriodo>('mes_actual');
  const [rangoMovimientos, setRangoMovimientos] = useState<{ from: Date; to: Date } | null>(null);
  const [filtroCierresCaja, setFiltroCierresCaja] = useState<LocalPeriodo>('mes_actual');
  const [rangoCierresCaja, setRangoCierresCaja] = useState<{ from: Date; to: Date } | null>(null);

  // Cierre state
  const [cierreHoy, setCierreHoy] = useState<any>(null);
  const [cierreContado, setCierreContado] = useState("");
  const [cierreObservaciones, setCierreObservaciones] = useState("");
  const [cierreLoading, setCierreLoading] = useState(false);
  const [cierreError, setCierreError] = useState<string | null>(null);
  const [cierreSuccess, setCierreSuccess] = useState<string | null>(null);

  const setActiveTab = (tab: FinanzasTab) => setSearchParams({ tab });

  const monedaUsuario = normalizeCurrencyCode(user?.moneda || getStoredCurrency("COP"));

  const allowedSedeIds = useMemo(() => {
    const values = new Set<string>();
    const add = (candidate: string | null | undefined) => { const n = normalizeSedeId(candidate); if (n) values.add(n); };
    add(user?.sede_id_principal);
    add(user?.sede_id);
    add(activeSedeId);
    if (Array.isArray(user?.sedes_permitidas)) user.sedes_permitidas.forEach((s) => add(s));
    return Array.from(values);
  }, [activeSedeId, user?.sede_id, user?.sede_id_principal, user?.sedes_permitidas]);

  const isAdminSede = useMemo(() => {
    const r = String(user?.role ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    return r === "admin_sede" || r === "adminsede" || r === "admin";
  }, [user?.role]);

  const isSpecificSede = selectedSede !== "global" && selectedSede !== "";

  const PERIODO_TO_API: Record<PeriodoId, string> = {
    hoy: "today", "7dias": "last_7_days", mes: "month", "30dias": "last_30_days", rango: "custom",
  };

  const PERIODO_LABELS: Record<PeriodoId, string> = {
    hoy: "Hoy", "7dias": "7 días", mes: "Mes actual", "30dias": "30 días", rango: "Rango personalizado",
  };

  // ── Currency resolution ──
  const resolveMetricasByCurrency = useCallback(
    (metricasPorMoneda?: VentasDashboardResponse["metricas_por_moneda"]) => {
      const fallback = normalizeCurrencyCode(monedaUsuario);
      if (!metricasPorMoneda || Object.keys(metricasPorMoneda).length === 0) return { metricas: undefined, moneda: fallback };
      const sedeActual = selectedSede === "global" ? undefined : sedes.find((s) => s.sede_id === selectedSede);
      const sedeCurrency = resolveCurrencyFromSede(sedeActual, fallback);
      const countryCurrency = resolveCurrencyFromCountry(user?.pais, sedeCurrency);
      const candidates = Array.from(new Set([sedeCurrency, countryCurrency, fallback, "COP", "USD", "MXN"].map((c) => normalizeCurrencyCode(c)).filter(Boolean)));
      for (const c of candidates) { if (metricasPorMoneda[c]) return { metricas: metricasPorMoneda[c], moneda: c }; }
      const [first] = Object.keys(metricasPorMoneda);
      if (!first) return { metricas: undefined, moneda: fallback };
      return { metricas: metricasPorMoneda[first], moneda: normalizeCurrencyCode(first) };
    },
    [monedaUsuario, selectedSede, sedes, user?.pais]
  );

  const getActiveCurrency = useCallback((): string => {
    const src = realMetricasByCurrency ?? dashboardData?.metricas_por_moneda;
    return resolveMetricasByCurrency(src).moneda;
  }, [realMetricasByCurrency, dashboardData, resolveMetricasByCurrency]);

  const formatCurrency = useCallback((value: number | string): string => {
    try {
      const c = getActiveCurrency();
      const locale = resolveCurrencyLocale(c, "es-CO");
      return typeof value === "string" ? formatMoney(extractNumericValue(value), c, locale) : formatMoney(value, c, locale);
    } catch { return formatMoney(0, "COP", "es-CO"); }
  }, [getActiveCurrency]);

  const getMetricas = useCallback(() => {
    const fallback = getActiveCurrency();
    const src = realMetricasByCurrency ?? dashboardData?.metricas_por_moneda;
    if (!src || Object.keys(src).length === 0) return { ...createEmptyMetricas(), moneda: fallback };
    const { metricas, moneda } = resolveMetricasByCurrency(src);
    return metricas ? { ...metricas, moneda } : { ...createEmptyMetricas(), moneda };
  }, [realMetricasByCurrency, dashboardData, getActiveCurrency, resolveMetricasByCurrency]);

  // ── Date helpers ──
  const buildDashboardParams = useCallback(() => {
    const selectedPeriod = PERIODO_TO_API[periodoActivo];
    if (selectedPeriod === "custom") {
      if (!dateRange.start_date || !dateRange.end_date) throw new Error("Selecciona un rango de fechas");
      return { start_date: dateRange.start_date, end_date: dateRange.end_date, period: "custom" };
    }
    if (selectedPeriod === "today") return { period: "today" };
    return { period: selectedPeriod };
  }, [periodoActivo, dateRange]);

  const buildInvoiceRange = useCallback((): DateRange => {
    const today = new Date();
    const todayYmd = toLocalYMD(today);
    const selectedPeriod = PERIODO_TO_API[periodoActivo];
    if (selectedPeriod === "custom" && dateRange.start_date && dateRange.end_date) return { start_date: dateRange.start_date, end_date: dateRange.end_date };
    if (selectedPeriod === "last_7_days") { const s = new Date(today); s.setDate(s.getDate() - 6); return { start_date: toLocalYMD(s), end_date: todayYmd }; }
    if (selectedPeriod === "last_30_days") { const s = new Date(today); s.setDate(s.getDate() - 29); return { start_date: toLocalYMD(s), end_date: todayYmd }; }
    if (selectedPeriod === "month") { const s = new Date(today.getFullYear(), today.getMonth(), 1); return { start_date: toLocalYMD(s), end_date: todayYmd }; }
    return { start_date: todayYmd, end_date: todayYmd };
  }, [periodoActivo, dateRange]);

  // ── Data loading ──
  useEffect(() => {
    const today = new Date();
    const last7 = new Date(); last7.setDate(today.getDate() - 7);
    setDateRange({ start_date: toLocalYMD(last7), end_date: toLocalYMD(today) });
  }, []);

  useEffect(() => { if (isAuthenticated && user) loadSedes(); }, [isAuthenticated, user]);

  useEffect(() => {
    const n = normalizeSedeId(activeSedeId);
    if (!n) return;
    setSelectedSede((cur) => { if (!cur || cur === "global") return cur; return normalizeSedeId(cur) === n ? cur : n; });
  }, [activeSedeId]);

  const loadSedes = async () => {
    try {
      setLoadingSedes(true);
      const data = await getSedes(user!.access_token, true);
      const allowedSet = allowedSedeIds.length > 0 ? new Set(allowedSedeIds.map((s) => s.toUpperCase())) : null;
      const filtered = data.filter((sede) => {
        const id = normalizeSedeId(sede.sede_id);
        if (!id) return false;
        if (!isAdminSede) return true;
        return allowedSet ? allowedSet.has(id.toUpperCase()) : false;
      });
      setSedes(filtered);
      if (filtered.length === 0) { setSelectedSede(""); return; }
      if (filtered.length > 1) {
        setSelectedSede((cur) => {
          if (cur === "global") return "global";
          if (cur && filtered.some((s) => s.sede_id === cur)) return cur;
          return "global";
        });
      } else {
        const preferred = normalizeSedeId(activeSedeId) || normalizeSedeId(user?.sede_id) || normalizeSedeId(user?.sede_id_principal) || "";
        const exists = filtered.some((s) => s.sede_id === preferred);
        setSelectedSede(exists ? preferred : filtered[0].sede_id);
      }
    } catch (e) { console.error("Error cargando sedes:", e); }
    finally { setLoadingSedes(false); }
  };

  const loadResumenFinanciero = useCallback(async () => {
    if (!user?.access_token || !isSpecificSede) return;
    try {
      setLoadingResumen(true);
      const range = buildInvoiceRange();
      const data = await getResumenFinanciero(user.access_token, { sede_id: selectedSede, fecha_inicio: range.start_date, fecha_fin: range.end_date });
      setResumenFinanciero(data);
    } catch { setResumenFinanciero(null); }
    finally { setLoadingResumen(false); }
  }, [user?.access_token, selectedSede, isSpecificSede, buildInvoiceRange]);

  const loadCierres = useCallback(async () => {
    if (!isSpecificSede) return;
    try {
      setLoadingCierres(true);
      const range = buildInvoiceRange();
      const data = await cashService.getCierres({ sede_id: selectedSede, fecha_inicio: range.start_date, fecha_fin: range.end_date });
      const list = Array.isArray(data) ? data : data?.cierres ?? [];
      setCierresHistorial(list);
      const todayStr = resolveToday();
      const hoy = list.find((c: any) => c.fecha === todayStr && c.efectivo_contado !== undefined && c.efectivo_contado !== null);
      setCierreHoy(hoy || null);
    } catch { setCierresHistorial([]); setCierreHoy(null); }
    finally { setLoadingCierres(false); }
  }, [selectedSede, isSpecificSede, buildInvoiceRange]);

  const loadFinancialData = useCallback(async () => {
    if (!user?.access_token || !selectedSede) return;
    try {
      setLoading(true);
      setError(null);
      setRealMetricasByCurrency(null);

      const baseParams = buildDashboardParams();
      const sedesIds = selectedSede === "global"
        ? sedes.map((s) => String(s.sede_id ?? "").trim()).filter(Boolean)
        : [selectedSede];

      if (sedesIds.length === 0) { setDashboardData(null); return; }

      if (selectedSede === "global") {
        const responses = await Promise.all(sedesIds.map(async (sid) => {
          try { return await getVentasDashboard(user.access_token, { ...baseParams, sede_id: sid, sede_header_id: sid }); }
          catch { return null; }
        }));
        const valid = responses.filter((r): r is VentasDashboardResponse => Boolean(r?.metricas_por_moneda));
        if (valid.length === 0) throw new Error("No se pudieron cargar métricas.");
        const aggregated: Record<string, VentasMetricas> = {};
        valid.forEach((resp) => {
          Object.entries(resp.metricas_por_moneda || {}).forEach(([currency, met]) => {
            const c = normalizeCurrencyCode(currency);
            if (!aggregated[c]) aggregated[c] = createEmptyMetricas();
            const t = aggregated[c];
            t.ventas_totales += met.ventas_totales || 0;
            t.cantidad_ventas += met.cantidad_ventas || 0;
            t.ventas_servicios += met.ventas_servicios || 0;
            t.ventas_productos += met.ventas_productos || 0;
            SALES_PAYMENT_METHODS.forEach((m) => { t.metodos_pago[m] = (t.metodos_pago[m] || 0) + (met.metodos_pago?.[m] || 0); });
          });
        });
        Object.values(aggregated).forEach((m) => { m.ticket_promedio = m.cantidad_ventas > 0 ? m.ventas_totales / m.cantidad_ventas : 0; });
        setDashboardData({ success: true, descripcion: `Global (${valid.length} sedes)`, range: valid.find((r) => r.range)?.range, usuario: { sede_asignada: "global", nombre_sede: "Global" }, metricas_por_moneda: aggregated });
        try {
          const invoiceRange = buildInvoiceRange();
          const arrays = await Promise.all(sedesIds.map(async (sid) => { try { return await facturaService.getVentasBySedeAllPages(sid, invoiceRange.start_date, invoiceRange.end_date); } catch { return []; } }));
          const all = arrays.flat();
          if (all.length > 0) setRealMetricasByCurrency(buildRealMetricasFromFacturas(all));
        } catch {}
      } else {
        const [ventasData] = await Promise.all([getVentasDashboard(user.access_token, { ...baseParams, sede_id: selectedSede, sede_header_id: selectedSede }).catch(() => null)]);
        if (ventasData) setDashboardData(ventasData);
        try {
          const invoiceRange = buildInvoiceRange();
          const facturas = await facturaService.getVentasBySedeAllPages(selectedSede, invoiceRange.start_date, invoiceRange.end_date);
          setRealMetricasByCurrency(buildRealMetricasFromFacturas(facturas));
        } catch { setRealMetricasByCurrency(null); }
      }
    } catch (err: any) { setError(`Error al cargar datos: ${err?.message || "Error desconocido"}`); setDashboardData(null); }
    finally { setLoading(false); }
  }, [user?.access_token, selectedSede, buildDashboardParams, buildInvoiceRange, sedes]);

  useEffect(() => { loadFinancialData(); }, [loadFinancialData, reloadNonce]);
  useEffect(() => { loadResumenFinanciero(); }, [loadResumenFinanciero, reloadNonce]);
  useEffect(() => { loadCierres(); }, [loadCierres, reloadNonce]);

  useEffect(() => {
    if (isSpecificSede) setRegistrarSedeId(selectedSede);
    else setRegistrarSedeId("");
  }, [selectedSede, isSpecificSede]);

  // ── Handlers ──
  const handleSedeChange = (sedeId: string) => { setSelectedSede(sedeId); if (sedeId !== "global") setActiveSedeId(sedeId); };
  const formatDateDisplay = (s: string) => formatDateDMY(s, "");
  const getPeriodDisplay = () => periodoActivo === "rango" ? `${formatDateDisplay(dateRange.start_date)} - ${formatDateDisplay(dateRange.end_date)}` : PERIODO_LABELS[periodoActivo] || "Período";

  const handleEgresoMayor = async () => {
    if (!egresoMayorForm.concepto || !egresoMayorForm.monto || !egresoMayorForm.categoria) { setRegistrarError("Completa concepto, monto y categoría"); return; }
    try {
      setRegistrarLoading(true); setRegistrarError(null);
      await crearEgresoMayor(user!.access_token, { sede_id: registrarSedeId, fecha: egresoMayorForm.fecha, concepto: egresoMayorForm.concepto, monto: parseFloat(egresoMayorForm.monto.replace(/[^0-9.-]/g, "")), categoria: normalizeCategoria("egreso-mayor", egresoMayorForm.categoria), metodo_pago: normalizeMetodoPago(egresoMayorForm.metodo), referencia_factura: egresoMayorForm.referencia || undefined, observaciones: egresoMayorForm.observaciones || undefined });
      setRegistrarSuccess("Egreso registrado correctamente");
      toast.success("Egreso de caja mayor registrado");
      setEgresoMayorForm({ concepto: "", monto: "", categoria: "", metodo: CASH_PAYMENT_METHOD_OPTIONS[0].value, fecha: resolveToday(), referencia: "", observaciones: "" });
      setReloadNonce((n) => n + 1);
    } catch (e: any) { setRegistrarError(e.message || "Error al registrar egreso"); toast.error(e.message || "Error al registrar"); }
    finally { setRegistrarLoading(false); }
  };

  const handleIngresoMayor = async () => {
    if (!ingresoMayorForm.concepto || !ingresoMayorForm.monto) { setRegistrarError("Completa concepto y monto"); return; }
    try {
      setRegistrarLoading(true); setRegistrarError(null);
      await crearIngresoMayor(user!.access_token, { sede_id: registrarSedeId, fecha: ingresoMayorForm.fecha, concepto: ingresoMayorForm.concepto, monto: parseFloat(ingresoMayorForm.monto.replace(/[^0-9.-]/g, "")), categoria: normalizeCategoria("ingreso-mayor", ingresoMayorForm.tipo || "otro"), metodo_pago: normalizeMetodoPago(ingresoMayorForm.metodo), referencia_factura: ingresoMayorForm.referencia || undefined, observaciones: ingresoMayorForm.observaciones || undefined });
      setRegistrarSuccess("Ingreso registrado correctamente");
      toast.success("Ingreso de caja mayor registrado");
      setIngresoMayorForm({ concepto: "", monto: "", tipo: "", metodo: CASH_PAYMENT_METHOD_OPTIONS[0].value, fecha: resolveToday(), referencia: "", observaciones: "" });
      setReloadNonce((n) => n + 1);
    } catch (e: any) { setRegistrarError(e.message || "Error al registrar ingreso"); toast.error(e.message || "Error al registrar"); }
    finally { setRegistrarLoading(false); }
  };

  const handleTraslado = async () => {
    if (!trasladoForm.monto) { setRegistrarError("Ingresa el monto a trasladar"); return; }
    try {
      setRegistrarLoading(true); setRegistrarError(null);
      await crearTraslado(user!.access_token, { sede_id: registrarSedeId, fecha: trasladoForm.fecha, concepto: trasladoForm.concepto || `Traslado ${transferDir}`, monto: parseFloat(trasladoForm.monto.replace(/[^0-9.-]/g, "")), caja_origen: transferDir === "menor-mayor" ? "caja_menor" : "caja_mayor", caja_destino: transferDir === "menor-mayor" ? "caja_mayor" : "caja_menor", observaciones: trasladoForm.observaciones || undefined });
      setRegistrarSuccess("Traslado registrado correctamente");
      toast.success("Traslado registrado");
      setTrasladoForm({ monto: "", fecha: resolveToday(), concepto: "", observaciones: "" });
      setReloadNonce((n) => n + 1);
    } catch (e: any) { setRegistrarError(e.message || "Error al registrar traslado"); toast.error(e.message || "Error al registrar"); }
    finally { setRegistrarLoading(false); }
  };

  const handleEgresoMenor = async () => {
    if (!egresoMenorForm.concepto || !egresoMenorForm.monto) { setRegistrarError("Completa concepto y monto"); return; }
    try {
      setRegistrarLoading(true); setRegistrarError(null);
      await crearEgresoMenor(user!.access_token, { sede_id: registrarSedeId, fecha: egresoMenorForm.fecha, concepto: egresoMenorForm.concepto, monto: parseFloat(egresoMenorForm.monto.replace(/[^0-9.-]/g, "")), categoria: normalizeCategoria("egreso-menor", egresoMenorForm.categoria), observaciones: egresoMenorForm.observaciones || undefined });
      setRegistrarSuccess("Egreso de caja menor registrado");
      toast.success("Egreso de caja menor registrado");
      setEgresoMenorForm({ concepto: "", monto: "", categoria: "Gasto operativo", fecha: resolveToday(), observaciones: "" });
      setReloadNonce((n) => n + 1);
    } catch (e: any) { setRegistrarError(e.message || "Error al registrar egreso"); toast.error(e.message || "Error al registrar"); }
    finally { setRegistrarLoading(false); }
  };

  const handleDevolucion = async () => {
    if (!devolucionForm.numeroVenta || !devolucionForm.monto) { setRegistrarError("Completa número de venta y monto"); return; }
    try {
      setRegistrarLoading(true); setRegistrarError(null);
      await crearEgresoMenor(user!.access_token, { sede_id: registrarSedeId, fecha: resolveToday(), concepto: `Devolución venta ${devolucionForm.numeroVenta}`, monto: parseFloat(devolucionForm.monto.replace(/[^0-9.-]/g, "")), categoria: normalizeCategoria("egreso-menor", "Devoluciones"), observaciones: `Motivo: ${devolucionForm.motivo}. Sale de: ${devolucionForm.saleDe === "caja_menor" ? "Caja Menor" : "Caja Mayor"}. ${devolucionForm.observaciones}`.trim() });
      setRegistrarSuccess("Devolución registrada");
      toast.success("Devolución registrada correctamente");
      setDevolucionForm({ numeroVenta: "", monto: "", saleDe: "caja_menor", motivo: "Cliente insatisfecha", observaciones: "" });
      setReloadNonce((n) => n + 1);
    } catch (e: any) { setRegistrarError(e.message || "Error al registrar devolución"); toast.error(e.message || "Error al registrar"); }
    finally { setRegistrarLoading(false); }
  };

  const handlePropina = async () => {
    if (!propinaForm.estilista || !propinaForm.monto) { setRegistrarError("Completa estilista y monto"); return; }
    try {
      setRegistrarLoading(true); setRegistrarError(null);
      await crearEgresoMenor(user!.access_token, { sede_id: registrarSedeId, fecha: propinaForm.fecha, concepto: `Propina estilista: ${propinaForm.estilista}`, monto: parseFloat(propinaForm.monto.replace(/[^0-9.-]/g, "")), categoria: normalizeCategoria("egreso-menor", "Propinas"), observaciones: `Método original: ${propinaForm.metodoOriginal === "efectivo" ? "Efectivo" : "Digital — traslado ya registrado"}` });
      setRegistrarSuccess("Propina registrada");
      toast.success("Propina registrada correctamente");
      setPropinaForm({ estilista: "", monto: "", metodoOriginal: "efectivo", fecha: resolveToday() });
      setReloadNonce((n) => n + 1);
    } catch (e: any) { setRegistrarError(e.message || "Error al registrar propina"); toast.error(e.message || "Error al registrar"); }
    finally { setRegistrarLoading(false); }
  };

  const handleNomina = async () => {
    if (!nominaForm.empleado || !nominaForm.monto) { setRegistrarError("Completa nombre del empleado y monto"); return; }
    try {
      setRegistrarLoading(true); setRegistrarError(null);
      const montoNum = parseFloat(nominaForm.monto.replace(/[^0-9.-]/g, ""));
      const obs = `Período: ${nominaForm.periodo}. ${nominaForm.observaciones}`.trim();
      if (nominaForm.saleDe === "caja_mayor") {
        await crearEgresoMayor(user!.access_token, { sede_id: registrarSedeId, fecha: resolveToday(), concepto: `Nómina: ${nominaForm.empleado}`, monto: montoNum, categoria: normalizeCategoria("egreso-mayor", "Nómina admin"), metodo_pago: normalizeMetodoPago("transferencia"), observaciones: obs });
      } else {
        await crearEgresoMenor(user!.access_token, { sede_id: registrarSedeId, fecha: resolveToday(), concepto: `Nómina: ${nominaForm.empleado}`, monto: montoNum, categoria: normalizeCategoria("egreso-menor", "Nómina admin"), observaciones: obs });
      }
      setRegistrarSuccess("Nómina registrada");
      toast.success("Nómina registrada correctamente");
      setNominaForm({ empleado: "", monto: "", saleDe: "caja_mayor", periodo: "Primera quincena", observaciones: "" });
      setReloadNonce((n) => n + 1);
    } catch (e: any) { setRegistrarError(e.message || "Error al registrar nómina"); toast.error(e.message || "Error al registrar"); }
    finally { setRegistrarLoading(false); }
  };

  const handleGuardarCierre = async () => {
    if (!cierreContado.trim()) { setCierreError("Ingresa el monto contado"); return; }
    try {
      setCierreLoading(true); setCierreError(null);
      const metricas = getMetricas();
      await cashService.cierreCaja({ sede_id: selectedSede, fecha: resolveToday(), efectivo_esperado: metricas.metodos_pago?.efectivo ?? 0, efectivo_contado: parseFloat(cierreContado.replace(/[^0-9.-]/g, "")), observaciones: cierreObservaciones || undefined });
      setCierreSuccess("Cierre registrado correctamente");
      toast.success("Cierre de caja registrado");
      setCierreContado(""); setCierreObservaciones("");
      setReloadNonce((n) => n + 1);
    } catch (e: any) { setCierreError(e.message || "Error al guardar cierre"); toast.error(e.message || "Error al guardar cierre"); }
    finally { setCierreLoading(false); }
  };

  // ── Mini-components ──
  const KPICard = ({ label, value, sub, change, featured, valueClassName }: { label: string; value: string; sub?: string; change?: string; featured?: boolean; valueClassName?: string }) => (
    <div className={`bg-white rounded-[10px] px-4 py-3.5 ${featured ? "border-2 border-slate-800" : "border border-slate-200"}`}>
      <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-[0.4px] mb-1.5">{label}</div>
      <div className={`text-[22px] font-bold tracking-tight ${valueClassName || "text-slate-800"}`}>{value}</div>
      {change && change !== "0%" && <div className="text-[10px] font-semibold mt-0.5 text-slate-800">↑ {change} vs mes anterior</div>}
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );

  const RowItem = ({ name, value, sub, barPct }: { name: React.ReactNode; value: React.ReactNode; sub?: string; barPct?: number }) => (
    <div className="flex justify-between items-center py-2 text-xs border-b border-slate-100 last:border-b-0">
      <span className="font-medium text-slate-700 flex-shrink-0 flex items-center">{name}</span>
      {barPct !== undefined && <div className="flex-1 mx-3 h-1 bg-slate-100 rounded min-w-[40px]"><div className="h-full bg-slate-800 rounded" style={{ width: `${Math.max(2, barPct)}%` }} /></div>}
      <div className="text-right">
        <span className="font-bold text-[13px] text-slate-800">{value}</span>
        {sub && <div className="text-[10px] text-slate-400 leading-none mt-0.5">{sub}</div>}
      </div>
    </div>
  );

  const Card = ({ title, titleSub, children, scrollable, action }: { title: string; titleSub?: string; children: React.ReactNode; scrollable?: boolean; action?: React.ReactNode }) => (
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

  const FiltroSeccion = ({ valor, onChange, rango, onRangoChange }: { valor: LocalPeriodo; onChange: (v: LocalPeriodo) => void; rango?: { from: Date; to: Date } | null; onRangoChange?: (r: { from: Date; to: Date }) => void }) => (
    <div className="flex items-center gap-2 flex-wrap">
      <button onClick={() => onChange('mes_actual')} className={`px-3.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${valor === 'mes_actual' ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>Mes actual</button>
      <button onClick={() => onChange('rango')} className={`px-3.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${valor === 'rango' ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>Rango</button>
      {valor === 'rango' && onRangoChange && (
        <div className="flex items-center gap-1.5">
          <DatePicker value={rango?.from ? toLocalYMD(rango.from) : ''} onChange={(v) => { const d = new Date(v + 'T12:00:00'); onRangoChange({ from: d, to: rango?.to ?? d }); }} />
          <span className="text-[11px] text-slate-400">–</span>
          <DatePicker value={rango?.to ? toLocalYMD(rango.to) : ''} onChange={(v) => { const d = new Date(v + 'T12:00:00'); onRangoChange({ from: rango?.from ?? d, to: d }); }} />
        </div>
      )}
    </div>
  );

    // ── Derived values ───────────────────────────────────────
  const metricas = getMetricas();
  const saldoCajaMenorReal =
  (metricas.metodos_pago?.efectivo ?? 0)
  + (resumenFinanciero?.traslados.mayor_a_menor ?? 0)
  - (resumenFinanciero?.pl.egresos_menor_total ?? 0)
  - (resumenFinanciero?.traslados.menor_a_mayor ?? 0);

  const saldoConsolidadoReal =
  saldoCajaMenorReal + (resumenFinanciero?.cajas.caja_mayor ?? 0);



  // ── Guards ──
  if (!isAuthenticated) {
    return (
      <div className="flex flex-col h-screen items-center justify-center">
        <h2 className="text-2xl font-bold">Acceso no autorizado</h2>
        <p className="mt-2 text-gray-600">Por favor inicia sesión.</p>
      </div>
    );
  }

  if (loadingSedes) {
    return (
      <div className="flex flex-col h-screen items-center justify-center">
        <div className="w-12 h-12 border-4 border-gray-200 border-t-gray-800 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-600">Cargando información…</p>
      </div>
    );
  }

  if (!selectedSede) {
    return (
      <div className="flex flex-col h-screen items-center justify-center text-center">
        <h2 className="text-2xl font-bold">Sede no disponible</h2>
        <p className="mt-2 text-gray-600">No se pudo determinar tu sede asignada.</p>
        <button onClick={() => loadSedes()} className="mt-4 flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
          <RefreshCw className="w-4 h-4" /> Reintentar
        </button>
      </div>
    );
  }

  // ── Render ──
  return (
    <div className="flex flex-col h-screen bg-white">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-white">
        {/* Sub-navigation — same pattern as Productos */}
        <div className="border-b border-gray-200 bg-white px-4 md:px-8 pt-1 overflow-x-auto scrollbar-hide">
          <nav className="flex gap-0">
            {([
              { id: "estado-financiero" as const, label: "Estado Financiero" },
              { id: "cierre-caja" as const, label: "Cierre de Caja" },
            ]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? "border-gray-900 text-gray-900"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="w-full px-4 md:px-8 py-5 pb-10">

          {/* Header */}
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">Finanzas</h1>
              <div className="text-xs text-slate-500 mt-0.5">Estado financiero y cierre de caja · {user?.pais || "Colombia"} · {monedaUsuario}</div>
            </div>
            <div className="flex gap-1.5 items-center">
              {sedes.length > 1 && (
                <SedeDropdown
                  value={selectedSede}
                  onChange={handleSedeChange}
                  options={sedes.map((s) => ({ sede_id: s.sede_id, nombre: formatSedeNombre(s.nombre, s.sede_id) }))}
                  showAll
                  allValue="global"
                  allLabel="Todas las sedes"
                  size="sm"
                  align="right"
                />
              )}
              <button onClick={() => setReloadNonce((n) => n + 1)} className="px-3.5 py-[7px] bg-white border border-slate-200 rounded-lg text-[11px] text-slate-500 font-medium flex items-center gap-1 hover:bg-slate-50">
                <RefreshCw className="w-3 h-3" /> Actualizar
              </button>
            </div>
          </div>


          {/* Loading / Error */}
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin mx-auto mb-4" />
                <p className="text-slate-500 text-sm">Cargando datos financieros…</p>
              </div>
            </div>
          ) : error ? (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
              <p className="text-slate-500 mb-4">{error}</p>
              <button onClick={() => { setReloadNonce((n) => n + 1); }} className="flex items-center gap-2 mx-auto px-4 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50">
                <RefreshCw className="w-4 h-4" /> Reintentar
              </button>
            </div>
          ) : (
            <>
              {/* ═══ ESTADO FINANCIERO TAB ═══ */}
              {activeTab === "estado-financiero" && (
                <>
                  {/* Financial sub-tabs */}
                  <div className="border-b border-gray-200 mb-4">
                    <nav className="flex gap-0">
                      {([
                        { id: "pl" as const, label: "Estado de Resultados" },
                        { id: "cajas" as const, label: "Cajas" },
                        { id: "traslados" as const, label: "Traslados" },
                        { id: "registrar" as const, label: "Registrar movimientos" },
                      ]).map((t) => (
                        <button key={t.id} onClick={() => setFinancialTab(t.id)} className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${financialTab === t.id ? "border-gray-900 text-gray-900" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"}`}>{t.label}</button>
                      ))}
                    </nav>
                  </div>

                  {/* ── P&L ── */}
                  {financialTab === "pl" && (
            <>
              <div className="p-3.5 bg-slate-50 border border-slate-100 rounded-lg text-[11px] text-slate-500 leading-relaxed mb-4">
                <span className="font-semibold text-slate-700">Estado de Resultados (P&L)</span> — Rentabilidad real de la operación. Los traslados entre cajas NO aparecen aquí. Comisiones, arriendo y nómina SÍ aparecen aunque se paguen desde caja mayor.
              </div>
              <div className="mb-4">
                <FiltroSeccion valor={filtroResultados} onChange={setFiltroResultados} rango={rangoResultados} onRangoChange={setRangoResultados} />
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
                  <RowItem name={<>Arriendo</>}value={loadingResumen ? "…" : egresoMayorCat("arriendo") > 0 ? <span className="text-red-600">-{formatCurrency(egresoMayorCat("arriendo"))}</span>: <span className="text-slate-400">—</span>} />
                  <RowItem name={<>Nómina administrativa</>}value={loadingResumen ? "…" : egresoMayorCat("nomina") > 0 ? <span className="text-red-600">-{formatCurrency(egresoMayorCat("nomina"))}</span> : <span className="text-slate-400">—</span>} />
                  <RowItem name={<>Servicios públicos</>} value={loadingResumen ? "…" : egresoMayorCat("servicios_publicos") > 0 ? <span className="text-red-600">-{formatCurrency(egresoMayorCat("servicios_publicos"))}</span> : <span className="text-slate-400">—</span>} />
                  <RowItem name={<>Impuestos</>} value={loadingResumen ? "…" : egresoMayorCat("impuestos") > 0 ? <span className="text-red-600">-{formatCurrency(egresoMayorCat("impuestos"))}</span> : <span className="text-slate-400">—</span>} />
                  <RowItem name={<>Otros gastos fijos <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-slate-100 text-slate-500 border border-slate-200 ml-1.5">Manual · Caja Mayor</span></>} value={<span className="text-slate-400">—</span>} />
                  <div className="text-[10px] font-bold uppercase tracking-[0.5px] text-slate-400 mt-3 mb-1">Gastos variables</div>
                  <RowItem name={<>Gastos operativos caja menor</>} value={loadingResumen ? "…" : resumenFinanciero ? <span className="text-red-600">-{formatCurrency(resumenFinanciero.pl.egresos_menor_total ?? 0)}</span> : <span className="text-slate-400">—</span>} />
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
                  <div className="flex justify-between items-center mb-4">
                    <div className="text-[13px] font-bold text-slate-800">Historial de cierres de caja</div>
                    <FiltroSeccion valor={filtroCierres} onChange={setFiltroCierres} rango={rangoCierres} onRangoChange={setRangoCierres} />
                  </div>
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
                                          sede_id: c.sede_id || selectedSede,
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

                  {/* ── TRASLADOS ── */}
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
              <Card title="Registro de traslados" action={<div className="flex items-center gap-2"><FiltroSeccion valor={filtroTraslados} onChange={setFiltroTraslados} rango={rangoTraslados} onRangoChange={setRangoTraslados} /><button onClick={() => { setFinancialTab("registrar"); setRegistrarSubTab("traslado"); }} className="px-3 py-1.5 bg-slate-800 text-white rounded-md text-[11px] font-semibold hover:bg-slate-700">+ Registrar traslado</button></div>}>
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

                  {/* ── REGISTRAR ── */}
                  {financialTab === "registrar" && (
                    <>
                      <div className="text-[12px] text-slate-500 leading-relaxed mb-4">
                        Aquí el administrador registra los movimientos que <span className="font-semibold text-slate-700">no pasan por la caja registradora</span>.
                      </div>
                      {!isSpecificSede && sedes.length > 0 && (
                        <div className="mb-4 flex flex-col gap-1">
                          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Sede para este movimiento</label>
                          <select value={registrarSedeId} onChange={(e) => setRegistrarSedeId(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800 max-w-xs">
                            <option value="">Seleccionar sede...</option>
                            {sedes.map((s) => <option key={s.sede_id} value={s.sede_id}>{s.nombre || s.sede_id}</option>)}
                          </select>
                        </div>
                      )}
                      {registrarError && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-700">{registrarError}</div>}
                      {registrarSuccess && <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg text-[11px] text-green-700">{registrarSuccess}</div>}
                      {registrarSedeId && (
                        <div className="flex gap-1.5 mb-4 flex-wrap">
                          {([
                            { id: "egreso-mayor" as const, label: "Egreso Caja Mayor" },
                            { id: "ingreso-mayor" as const, label: "Ingreso Caja Mayor" },
                            { id: "traslado" as const, label: "Traslado entre cajas" },
                            { id: "egreso-menor" as const, label: "Egreso Caja Menor" },
                            { id: "devolucion" as const, label: "Devolución a cliente" },
                            { id: "propina" as const, label: "Propina estilista" },
                            { id: "nomina" as const, label: "Nómina administrativa" },
                          ]).map((st) => (
                            <button key={st.id} onClick={() => setRegistrarSubTab(st.id)} className={`px-4 py-2 border rounded-lg text-[11px] font-medium transition-colors ${registrarSubTab === st.id ? "bg-slate-800 text-white border-slate-800" : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{st.label}</button>
                          ))}
                        </div>
                      )}

                      {registrarSedeId && registrarSubTab === "egreso-mayor" && (
                        <div className="bg-white border border-slate-200 rounded-[10px] p-5 mb-4">
                          <div className="text-[14px] font-bold text-slate-800 mb-1">Registrar egreso — Caja Mayor</div>
                          <div className="text-[11px] text-slate-500 mb-4">Para gastos desde la cuenta principal.</div>
                          <div className="grid grid-cols-2 gap-2.5">
                            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Concepto</label><input value={egresoMayorForm.concepto} onChange={(e) => setEgresoMayorForm((f) => ({ ...f, concepto: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="Ej: Arriendo local" /></div>
                            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Monto</label><input value={egresoMayorForm.monto} onChange={(e) => setEgresoMayorForm((f) => ({ ...f, monto: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="$0" /></div>
                            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Categoría</label><select value={egresoMayorForm.categoria} onChange={(e) => setEgresoMayorForm((f) => ({ ...f, categoria: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800"><option value="">Seleccionar...</option><option>Arriendo</option><option>Nómina administrativa</option><option>Comisiones estilistas</option><option>Servicios públicos</option><option>Impuestos</option><option>Insumos / Proveedores</option><option>Mantenimiento</option><option>Marketing y publicidad</option><option>Software y herramientas</option><option>Otro gasto fijo</option><option>Otro gasto operativo</option></select></div>
                            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Método de pago</label><select value={egresoMayorForm.metodo} onChange={(e) => setEgresoMayorForm((f) => ({ ...f, metodo: e.target.value as typeof f.metodo }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800">{CASH_PAYMENT_METHOD_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
                            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Fecha</label><DatePicker value={egresoMayorForm.fecha} onChange={(v) => setEgresoMayorForm((f) => ({ ...f, fecha: v }))} /></div>
                            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Referencia</label><input value={egresoMayorForm.referencia} onChange={(e) => setEgresoMayorForm((f) => ({ ...f, referencia: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="Opcional" /></div>
                            <div className="flex flex-col gap-1 col-span-2"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Observaciones</label><textarea value={egresoMayorForm.observaciones} onChange={(e) => setEgresoMayorForm((f) => ({ ...f, observaciones: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[12px] resize-y min-h-[56px] focus:outline-none focus:border-slate-800" placeholder="Detalles adicionales..." /></div>
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
                          <div className="text-[11px] text-slate-500 mb-4">Ingresos que no vienen de ventas a clientes.</div>
                          <div className="grid grid-cols-2 gap-2.5">
                            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Concepto</label><input value={ingresoMayorForm.concepto} onChange={(e) => setIngresoMayorForm((f) => ({ ...f, concepto: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="Ej: Devolución proveedor" /></div>
                            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Monto</label><input value={ingresoMayorForm.monto} onChange={(e) => setIngresoMayorForm((f) => ({ ...f, monto: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="$0" /></div>
                            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Tipo</label><select value={ingresoMayorForm.tipo} onChange={(e) => setIngresoMayorForm((f) => ({ ...f, tipo: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800"><option value="">Seleccionar...</option><option>Devolución de proveedor</option><option>Intereses bancarios</option><option>Ingreso extraordinario</option><option>Ajuste contable</option><option>Otro</option></select></div>
                            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Método</label><select value={ingresoMayorForm.metodo} onChange={(e) => setIngresoMayorForm((f) => ({ ...f, metodo: e.target.value as typeof f.metodo }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800">{CASH_PAYMENT_METHOD_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
                            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Fecha</label><DatePicker value={ingresoMayorForm.fecha} onChange={(v) => setIngresoMayorForm((f) => ({ ...f, fecha: v }))} /></div>
                            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Referencia</label><input value={ingresoMayorForm.referencia} onChange={(e) => setIngresoMayorForm((f) => ({ ...f, referencia: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="Opcional" /></div>
                            <div className="flex flex-col gap-1 col-span-2"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Observaciones</label><textarea value={ingresoMayorForm.observaciones} onChange={(e) => setIngresoMayorForm((f) => ({ ...f, observaciones: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[12px] resize-y min-h-[56px] focus:outline-none focus:border-slate-800" placeholder="Detalles..." /></div>
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
                          <div className="text-[11px] text-slate-500 mb-4">Mover dinero entre Caja Menor y Caja Mayor. No afecta el P&L.</div>
                          <div className="flex items-center gap-2.5 p-3 bg-slate-50 border border-slate-100 rounded-lg mb-4">
                            <div className="flex-1 text-center bg-white border border-slate-200 rounded-md px-3 py-2.5"><div className="text-[9px] text-slate-400 font-semibold uppercase tracking-[0.3px]">Origen</div><div className="text-[14px] font-bold text-slate-800 mt-0.5">{transferDir === "menor-mayor" ? "Caja Menor" : "Caja Mayor"}</div></div>
                            <div className="flex flex-col items-center gap-1"><span className="text-slate-300 text-xl">→</span><button onClick={() => setTransferDir((d) => d === "menor-mayor" ? "mayor-menor" : "menor-mayor")} className="text-[9px] text-slate-500 underline hover:text-slate-700">Invertir</button></div>
                            <div className="flex-1 text-center bg-white border border-slate-200 rounded-md px-3 py-2.5"><div className="text-[9px] text-slate-400 font-semibold uppercase tracking-[0.3px]">Destino</div><div className="text-[14px] font-bold text-slate-800 mt-0.5">{transferDir === "menor-mayor" ? "Caja Mayor" : "Caja Menor"}</div></div>
                          </div>
                          <div className="grid grid-cols-2 gap-2.5">
                            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Monto</label><input value={trasladoForm.monto} onChange={(e) => setTrasladoForm((f) => ({ ...f, monto: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="$0" /></div>
                            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Fecha</label><DatePicker value={trasladoForm.fecha} onChange={(v) => setTrasladoForm((f) => ({ ...f, fecha: v }))} /></div>
                            <div className="flex flex-col gap-1 col-span-2"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Concepto</label><input value={trasladoForm.concepto} onChange={(e) => setTrasladoForm((f) => ({ ...f, concepto: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="Ej: Entrega excedente diario" /></div>
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
                          <div className="text-[11px] text-slate-500 mb-4">Gastos del día a día: almuerzos, domicilios, papelería.</div>
                          <div className="grid grid-cols-2 gap-2.5">
                            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Concepto</label><input value={egresoMenorForm.concepto} onChange={(e) => setEgresoMenorForm((f) => ({ ...f, concepto: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="Ej: Almuerzo" /></div>
                            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Monto</label><input value={egresoMenorForm.monto} onChange={(e) => setEgresoMenorForm((f) => ({ ...f, monto: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="$0" /></div>
                            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Categoría</label><select value={egresoMenorForm.categoria} onChange={(e) => setEgresoMenorForm((f) => ({ ...f, categoria: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800"><option>Gasto operativo</option><option>Propina</option><option>Alimentación</option><option>Domicilio / mensajería</option><option>Papelería / insumos menores</option><option>Otro</option></select></div>
                            <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Fecha</label><DatePicker value={egresoMenorForm.fecha} onChange={(v) => setEgresoMenorForm((f) => ({ ...f, fecha: v }))} /></div>
                            <div className="flex flex-col gap-1 col-span-2"><label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Observaciones</label><textarea value={egresoMenorForm.observaciones} onChange={(e) => setEgresoMenorForm((f) => ({ ...f, observaciones: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[12px] resize-y min-h-[56px] focus:outline-none focus:border-slate-800" placeholder="Opcional" /></div>
                          </div>
                          <div className="flex gap-2 justify-end mt-4">
                            <button onClick={() => setEgresoMenorForm({ concepto: "", monto: "", categoria: "Gasto operativo", fecha: resolveToday(), observaciones: "" })} className="px-4 py-2 border border-slate-200 rounded-md text-[12px] font-semibold text-slate-500 hover:bg-slate-50">Cancelar</button>
                            <button onClick={handleEgresoMenor} disabled={registrarLoading} className="px-4 py-2 bg-slate-800 text-white rounded-md text-[12px] font-semibold hover:bg-slate-700 disabled:opacity-60">{registrarLoading ? "Registrando..." : "Registrar egreso"}</button>
                          </div>
                        </div>
                      )}

                      {/* ── DEVOLUCIÓN A CLIENTE ── */}
                      {registrarSedeId && registrarSubTab === "devolucion" && (
                        <div className="bg-white border border-slate-200 rounded-md p-6 mb-4 max-w-[740px] shadow-sm">
                          <div className="text-[15px] font-semibold text-slate-800 mb-1">Registrar devolución a cliente</div>
                          <div className="text-[12.5px] text-slate-400 mb-5">Reduce los ingresos del P&L. No es un gasto operativo. Debe vincularse a la venta original.</div>
                          <div className="grid grid-cols-2 gap-3.5 mb-3.5">
                            <div className="flex flex-col gap-1.5"><label className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.06em]">Número de venta</label><input value={devolucionForm.numeroVenta} onChange={(e) => setDevolucionForm((f) => ({ ...f, numeroVenta: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="Ej: SD-26470" /></div>
                            <div className="flex flex-col gap-1.5"><label className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.06em]">Monto a devolver</label><input value={devolucionForm.monto} onChange={(e) => setDevolucionForm((f) => ({ ...f, monto: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="$ 0" /></div>
                          </div>
                          <div className="grid grid-cols-2 gap-3.5 mb-3.5">
                            <div className="flex flex-col gap-1.5">
                              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.06em]">Sale de</label>
                              <select value={devolucionForm.saleDe} onChange={(e) => setDevolucionForm((f) => ({ ...f, saleDe: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800">
                                <option value="caja_menor">Caja Menor (efectivo)</option>
                                <option value="caja_mayor">Caja Mayor (transferencia)</option>
                              </select>
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.06em]">Motivo</label>
                              <select value={devolucionForm.motivo} onChange={(e) => setDevolucionForm((f) => ({ ...f, motivo: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800">
                                <option>Cliente insatisfecha</option>
                                <option>Servicio no realizado</option>
                                <option>Error de cobro</option>
                                <option>Otro</option>
                              </select>
                            </div>
                          </div>
                          <div className="mb-3.5">
                            <div className="flex flex-col gap-1.5"><label className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.06em]">Observaciones</label><textarea value={devolucionForm.observaciones} onChange={(e) => setDevolucionForm((f) => ({ ...f, observaciones: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[12px] resize-y min-h-[56px] focus:outline-none focus:border-slate-800 w-full" placeholder="Describe el motivo con detalle" /></div>
                          </div>
                          <div className="flex gap-2.5 justify-end pt-4 border-t border-slate-200 mt-1.5">
                            <button onClick={() => setDevolucionForm({ numeroVenta: "", monto: "", saleDe: "caja_menor", motivo: "Cliente insatisfecha", observaciones: "" })} className="px-4 py-2 bg-white border border-slate-200 rounded-md text-[12px] font-medium text-slate-800 hover:bg-slate-50">Cancelar</button>
                            <button onClick={handleDevolucion} disabled={registrarLoading} className="px-4 py-2 bg-slate-800 text-white rounded-md text-[12px] font-semibold hover:bg-slate-700 disabled:opacity-60">{registrarLoading ? "Registrando..." : "Registrar devolución"}</button>
                          </div>
                        </div>
                      )}

                      {/* ── PROPINA ESTILISTA ── */}
                      {registrarSedeId && registrarSubTab === "propina" && (
                        <div className="bg-white border border-slate-200 rounded-md p-6 mb-4 max-w-[740px] shadow-sm">
                          <div className="text-[15px] font-semibold text-slate-800 mb-1">Registrar propina — estilista</div>
                          <div className="text-[12.5px] text-slate-400 mb-5">Pass-through: no afecta el P&L. Si la propina llegó digital (tarjeta/transferencia), primero se hace un traslado Caja Mayor → Caja Menor, luego este egreso.</div>
                          <div className="bg-amber-50 border border-amber-200 rounded-md px-3.5 py-2.5 mb-4 text-[12.5px] text-amber-600">
                            <strong className="text-slate-800">⚠ Importante:</strong> Si la propina fue pagada por tarjeta o transferencia, primero registra el traslado Caja Mayor → Caja Menor antes de continuar.
                          </div>
                          <div className="grid grid-cols-2 gap-3.5 mb-3.5">
                            <div className="flex flex-col gap-1.5"><label className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.06em]">Estilista</label><input value={propinaForm.estilista} onChange={(e) => setPropinaForm((f) => ({ ...f, estilista: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="Nombre del estilista" /></div>
                            <div className="flex flex-col gap-1.5"><label className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.06em]">Monto</label><input value={propinaForm.monto} onChange={(e) => setPropinaForm((f) => ({ ...f, monto: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="$ 0" /></div>
                          </div>
                          <div className="grid grid-cols-2 gap-3.5 mb-3.5">
                            <div className="flex flex-col gap-1.5">
                              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.06em]">Método original de la propina</label>
                              <select value={propinaForm.metodoOriginal} onChange={(e) => setPropinaForm((f) => ({ ...f, metodoOriginal: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800">
                                <option value="efectivo">Efectivo (ya estaba en Caja Menor)</option>
                                <option value="digital">Digital — traslado ya registrado</option>
                              </select>
                            </div>
                            <div className="flex flex-col gap-1.5"><label className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.06em]">Fecha</label><DatePicker value={propinaForm.fecha} onChange={(v) => setPropinaForm((f) => ({ ...f, fecha: v }))} /></div>
                          </div>
                          <div className="flex gap-2.5 justify-end pt-4 border-t border-slate-200 mt-1.5">
                            <button onClick={() => setPropinaForm({ estilista: "", monto: "", metodoOriginal: "efectivo", fecha: resolveToday() })} className="px-4 py-2 bg-white border border-slate-200 rounded-md text-[12px] font-medium text-slate-800 hover:bg-slate-50">Cancelar</button>
                            <button onClick={handlePropina} disabled={registrarLoading} className="px-4 py-2 bg-slate-800 text-white rounded-md text-[12px] font-semibold hover:bg-slate-700 disabled:opacity-60">{registrarLoading ? "Registrando..." : "Registrar propina"}</button>
                          </div>
                        </div>
                      )}

                      {/* ── NÓMINA ADMINISTRATIVA ── */}
                      {registrarSedeId && registrarSubTab === "nomina" && (
                        <div className="bg-white border border-slate-200 rounded-md p-6 mb-4 max-w-[740px] shadow-sm">
                          <div className="text-[15px] font-semibold text-slate-800 mb-1">Registrar nómina administrativa</div>
                          <div className="text-[12.5px] text-slate-400 mb-5">Personal administrativo: recepción, coordinadores, limpieza. Aparece en el P&L como gasto fijo.</div>
                          <div className="grid grid-cols-2 gap-3.5 mb-3.5">
                            <div className="flex flex-col gap-1.5"><label className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.06em]">Nombre del empleado</label><input value={nominaForm.empleado} onChange={(e) => setNominaForm((f) => ({ ...f, empleado: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="Ej: María González – Recepción" /></div>
                            <div className="flex flex-col gap-1.5"><label className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.06em]">Monto</label><input value={nominaForm.monto} onChange={(e) => setNominaForm((f) => ({ ...f, monto: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="$ 0" /></div>
                          </div>
                          <div className="grid grid-cols-2 gap-3.5 mb-3.5">
                            <div className="flex flex-col gap-1.5">
                              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.06em]">Sale de</label>
                              <select value={nominaForm.saleDe} onChange={(e) => setNominaForm((f) => ({ ...f, saleDe: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800">
                                <option value="caja_mayor">Caja Mayor (transferencia)</option>
                                <option value="caja_menor">Caja Menor (efectivo)</option>
                              </select>
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.06em]">Período que cubre</label>
                              <select value={nominaForm.periodo} onChange={(e) => setNominaForm((f) => ({ ...f, periodo: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:border-slate-800">
                                <option>Primera quincena</option>
                                <option>Segunda quincena</option>
                                <option>Mes completo</option>
                                <option>Otro</option>
                              </select>
                            </div>
                          </div>
                          <div className="mb-3.5">
                            <div className="flex flex-col gap-1.5"><label className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.06em]">Observaciones</label><textarea value={nominaForm.observaciones} onChange={(e) => setNominaForm((f) => ({ ...f, observaciones: e.target.value }))} className="px-3 py-2 border border-slate-200 rounded-md text-[12px] resize-y min-h-[56px] focus:outline-none focus:border-slate-800 w-full" placeholder="Opcional" /></div>
                          </div>
                          <div className="flex gap-2.5 justify-end pt-4 border-t border-slate-200 mt-1.5">
                            <button onClick={() => setNominaForm({ empleado: "", monto: "", saleDe: "caja_mayor", periodo: "Primera quincena", observaciones: "" })} className="px-4 py-2 bg-white border border-slate-200 rounded-md text-[12px] font-medium text-slate-800 hover:bg-slate-50">Cancelar</button>
                            <button onClick={handleNomina} disabled={registrarLoading} className="px-4 py-2 bg-slate-800 text-white rounded-md text-[12px] font-semibold hover:bg-slate-700 disabled:opacity-60">{registrarLoading ? "Registrando..." : "Registrar nómina"}</button>
                          </div>
                        </div>
                      )}

                      {/* Historial movimientos */}
                      {registrarSedeId && (
                        <Card title="Últimos movimientos" titleSub="historial" scrollable action={<FiltroSeccion valor={filtroMovimientos} onChange={setFiltroMovimientos} rango={rangoMovimientos} onRangoChange={setRangoMovimientos} />}>
                          {movimientosManuales.length === 0 ? (
                            <div className="py-8 text-center text-[11px] text-slate-400">No hay movimientos registrados aún.</div>
                          ) : (
                            <table className="w-full border-collapse">
                              <thead><tr>{["Fecha", "Caja", "Tipo", "Concepto", "Categoría", "Monto"].map((h, i) => <th key={i} className={`text-left text-[9px] font-bold uppercase tracking-[0.5px] text-slate-400 pb-2 border-b border-slate-200 ${i === 5 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
                              <tbody>{movimientosManuales.map((m) => (
                                <tr key={m.id} className="border-b border-slate-100 last:border-0">
                                  <td className="py-2.5 text-[11px] text-slate-600">{m.fecha}</td>
                                  <td className="py-2.5 text-[11px] text-slate-600">{m.caja}</td>
                                  <td className="py-2.5"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${m.tipo === "Egreso" ? "bg-red-50 text-red-600" : m.tipo === "Ingreso" ? "bg-green-50 text-green-600" : "bg-blue-50 text-blue-600"}`}>{m.tipo}</span></td>
                                  <td className="py-2.5 text-[11px] text-slate-700 font-medium max-w-[160px] truncate">{m.concepto}</td>
                                  <td className="py-2.5 text-[11px] text-slate-500">{m.categoria}</td>
                                  <td className="py-2.5 text-[11px] text-right font-semibold text-slate-800">{formatMoney(m.monto, monedaUsuario)}</td>
                                </tr>
                              ))}</tbody>
                            </table>
                          )}
                        </Card>
                      )}
                    </>
                  )}
                </>
              )}

              {/* ═══ CIERRE DE CAJA TAB ═══ */}
              {activeTab === "cierre-caja" && (
                <>
                  {!isSpecificSede ? (
                    <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                      <p className="text-slate-500 mb-2">Selecciona una sede específica para realizar el cierre de caja.</p>
                    </div>
                  ) : loadingCierres ? (
                    <div className="py-12 text-center text-[11px] text-slate-400">Cargando datos de cierre…</div>
                  ) : cierreHoy ? (
                    <div className="max-w-[640px]">
                      <div className="text-[17px] font-semibold text-slate-800 mb-1">Cierre de caja — {cierreHoy.fecha}</div>
                      <div className="text-[13px] text-slate-400 mb-5">{cierreHoy.sede_nombre || sedes.find((s) => s.sede_id === selectedSede)?.nombre || "Sede"} · Cierre registrado</div>
                      <div className="p-4 bg-green-50 border border-green-200 rounded-lg mb-5">
                        <div className="text-[13px] font-semibold text-green-700 mb-2">Cierre del día completado</div>
                        <div className="grid grid-cols-2 gap-3 text-[12px]">
                          <div><span className="text-slate-500">Esperado:</span> <span className="font-semibold text-slate-800">{formatCurrency(cierreHoy.efectivo_esperado ?? 0)}</span></div>
                          <div><span className="text-slate-500">Contado:</span> <span className="font-semibold text-slate-800">{formatCurrency(cierreHoy.efectivo_contado ?? 0)}</span></div>
                          <div><span className="text-slate-500">Diferencia:</span> <span className={`font-semibold ${(cierreHoy.diferencia ?? 0) === 0 ? "text-slate-400" : (cierreHoy.diferencia ?? 0) > 0 ? "text-green-600" : "text-red-600"}`}>{(cierreHoy.diferencia ?? 0) > 0 ? "+" : ""}{formatCurrency(cierreHoy.diferencia ?? 0)}</span></div>
                          <div><span className="text-slate-500">Estado:</span> <span className="font-semibold text-slate-800">{cierreHoy.estado ?? "cerrado"}</span></div>
                        </div>
                        {cierreHoy.observaciones && <div className="mt-2 text-[11px] text-slate-500">Obs: {cierreHoy.observaciones}</div>}
                      </div>
                    </div>
                  ) : (
                    <div className="max-w-[640px]">
                      <div className="text-[17px] font-semibold text-slate-800 mb-1">Cierre de caja — {resolveToday()}</div>
                      <div className="text-[13px] text-slate-400 mb-5">{sedes.find((s) => s.sede_id === selectedSede)?.nombre || "Sede"} · Cuenta lo que hay en el cajón.</div>
                      {cierreError && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-700">{cierreError}</div>}
                      {cierreSuccess && <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg text-[11px] text-green-700">{cierreSuccess}</div>}
                      <div className="grid grid-cols-2 gap-3 mb-5">
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                          <div className="text-[10px] font-bold uppercase tracking-[0.5px] text-slate-400 mb-1">El sistema esperaba</div>
                          <div className="text-[18px] font-bold text-slate-800">{formatCurrency(metricas.metodos_pago?.efectivo ?? 0)}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">Cobros efectivo</div>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                          <div className="text-[10px] font-bold uppercase tracking-[0.5px] text-slate-400 mb-1">Desglose</div>
                          <div className="text-[12px] text-slate-500 mt-1 leading-[1.8]">
                            Cobros efectivo: <span className="font-semibold text-slate-800">{formatCurrency(metricas.metodos_pago?.efectivo ?? 0)}</span><br />
                            Traslados a Mayor: <span className="font-semibold text-slate-800">-{loadingResumen ? "…" : resumenFinanciero ? formatCurrency(resumenFinanciero.traslados.menor_a_mayor) : "–"}</span>
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2.5 mb-5">
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">¿Cuánto contaste?</label>
                          <input value={cierreContado} onChange={(e) => setCierreContado(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:border-slate-800" placeholder="$ 0" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Diferencia</label>
                          {(() => {
                            const contadoNum = parseFloat(cierreContado.replace(/[^0-9.-]/g, ""));
                            const esperado = metricas.metodos_pago?.efectivo ?? 0;
                            if (isNaN(contadoNum) || !cierreContado.trim()) return <div className="px-3 py-2 border border-slate-200 rounded-md text-[15px] font-bold text-slate-400 bg-slate-50">—</div>;
                            const diff = contadoNum - esperado;
                            const color = diff === 0 ? "text-slate-400" : diff > 0 ? "text-green-600" : "text-red-600";
                            return <div className={`px-3 py-2 border border-slate-200 rounded-md text-[15px] font-bold bg-slate-50 ${color}`}>{diff > 0 ? "+" : ""}{formatCurrency(diff)}</div>;
                          })()}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 mb-5">
                        <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.4px]">Observaciones (opcional)</label>
                        <textarea value={cierreObservaciones} onChange={(e) => setCierreObservaciones(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-md text-[12px] resize-y min-h-[56px] focus:outline-none focus:border-slate-800" placeholder="Novedades del día..." />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => { setCierreContado(""); setCierreObservaciones(""); setCierreError(null); }} className="px-4 py-2 border border-slate-200 rounded-md text-[12px] font-semibold text-slate-500 hover:bg-slate-50">Cancelar</button>
                        <button onClick={handleGuardarCierre} disabled={cierreLoading} className="px-4 py-2 bg-slate-800 text-white rounded-md text-[12px] font-semibold hover:bg-slate-700 disabled:opacity-60">{cierreLoading ? "Guardando…" : "Guardar cierre"}</button>
                      </div>
                    </div>
                  )}

                  {/* Historial de cierres */}
                  {cierresHistorial.length > 0 && (
                    <div className="mt-6">
                      <Card title="Historial de cierres recientes" titleSub={`${cierresHistorial.length} registros`} action={<FiltroSeccion valor={filtroCierresCaja} onChange={setFiltroCierresCaja} rango={rangoCierresCaja} onRangoChange={setRangoCierresCaja} />}>
                        <table className="w-full border-collapse">
                          <thead><tr>{["Fecha", "Sede", "Esperado", "Contado", "Diferencia", "Estado", "Observaciones"].map((h) => <th key={h} className="text-left text-[9px] font-bold uppercase tracking-[0.5px] text-slate-400 pb-2 border-b border-slate-200">{h}</th>)}</tr></thead>
                          <tbody>
                            {cierresHistorial.slice(0, 10).map((c: any, idx: number) => {
                              const diff = c.diferencia ?? ((c.efectivo_contado ?? 0) - (c.efectivo_esperado ?? 0));
                              const isOpen = !c.efectivo_contado && c.efectivo_contado !== 0;
                              return (
                                <tr key={c.cierre_id || idx} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                                  <td className="py-2.5 text-[12px] text-slate-600">{c.fecha}</td>
                                  <td className="py-2.5 text-[11px] text-slate-500">{c.sede_nombre || sedes.find((s) => s.sede_id === c.sede_id)?.nombre || "—"}</td>
                                  <td className="py-2.5 text-[12px] text-slate-800 tabular-nums">{formatCurrency(c.efectivo_esperado ?? 0)}</td>
                                  <td className="py-2.5 text-[12px] text-slate-800 tabular-nums">{isOpen ? "—" : formatCurrency(c.efectivo_contado ?? 0)}</td>
                                  <td className="py-2.5 text-[12px] font-semibold tabular-nums">
                                    {isOpen ? <span className="text-slate-400">—</span> : diff === 0 ? <span className="text-slate-400">$ 0</span> : diff > 0 ? <span className="text-green-600">+{formatCurrency(diff)}</span> : <span className="text-red-600">-{formatCurrency(Math.abs(diff))}</span>}
                                  </td>
                                  <td className="py-2.5">
                                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${isOpen ? "bg-blue-50 text-blue-600 border border-blue-200" : diff === 0 ? "bg-green-50 text-green-600 border border-green-200" : "bg-amber-50 text-amber-600 border border-amber-200"}`}>
                                      {isOpen ? "Abierto" : diff === 0 ? "Cuadrado" : "Con diferencia"}
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
            </>
          )}
        </div>
      </main>
    </div>
  );
}
