"use client";

import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Edit3,
  Loader2,
  Plus,
  Search,
  Settings2,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Sidebar } from "../../components/Layout/Sidebar";
import { confirmAction } from '../../components/ui/confirm-dialog';
import { PageHeader } from "../../components/Layout/PageHeader";
import { Button } from "../../components/ui/button";
import { PeriodoSelector, type PeriodoId } from "../../components/ui/PeriodoSelector";
import { useAuth } from "../../components/Auth/AuthContext";
import { facturaService, type FacturaConverted } from "../../pages/PageSuperAdmin/Sales-invoiced/facturas";
import { sedeService, type Sede } from "../../pages/PageSuperAdmin/Sedes/sedeService";
import { systemUsersService } from "../../pages/PageSuperAdmin/SystemUsers/systemUsersService";
import type { Estilista, CreateEstilistaData } from "../../types/estilista";
import type { SystemUser } from "../../types/system-user";
import { formatSedeNombre } from "../../lib/sede";
import { formatCurrencyNoDecimals, getStoredCurrency } from "../../lib/currency";
import { formatDateDMY } from "../../lib/dateFormat";
import {
  buildCategoryCommissionPayload,
  resolveCategoryCommissionEntries,
  resolveServiceCommissions,
  type ServiceCommissionEntry,
} from "../../lib/serviceCommissions";
import { getCitas } from "../../components/Quotes/citasApi";
import { getHorariosEstilista } from "../../components/Quotes/horariosApi";
import {
  fetchPerformanceAnalytics,
  type PerformancePeriod,
  type PerformanceProfessional,
} from "./performanceApi";
import {
  buildStylistDashboardRows,
  buildVendorRows,
  enumerateDateRange,
  getAllowedSedeIds,
  getDefaultDateRange,
  normalizeAppointmentRecord,
  normalizeScheduleRecord,
  type DateRangeValue,
  type StylistDashboardRow,
  type TeamAppointmentRecord,
  type TeamScheduleRecord,
} from "./stylists-team.utils";

type DashboardRowWithProducts = StylistDashboardRow & { cantidadProductos: number };

type MonthlyProjectionRow = {
  profesionalId: string;
  nombre: string;
  citasActivas: number | null;
  ingresosGenerados: number | null;
  comisionProyectada: number | null;
  ocupacionPct: number | null;
};

const DEFAULT_STYLIST_PASSWORD = "Temporal123!";

type StylistsTeamWorkspaceProps = {
  servicesApi: {
    getServicios: (
      token: string,
      moneda?: string,
    ) => Promise<
      Array<{
        id?: string;
        servicio_id?: string;
        nombre: string;
        categoria?: string;
        duracion?: number;
        precio?: number;
        precio_local?: number;
      }>
    >;
  };
  stylistApi: {
    getEstilistas: (token: string) => Promise<Estilista[]>;
    createEstilista: (token: string, payload: CreateEstilistaData) => Promise<Estilista>;
    createHorario?: (token: string, horario: LegacyScheduleData) => Promise<unknown>;
    updateHorario?: (token: string, horarioId: string, horario: LegacyScheduleData) => Promise<unknown>;
    updateEstilista: (
      token: string,
      profesionalId: string,
      payload: Partial<Estilista> & Record<string, unknown>,
    ) => Promise<Estilista>;
    updateServicios?: (
      token: string,
      profesionalId: string,
      serviciosNoPresta: string[],
    ) => Promise<unknown>;
    updateServiceCommissions?: (
      token: string,
      profesionalId: string,
      payload: Record<string, number>,
    ) => Promise<unknown>;
    deleteEstilista: (token: string, profesionalId: string) => Promise<void>;
  };
  legacyCreateModal?: ComponentType<LegacyCreateModalProps>;
};

type ViewMode = "dashboard" | "settings";

type ServiceOption = {
  id: string;
  nombre: string;
  categoria: string;
  duracion: number;
  precio: number;
};

type EditorState = {
  mode: "create" | "edit";
  nombre: string;
  email: string;
  telefono: string;
  rol: string;
  sede_id: string;
  comision: string;
  password: string;
  activo: boolean;
  serviceIds: string[];
  serviceCommissions: ServiceCommissionEntry[];
  productCommission: string;
};

type LegacyScheduleData = {
  profesional_id: string;
  sede_id: string;
  disponibilidad: Array<{
    dia_semana: number;
    hora_inicio: string;
    hora_fin: string;
    activo: boolean;
  }>;
};

type LegacyCreatePayload = Partial<Estilista> & {
  password?: string;
  horario?: LegacyScheduleData;
  horarioId?: string;
};

type LegacyCreateModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: LegacyCreatePayload) => void;
  estilista: Estilista | null;
  isSaving?: boolean;
};

const DASHBOARD_HEADERS: Array<{ key: keyof DashboardRowWithProducts; lines: string[] }> = [
  { key: "nombre", lines: ["Estilistas"] },
  { key: "citas", lines: ["# de Citas"] },
  { key: "cantidadProductos", lines: ["Cantidad de", "Productos"] },
  { key: "totalVentaServicios", lines: ["Total Venta", "Servicios"] },
  { key: "totalVentaProductos", lines: ["Total Ventas", "Productos"] },
  { key: "totalVentas", lines: ["Total", "Ventas"] },
  { key: "comisionesServicios", lines: ["Comisiones por", "Servicios"] },
  { key: "comisionesProductos", lines: ["Comisiones", "Productos"] },
  { key: "totalComisiones", lines: ["Total", "Comisiones"] },
];

const ROLE_LABELS: Record<string, string> = {
  admin_sede: "Admin sede",
  recepcionista: "Recepcionista",
  estilista: "Estilista",
  call_center: "Call center",
  super_admin: "Super admin",
  superadmin: "Super admin",
};

const ALL_SEDES_VALUE = "__ALL_SEDES__";

const normalizeText = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const getRoleLabel = (role: string): string => {
  const normalized = normalizeText(role).replace(/[\s-]+/g, "_");
  return ROLE_LABELS[normalized] ?? role ?? "Sin rol";
};

const getInitials = (name: string): string =>
  name
    .split(" ")
    .map((part) => part.trim().charAt(0).toUpperCase())
    .filter(Boolean)
    .slice(0, 2)
    .join("") || "ST";

const parseCommissionValue = (value: string): number | null => {
  const raw = value.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && !Number.isNaN(parsed) ? parsed : null;
};

const formatDateRangeSelectValue = (value?: string): string => {
  const date = value ? new Date(`${value}T00:00:00`) : null;
  if (!date || Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
    .format(date)
    .replace(/\./g, "")
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
};


const chunk = <T,>(items: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

const PANEL_CLASS = "rounded-xl border border-gray-300 bg-white shadow";
const TABLE_WRAPPER_CLASS = "overflow-hidden rounded-lg border border-gray-300 bg-white";
const TABLE_HEAD_CLASS = "bg-gray-50";
const TABLE_HEAD_CELL_CLASS = "px-4 py-3 text-left text-sm font-medium text-gray-700";
const TABLE_ROW_CLASS = "border-t border-gray-200 hover:bg-gray-50";
const TABLE_CELL_CLASS = "px-4 py-3 text-sm text-gray-700";
const TABLE_CELL_MEDIUM_CLASS = "px-4 py-3 text-sm font-medium text-gray-900";
const TABLE_CELL_STRONG_CLASS = "px-4 py-3 text-sm font-semibold text-gray-900";
const OUTLINE_BUTTON_CLASS = "border-gray-300 bg-white text-gray-800 hover:bg-gray-100 hover:text-gray-900";
const PRIMARY_BUTTON_CLASS = "bg-black text-white hover:bg-gray-800";
const STATUS_PILL_CLASS =
  "inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600";
const ERROR_ALERT_CLASS = "mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700";
const WARNING_ALERT_CLASS =
  "mt-4 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800";

function HeaderLabel({ lines }: { lines: string[] }) {
  return (
    <span className="inline-flex min-w-[88px] flex-col leading-[1.15] whitespace-normal">
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </span>
  );
}

function EmptyPanel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-gray-300 bg-white">
        <Users className="h-5 w-5 text-gray-500" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-gray-500">{description}</p>
    </div>
  );
}

type PanelCommissionRow = {
  id: string;
  cliente: string;
  fecha: string;
  servicio: string;
  valor: number;
  comision: number | null;
};

const PANEL_TABS = ["servicios", "productos", "citas", "resumen"] as const;
type PanelTab = (typeof PANEL_TABS)[number];
const PANEL_TAB_LABELS: Record<PanelTab, string> = {
  servicios: "Servicios",
  productos: "Productos",
  citas: "Citas",
  resumen: "Resumen",
};

