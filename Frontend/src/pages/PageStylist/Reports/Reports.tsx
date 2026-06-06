"use client";

import {
  ArrowLeft,
  Calendar as CalendarIcon,
  ChevronDown,
  Info,
  Loader2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useNavigate } from "react-router-dom";
import StylistBottomNav from "../../../components/Layout/StylistBottomNav";
import { DatePicker } from "../../../components/ui/DatePicker";
import { useAuth } from "../../../components/Auth/AuthContext";
import {
  formatDateDMY,
  formatLongDateEs,
  parseDateToDate,
  toLocalYMD,
} from "../../../lib/dateFormat";
import {
  formatCurrencyNoDecimals,
  getStoredCurrency,
  resolveCurrencyLocale,
} from "../../../lib/currency";
import { cn } from "../../../lib/utils";
import { estilistaApi } from "../Appoinment/api";
import {
  facturaService,
  type FacturaConverted,
  type ItemFactura,
} from "../../PageSede/Sales-invoiced/facturas";
import { citasApi } from "../Appoinment/api";
import { enumerateDateRange } from "../../../features/stylists-team/stylists-team.utils";

type DateRange = { start: string; end: string };

type CommissionRow = {
  id: string;
  cliente: string;
  fecha: string;
  servicio: string;
  valor: number;
  comision: number | null;
  moneda: string;
  tipo: "service" | "product";
};

const getDefaultRange = (): DateRange => {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 30);
  return { start: toLocalYMD(start), end: toLocalYMD(end) };
};

const formatRangeLabel = (range: DateRange) => {
  return `${formatLongDateEs(range.start, range.start)} - ${formatLongDateEs(range.end, range.end)}`;
};

const getInvoiceEffectiveDate = (invoice: FacturaConverted) =>
  String(invoice.fecha_comprobante || invoice.fecha_pago || "").trim();

const isServiceItem = (item: ItemFactura) => {
  const tipo = String(item.tipo || "").toLowerCase();
  return (
    tipo.includes("servicio") ||
    tipo.includes("service") ||
    Boolean(item.servicio_id)
  );
};

// Compara solo por la fecha (YYYY-MM-DD) para evitar desfases por zona horaria.
// Si el backend envía timestamps en UTC (ej. "2026-03-19T00:00:00Z"), el filtro
// seguirá considerándolos dentro del día 19 en la zona horaria local.
const isWithinRange = (iso: string | undefined, range: DateRange) => {
  if (!iso) return false;

  const targetDate = parseDateToDate(iso);
  const startDate = parseDateToDate(range.start);
  const endDate = parseDateToDate(range.end);

  if (!targetDate || !startDate || !endDate) return false;

  const target = toLocalYMD(targetDate);
  const start = toLocalYMD(startDate);
  const end = toLocalYMD(endDate);

  return target >= start && target <= end;
};

const getItemSubtotal = (item: ItemFactura): number => {
  if (typeof item.subtotal === "number") return item.subtotal;
  if (
    typeof item.precio_unitario === "number" &&
    typeof item.cantidad === "number"
  ) {
    return item.precio_unitario * item.cantidad;
  }
  return Number(item.subtotal || 0);
};