function buildPanelTransactionRows(
  invoices: import("../../pages/PageSuperAdmin/Sales-invoiced/facturas").FacturaConverted[],
  profesionalId: string,
  tipo: "servicio" | "producto",
): PanelCommissionRow[] {
  const rows: PanelCommissionRow[] = [];

  for (const inv of invoices) {
    if (String(inv.profesional_id ?? "").trim() !== profesionalId) continue;
    const items = inv.items ?? [];

    if (items.length === 0 && tipo === "servicio") {
      rows.push({
        id: inv.identificador,
        cliente: inv.nombre_cliente || "—",
        fecha: String(inv.fecha_pago || "").slice(0, 10),
        servicio: "Venta",
        valor: inv.total || 0,
        comision: null,
      });
      continue;
    }

    for (const item of items) {
      const tipoNorm = normalizeText(item.tipo);
      const isServicio =
        item.servicio_id || tipoNorm.includes("servicio") || tipoNorm.includes("service");
      const isProducto =
        item.producto_id || tipoNorm.includes("producto") || tipoNorm.includes("product");

      if (tipo === "servicio" && !isServicio) continue;
      if (tipo === "producto" && !isProducto) continue;

      const rawComision = item.comision;
      const parsedComision =
        rawComision !== undefined && rawComision !== null ? Number(rawComision) : null;

      rows.push({
        id: `${inv.identificador}-${item.servicio_id ?? item.producto_id ?? item.nombre}`,
        cliente: inv.nombre_cliente || "—",
        fecha: String(inv.fecha_pago || "").slice(0, 10),
        servicio: item.nombre || "—",
        valor: Number(item.subtotal ?? 0),
        comision: parsedComision !== null && Number.isFinite(parsedComision) ? parsedComision : null,
      });
    }
  }

  return rows.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

const MONTH_NAMES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function EstilistaDetallePanel({
  row,
  invoices,
  appointments,
  selectedSedeLabel,
  periodoLabel,
  currency,
  onClose,
}: {
  row: DashboardRowWithProducts;
  invoices: import("../../pages/PageSuperAdmin/Sales-invoiced/facturas").FacturaConverted[];
  appointments: TeamAppointmentRecord[];
  selectedSedeLabel: string;
  periodoLabel: string;
  currency: string;
  onClose: () => void;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>("servicios");

  useEffect(() => {
    const raf = requestAnimationFrame(() => setIsVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const serviciosRows = useMemo(
    () => buildPanelTransactionRows(invoices, row.profesionalId, "servicio"),
    [invoices, row.profesionalId],
  );

  const productosRows = useMemo(
    () => buildPanelTransactionRows(invoices, row.profesionalId, "producto"),
    [invoices, row.profesionalId],
  );

  const citasRows = useMemo(() => {
    const filtered = appointments.filter(
      (a) => String(a.profesional_id ?? "").trim() === row.profesionalId,
    );

    // Build a lookup from invoice items: key = "fecha|cliente|servicio" → subtotal
    // so we can enrich appointments that have no precio from the API.
    const invoiceLookup = new Map<string, number>();
    for (const inv of invoices) {
      if (String(inv.profesional_id ?? "").trim() !== row.profesionalId) continue;
      const fechaInv = String(inv.fecha_pago || "").slice(0, 10);
      const clienteInv = normalizeText(inv.nombre_cliente);
      const items = Array.isArray(inv.items) ? inv.items : [];
      if (items.length === 0) {
        // Whole invoice with no items breakdown
        const key = `${fechaInv}|${clienteInv}|`;
        if (!invoiceLookup.has(key)) invoiceLookup.set(key, inv.total || 0);
      } else {
        for (const item of items) {
          const tipoNorm = normalizeText(item.tipo);
          if (
            !item.servicio_id &&
            !tipoNorm.includes("servicio") &&
            !tipoNorm.includes("service")
          ) continue;
          const servicioInv = normalizeText(item.nombre);
          const key = `${fechaInv}|${clienteInv}|${servicioInv}`;
          if (!invoiceLookup.has(key)) invoiceLookup.set(key, Number(item.subtotal ?? 0));
        }
      }
    }

    return filtered.map((a) => {
      if (a.precio != null && a.precio > 0) return a;
      // Try to match by date + client + service
      const fechaCita = String(a.fecha || "").slice(0, 10);
      const clienteCita = normalizeText(a.cliente_nombre);
      const servicioCita = normalizeText(a.servicio_nombre);
      const keyExact = `${fechaCita}|${clienteCita}|${servicioCita}`;
      const keyLoose = `${fechaCita}|${clienteCita}|`;
      const precio = invoiceLookup.get(keyExact) ?? invoiceLookup.get(keyLoose);
      return precio != null && precio > 0 ? { ...a, precio } : a;
    });
  }, [appointments, invoices, row.profesionalId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const servTotalComision = useMemo(
    () => serviciosRows.reduce((s, r) => s + (r.comision ?? 0), 0),
    [serviciosRows],
  );
  const prodTotalComision = useMemo(
    () => productosRows.reduce((s, r) => s + (r.comision ?? 0), 0),
    [productosRows],
  );

  const totalVentas = row.totalVentaServicios + row.totalVentaProductos;
  const pctServ = totalVentas > 0 ? Math.round((row.totalVentaServicios / totalVentas) * 100) : 0;
  const pctProd = 100 - pctServ;
  const pctComOverVenta = totalVentas > 0 ? ((row.totalComisiones / totalVentas) * 100).toFixed(1) : "0.0";

  function renderTransactionTab(
    rows: PanelCommissionRow[],
    colLabel: string,
    totalComision: number,
  ) {
    return (
      <>
        <p className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-gray-400">
          {colLabel === "Servicio" ? "Servicios" : "Productos"} — {rows.length} registro{rows.length !== 1 ? "s" : ""}
        </p>
        {rows.length === 0 ? (
          <p className="py-5 text-[13px] text-[#8a8a8a]">
            Sin {colLabel === "Servicio" ? "servicios" : "productos"} para mostrar en este período.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200">
            {/* Header */}
            <div className="grid grid-cols-[1.2fr_1fr_0.9fr_0.55fr_0.9fr] bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">
              <span>Cliente</span>
              <span>{colLabel}</span>
              <span className="text-right">Valor</span>
              <span className="text-right">%</span>
              <span className="text-right">Comisión</span>
            </div>
            {/* Rows */}
            <div className="divide-y divide-gray-100">
              {rows.map((r) => {
                const pct =
                  r.comision !== null && r.valor > 0
                    ? Math.round((r.comision / r.valor) * 100)
                    : null;
                return (
                  <div
                    key={r.id}
                    className="grid grid-cols-[1.2fr_1fr_0.9fr_0.55fr_0.9fr] px-3 py-3 text-sm text-gray-800 transition-colors hover:bg-gray-50"
                  >
                    <div>
                      <p className="font-semibold text-gray-900 leading-snug">{r.cliente}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{r.fecha ? formatDateDMY(r.fecha) : "—"}</p>
                    </div>
                    <div className="text-[13px] text-gray-800 leading-snug pr-2">{r.servicio}</div>
                    <div className="text-right font-medium tabular-nums text-[13px]">
                      {formatCurrencyNoDecimals(r.valor, currency)}
                    </div>
                    <div className="text-right tabular-nums text-[12px] text-gray-500">
                      {pct !== null ? `${pct}%` : "—"}
                    </div>
                    <div className="text-right font-semibold tabular-nums text-[13px] text-gray-900">
                      {r.comision !== null
                        ? formatCurrencyNoDecimals(r.comision, currency)
                        : "—"}
                    </div>
                  </div>
                );
              })}
              {/* Total row */}
              <div className="grid grid-cols-[1.2fr_1fr_0.9fr_0.55fr_0.9fr] bg-gray-50 px-3 py-3 text-sm font-semibold text-gray-900">
                <span>Total</span>
                <span />
                <span />
                <span />
                <span className="text-right tabular-nums">
                  {formatCurrencyNoDecimals(totalComision, currency)}
                </span>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      {/* Scrim */}
      <div
        className={`fixed inset-0 z-40 transition-opacity duration-200 ${isVisible ? "opacity-100" : "opacity-0"}`}
        style={{ background: "rgba(0,0,0,0.32)" }}
        onClick={onClose}
      />

      {/* Panel */}
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-full flex-col bg-white transition-transform duration-[240ms] ${isVisible ? "translate-x-0" : "translate-x-full"}`}
        style={{ maxWidth: "720px", boxShadow: "-8px 0 32px rgba(0,0,0,0.08)", transitionTimingFunction: "cubic-bezier(0.32,0.72,0,1)" }}
      >
        {/* Panel head */}
        <div className="border-b border-gray-200 px-7 pt-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#111111] text-base font-semibold text-white">
                {getInitials(row.nombre)}
              </div>
              <div>
                <div className="text-[20px] font-bold leading-snug tracking-tight text-[#111111]">{row.nombre}</div>
                <div className="mt-0.5 text-[13px] text-[#8a8a8a]">{selectedSedeLabel} · {periodoLabel}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-md p-[6px] text-[#8a8a8a] transition hover:bg-[#f5f5f5] hover:text-[#111111]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Tabs */}
          <div className="-mx-7 flex px-7">
            {PANEL_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`-mb-px border-b-2 px-4 pb-3.5 pt-3 text-[13.5px] transition-colors ${
                  activeTab === tab
                    ? "border-[#111111] font-semibold text-[#111111]"
                    : "border-transparent font-medium text-[#8a8a8a] hover:text-[#4a4a4a]"
                }`}
              >
                {PANEL_TAB_LABELS[tab]}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-7 pb-10 pt-6" style={{ scrollbarWidth: "thin", scrollbarColor: "#d4d4d4 transparent" }}>

          {/* ── Servicios ── */}
          {activeTab === "servicios" && renderTransactionTab(serviciosRows, "Servicio", servTotalComision)}

          {/* ── Productos ── */}
          {activeTab === "productos" && renderTransactionTab(productosRows, "Producto", prodTotalComision)}

          {/* ── Citas ── */}
          {activeTab === "citas" && (
            <>
              <p className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-gray-400">
                Citas del período{row.citas != null ? ` — ${row.citas} en total` : ""}
              </p>
              {citasRows.length === 0 ? (
                <p className="py-5 text-[13px] text-[#8a8a8a]">Sin citas para mostrar en este período.</p>
              ) : (
                <div>
                  {citasRows.map((cita) => {
                    const parts = cita.fecha.split("-");
                    const monthLabel = MONTH_NAMES[parseInt(parts[1] ?? "1", 10) - 1] ?? parts[1];
                    const clienteLabel = cita.cliente_nombre || "—";
                    const servicioLabel = cita.servicio_nombre || null;
                    const horaLabel = cita.hora_inicio || "—";
                    const montoLabel = cita.precio != null && cita.precio > 0
                      ? formatCurrencyNoDecimals(cita.precio, currency)
                      : null;
                    return (
                      <div key={cita.id} className="flex items-center gap-4 border-b border-[#ebebeb] py-3 last:border-0">
                        {/* Fecha */}
                        <div className="w-14 shrink-0 text-center">
                          <div className="text-[17px] font-bold leading-tight tracking-tight text-[#111111]">{parts[2]}</div>
                          <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#8a8a8a]">{monthLabel}</div>
                        </div>
                        {/* Info */}
                        <div className="min-w-0 flex-1">
                          <div className="text-[13.5px] font-semibold text-[#111111]">{clienteLabel}</div>
                          {servicioLabel && (
                            <div className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] text-[#8a8a8a]">{servicioLabel}</div>
                          )}
                          <div className="mt-0.5 text-[11.5px] text-[#8a8a8a]">{horaLabel}</div>
                        </div>
                        {/* Monto */}
                        <div className="shrink-0 text-[13.5px] font-semibold tabular-nums text-[#111111]">
                          {montoLabel ?? "—"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ── Resumen ── */}
          {activeTab === "resumen" && (
            <>
              <p className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-gray-400">Período</p>

              {/* KPI grid */}
              <div
                className="mb-6 grid grid-cols-2 overflow-hidden rounded-lg border border-[#ebebeb]"
                style={{ gap: "1px", background: "#ebebeb" }}
              >
                {[
                  {
                    label: "Total ventas",
                    value: formatCurrencyNoDecimals(row.totalVentas, currency),
                    sub: `${row.citas ?? "—"} citas · ${row.cantidadProductos} productos`,
                  },
                  {
                    label: "Total comisión",
                    value: formatCurrencyNoDecimals(row.totalComisiones, currency),
                    sub: `${pctComOverVenta}% sobre ventas`,
                  },
                  {
                    label: "Comisión servicios",
                    value: formatCurrencyNoDecimals(row.comisionesServicios, currency),
                    sub: `De ${formatCurrencyNoDecimals(row.totalVentaServicios, currency)} en servicios`,
                  },
                  {
                    label: "Comisión productos",
                    value: formatCurrencyNoDecimals(row.comisionesProductos, currency),
                    sub: `De ${formatCurrencyNoDecimals(row.totalVentaProductos, currency)} en productos`,
                  },
                ].map(({ label, value, sub }) => (
                  <div key={label} className="bg-white px-[18px] py-4">
                    <p className="mb-1 text-[12px] font-medium text-[#8a8a8a]">{label}</p>
                    <p className="text-[22px] font-bold leading-tight tracking-tight tabular-nums text-[#111111]">{value}</p>
                    <p className="mt-0.5 text-[12px] text-[#8a8a8a]">{sub}</p>
                  </div>
                ))}
              </div>

              {/* Mix de ingresos */}
              <p className="mb-2.5 mt-6 text-[12px] font-semibold uppercase tracking-[0.04em] text-gray-400">Mix de ingresos</p>
              <div className="my-2 flex h-2 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full bg-[#111111]" style={{ width: `${pctServ}%` }} />
                <div className="h-full bg-[#b5b5b5]" style={{ width: `${pctProd}%` }} />
              </div>
              <div className="flex justify-between text-[12px] text-[#8a8a8a]">
                <span>
                  <span className="mr-1.5 inline-block h-2 w-2 align-middle rounded-sm bg-[#111111]" />
                  Servicios {pctServ}% · {formatCurrencyNoDecimals(row.totalVentaServicios, currency)}
                </span>
                <span>
                  <span className="mr-1.5 inline-block h-2 w-2 align-middle rounded-sm bg-[#b5b5b5]" />
                  Productos {pctProd}% · {formatCurrencyNoDecimals(row.totalVentaProductos, currency)}
                </span>
              </div>

              {/* Comisiones desglosadas */}
              <p className="mb-2.5 mt-6 text-[12px] font-semibold uppercase tracking-[0.04em] text-gray-400">Comisiones desglosadas</p>
              <div className="overflow-hidden rounded-md border border-[#ebebeb]">
                <table className="w-full border-collapse">
                  <thead className="bg-[#fafafa]">
                    <tr>
                      {["Concepto", "Venta", "Comisión", "% efectivo"].map((h) => (
                        <th
                          key={h}
                          className={`border-b border-[#ebebeb] px-3 py-2 text-[11.5px] font-semibold text-[#8a8a8a] ${h === "Concepto" ? "text-left" : "text-right"}`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ebebeb] bg-white">
                    {[
                      {
                        label: "Servicios",
                        venta: row.totalVentaServicios,
                        comision: row.comisionesServicios,
                      },
                      {
                        label: "Productos",
                        venta: row.totalVentaProductos,
                        comision: row.comisionesProductos,
                      },
                    ].map(({ label, venta, comision }) => (
                      <tr key={label} className="transition-colors hover:bg-[#f9f9f9]">
                        <td className="px-3 py-[11px] text-[13px] text-[#4a4a4a]">{label}</td>
                        <td className="px-3 py-[11px] text-right text-[13px] tabular-nums text-[#4a4a4a]">{formatCurrencyNoDecimals(venta, currency)}</td>
                        <td className="px-3 py-[11px] text-right text-[13px] tabular-nums text-[#4a4a4a]">{formatCurrencyNoDecimals(comision, currency)}</td>
                        <td className="px-3 py-[11px] text-right text-[13px]">
                          <span className="inline-block rounded bg-[#f5f5f5] px-[7px] py-0.5 text-[11.5px] font-medium tabular-nums text-[#4a4a4a]">
                            {venta > 0 ? ((comision / venta) * 100).toFixed(1) : "0.0"}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-[#ebebeb] bg-[#fafafa]">
                    <tr>
                      <td className="px-3 py-[11px] text-[13px] font-semibold text-[#111111]">Total</td>
                      <td className="px-3 py-[11px] text-right text-[13px] font-semibold tabular-nums text-[#111111]">{formatCurrencyNoDecimals(totalVentas, currency)}</td>
                      <td className="px-3 py-[11px] text-right text-[13px] font-semibold tabular-nums text-[#111111]">{formatCurrencyNoDecimals(row.totalComisiones, currency)}</td>
                      <td className="px-3 py-[11px] text-right text-[13px]">
                        <span className="inline-block rounded bg-[#f5f5f5] px-[7px] py-0.5 text-[11.5px] font-medium tabular-nums text-[#4a4a4a]">{pctComOverVenta}%</span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function MonthlyProjectionSection({
  rows,
  loading,
  error,
  periodLabel,
  onRetry,
  currency,
}: {
  rows: MonthlyProjectionRow[];
  loading: boolean;
  error: string | null;
  periodLabel: string;
  onRetry: () => void;
  currency: string;
}) {
  const hasOcupacion = rows.some((row) => row.ocupacionPct !== null);
  const countFormatter = useMemo(() => new Intl.NumberFormat("es-CO"), []);

  return (
    <section className={`${PANEL_CLASS} p-6`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Proyección del mes</h2>
          <p className="text-sm text-gray-500">
            Resumen de ingresos y proyección mensual por estilista.
          </p>
          <p className="text-xs text-gray-500">Período: {periodLabel || "Mes en curso"}</p>
        </div>
        <div className="flex items-center gap-2">
          {loading ? (
            <div className={STATUS_PILL_CLASS}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Cargando proyección
            </div>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className={OUTLINE_BUTTON_CLASS}
            onClick={onRetry}
            disabled={loading}
          >
            Actualizar
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={onRetry}
            className="border-red-300 bg-white text-red-700 hover:bg-red-100"
          >
            Reintentar
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-14 animate-pulse rounded-lg bg-gray-100"
            />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyPanel
          title="No hay datos para este período"
          description="No se encontraron métricas de performance mensual para los filtros actuales."
        />
      ) : (
        <div className={TABLE_WRAPPER_CLASS}>
          <div className="overflow-x-auto">
            <table className="min-w-[820px] w-full text-sm">
              <thead className={TABLE_HEAD_CLASS}>
                <tr>
                  <th className={TABLE_HEAD_CELL_CLASS}>
                    Estilista
                  </th>
                  <th className={TABLE_HEAD_CELL_CLASS}>
                    <HeaderLabel lines={["# Citas", "del mes"]} />
                  </th>
                  <th className={TABLE_HEAD_CELL_CLASS}>
                    <HeaderLabel lines={["Ganado", "del mes"]} />
                  </th>
                  <th className={TABLE_HEAD_CELL_CLASS}>
                    <HeaderLabel lines={["Proyección", "del mes"]} />
                  </th>
                  {hasOcupacion ? (
                    <th className={TABLE_HEAD_CELL_CLASS}>
                      <HeaderLabel lines={["Ocupación", "del mes"]} />
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="bg-white">
                {rows.map((row) => (
                  <tr key={row.profesionalId} className={TABLE_ROW_CLASS}>
                    <td className={TABLE_CELL_MEDIUM_CLASS}>{row.nombre}</td>
                    <td className={TABLE_CELL_MEDIUM_CLASS}>
                      {row.citasActivas === null
                        ? "--"
                        : countFormatter.format(row.citasActivas)}
                    </td>
                    <td className={TABLE_CELL_STRONG_CLASS}>
                      {row.ingresosGenerados === null
                        ? "--"
                        : formatCurrencyNoDecimals(row.ingresosGenerados, currency)}
                    </td>
                    <td className={TABLE_CELL_STRONG_CLASS}>
                      {row.comisionProyectada === null
                        ? "--"
                        : formatCurrencyNoDecimals(row.comisionProyectada, currency)}
                    </td>
                    {hasOcupacion ? (
                      <td className={TABLE_CELL_MEDIUM_CLASS}>
                        {row.ocupacionPct === null || Number.isNaN(row.ocupacionPct)
                          ? "--"
                          : `${row.ocupacionPct.toFixed(1)}%`}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

export function StylistsTeamWorkspace({
  servicesApi,
  stylistApi,
  legacyCreateModal: LegacyCreateModal,
}: StylistsTeamWorkspaceProps) {
  const { user, activeSedeId, setActiveSedeId, isLoading: authLoading } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>("dashboard");
  const [dateRange, setDateRange] = useState<DateRangeValue>(getDefaultDateRange);
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [stylists, setStylists] = useState<Estilista[]>([]);
  const [systemUsers, setSystemUsers] = useState<SystemUser[]>([]);
  const [selectedSedeId, setSelectedSedeId] = useState("");
  const [selectedStylistId, setSelectedStylistId] = useState("");
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [metricsWarning, setMetricsWarning] = useState<string | null>(null);
  const [isBootLoading, setIsBootLoading] = useState(true);
  const [isMetricsLoading, setIsMetricsLoading] = useState(false);
  const [isPerformanceLoading, setIsPerformanceLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLegacyCreateOpen, setIsLegacyCreateOpen] = useState(false);
  const [isLegacyCreateSaving, setIsLegacyCreateSaving] = useState(false);
  const [legacyEditStylist, setLegacyEditStylist] = useState<Estilista | null>(null);
  const [periodoActivo, setPeriodoActivo] = useState<PeriodoId>("30dias");
  const [rangoAplicado, setRangoAplicado] = useState<{ from: Date; to: Date } | undefined>(undefined);
  const [panelEstilistaId, setPanelEstilistaId] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<"datos" | "sedes" | "servicios" | "productos">("datos");
  const [settingsSearch, setSettingsSearch] = useState("");
  const [settingsFilter, setSettingsFilter] = useState<"todos" | "activos" | "inactivos">("todos");
  const [settingsOpenCategories, setSettingsOpenCategories] = useState<Set<string>>(new Set());
  const [settingsPanelClosed, setSettingsPanelClosed] = useState(false);
  const [invoices, setInvoices] = useState<FacturaConverted[]>([]);
  const [appointments, setAppointments] = useState<TeamAppointmentRecord[]>([]);
  const [schedulesByStylist, setSchedulesByStylist] = useState<Record<string, TeamScheduleRecord[]>>({});
  const [performanceRows, setPerformanceRows] = useState<PerformanceProfessional[]>([]);
  const [performanceError, setPerformanceError] = useState<string | null>(null);
  const [performancePeriod, setPerformancePeriod] = useState<PerformancePeriod | null>(null);



  const invoicesCacheRef = useRef<Map<string, FacturaConverted[]>>(new Map());
  const appointmentsCacheRef = useRef<Map<string, TeamAppointmentRecord[]>>(new Map());
  const schedulesCacheRef = useRef<Map<string, TeamScheduleRecord[]>>(new Map());
  const performanceCacheRef = useRef<
    Map<
      string,
      {
        rows: PerformanceProfessional[];
        period: PerformancePeriod | null;
      }
    >
  >(new Map());
  const performanceRequestKeyRef = useRef<string>("");

  const token =
    user?.access_token ||
    sessionStorage.getItem("access_token") ||
    localStorage.getItem("access_token") ||
    "";
  const currency = String(user?.moneda || getStoredCurrency("USD")).toUpperCase();

  const isSuperAdmin = useMemo(() => {
    const role = normalizeText(user?.role).replace(/[\s-]+/g, "_");
    return role === "super_admin" || role === "superadmin";
  }, [user?.role]);

  const allowedSedeIds = useMemo(
    () => getAllowedSedeIds(user ?? null, activeSedeId),
    [activeSedeId, user],
  );

  const visibleSedes = useMemo(() => {
    if (isSuperAdmin) {
      return sedes;
    }

    const allowedSet = new Set(allowedSedeIds);
    if (allowedSet.size === 0) {
      return sedes;
    }

    return sedes.filter((sede) => allowedSet.has(String(sede.sede_id ?? "").trim()));
  }, [allowedSedeIds, isSuperAdmin, sedes]);

  const canSelectAllSedes = visibleSedes.length > 1;
  const shouldShowSedeDropdown = visibleSedes.length > 1;
  const isAllSedesSelected = selectedSedeId === ALL_SEDES_VALUE;

  const selectedSedeIds = useMemo(() => {
    if (isAllSedesSelected) {
      return visibleSedes
        .map((sede) => String(sede.sede_id ?? "").trim())
        .filter(Boolean);
    }

    return selectedSedeId ? [selectedSedeId] : [];
  }, [isAllSedesSelected, selectedSedeId, visibleSedes]);

  const primarySelectedSedeId = selectedSedeIds[0] ?? "";

  const performanceRange = useMemo(
    () => ({
      start: dateRange.start,
      end: dateRange.end,
    }),
    [dateRange.end, dateRange.start],
  );

  const performanceCacheKey = useMemo(
    () =>
      `${isAllSedesSelected ? "ALL" : selectedSedeIds[0] ?? "NONE"}:${performanceRange.start}:${performanceRange.end}`,
    [isAllSedesSelected, performanceRange.end, performanceRange.start, selectedSedeIds],
  );

  const selectedSede = useMemo(
    () => visibleSedes.find((sede) => sede.sede_id === selectedSedeId) ?? null,
    [selectedSedeId, visibleSedes],
  );

  const selectedSedeLabel = useMemo(() => {
    if (isAllSedesSelected) {
      return "Todas las sedes";
    }

    return selectedSede
      ? formatSedeNombre(selectedSede.nombre, selectedSede.sede_id)
      : "Equipo";
  }, [isAllSedesSelected, selectedSede]);

  const filteredStylists = useMemo(() => {
    if (selectedSedeIds.length === 0) return [];
    const selectedIds = new Set(selectedSedeIds);
    return stylists
      .filter((stylist) => selectedIds.has(String(stylist.sede_id ?? "").trim()))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [selectedSedeIds, stylists]);

  const filteredSettingsStylists = useMemo(() => {
    let list = filteredStylists;
    if (settingsFilter === "activos") list = list.filter((s) => s.activo);
    else if (settingsFilter === "inactivos") list = list.filter((s) => !s.activo);
    if (settingsSearch.trim()) {
      const q = normalizeText(settingsSearch);
      list = list.filter(
        (s) => normalizeText(s.nombre).includes(q) || normalizeText(s.email).includes(q),
      );
    }
    return list;
  }, [filteredStylists, settingsFilter, settingsSearch]);

  const selectedStylist = useMemo(
    () => filteredStylists.find((stylist) => stylist.profesional_id === selectedStylistId) ?? null,
    [filteredStylists, selectedStylistId],
  );

  const serviceOptionsById = useMemo(
    () => new Map(services.map((service) => [service.id, service])),
    [services],
  );

  const getServiceIdForCategory = useCallback(
    (category: string): string | null => {
      const normalized = normalizeText(category);
      const match = services.find(
        (service) => normalizeText(service.categoria) === normalized && service.id,
      );
      return match?.id ?? null;
    },
    [services],
  );

  const buildServiceIdsFromCategoryCommissions = useCallback(
    (categoryMap: unknown): string[] => {
      if (!categoryMap || typeof categoryMap !== "object" || Array.isArray(categoryMap)) {
        return [];
      }

      const ids = Object.keys(categoryMap as Record<string, unknown>)
        .map((category) => getServiceIdForCategory(category))
        .filter((id): id is string => Boolean(id));

      return Array.from(new Set(ids));
    },
    [getServiceIdForCategory],
  );

  const categoryOptions = useMemo(() => {
    if (!selectedStylist) return [];
    const categoryMap = selectedStylist.comisiones_por_categoria;
    if (!categoryMap || typeof categoryMap !== "object" || Array.isArray(categoryMap)) return [];

    return Object.keys(categoryMap as Record<string, unknown>)
      .map((category) => {
        const serviceId = getServiceIdForCategory(category);
        return serviceId ? { category, serviceId } : null;
      })
      .filter((item): item is { category: string; serviceId: string } => Boolean(item));
  }, [getServiceIdForCategory, selectedStylist]);

  const useCategoryOptions = categoryOptions.length > 0;

  const resolveServiceIdsAndCommissions = useCallback(
    (stylist: Estilista, targetSedeId: string) => {
      const resolvedCommissions = resolveServiceCommissions(
        stylist as unknown as Record<string, unknown>,
        targetSedeId,
      );

      const specialtyServiceIds = Array.isArray(stylist.especialidades_detalle)
        ? stylist.especialidades_detalle.map((detail) => detail.id).filter(Boolean)
        : [];

    const categoryServiceIds = buildServiceIdsFromCategoryCommissions(
      stylist.comisiones_por_categoria,
    );

      const commissionServiceIds = resolvedCommissions.entries.map((entry) => entry.servicio_id);

      const mergedServiceIds = Array.from(
        new Set([...specialtyServiceIds, ...categoryServiceIds, ...commissionServiceIds]),
      );

      return {
        serviceIds: mergedServiceIds,
        resolvedCommissions,
      };
    },
    [buildServiceIdsFromCategoryCommissions],
  );

  const selectServiceOptions = useMemo(() => {
    if (!useCategoryOptions) {
      return services;
    }

    // Priorizar las categorías ya configuradas, pero mostrar todos los servicios disponibles
    const categoryServices = categoryOptions.map(({ category, serviceId }) => ({
      id: serviceId,
      nombre: category,
      categoria: category,
      duracion: 0,
      precio: 0,
    }));

    const categoryIds = new Set(categoryServices.map((s) => s.id));
    const remainingServices = services.filter((s) => !categoryIds.has(s.id));

    return [...categoryServices, ...remainingServices];
  }, [categoryOptions, services, useCategoryOptions]);

  const baseDashboardRows = useMemo(
    () =>
      buildStylistDashboardRows({
        stylists: filteredStylists,
        invoices,
        appointments,
        schedulesByStylist,
        range: dateRange,
      }),
    [appointments, dateRange, filteredStylists, invoices, schedulesByStylist],
  );

  const dashboardRows: DashboardRowWithProducts[] = useMemo(() => {
    if (baseDashboardRows.length === 0) return [];

    const productCountByStylist = new Map<string, number>();

    invoices.forEach((invoice) => {
      const stylistId = String(invoice.profesional_id ?? "").trim();
      if (!stylistId || !Array.isArray(invoice.items)) return;

      const productCount = invoice.items.reduce((total, item) => {
        const itemType = normalizeText(item.tipo);
        const isProduct =
          itemType.includes("producto") || (item.producto_id && !item.servicio_id);
        const quantity = Number(item.cantidad ?? 0);

        if (!isProduct || !Number.isFinite(quantity)) return total;
        return total + quantity;
      }, 0);

      if (productCount > 0) {
        productCountByStylist.set(
          stylistId,
          (productCountByStylist.get(stylistId) ?? 0) + productCount,
        );
      }
    });

    return baseDashboardRows.map((row) => ({
      ...row,
      cantidadProductos: productCountByStylist.get(row.profesionalId) ?? 0,
    }));
  }, [baseDashboardRows, invoices]);

  const panelEstilista = useMemo(
    () => (panelEstilistaId ? (dashboardRows.find((r) => r.profesionalId === panelEstilistaId) ?? null) : null),
    [panelEstilistaId, dashboardRows],
  );

  const panelPeriodoLabel = useMemo(() => {
    if (periodoActivo === "hoy") return "Hoy";
    if (periodoActivo === "7dias") return "Últimos 7 días";
    if (periodoActivo === "mes") return "Mes actual";
    if (periodoActivo === "30dias") return "Últimos 30 días";
    return `${formatDateRangeSelectValue(dateRange.start)} – ${formatDateRangeSelectValue(dateRange.end)}`;
  }, [periodoActivo, dateRange.start, dateRange.end]);

  const vendorRows = useMemo(
    () => buildVendorRows(systemUsers, selectedSedeIds, filteredStylists, invoices),
    [filteredStylists, invoices, selectedSedeIds, systemUsers],
  );

  const monthlyProjectionRows = useMemo<MonthlyProjectionRow[]>(() => {
    if (!performanceRows || performanceRows.length === 0) return [];

    return performanceRows
      .map((prof) => {
        const citasActivas =
          typeof prof.citas?.activas === "number"
            ? prof.citas.activas
            : typeof prof.citas?.total === "number"
              ? prof.citas.total
              : null;

        return {
          profesionalId: prof.profesional_id,
          nombre: prof.nombre || "Sin nombre",
          citasActivas,
          ingresosGenerados: prof.kpis?.ingresos_generados ?? null,
          comisionProyectada: prof.kpis?.comision_proyectada ?? null,
          ocupacionPct:
            prof.kpis?.tasa_ocupacion_pct === undefined
              ? null
              : prof.kpis?.tasa_ocupacion_pct ?? null,
        };
      })
      .sort((a, b) => {
        const diff = (b.ingresosGenerados ?? 0) - (a.ingresosGenerados ?? 0);
        if (diff !== 0) return diff;
        return a.nombre.localeCompare(b.nombre);
      });
  }, [performanceRows]);

  const performancePeriodLabel = useMemo(() => {
    if (performancePeriod?.desde && performancePeriod?.hasta) {
      return `${formatDateRangeSelectValue(performancePeriod.desde)} - ${formatDateRangeSelectValue(performancePeriod.hasta)}`;
    }

    return `${formatDateRangeSelectValue(performanceRange.start)} - ${formatDateRangeSelectValue(performanceRange.end)}`;
  }, [performanceRange.end, performanceRange.start, performancePeriod?.desde, performancePeriod?.hasta]);

  const initializeEditorState = useCallback(
    (stylist: Estilista | null, mode: "create" | "edit" = "edit") => {
      const targetSedeId =
        String(stylist?.sede_id ?? "").trim() ||
        String(primarySelectedSedeId ?? "").trim() ||
        String(selectedSedeId ?? "").trim();

      if (!targetSedeId || selectedSedeId === ALL_SEDES_VALUE && mode === "create") {
        setEditorState(null);
        return;
      }

      if (!stylist || mode === "create") {
        setEditorState({
          mode: "create",
          nombre: "",
          email: "",
          telefono: "",
          rol: "estilista",
          sede_id: targetSedeId,
          comision: "",
          password: "",
          activo: true,
          serviceIds: [],
          serviceCommissions: [],
          productCommission: "",
        });
        return;
      }

      const { serviceIds, resolvedCommissions } = resolveServiceIdsAndCommissions(
        stylist,
        targetSedeId,
      );
      const categoryCommissions = resolveCategoryCommissionEntries(
        stylist as unknown as Record<string, unknown>,
        services,
        serviceIds,
      );

      const matchedUser =
        systemUsers.find(
          (systemUser) => normalizeText(systemUser.email) === normalizeText(stylist.email),
        ) ?? null;

      setEditorState({
        mode: "edit",
        nombre: stylist.nombre || "",
        email: stylist.email || "",
        telefono: stylist.telefono || "",
        rol: matchedUser?.role || stylist.rol || "estilista",
        sede_id: stylist.sede_id || targetSedeId,
        comision:
          stylist.comision !== null && stylist.comision !== undefined ? String(stylist.comision) : "",
        password: "",
        activo: Boolean(stylist.activo),
        serviceIds,
        serviceCommissions: (categoryCommissions.length > 0
          ? categoryCommissions
          : resolvedCommissions.entries
        ).map((entry) => ({
        ...entry,
        tipo: "%",
      })),
        productCommission:
          stylist.comision_productos !== null && stylist.comision_productos !== undefined
            ? String(stylist.comision_productos)
            : "",
      });
    },
    [primarySelectedSedeId, resolveServiceIdsAndCommissions, selectedSedeId, services, systemUsers],
  );

  const loadBaseData = useCallback(async () => {
    if (!token) {
      setBootError("No hay token de autenticación disponible.");
      setIsBootLoading(false);
      return;
    }

    setIsBootLoading(true);
    setBootError(null);

    try {
      const [sedesData, stylistsData, servicesData, usersData] = await Promise.all([
        sedeService.getSedes(token),
        stylistApi.getEstilistas(token),
        servicesApi.getServicios(token, currency),
        systemUsersService.getSystemUsers(token).catch(() => []),
      ]);

      const normalizedServices = servicesData
        .map((service) => {
          const serviceId = String(service.servicio_id ?? service.id ?? "").trim();
          if (!serviceId) return null;

          return {
            id: serviceId,
            nombre: service.nombre,
            categoria: String(service.categoria ?? "").trim(),
            duracion: Number(service.duracion ?? 0),
            precio: Number(service.precio_local ?? service.precio ?? 0),
          } satisfies ServiceOption;
        })
        .filter((service): service is ServiceOption => Boolean(service))
        .sort((a, b) => a.nombre.localeCompare(b.nombre));

      setSedes(Array.isArray(sedesData) ? sedesData : []);
      setStylists(Array.isArray(stylistsData) ? stylistsData : []);
      setServices(normalizedServices);
      setSystemUsers(Array.isArray(usersData) ? usersData : []);
    } catch (error) {
      console.error("Error cargando módulo de estilistas:", error);
      setBootError(
        error instanceof Error
          ? error.message
          : "No se pudo cargar la información del módulo de equipo.",
      );
    } finally {
      setIsBootLoading(false);
    }
  }, [currency, servicesApi, stylistApi, token]);

  const loadAppointmentsForRange = useCallback(
    async (sedeId: string, range: DateRangeValue): Promise<TeamAppointmentRecord[]> => {
      const dates = enumerateDateRange(range);
      const results: TeamAppointmentRecord[] = [];

      for (const group of chunk(dates, 5)) {
        const groupResults = await Promise.all(
          group.map(async (dateValue) => {
            const cacheKey = `${sedeId}:${dateValue}`;
            const cached = appointmentsCacheRef.current.get(cacheKey);
            if (cached) {
              return cached;
            }

            try {
              const response = await getCitas({ sede_id: sedeId, fecha: dateValue }, token);
              const source = Array.isArray((response as { citas?: unknown[] })?.citas)
                ? ((response as { citas?: unknown[] }).citas ?? [])
                : Array.isArray(response)
                  ? response
                  : [];

              const normalized = source
                .map((item) => normalizeAppointmentRecord(item))
                .filter((item): item is TeamAppointmentRecord => Boolean(item));

              appointmentsCacheRef.current.set(cacheKey, normalized);
              return normalized;
            } catch (error) {
              console.error(`Error cargando citas para ${dateValue}:`, error);
              appointmentsCacheRef.current.set(cacheKey, []);
              return [];
            }
          }),
        );

        groupResults.forEach((items) => results.push(...items));
      }

      return results;
    },
    [token],
  );

  const loadSchedulesForStylists = useCallback(
    async (items: Estilista[]): Promise<Record<string, TeamScheduleRecord[]>> => {
      const nextSchedules: Record<string, TeamScheduleRecord[]> = {};

      const responses = await Promise.allSettled(
        items.map(async (stylist) => {
          const cacheKey = stylist.profesional_id;
          const cached = schedulesCacheRef.current.get(cacheKey);
          if (cached) {
            return { profesionalId: cacheKey, schedules: cached };
          }

          const source = await getHorariosEstilista(token, cacheKey);
          const normalized = (Array.isArray(source) ? source : [])
            .map((schedule) => normalizeScheduleRecord(schedule))
            .filter((schedule): schedule is TeamScheduleRecord => Boolean(schedule));

          schedulesCacheRef.current.set(cacheKey, normalized);
          return { profesionalId: cacheKey, schedules: normalized };
        }),
      );

      responses.forEach((response) => {
        if (response.status === "fulfilled") {
          nextSchedules[response.value.profesionalId] = response.value.schedules;
        }
      });

      return nextSchedules;
    },
    [token],
  );

  const loadPerformance = useCallback(async () => {
    if (!token || selectedSedeIds.length === 0) {
      setPerformanceRows([]);
      setPerformancePeriod(null);
      setPerformanceError(null);
      setIsPerformanceLoading(false);
      return;
    }

    const sedeForRequest = isAllSedesSelected ? undefined : selectedSedeIds[0];
    const requestKey = performanceCacheKey;
    performanceRequestKeyRef.current = requestKey;
    const cached = performanceCacheRef.current.get(performanceCacheKey);

    if (cached) {
      setPerformanceRows(cached.rows);
      setPerformancePeriod(cached.period);
      setPerformanceError(null);
      setIsPerformanceLoading(false);
      return;
    }

    setIsPerformanceLoading(true);
    setPerformanceError(null);

    try {
        const response = await fetchPerformanceAnalytics({
          token,
          sedeId: sedeForRequest,
          fechaDesde: performanceRange.start,
          fechaHasta: performanceRange.end,
        });

      const rows = Array.isArray(response.profesionales) ? response.profesionales : [];
      const period = response.periodo ?? null;

      performanceCacheRef.current.set(requestKey, { rows, period });

      if (performanceRequestKeyRef.current !== requestKey) {
        return;
      }

      setPerformanceRows(rows);
      setPerformancePeriod(period);
    } catch (error) {
      console.error("Error cargando performance mensual:", error);
      if (performanceRequestKeyRef.current === requestKey) {
        setPerformanceRows([]);
        setPerformancePeriod(null);
        setPerformanceError(
          error instanceof Error ? error.message : "No se pudo cargar la proyección mensual.",
        );
      }
    } finally {
      if (performanceRequestKeyRef.current === requestKey) {
        setIsPerformanceLoading(false);
      }
    }
  }, [
    isAllSedesSelected,
    performanceCacheKey,
    performanceRange.end,
    performanceRange.start,
    selectedSedeIds,
    token,
  ]);

  useEffect(() => {
    if (!authLoading && token) {
      void loadBaseData();
    }
  }, [authLoading, loadBaseData, token]);

  useEffect(() => {
    if (visibleSedes.length === 0) {
      setSelectedSedeId("");
      return;
    }

    if (
      selectedSedeId &&
      ((selectedSedeId === ALL_SEDES_VALUE && canSelectAllSedes) ||
        visibleSedes.some((sede) => sede.sede_id === selectedSedeId))
    ) {
      return;
    }

    const nextSedeId =
      canSelectAllSedes && isSuperAdmin
        ? ALL_SEDES_VALUE
        : activeSedeId && visibleSedes.some((sede) => sede.sede_id === activeSedeId)
        ? activeSedeId
        : String(user?.sede_id_principal ?? "").trim() &&
            visibleSedes.some((sede) => sede.sede_id === user?.sede_id_principal)
          ? String(user?.sede_id_principal ?? "").trim()
          : visibleSedes[0]?.sede_id || "";

    setSelectedSedeId(nextSedeId);
  }, [activeSedeId, canSelectAllSedes, isSuperAdmin, selectedSedeId, user?.sede_id_principal, visibleSedes]);

  useEffect(() => {
    if (!selectedSedeId || selectedSedeId === ALL_SEDES_VALUE || selectedSedeId === activeSedeId) {
      return;
    }
    setActiveSedeId(selectedSedeId);
  }, [activeSedeId, selectedSedeId, setActiveSedeId]);

  useEffect(() => {
    if (settingsPanelClosed) return;
    if (filteredStylists.length === 0) {
      setSelectedStylistId("");
      initializeEditorState(null, "create");
      return;
    }

    if (selectedStylistId && filteredStylists.some((stylist) => stylist.profesional_id === selectedStylistId)) {
      return;
    }

    setSelectedStylistId(filteredStylists[0].profesional_id);
  }, [filteredStylists, initializeEditorState, selectedStylistId, settingsPanelClosed]);

  useEffect(() => {
    if (settingsPanelClosed) return;
    if (!selectedStylist) {
      initializeEditorState(null, "create");
      return;
    }

    initializeEditorState(selectedStylist, "edit");
  }, [initializeEditorState, selectedStylist, settingsPanelClosed]);

  useEffect(() => {
    void loadPerformance();
  }, [loadPerformance]);

  useEffect(() => {
    if (!token || selectedSedeIds.length === 0 || filteredStylists.length === 0) {
      setInvoices([]);
      setAppointments([]);
      setSchedulesByStylist({});
      return;
    }

    let isMounted = true;
    const loadMetrics = async () => {
      setIsMetricsLoading(true);
      setMetricsError(null);
      setMetricsWarning(null);

      const invoiceResults = await Promise.allSettled(
        selectedSedeIds.map(async (sedeId) => {
          const rangeKey = `${sedeId}:${dateRange.start}:${dateRange.end}`;
          const cached = invoicesCacheRef.current.get(rangeKey);
          if (cached) {
            return cached;
          }

          const result = await facturaService.getTodasVentasBySede(sedeId, {
            fecha_desde: dateRange.start,
            fecha_hasta: dateRange.end,
            pageSize: 200,
          });

          invoicesCacheRef.current.set(rangeKey, result);
          return result;
        }),
      );

      const appointmentResults = await Promise.allSettled(
        selectedSedeIds.map((sedeId) => loadAppointmentsForRange(sedeId, dateRange)),
      );

      const schedulesResult = await Promise.allSettled([
        loadSchedulesForStylists(filteredStylists),
      ]);

      if (!isMounted) return;

      const successfulInvoices = invoiceResults
        .filter(
          (result): result is PromiseFulfilledResult<FacturaConverted[]> =>
            result.status === "fulfilled",
        )
        .flatMap((result) => result.value);

      if (successfulInvoices.length > 0 || invoiceResults.length === 0) {
        setInvoices(successfulInvoices);
      } else {
        console.error("Error cargando ventas del equipo:", invoiceResults);
        setInvoices([]);
        setMetricsError("No se pudieron cargar las ventas del equipo para el rango seleccionado.");
      }

      const successfulAppointments = appointmentResults
        .filter(
          (result): result is PromiseFulfilledResult<TeamAppointmentRecord[]> =>
            result.status === "fulfilled",
        )
        .flatMap((result) => result.value);

      if (successfulAppointments.length > 0 || appointmentResults.length === 0) {
        setAppointments(successfulAppointments);
      } else {
        console.error("Error cargando citas del equipo:", appointmentResults);
        setAppointments([]);
        setMetricsWarning(
          "No se pudieron calcular las citas y la ocupación para este rango. Las ventas y comisiones siguen disponibles.",
        );
      }

      if (schedulesResult[0]?.status === "fulfilled") {
        setSchedulesByStylist(schedulesResult[0].value);
      } else {
        console.error("Error cargando horarios del equipo:", schedulesResult[0]);
        setSchedulesByStylist({});
        setMetricsWarning(
          "No se pudo calcular la ocupación con los horarios actuales. Las demás métricas siguen disponibles.",
        );
      }

      const failedInvoiceCount = invoiceResults.filter((result) => result.status === "rejected").length;
      const failedAppointmentCount = appointmentResults.filter((result) => result.status === "rejected").length;

      if (
        (failedInvoiceCount > 0 && successfulInvoices.length > 0) ||
        (failedAppointmentCount > 0 && successfulAppointments.length > 0)
      ) {
        setMetricsWarning(
          "Se cargaron datos parciales: una o más sedes no respondieron a tiempo para este rango.",
        );
      }

      setIsMetricsLoading(false);
    };

    void loadMetrics();

    return () => {
      isMounted = false;
    };
  }, [dateRange, filteredStylists, loadAppointmentsForRange, loadSchedulesForStylists, selectedSedeIds, token]);

  const handlePeriodoChange = useCallback((periodo: PeriodoId, fechas?: { from: Date; to: Date }) => {
    setPeriodoActivo(periodo);
    const hoy = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const todayStr = fmt(hoy);
    if (periodo === "hoy") {
      setDateRange({ start: todayStr, end: todayStr });
    } else if (periodo === "7dias") {
      const s = new Date(hoy); s.setDate(s.getDate() - 6);
      setDateRange({ start: fmt(s), end: todayStr });
    } else if (periodo === "mes") {
      const s = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      setDateRange({ start: fmt(s), end: todayStr });
    } else if (periodo === "30dias") {
      const s = new Date(hoy); s.setDate(s.getDate() - 29);
      setDateRange({ start: fmt(s), end: todayStr });
    } else if (periodo === "rango" && fechas) {
      setRangoAplicado(fechas);
      // ✅ DEBUG: Verify custom range dates
      console.log('[StylistsTeamWorkspace] Custom range applied:', {
        from: fechas.from,
        to: fechas.to,
        from_month: fechas.from.getMonth(),
        to_month: fechas.to.getMonth(),
      });
      setDateRange({ start: fmt(fechas.from), end: fmt(fechas.to) });
    }
  }, []);

  const updateEditor = <K extends keyof EditorState>(key: K, value: EditorState[K]) => {
    setEditorState((current) => (current ? { ...current, [key]: value } : current));
  };

  const getNormalizedCategoryForService = (serviceId: string): string =>
    normalizeText(serviceOptionsById.get(serviceId)?.categoria ?? "");

  const addServiceToEditor = () => {
    if (!editorState) return;

    const nextService = selectServiceOptions.find(
      (service) => !editorState.serviceIds.includes(service.id),
    );
    if (!nextService) return;

    setEditorState((current) =>
      current
        ? {
            ...current,
            serviceIds: [...current.serviceIds, nextService.id],
            serviceCommissions: [
              ...current.serviceCommissions,
              {
                servicio_id: nextService.id,
                valor:
                  current.serviceCommissions.find(
                    (entry) =>
                      getNormalizedCategoryForService(entry.servicio_id) ===
                      getNormalizedCategoryForService(nextService.id),
                  )?.valor ?? 0,
                tipo: "%" as const,
              },
            ],
          }
        : current,
    );
  };


  const removeServiceSelection = (serviceId: string) => {
    setEditorState((current) =>
      current
        ? {
            ...current,
            serviceIds: current.serviceIds.filter((currentServiceId) => currentServiceId !== serviceId),
            serviceCommissions: current.serviceCommissions.filter(
              (entry) => entry.servicio_id !== serviceId,
            ),
          }
        : current,
    );
  };

  const updateServiceCommission = (
    serviceId: string,
    updates: Partial<ServiceCommissionEntry>,
  ) => {
    setEditorState((current) => {
      if (!current) return current;

      const category = getNormalizedCategoryForService(serviceId);
      const hasEntry = current.serviceCommissions.some((entry) => entry.servicio_id === serviceId);
      const nextEntries = hasEntry
        ? current.serviceCommissions.map((entry) =>
            entry.servicio_id === serviceId ||
            (category && getNormalizedCategoryForService(entry.servicio_id) === category)
              ? { ...entry, ...updates, tipo: "%" as const }
              : entry,
          )
        : [
            ...current.serviceCommissions,
            { servicio_id: serviceId, valor: Number(updates.valor ?? 0), tipo: "%" as const },
          ];

      return {
        ...current,
        serviceCommissions: nextEntries,
      };
    });
  };

  const reloadStylists = useCallback(async () => {
    if (!token) return;
    const data = await stylistApi.getEstilistas(token);
    setStylists(Array.isArray(data) ? data : []);
  }, [stylistApi, token]);

  const handleSave = async () => {
    const targetSedeId =
      editorState?.mode === "edit"
        ? String(selectedStylist?.sede_id ?? editorState?.sede_id ?? primarySelectedSedeId).trim()
        : String(editorState?.sede_id ?? primarySelectedSedeId).trim();

    if (!token || !editorState || !targetSedeId) return;
    if (!editorState.nombre.trim() || !editorState.email.trim()) return;
    if (editorState.mode === "create" && !editorState.password.trim()) return;

    try {
      setIsSaving(true);
      const commission = parseCommissionValue(editorState.comision);
      const productCommission = parseCommissionValue(editorState.productCommission);

      if (productCommission !== null && (productCommission < 0 || productCommission > 100)) {
        setBootError("La comisión por productos debe estar entre 0 y 100.");
        setIsSaving(false);
        return;
      }

      if (editorState.mode === "create") {
        const payload: CreateEstilistaData = {
          nombre: editorState.nombre.trim(),
          email: editorState.email.trim(),
          sede_id: targetSedeId,
          especialidades: true,
          comision: commission,
          comision_productos: productCommission,
          password: editorState.password.trim(),
          activo: editorState.activo,
        };

        const created = await stylistApi.createEstilista(token, payload);
        if (typeof stylistApi.updateServicios === "function") {
          const selectedIds = new Set(editorState.serviceIds);
          const serviciosNoPresta = services
            .map((service) => service.id)
            .filter((serviceId) => !selectedIds.has(serviceId));
          await stylistApi.updateServicios(token, created.profesional_id, serviciosNoPresta);
        }
        if (
          typeof stylistApi.updateServiceCommissions === "function" &&
          (editorState.serviceIds.length > 0 || editorState.serviceCommissions.length > 0)
        ) {
          const categoryPayload = buildCategoryCommissionPayload(
            services,
            editorState.serviceIds,
            editorState.serviceCommissions,
          );
          await stylistApi.updateServiceCommissions(token, created.profesional_id, categoryPayload);
        }
        await reloadStylists();
        setSelectedStylistId(created.profesional_id);
      } else if (selectedStylist) {
        const { serviceIds: initialServiceIds } = resolveServiceIdsAndCommissions(
          selectedStylist,
          targetSedeId,
        );
        const nextServiceIds = editorState.serviceIds.filter(Boolean);
        const normalizedInitialServiceIds = [...new Set(initialServiceIds)].sort();
        const normalizedNextServiceIds = [...new Set(nextServiceIds)].sort();
        const hasServiceSelectionChanges =
          JSON.stringify(normalizedInitialServiceIds) !== JSON.stringify(normalizedNextServiceIds);

        const initialCommission = selectedStylist.comision ?? null;
        const initialProductCommission = selectedStylist.comision_productos ?? null;
        const hasBasicChanges =
          selectedStylist.nombre !== editorState.nombre.trim() ||
          selectedStylist.email !== editorState.email.trim() ||
          String(selectedStylist.sede_id ?? "").trim() !== targetSedeId ||
          Boolean(selectedStylist.activo) !== editorState.activo ||
          initialCommission !== commission ||
          initialProductCommission !== productCommission;

        const initialCommissionEntries = resolveCategoryCommissionEntries(
          selectedStylist as unknown as Record<string, unknown>,
          services,
          initialServiceIds,
        );
        const currentCategoryPayload = buildCategoryCommissionPayload(
          services,
          nextServiceIds,
          editorState.serviceCommissions,
        );
        const initialCategoryPayload = buildCategoryCommissionPayload(
          services,
          initialServiceIds,
          initialCommissionEntries,
        );
        const hasServiceCommissionChanges =
          JSON.stringify(Object.entries(initialCategoryPayload).sort(([a], [b]) => a.localeCompare(b))) !==
          JSON.stringify(Object.entries(currentCategoryPayload).sort(([a], [b]) => a.localeCompare(b)));

        if (hasBasicChanges) {
          const payload: Partial<Estilista> & Record<string, unknown> = {
            nombre: editorState.nombre.trim(),
            email: editorState.email.trim(),
            sede_id: targetSedeId,
            especialidades: true,
            activo: editorState.activo,
            comision: commission,
            comision_productos: productCommission,
            password: editorState.password.trim() || DEFAULT_STYLIST_PASSWORD,
          };

          await stylistApi.updateEstilista(token, selectedStylist.profesional_id, payload);
        }
        if (hasServiceSelectionChanges && typeof stylistApi.updateServicios === "function") {
          const selectedIds = new Set(nextServiceIds);
          const serviciosNoPresta = services
            .map((service) => service.id)
            .filter((serviceId) => !selectedIds.has(serviceId));
          await stylistApi.updateServicios(token, selectedStylist.profesional_id, serviciosNoPresta);
        }
        if (hasServiceCommissionChanges && typeof stylistApi.updateServiceCommissions === "function") {
          await stylistApi.updateServiceCommissions(
            token,
            selectedStylist.profesional_id,
            currentCategoryPayload,
          );
        }
        await reloadStylists();
      }
    } catch (error) {
      console.error("Error guardando estilista:", error);
      setBootError(
        error instanceof Error ? error.message : "No se pudo guardar la configuración del estilista.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!token || !selectedStylist) return;
    const confirmed = await confirmAction({ title: "Confirmar", message: `¿Eliminar a ${selectedStylist.nombre}?`, confirmLabel: "Sí, eliminar", variant: "danger" });
    if (!confirmed) return;

    try {
      setIsSaving(true);
      await stylistApi.deleteEstilista(token, selectedStylist.profesional_id);
      await reloadStylists();
    } catch (error) {
      console.error("Error eliminando estilista:", error);
      setBootError(
        error instanceof Error ? error.message : "No se pudo eliminar el estilista seleccionado.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleLegacyCreateSave = async (payload: LegacyCreatePayload) => {
    if (!token) {
      setBootError("No hay token de autenticación disponible.");
      return;
    }

    const targetSedeId = String(
      payload.sede_id ?? legacyEditStylist?.sede_id ?? primarySelectedSedeId ?? "",
    ).trim();
    if (!targetSedeId) {
      setBootError("Debes seleccionar una sede para crear el estilista.");
      return;
    }

    try {
      setIsLegacyCreateSaving(true);
      setBootError(null);

      const normalizeCommission = (value: unknown): number | null => {
        if (typeof value === "number") return value;
        if (value === null || value === undefined) return null;
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
      };

      if (legacyEditStylist) {
        const updatePayload: Partial<Estilista> & Record<string, unknown> = {
          nombre: String(payload.nombre ?? legacyEditStylist.nombre ?? "").trim(),
          email: String(payload.email ?? legacyEditStylist.email ?? "").trim(),
          sede_id: targetSedeId,
          especialidades: true,
          comision: normalizeCommission(payload.comision),
          comision_productos: normalizeCommission((payload as any).comision_productos),
          activo: payload.activo ?? legacyEditStylist.activo ?? true,
          telefono: typeof payload.telefono === "string" ? payload.telefono.trim() : undefined,
          password: String(payload.password ?? "").trim() || DEFAULT_STYLIST_PASSWORD,
        };

        await stylistApi.updateEstilista(token, legacyEditStylist.profesional_id, updatePayload);

        if (payload.horario) {
          if (typeof stylistApi.updateHorario === "function" && payload.horarioId) {
            await stylistApi.updateHorario(token, payload.horarioId, {
              ...payload.horario,
              profesional_id: legacyEditStylist.profesional_id,
              sede_id: targetSedeId,
            });
          } else if (typeof stylistApi.createHorario === "function") {
            await stylistApi.createHorario(token, {
              ...payload.horario,
              profesional_id: legacyEditStylist.profesional_id,
              sede_id: targetSedeId,
            });
          }
        }

        setSelectedStylistId(legacyEditStylist.profesional_id);
      } else {
        const createPayload: CreateEstilistaData = {
          nombre: String(payload.nombre ?? "").trim(),
          email: String(payload.email ?? "").trim(),
          sede_id: targetSedeId,
          especialidades: true,
          comision: normalizeCommission(payload.comision),
          telefono: typeof payload.telefono === "string" ? payload.telefono.trim() : undefined,
          password: String(payload.password ?? "").trim() || DEFAULT_STYLIST_PASSWORD,
          activo: payload.activo ?? true,
        };

        const created = await stylistApi.createEstilista(token, createPayload);

        if (payload.horario && typeof stylistApi.createHorario === "function") {
          await stylistApi.createHorario(token, {
            ...payload.horario,
            profesional_id: created.profesional_id,
            sede_id: targetSedeId,
          });
        }

        if (selectedSedeId !== ALL_SEDES_VALUE && selectedSedeId !== targetSedeId) {
          setSelectedSedeId(targetSedeId);
        }

        setSelectedStylistId(created.profesional_id);
      }

      await reloadStylists();
      setIsLegacyCreateOpen(false);
      setLegacyEditStylist(null);
    } catch (error) {
      console.error("Error creando estilista desde modal legado:", error);
      setBootError(
        error instanceof Error
          ? error.message
          : "No se pudo crear el estilista con el formulario anterior.",
      );
    } finally {
      setIsLegacyCreateSaving(false);
    }
  };

  const handleReloadPerformance = useCallback(() => {
    performanceCacheRef.current.delete(performanceCacheKey);
    void loadPerformance();
  }, [loadPerformance, performanceCacheKey]);



  const toggleSettingsCategory = useCallback((cat: string) => {
    setSettingsOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const getServiceTagsForStylist = useCallback(
    (stylist: Estilista): string[] => {
      const details = Array.isArray(stylist.especialidades_detalle)
        ? stylist.especialidades_detalle
        : [];
      if (details.length > 0) {
        return details.map((d) => d.nombre || "").filter(Boolean);
      }
      const specs = Array.isArray(stylist.especialidades) ? stylist.especialidades : [];
      return specs.filter((s): s is string => typeof s === "string" && Boolean(s));
    },
    [],
  );

  const getServiceCategoriesGrouped = useCallback(() => {
    if (!editorState) return new Map<string, { serviceId: string; nombre: string; categoria: string }[]>();
    const grouped = new Map<string, { serviceId: string; nombre: string; categoria: string }[]>();
    for (const sId of editorState.serviceIds) {
      const svc = serviceOptionsById.get(sId);
      const cat = svc?.categoria || "Sin categoría";
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push({ serviceId: sId, nombre: svc?.nombre || sId, categoria: cat });
    }
    return grouped;
  }, [editorState, serviceOptionsById]);

  const handleOpenCreate = () => {
    if (LegacyCreateModal) {
      setIsLegacyCreateOpen(true);
      setLegacyEditStylist(null);
      return;
    }

    setSelectedStylistId("");
    initializeEditorState(null, "create");
  };

  if (authLoading || isBootLoading) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center bg-white">
        <div className="flex items-center gap-3 text-gray-700">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Cargando módulo de equipo...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white text-gray-900">
      <Sidebar />

      <main className={`flex-1 ${viewMode === "settings" ? "overflow-hidden" : "overflow-auto"}`}>
        <div className={viewMode === "settings" ? "flex flex-col h-full overflow-hidden" : "p-4 md:p-8"}>
          {viewMode === "dashboard" && (
            <PageHeader
              title="Estilistas"
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="default"
                    className={PRIMARY_BUTTON_CLASS}
                    onClick={() => { setSettingsPanelClosed(true); setSelectedStylistId(""); setEditorState(null); setViewMode("settings"); }}
                  >
                    <Settings2 className="mr-2 h-4 w-4" />
                    Configuración de Estilistas
                  </Button>
                </div>
              }
            />
          )}

          {viewMode === "dashboard" && (
          <div className="mt-4">
            {shouldShowSedeDropdown ? (
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium">Sede:</span>
                <select
                  value={selectedSedeId}
                  onChange={(event) => setSelectedSedeId(event.target.value)}
                  className="px-2 py-[5px] border border-slate-200 rounded-lg text-xs bg-white font-semibold text-slate-700 focus:outline-none"
                >
                  {canSelectAllSedes ? (
                    <option value={ALL_SEDES_VALUE}>Todas las sedes</option>
                  ) : null}
                  {visibleSedes.map((sede) => (
                    <option key={sede.sede_id} value={sede.sede_id}>
                      {formatSedeNombre(sede.nombre, sede.sede_id)}
                    </option>
                  ))}
                </select>
              </div>
            ) : selectedSedeLabel ? (
              <p className="mb-2 text-xs text-slate-500">
                Sede: <span className="font-semibold text-slate-700">{selectedSedeLabel}</span>
              </p>
            ) : null}
            {viewMode === "dashboard" && (
              <PeriodoSelector
                periodoActivo={periodoActivo}
                onPeriodoChange={handlePeriodoChange}
                rangoAplicado={rangoAplicado}
              />
            )}
          </div>
          )}

          {bootError ? (
            <div className={ERROR_ALERT_CLASS}>
              {bootError}
            </div>
          ) : null}

          {metricsError ? (
            <div className={ERROR_ALERT_CLASS}>
              {metricsError}
            </div>
          ) : null}

          {metricsWarning ? (
            <div className={WARNING_ALERT_CLASS}>
              {metricsWarning}
            </div>
          ) : null}

          {viewMode === "dashboard" ? (
            <div className="mt-8 space-y-6">
              <section className={`${PANEL_CLASS} p-6`}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">Estilistas</h2>
                    <p className="text-sm text-gray-500">
                      Métricas por estilista para la sede y el rango seleccionados.
                    </p>
                  </div>
                  {isMetricsLoading ? (
                    <div className={STATUS_PILL_CLASS}>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Actualizando métricas
                    </div>
                  ) : null}
                </div>

                {dashboardRows.length === 0 ? (
                  <EmptyPanel
                    title="No hay estilistas en esta sede"
                    description="Selecciona otra sede o agrega estilistas al equipo para ver el tablero."
                  />
                ) : (
                  <div className={TABLE_WRAPPER_CLASS}>
                    <div className="overflow-x-auto">
                      <table className="min-w-[1240px] w-full text-sm">
                        <thead className={TABLE_HEAD_CLASS}>
                          <tr>
                            {DASHBOARD_HEADERS.map((header) => (
                              <th
                                key={header.key}
                                className={TABLE_HEAD_CELL_CLASS}
                              >
                                <HeaderLabel lines={header.lines} />
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="bg-white">
                          {dashboardRows.map((row) => (
                            <tr
                              key={row.profesionalId}
                              className={`cursor-pointer ${TABLE_ROW_CLASS} ${panelEstilistaId === row.profesionalId ? "bg-gray-100" : ""}`}
                              onClick={() => setPanelEstilistaId(row.profesionalId)}
                            >
                              <td className={TABLE_CELL_MEDIUM_CLASS}>{row.nombre}</td>
                              <td className={TABLE_CELL_MEDIUM_CLASS}>{row.citas ?? "--"}</td>
                              <td className={TABLE_CELL_MEDIUM_CLASS}>
                                {row.cantidadProductos ?? 0}
                              </td>
                              <td className={TABLE_CELL_MEDIUM_CLASS}>
                                {formatCurrencyNoDecimals(row.totalVentaServicios, currency)}
                              </td>
                              <td className={TABLE_CELL_MEDIUM_CLASS}>
                                {formatCurrencyNoDecimals(row.totalVentaProductos, currency)}
                              </td>
                              <td className={TABLE_CELL_STRONG_CLASS}>
                                {formatCurrencyNoDecimals(row.totalVentas, currency)}
                              </td>
                              <td className={TABLE_CELL_MEDIUM_CLASS}>
                                {formatCurrencyNoDecimals(row.comisionesServicios, currency)}
                              </td>
                              <td className={TABLE_CELL_MEDIUM_CLASS}>
                                {formatCurrencyNoDecimals(row.comisionesProductos, currency)}
                              </td>
                              <td className={TABLE_CELL_STRONG_CLASS}>
                                {formatCurrencyNoDecimals(row.totalComisiones, currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </section>

              <MonthlyProjectionSection
                rows={monthlyProjectionRows}
                loading={isPerformanceLoading}
                error={performanceError}
                periodLabel={performancePeriodLabel}
                onRetry={handleReloadPerformance}
                currency={currency}
              />

              <section className={`${PANEL_CLASS} p-6`}>
                <div className="mb-4">
                  <h2 className="text-xl font-semibold text-gray-900">Vendedores</h2>
                  <p className="text-sm text-gray-500">
                    Ventas de productos y comisiones registradas para usuarios de la sede actual.
                  </p>
                </div>

                {vendorRows.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-5 py-8 text-sm text-gray-500">
                    No hay vendedores configurados o no existen ventas de productos para este rango.
                  </div>
                ) : (
                  <div className={TABLE_WRAPPER_CLASS}>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className={TABLE_HEAD_CLASS}>
                          <tr>
                            <th className={TABLE_HEAD_CELL_CLASS}>
                              Vendedor
                            </th>
                            <th className={TABLE_HEAD_CELL_CLASS}>
                              <HeaderLabel lines={["Total de Ventas", "Productos"]} />
                            </th>
                            <th className={TABLE_HEAD_CELL_CLASS}>
                              <HeaderLabel lines={["Comisiones por", "Productos"]} />
                            </th>
                            <th className={TABLE_HEAD_CELL_CLASS}>
                              <HeaderLabel lines={["Total", "Comisiones"]} />
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white">
                          {vendorRows.map((vendor) => (
                            <tr key={vendor.id} className={TABLE_ROW_CLASS}>
                              <td className={TABLE_CELL_CLASS}>
                                <p className="font-medium text-gray-900">{vendor.nombre}</p>
                              </td>
                              <td className={TABLE_CELL_MEDIUM_CLASS}>
                                {formatCurrencyNoDecimals(vendor.totalVentaProductos, currency)}
                              </td>
                              <td className={TABLE_CELL_MEDIUM_CLASS}>
                                {formatCurrencyNoDecimals(vendor.comisionesProductos, currency)}
                              </td>
                              <td className={TABLE_CELL_STRONG_CLASS}>
                                {formatCurrencyNoDecimals(vendor.totalComisiones, currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </section>

            </div>
          ) : (
            <div className="gle-settings-layout">
              {/* ── LEFT PANEL: Stylist List ── */}
              <div className="gle-left-panel">
                {/* Header inside left panel */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">
                    Configuración de Estilistas
                  </h1>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      className={OUTLINE_BUTTON_CLASS}
                      onClick={() => setViewMode("dashboard")}
                    >
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Volver al dashboard
                    </Button>
                    <Button
                      type="button"
                      variant="default"
                      className={PRIMARY_BUTTON_CLASS}
                      onClick={handleOpenCreate}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Nuevo estilista
                    </Button>
                  </div>
                </div>

                {/* Sede selector */}
                {shouldShowSedeDropdown ? (
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-xs text-slate-500 font-medium">Sede:</span>
                    <select
                      value={selectedSedeId}
                      onChange={(event) => setSelectedSedeId(event.target.value)}
                      className="px-2 py-[5px] border border-slate-200 rounded-lg text-xs bg-white font-semibold text-slate-700 focus:outline-none"
                    >
                      {canSelectAllSedes ? (
                        <option value={ALL_SEDES_VALUE}>Todas las sedes</option>
                      ) : null}
                      {visibleSedes.map((sede) => (
                        <option key={sede.sede_id} value={sede.sede_id}>
                          {formatSedeNombre(sede.nombre, sede.sede_id)}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : selectedSedeLabel ? (
                  <p className="mb-3 text-xs text-slate-500">
                    Sede: <span className="font-semibold text-slate-700">{selectedSedeLabel}</span>
                  </p>
                ) : null}

                {/* Toolbar */}
                <div className="gle-toolbar">
                  <div className="gle-search-wrap">
                    <Search className="h-[14px] w-[14px]" />
                    <input
                      className="gle-search-input text-[13px]"
                      type="text"
                      placeholder="Buscar estilista..."
                      value={settingsSearch}
                      onChange={(e) => setSettingsSearch(e.target.value)}
                    />
                  </div>
                  {(["todos", "activos", "inactivos"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={`gle-filter-pill text-[12px] ${settingsFilter === f ? "active" : ""}`}
                      onClick={() => setSettingsFilter(f)}
                    >
                      {f === "todos" ? "Todos" : f === "activos" ? "Activos" : "Inactivos"}
                    </button>
                  ))}
                </div>

                {/* Table */}
                <div className="gle-table-card">
                  <div className="gle-table-head gle-table-head-5col">
                    <div className="gle-th text-[11px]">Estilista</div>
                    <div className="gle-th text-[11px]">Sede</div>
                    <div className="gle-th text-[11px]">Servicios</div>
                    <div className="gle-th text-[11px]">Estado</div>
                    <div className="gle-th text-[11px]" />
                  </div>

                  {filteredSettingsStylists.length === 0 ? (
                    <div className="px-10 py-10 text-center">
                      <p className="text-[13px]" style={{ color: "var(--gle-text-tertiary)" }}>
                        No hay estilistas para mostrar.
                      </p>
                    </div>
                  ) : (
                    filteredSettingsStylists.map((stylist) => {
                      const isSelected = selectedStylistId === stylist.profesional_id;
                      const tags = getServiceTagsForStylist(stylist);
                      const sedeObj = sedes.find((s) => s.sede_id === stylist.sede_id);
                      const sedeLabel = sedeObj
                        ? formatSedeNombre(sedeObj.nombre, sedeObj.sede_id)
                        : "—";

                      return (
                        <div
                          key={stylist.profesional_id}
                          className={`gle-stylist-row gle-stylist-row-5col ${isSelected ? "selected" : ""}`}
                          onClick={() => {
                            setSettingsPanelClosed(false);
                            setSelectedStylistId(stylist.profesional_id);
                            initializeEditorState(stylist, "edit");
                            setSettingsTab("datos");
                          }}
                        >
                          <div className="gle-stylist-identity">
                            <div className="gle-avatar text-[12px]" style={{ background: "#111111", color: "#ffffff" }}>
                              {getInitials(stylist.nombre)}
                            </div>
                            <div>
                              <div className="gle-stylist-name text-[13px]">{stylist.nombre}</div>
                              <div className="gle-stylist-email text-[11px]">{stylist.email}</div>
                            </div>
                          </div>
                          <div className="gle-cell-secondary text-[12px]">{sedeLabel}</div>
                          <div>
                            {tags.length > 0 ? (
                              <div className="gle-service-tags">
                                {tags.slice(0, 2).map((tag) => (
                                  <span key={tag} className="gle-service-tag text-[11px]">{tag}</span>
                                ))}
                                {tags.length > 2 && (
                                  <span className="gle-service-tag more text-[11px]">+{tags.length - 2}</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[12px]" style={{ color: "var(--gle-text-tertiary)" }}>
                                Sin servicios asignados
                              </span>
                            )}
                          </div>
                          <div>
                            <span className={`gle-status-badge text-[11px] ${stylist.activo ? "active" : "inactive"}`}>
                              <span className="gle-status-dot" />
                              {stylist.activo ? "Activo" : "Inactivo"}
                            </span>
                          </div>
                          <div className="gle-row-actions">
                            <button
                              type="button"
                              className="gle-icon-btn"
                              title="Editar"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSettingsPanelClosed(false);
                                setSelectedStylistId(stylist.profesional_id);
                                initializeEditorState(stylist, "edit");
                                setSettingsTab("datos");
                              }}
                            >
                              <Edit3 className="h-[13px] w-[13px]" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* ── RIGHT PANEL: Edit/Detail ── */}
              <div className={`gle-right-panel ${!editorState ? "collapsed" : ""}`}>
                {editorState ? (
                  <>
                    {/* Panel Header */}
                    <div className="gle-panel-header">
                      <div className="gle-panel-top-row">
                        <div className="flex items-center gap-[10px]">
                          <div className="gle-avatar-lg text-[18px]" style={{ background: "#111111", color: "#ffffff" }}>
                            {getInitials(editorState.nombre || "ST")}
                          </div>
                          <div>
                            <div className="gle-panel-title text-[15px]">
                              {editorState.nombre || "Nuevo estilista"}
                            </div>
                            <div className="text-[12px]" style={{ color: "var(--gle-text-tertiary)" }}>
                              {editorState.mode === "edit"
                                ? `${getRoleLabel(editorState.rol)} · ${selectedSedeLabel}`
                                : "Sin asignar"}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="gle-close-btn text-[16px]"
                          onClick={() => {
                            setSettingsPanelClosed(true);
                            setSelectedStylistId("");
                            setEditorState(null);
                          }}
                        >
                          ✕
                        </button>
                      </div>

                      {/* Tabs */}
                      <div className="gle-panel-tabs">
                        {(["datos", "sedes", "servicios", "productos"] as const).map((tab) => (
                          <button
                            key={tab}
                            type="button"
                            className={`gle-ptab ${settingsTab === tab ? "active" : ""}`}
                            onClick={() => setSettingsTab(tab)}
                          >
                            {tab === "datos" ? "Datos" : tab === "sedes" ? "Sede" : tab === "servicios" ? "Comisiones servicios" : "Comisiones productos"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Panel Body */}
                    <div className="gle-panel-body">

                      {/* ── TAB: DATOS ── */}
                      {settingsTab === "datos" && (
                        <div>
                          <div className="gle-form-section">
                            <div className="gle-avatar-uploader">
                              <div className="gle-avatar-lg text-[18px]" style={{ background: "#111111", color: "#ffffff" }}>
                                {getInitials(editorState.nombre || "ST")}
                              </div>
                              <div>
                                <div className="text-[13px] font-medium" style={{ color: "var(--gle-text-primary)" }}>Foto de perfil</div>
                                <div className="text-[11px]" style={{ color: "var(--gle-text-tertiary)" }}>JPG o PNG · máx 2 MB</div>
                              </div>
                            </div>
                          </div>

                          <div className="gle-form-section">
                            <div className="gle-form-section-label text-[11px]">Información personal</div>
                            <div className="gle-form-grid-2">
                              <div className="gle-form-group full">
                                <label className="gle-form-label text-[12px]">Nombre completo</label>
                                <input
                                  className="gle-form-input text-[13px]"
                                  type="text"
                                  value={editorState.nombre}
                                  onChange={(e) => updateEditor("nombre", e.target.value)}
                                  placeholder="Nombre completo"
                                />
                              </div>
                              <div className="gle-form-group">
                                <label className="gle-form-label text-[12px]">Correo electrónico</label>
                                <input
                                  className="gle-form-input text-[13px]"
                                  type="email"
                                  value={editorState.email}
                                  onChange={(e) => updateEditor("email", e.target.value)}
                                  placeholder="nombre@correo.com"
                                />
                              </div>
                              <div className="gle-form-group">
                                <label className="gle-form-label text-[12px]">Teléfono</label>
                                <input
                                  className="gle-form-input text-[13px]"
                                  type="tel"
                                  value={editorState.telefono}
                                  onChange={(e) => updateEditor("telefono", e.target.value)}
                                  placeholder="+57 300 000 0000"
                                />
                              </div>
                              <div className="gle-form-group">
                                <label className="gle-form-label text-[12px]">Cargo</label>
                                <select
                                  className="gle-form-select text-[13px]"
                                  value={editorState.rol}
                                  disabled
                                >
                                  <option value={editorState.rol}>{getRoleLabel(editorState.rol)}</option>
                                </select>
                              </div>
                              <div className="gle-form-group">
                                <label className="gle-form-label text-[12px]">Estado</label>
                                <select
                                  className="gle-form-select text-[13px]"
                                  value={editorState.activo ? "activo" : "inactivo"}
                                  onChange={(e) => updateEditor("activo", e.target.value === "activo")}
                                >
                                  <option value="activo">Activo</option>
                                  <option value="inactivo">Inactivo</option>
                                </select>
                              </div>
                            </div>
                          </div>

                          <div className="gle-form-section">
                            <div className="gle-form-section-label text-[11px]">Acceso al sistema</div>
                            <div className="gle-form-grid-2">
                              <div className="gle-form-group">
                                <label className="gle-form-label text-[12px]">Comisión base</label>
                                <input
                                  className="gle-form-input text-[13px]"
                                  type="text"
                                  value={editorState.comision}
                                  onChange={(e) => updateEditor("comision", e.target.value)}
                                  placeholder="Ej: 20"
                                />
                              </div>
                              {editorState.mode === "create" ? (
                                <div className="gle-form-group">
                                  <label className="gle-form-label text-[12px]">Contraseña</label>
                                  <input
                                    className="gle-form-input text-[13px]"
                                    type="password"
                                    value={editorState.password}
                                    onChange={(e) => updateEditor("password", e.target.value)}
                                    placeholder="Mínimo 6 caracteres"
                                  />
                                </div>
                              ) : (
                                <div className="gle-form-group">
                                  <label className="gle-form-label text-[12px]">Contraseña</label>
                                  <input
                                    className="gle-form-input text-[13px]"
                                    type="password"
                                    placeholder="••••"
                                    value={editorState.password}
                                    onChange={(e) => updateEditor("password", e.target.value)}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ── TAB: SEDES ── */}
                      {settingsTab === "sedes" && (
                        <div>
                          <div className="gle-form-section">
                            <div className="gle-form-section-label text-[11px]">Sede principal</div>
                            <div className="gle-sede-selector">
                              {visibleSedes.map((sede) => {
                                const isSedeSelected = editorState.sede_id === sede.sede_id;
                                return (
                                  <div
                                    key={sede.sede_id}
                                    className={`gle-sede-option ${isSedeSelected ? "selected" : ""}`}
                                    onClick={() => updateEditor("sede_id", sede.sede_id)}
                                  >
                                    <div>
                                      <div className="gle-sede-option-name text-[13px]">
                                        {formatSedeNombre(sede.nombre, sede.sede_id)}
                                      </div>
                                      <div className="gle-sede-option-city text-[11px]">
                                        {sede.direccion || sede.pais || ""}
                                      </div>
                                    </div>
                                    <div className="gle-sede-check">
                                      <div className="gle-sede-check-dot" />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <div className="gle-hint-box text-[12px]">
                            La sede seleccionada determina en qué agenda aparece el estilista y qué reportes financieros lo incluyen.
                          </div>
                        </div>
                      )}

                      {/* ── TAB: COMISIONES SERVICIOS ── */}
                      {settingsTab === "servicios" && (
                        <div>
                          {/* Base commission */}
                          <div className="gle-base-commission-box">
                            <div>
                              <div className="gle-base-comm-label text-[13px]">Comisión base por servicio</div>
                              <div className="gle-base-comm-desc text-[11px]">Se aplica cuando el servicio no tiene % específico</div>
                            </div>
                            <div className="flex items-center gap-[6px]">
                              <div className="gle-commission-input-wrap" style={{ width: 64 }}>
                                <input
                                  className="gle-commission-input text-[13px]"
                                  type="number"
                                  value={editorState.comision}
                                  onChange={(e) => updateEditor("comision", e.target.value)}
                                  min={0}
                                  max={100}
                                />
                                <span className="gle-commission-symbol text-[12px]">%</span>
                              </div>
                            </div>
                          </div>

                          <div className="gle-hint-box text-[12px]">
                            Puedes sobrescribir el % para cada categoría de servicio. Las categorías sin % específico usarán la comisión base.
                          </div>

                          {/* Grouped by category */}
                          {(() => {
                            const grouped = getServiceCategoriesGrouped();
                            return Array.from(grouped.entries()).map(([cat, svcs]) => {
                              const isOpen = settingsOpenCategories.has(cat);
                              return (
                                <div key={cat} className="mb-[6px]">
                                  <div className="gle-cat-header" onClick={() => toggleSettingsCategory(cat)}>
                                    <div className="gle-cat-header-name text-[12px]">
                                      {cat}
                                      <span className="gle-cat-count text-[11px]">{svcs.length} servicio{svcs.length !== 1 ? "s" : ""}</span>
                                    </div>
                                    <span className={`gle-cat-expand text-[12px] ${isOpen ? "open" : ""}`}>▾</span>
                                  </div>
                                  {isOpen && (
                                    <div>
                                      <div className="gle-cat-divider" />
                                      {svcs.map(({ serviceId, nombre }) => {
                                        const entry = editorState.serviceCommissions.find(
                                          (e) => e.servicio_id === serviceId,
                                        ) ?? { servicio_id: serviceId, valor: 0, tipo: "%" };
                                        return (
                                          <div key={serviceId} className="gle-commission-row">
                                            <div>
                                              <div className="gle-commission-label text-[13px]">{nombre}</div>
                                            </div>
                                            <div className="gle-commission-input-wrap">
                                              <input
                                                className="gle-commission-input text-[13px]"
                                                type="number"
                                                value={entry.valor}
                                                onChange={(e) =>
                                                  updateServiceCommission(serviceId, {
                                                    valor: Number(e.target.value || 0),
                                                  })
                                                }
                                              />
                                              <span className="gle-commission-symbol text-[12px]">%</span>
                                            </div>
                                            <div className="gle-type-toggle">
                                              <button type="button" className="active text-[11px]">%</button>
                                              <button type="button" className="text-[11px]">$</button>
                                            </div>
                                            <button
                                              type="button"
                                              className="gle-del-btn"
                                              onClick={() => removeServiceSelection(serviceId)}
                                            >
                                              <Trash2 className="h-3 w-3" />
                                            </button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            });
                          })()}

                          <button
                            type="button"
                            className="gle-add-line-btn text-[12px]"
                            onClick={addServiceToEditor}
                            disabled={
                              selectServiceOptions.filter(
                                (option) => !editorState.serviceIds.includes(option.id),
                              ).length === 0
                            }
                          >
                            <Plus className="h-[14px] w-[14px]" />
                            Agregar servicio
                          </button>
                        </div>
                      )}

                      {/* ── TAB: COMISIONES PRODUCTOS ── */}
                      {settingsTab === "productos" && (
                        <div>
                          <div className="gle-base-commission-box">
                            <div>
                              <div className="gle-base-comm-label text-[13px]">Comisión base por producto</div>
                              <div className="gle-base-comm-desc text-[11px]">Se aplica a todos los productos que venda este estilista</div>
                            </div>
                            <div className="flex items-center gap-[6px]">
                              <div className="gle-commission-input-wrap" style={{ width: 64 }}>
                                <input
                                  className="gle-commission-input text-[13px]"
                                  type="number"
                                  value={editorState.productCommission}
                                  onChange={(e) => updateEditor("productCommission", e.target.value)}
                                  min={0}
                                  max={100}
                                />
                                <span className="gle-commission-symbol text-[12px]">%</span>
                              </div>
                            </div>
                          </div>

                          <div className="gle-hint-box text-[12px]">
                            Las comisiones por producto aplican cuando el estilista registra una venta de producto en facturación. Puedes definir % diferente por categoría de producto o por proveedor.
                          </div>

                          <p className="mt-2 text-[12px]" style={{ color: "var(--gle-text-tertiary)" }}>
                            Opcional. Valor entre 0 y 100. Si se deja vacío se usará la comisión del inventario/sede o la global del producto.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Panel Footer */}
                    <div className="gle-panel-footer">
                      <button
                        type="button"
                        className="gle-btn-ghost text-[13px]"
                        onClick={() => {
                          if (selectedStylist) {
                            initializeEditorState(selectedStylist, "edit");
                          } else {
                            initializeEditorState(null, "create");
                          }
                        }}
                        disabled={isSaving}
                      >
                        Cancelar
                      </button>
                      <div className="flex items-center gap-[8px]">
                        {editorState.mode === "edit" && (
                          <button
                            type="button"
                            className="gle-btn-ghost text-[12px]"
                            style={{ color: "var(--gle-destructive-text)", borderColor: "var(--gle-destructive)" }}
                            onClick={handleDelete}
                            disabled={isSaving}
                          >
                            Eliminar
                          </button>
                        )}
                        <span className="text-[12px]" style={{ color: "var(--gle-text-tertiary)" }}>
                          Cambios sin guardar<span className="gle-unsaved-dot" />
                        </span>
                        <button
                          type="button"
                          className="gle-btn-primary text-[13px]"
                          onClick={handleSave}
                          disabled={
                            isSaving ||
                            !editorState.nombre.trim() ||
                            !editorState.email.trim() ||
                            (editorState.mode === "create" && !editorState.password.trim())
                          }
                        >
                          {isSaving ? "Guardando..." : "Guardar cambios"}
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </main>

      {LegacyCreateModal ? (
        <LegacyCreateModal
          isOpen={isLegacyCreateOpen}
          onClose={() => setIsLegacyCreateOpen(false)}
          onSave={handleLegacyCreateSave}
          estilista={null}
          isSaving={isLegacyCreateSaving}
        />
      ) : null}

      {panelEstilista && viewMode === "dashboard" ? (
        <EstilistaDetallePanel
          row={panelEstilista}
          invoices={invoices}
          appointments={appointments}
          selectedSedeLabel={selectedSedeLabel}
          periodoLabel={panelPeriodoLabel}
          currency={currency}
          onClose={() => setPanelEstilistaId(null)}
        />
      ) : null}
    </div>
  );
}