const getCommissionValue = (item: ItemFactura): number | null => {
  const raw = item.comision;
  if (raw === undefined || raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildSummary = (items: CommissionRow[]) => {
  const totalVentas = items.reduce((sum, row) => sum + (row.valor || 0), 0);
  const totalComisiones = items.reduce(
    (sum, row) => sum + (row.comision ?? 0),
    0,
  );
  const clientes = new Set(
    items.map((row) => row.cliente || row.id || "sin-cliente"),
  ).size;

  const servicesMap = new Map<string, number>();
  items.forEach((row) => {
    const name = row.servicio || "Item";
    const prev = servicesMap.get(name) || 0;
    servicesMap.set(name, prev + (row.valor || 0));
  });

  const chartData = Array.from(servicesMap.entries()).map(([name, value]) => ({
    name,
    value,
  }));

  const hasCommissionValues = items.some((row) => row.comision !== null);

  return {
    totalVentas,
    totalComisiones,
    totalClientes: clientes,
    chartData,
    hasCommissionValues,
  };
};

const calcularPrecioCita = (cita: any): number => {
  const direct = cita.valor_total || cita.precio_total || cita.total || 0;
  if (direct > 1) return direct;
  if (Array.isArray(cita.servicios) && cita.servicios.length > 0) {
    return cita.servicios.reduce((sum: number, servicio: any) => {
      const subtotal =
        servicio.subtotal ?? servicio.precio ?? servicio.precio_local ?? 0;
      return sum + subtotal;
    }, 0);
  }
  if (cita.servicio?.precio) return cita.servicio.precio;
  return 0;
};

const buildRowsFromCitas = (
  citas: any[],
  fallbackCurrency: string,
): CommissionRow[] => {
  return citas.map((cita) => {
    const servicios =
      Array.isArray(cita.servicios) && cita.servicios.length > 0
        ? cita.servicios.map((s: any) => s.nombre).join(", ")
        : cita.servicio?.nombre || "Servicio";

    const cliente =
      cita.cliente?.nombre || cita.cliente_nombre || cita.cliente?.apellido
        ? `${cita.cliente?.nombre || cita.cliente_nombre || ""} ${cita.cliente?.apellido || cita.cliente_apellido || ""}`.trim()
        : "Cliente";

    return {
      id: cita.cita_id || cita._id || Math.random().toString(36).slice(2),
      cliente,
      fecha: cita.fecha || "",
      servicio: servicios,
      valor: calcularPrecioCita(cita),
      comision: null,
      moneda: cita.moneda || fallbackCurrency,
      tipo: "service",
    };
  });
};

export default function StylistReportsPage() {
  const navigate = useNavigate();
  const { user, activeSedeId } = useAuth();

  const [range, setRange] = useState<DateRange>(getDefaultRange);
  const [pendingRange, setPendingRange] =
    useState<DateRange>(getDefaultRange());
  const [rangeOpen, setRangeOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [invoices, setInvoices] = useState<FacturaConverted[]>([]);
  const [professionalId, setProfessionalId] = useState<string>("");
  const [stylistName, setStylistName] = useState<string>(
    user?.name || "Estilista",
  );
  const [stylistSubtitle, setStylistSubtitle] =
    useState<string>("Especialista");
  const [currencyOverride, setCurrencyOverride] = useState<string | null>(null);
  const [manualRows, setManualRows] = useState<CommissionRow[] | null>(null);
  const [commissionTab, setCommissionTab] = useState<"services" | "products">(
    "services",
  );

  const resolvedCurrency = useMemo(
    () => currencyOverride || getStoredCurrency("COP"),
    [currencyOverride],
  );
  const resolvedLocale = useMemo(
    () => resolveCurrencyLocale(resolvedCurrency, "es-CO"),
    [resolvedCurrency],
  );

  // Resolver profesional_id y datos básicos del estilista
  useEffect(() => {
    const resolveProfile = async () => {
      const storedPro =
        sessionStorage.getItem("beaux-profesional_id") ||
        localStorage.getItem("beaux-profesional_id");
      if (storedPro) {
        setProfessionalId(storedPro);
      }

      if (!user?.email || !user?.access_token) {
        setStylistName(user?.name || "Estilista");
        return;
      }

      try {
        const perfil = await estilistaApi.getMiPerfil(
          user.access_token,
          user.email,
        );
        const estilistaData = perfil?.estilista as any;
        if (estilistaData?.nombre) {
          setStylistName(estilistaData.nombre);
        }
        const specialty =
          estilistaData?.especialidades_detalle?.[0]?.nombre ||
          estilistaData?.especialidades?.[0];
        if (specialty) {
          setStylistSubtitle(specialty);
        }
        const proId =
          estilistaData?.profesional_id ||
          estilistaData?._id ||
          storedPro ||
          "";
        if (proId) {
          setProfessionalId(proId);
          sessionStorage.setItem("beaux-profesional_id", proId);
        }
      } catch (profileError) {
        console.warn("No se pudo cargar perfil de estilista:", profileError);
        setStylistName(user?.name || "Estilista");
      }
    };

    resolveProfile();
  }, [user?.access_token, user?.email, user?.name]);

  // Cargar ventas/facturas para el rango seleccionado
  useEffect(() => {
    const loadInvoices = async () => {
      if (!professionalId) {
        setLoading(false);
        return;
      }

      const sedeId =
        user?.sede_id ||
        activeSedeId ||
        user?.sede_id_principal ||
        sessionStorage.getItem("beaux-active-sede_id") ||
        sessionStorage.getItem("beaux-sede_id") ||
        localStorage.getItem("beaux-active-sede_id") ||
        localStorage.getItem("beaux-sede_id") ||
        "";

      if (!sedeId) {
        setError("No se encontró la sede activa para cargar los reportes.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const facturas = await facturaService.getVentasBySedeAllPages(
          sedeId,
          range.start,
          range.end,
          undefined,
          { pageSize: 200 },
        );
        setInvoices(Array.isArray(facturas) ? facturas : []);
        setManualRows(null);
        const firstCurrency = facturas?.[0]?.moneda;
        if (firstCurrency) {
          setCurrencyOverride(firstCurrency.toUpperCase());
        }
      } catch (fetchError) {
        console.error(
          "Error cargando facturas para reportes de estilista:",
          fetchError,
        );
        const message =
          fetchError instanceof Error
            ? fetchError.message
            : "No se pudieron cargar las ventas.";
        setError(message);

        // Fallback: intentar con citas del estilista (rol sí permitido)
        try {
          if (!user?.access_token) throw new Error("Sin token de sesión");
          const dates = enumerateDateRange({
            start: range.start,
            end: range.end,
          });
          const citasByDay = await Promise.all(
            dates.map((fecha) =>
              citasApi
                .getCitas(
                  { estilista_id: professionalId, fecha },
                  user.access_token,
                )
                .catch(() => []),
            ),
          );
          const citas = citasByDay.flat();
          const fallbackRows = buildRowsFromCitas(citas, resolvedCurrency);
          setManualRows(fallbackRows);
          setError(null); // ocultar error si hay fallback
        } catch (fallbackError) {
          console.warn("Fallback de citas también falló:", fallbackError);
        }
      } finally {
        setLoading(false);
      }
    };

    loadInvoices();
  }, [
    activeSedeId,
    professionalId,
    range.end,
    range.start,
    user?.sede_id,
    user?.sede_id_principal,
  ]);

  const filteredInvoices = useMemo(
    () =>
      invoices.filter((invoice) =>
        isWithinRange(getInvoiceEffectiveDate(invoice), range),
      ),
    [invoices, range],
  );

  const filteredItems = useMemo(() => {
    if (manualRows) {
      return manualRows.filter((row) => isWithinRange(row.fecha, range));
    }
    if (!professionalId) return [];

    return filteredInvoices.flatMap((invoice) => {
      const belongsToPro =
        invoice.profesional_id &&
        String(invoice.profesional_id).trim().toLowerCase() ===
          String(professionalId).trim().toLowerCase();

      const items = Array.isArray(invoice.items) ? invoice.items : [];
      if (items.length === 0 && belongsToPro) {
        return [
          {
            id: invoice.identificador,
            cliente: invoice.nombre_cliente || "Cliente",
            fecha: getInvoiceEffectiveDate(invoice),
            servicio: "Venta",
            valor: invoice.total || 0,
            comision: null,
            moneda: invoice.moneda,
            tipo: "service",
          } as CommissionRow,
        ];
      }

      return items
        .filter((item) => {
          const proItem = item.profesional_id
            ? String(item.profesional_id).trim().toLowerCase()
            : "";
          if (proItem) {
            return proItem === String(professionalId).trim().toLowerCase();
          }
          return belongsToPro;
        })
        .map(
          (item): CommissionRow => ({
            id: `${invoice.identificador}-${item.servicio_id || item.producto_id || item.nombre}`,
            cliente: invoice.nombre_cliente || "Cliente",
            fecha: getInvoiceEffectiveDate(invoice),
            servicio: item.nombre || "Servicio",
            valor: getItemSubtotal(item),
            comision: getCommissionValue(item),
            moneda: item.moneda || invoice.moneda || resolvedCurrency,
            tipo: isServiceItem(item) ? "service" : "product",
          }),
        );
    });
  }, [filteredInvoices, manualRows, professionalId, range, resolvedCurrency]);

  const serviceItems = useMemo(
    () => filteredItems.filter((row) => row.tipo === "service"),
    [filteredItems],
  );

  const productItems = useMemo(
    () => filteredItems.filter((row) => row.tipo === "product"),
    [filteredItems],
  );

  const serviceSummary = useMemo(
    () => buildSummary(serviceItems),
    [serviceItems],
  );
  const productSummary = useMemo(
    () => buildSummary(productItems),
    [productItems],
  );
  const selectedSummary =
    commissionTab === "services" ? serviceSummary : productSummary;

  const formatMoney = (value: number) =>
    formatCurrencyNoDecimals(value || 0, resolvedCurrency, resolvedLocale);

  const emptyState =
    !loading && filteredItems.length === 0 && !error
      ? "No encontramos ventas para este rango. Ajusta las fechas o verifica tus comisiones."
      : null;

  const detailRows = commissionTab === "services" ? serviceItems : productItems;
  const detailColumnLabel =
    commissionTab === "services" ? "Servicio" : "Producto";
  const detailTabEmptyState =
    !loading && !error && filteredItems.length > 0 && detailRows.length === 0
      ? commissionTab === "services"
        ? "No hay comisiones de servicios en este rango."
        : "No hay comisiones de productos en este rango."
      : null;
  const detailTotalComision = detailRows.reduce(
    (sum, row) => sum + (row.comision ?? 0),
    0,
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto w-full max-w-[480px] pb-28">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 text-gray-700"
            aria-label="Volver"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="flex-1 text-center text-base font-semibold text-gray-900">
            RF Salon Agent
          </h1>
          <div className="w-10" />
        </header>

        <main className="space-y-3 px-3 py-3">
          <section className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-lg font-semibold text-gray-700">
              {stylistName
                .split(" ")
                .map((chunk) => chunk[0])
                .join("")
                .slice(0, 2)
                .toUpperCase() || "RF"}
            </div>
            <div className="flex-1">
              <p className="text-base font-semibold text-gray-900">
                {stylistName}
              </p>
              <p className="text-sm text-gray-600">{stylistSubtitle}</p>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-900">
                Reporte de Ventas y Comisiones
              </h2>
            </div>

            <div className="relative mt-3">
              <button
                type="button"
                onClick={() =>
                  setRangeOpen((prev) => {
                    const next = !prev;
                    if (!prev) {
                      // Al abrir el selector sincronizamos los inputs con el rango actual mostrado
                      setPendingRange(range);
                    }
                    return next;
                  })
                }
                className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-800"
              >
                <span className="inline-flex items-center gap-2">
                  <CalendarIcon className="h-4 w-4 text-gray-600" />
                  {formatRangeLabel(range)}
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-gray-600 transition-transform",
                    rangeOpen ? "rotate-180" : "",
                  )}
                />
              </button>

              {rangeOpen && (
                <div className="absolute z-20 mt-2 w-full rounded-2xl border border-gray-200 bg-white p-3 shadow-lg">
                  <div className="space-y-2 text-sm text-gray-700">
                    <label className="flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-600">Desde</span>
                      <DatePicker
                        value={pendingRange.start}
                        max={pendingRange.end || undefined}
                        onChange={(v) =>
                          setPendingRange((current) => ({
                            ...current,
                            start: v,
                          }))
                        }
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-600">Hasta</span>
                      <DatePicker
                        value={pendingRange.end}
                        min={pendingRange.start || undefined}
                        onChange={(v) =>
                          setPendingRange((current) => ({
                            ...current,
                            end: v,
                          }))
                        }
                      />
                    </label>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setRange(pendingRange);
                          setRangeOpen(false);
                        }}
                        className="flex-1 h-10 rounded-lg bg-gray-900 text-sm font-semibold text-white"
                      >
                        Aplicar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingRange(getDefaultRange());
                          setRange(getDefaultRange());
                          setRangeOpen(false);
                        }}
                        className="flex-1 h-10 rounded-lg border border-gray-200 text-sm font-semibold text-gray-800"
                      >
                        Últimos 30 días
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-gray-50 p-2 text-sm text-gray-800">
              <div className="rounded-lg bg-white px-3 py-2 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                <p className="text-xs text-gray-500">Ventas totales</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatMoney(selectedSummary.totalVentas)}
                </p>
              </div>
              <div className="rounded-lg bg-white px-3 py-2 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                <p className="text-xs text-gray-500">Comisiones totales</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatMoney(selectedSummary.totalComisiones)}
                </p>
              </div>
              <div className="rounded-lg bg-white px-3 py-2 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                <p className="text-xs text-gray-500">Clientes atendidos</p>
                <p className="text-lg font-semibold text-gray-900">
                  {selectedSummary.totalClientes}
                </p>
              </div>
            </div>

            <div className="mt-4">
              <p className="text-sm font-semibold text-gray-900">
                {commissionTab === "services"
                  ? "Ventas por servicios"
                  : "Ventas por productos"}
              </p>
              <div className="mt-2 h-48">
                {loading ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
                  </div>
                ) : selectedSummary.chartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center rounded-xl bg-gray-50 text-sm text-gray-500">
                    {commissionTab === "services"
                      ? "Sin datos de servicios en este rango."
                      : "Sin datos de productos en este rango."}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={selectedSummary.chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v) => `${Math.round(v / 1000)}K`}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(0,0,0,0.04)" }}
                        formatter={(value: number) => formatMoney(value)}
                        labelFormatter={(label) => label}
                      />
                      <Bar
                        dataKey="value"
                        fill="var(--color-chart-1, #111827)"
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900">
                Detalle de Comisiones
              </p>
              {!selectedSummary.hasCommissionValues && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
                  <Info className="h-3 w-3" />
                  Falta comisión en items
                </span>
              )}
            </div>

            <div className="mb-3 inline-flex rounded-full bg-gray-100 p-1 text-xs font-semibold text-gray-600">
              <button
                type="button"
                onClick={() => setCommissionTab("services")}
                className={cn(
                  "px-4 py-2 rounded-full transition-colors",
                  commissionTab === "services"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600 hover:text-gray-900",
                )}
              >
                Servicios
              </button>
              <button
                type="button"
                onClick={() => setCommissionTab("products")}
                className={cn(
                  "px-4 py-2 rounded-full transition-colors",
                  commissionTab === "products"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600 hover:text-gray-900",
                )}
              >
                Productos
              </button>
            </div>

            {loading && (
              <div className="space-y-2">
                {[1, 2, 3].map((key) => (
                  <div
                    key={key}
                    className="h-14 animate-pulse rounded-lg bg-gray-100"
                  />
                ))}
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            {emptyState && (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-center text-sm text-gray-600">
                {emptyState}
              </div>
            )}

            {detailTabEmptyState && (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-center text-sm text-gray-600">
                {detailTabEmptyState}
              </div>
            )}

            {!loading && !error && detailRows.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-gray-200">
                <div className="grid grid-cols-[1.2fr_1fr_0.9fr_0.9fr] bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">
                  <span>Cliente</span>
                  <span>{detailColumnLabel}</span>
                  <span className="text-right">Valor</span>
                  <span className="text-right">Comisión</span>
                </div>
                <div className="divide-y divide-gray-100">
                  {detailRows.map((row) => (
                    <div
                      key={row.id}
                      className="grid grid-cols-[1.2fr_1fr_0.9fr_0.9fr] px-3 py-3 text-sm text-gray-800"
                    >
                      <div>
                        <p className="font-semibold text-gray-900">
                          {row.cliente}
                        </p>
                        <p className="text-xs text-gray-500">
                          {row.fecha ? formatDateDMY(row.fecha) : "-"}
                        </p>
                      </div>
                      <div className="text-sm text-gray-800">
                        {row.servicio}
                      </div>
                      <div className="text-right font-medium">
                        {formatCurrencyNoDecimals(
                          row.valor,
                          row.moneda || resolvedCurrency,
                          resolvedLocale,
                        )}
                      </div>
                      <div className="text-right font-semibold text-gray-900">
                        {row.comision !== null
                          ? formatCurrencyNoDecimals(
                              row.comision,
                              row.moneda || resolvedCurrency,
                              resolvedLocale,
                            )
                          : "—"}
                      </div>
                    </div>
                  ))}
                  <div className="grid grid-cols-[1.2fr_1fr_0.9fr_0.9fr] bg-gray-50 px-3 py-3 text-sm font-semibold text-gray-900">
                    <span>Total</span>
                    <span />
                    <span />
                    <span className="text-right">
                      {formatMoney(detailTotalComision)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </section>
        </main>
      </div>

      <StylistBottomNav active="reports" />
    </div>
  );
}
