import type { FacturaConverted, ItemFactura } from "../../pages/PageSuperAdmin/Sales-invoiced/facturas";
import type { SystemUser } from "../../types/system-user";
import type { Estilista } from "../../types/estilista";
import { formatDateDMY, parseDateToDate, toLocalYMD } from "../../lib/dateFormat";

export interface DateRangeValue {
  start: string;
  end: string;
}

export interface TeamAppointmentRecord {
  id: string;
  fecha: string;
  profesional_id: string;
  hora_inicio: string;
  hora_fin: string;
  estado: string;
  cliente_nombre?: string;
  servicio_nombre?: string;
  precio?: number;
}

export interface TeamScheduleRecord {
  dia_semana: number;
  hora_inicio: string;
  hora_fin: string;
  activo: boolean;
}

export interface StylistDashboardRow {
  profesionalId: string;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
  citas: number | null;
  ocupacion: number | null;
  totalVentaServicios: number;
  totalVentaProductos: number;
  totalVentas: number;
  comisionesServicios: number;
  comisionesProductos: number;
  totalComisiones: number;
  serviciosAsignados: number;
}

export interface VendorRow {
  id: string;
  nombre: string;
  email: string;
  role: string;
  activo: boolean;
  totalVentaProductos: number;
  comisionesProductos: number;
  totalComisiones: number;
}

const CANCELLED_APPOINTMENT_STATUSES = new Set([
  "cancelada",
  "cancelado",
  "cancelled",
  "no_show",
  "ausente",
  "reagendada",
]);

const SERVICE_TYPE_TOKENS = ["servicio", "service"];
const PRODUCT_TYPE_TOKENS = ["producto", "product"];

const pad = (value: number) => String(value).padStart(2, "0");

const normalizeText = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const toNumber = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return 0;
  }
  return parsed;
};

const timeToMinutes = (value: string): number => {
  const [hours, minutes] = String(value || "")
    .split(":")
    .map((chunk) => Number(chunk));

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return 0;
  }

  return hours * 60 + minutes;
};

const getWeekday = (date: Date): number => {
  const day = date.getDay();
  return day === 0 ? 7 : day;
};

function normalizeAppointmentStatus(value: unknown): string {
  return normalizeText(value);
}

function isCancelledAppointment(value: unknown): boolean {
  return CANCELLED_APPOINTMENT_STATUSES.has(normalizeAppointmentStatus(value));
}

function normalizeWeekday(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.trunc(value);
    return rounded >= 1 && rounded <= 7 ? rounded : null;
  }

  const normalized = normalizeText(value);
  if (!normalized) return null;

  if (normalized === "1" || normalized.startsWith("lun")) return 1;
  if (normalized === "2" || normalized.startsWith("mar")) return 2;
  if (normalized === "3" || normalized.startsWith("mie")) return 3;
  if (normalized === "4" || normalized.startsWith("jue")) return 4;
  if (normalized === "5" || normalized.startsWith("vie")) return 5;
  if (normalized === "6" || normalized.startsWith("sab")) return 6;
  if (normalized === "7" || normalized.startsWith("dom")) return 7;

  return null;
}

function normalizeItemKind(item: ItemFactura): "service" | "product" | "unknown" {
  const type = normalizeText(item.tipo);

  if (SERVICE_TYPE_TOKENS.some((token) => type.includes(token)) || item.servicio_id) {
    return "service";
  }

  if (PRODUCT_TYPE_TOKENS.some((token) => type.includes(token)) || item.producto_id) {
    return "product";
  }

  return "unknown";
}

export function getDefaultDateRange(): DateRangeValue {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 30);

  return {
    start: toLocalYMD(start),
    end: toLocalYMD(end),
  };
}

export function enumerateDateRange(range: DateRangeValue): string[] {
  const start = parseDateToDate(range.start);
  const end = parseDateToDate(range.end);

  if (!start || !end || start > end) {
    return [];
  }

  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const values: string[] = [];

  while (cursor <= last) {
    values.push(
      `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`,
    );
    cursor.setDate(cursor.getDate() + 1);
  }

  return values;
}

export function formatDateRangeLabel(range: DateRangeValue): string {
  if (!range.start || !range.end) {
    return "Rango sin definir";
  }

  return `${formatDateDMY(range.start)} - ${formatDateDMY(range.end)}`;
}

export function getAllowedSedeIds(
  user: {
    sede_id?: string | null;
    sede_id_principal?: string | null;
    sedes_permitidas?: string[] | null;
  } | null,
  activeSedeId: string | null,
): string[] {
  const values = new Set<string>();

  const add = (candidate: string | null | undefined) => {
    const normalized = String(candidate ?? "").trim();
    if (normalized) {
      values.add(normalized);
    }
  };

  add(user?.sede_id);
  add(user?.sede_id_principal);
  add(activeSedeId);

  if (Array.isArray(user?.sedes_permitidas)) {
    user?.sedes_permitidas.forEach((sedeId) => add(sedeId));
  }

  return Array.from(values);
}

export function normalizeAppointmentRecord(raw: unknown): TeamAppointmentRecord | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const profesionalId = String(source.profesional_id ?? "").trim();
  const fecha = String(source.fecha ?? "").trim();
  const horaInicio = String(source.hora_inicio ?? "").trim();
  const horaFin = String(source.hora_fin ?? "").trim();

  if (!profesionalId || !fecha || !horaInicio || !horaFin) {
    return null;
  }

  const clienteNombre = String(
    source.cliente_nombre ?? source.nombre_cliente ?? source.clienteName ?? source.clientName ?? ""
  ).trim();
  const servicioNombre = String(
    source.servicio_nombre ?? source.nombre_servicio ?? source.serviceName ?? source.tipo_servicio ?? ""
  ).trim();
  const precioRaw = source.precio ?? source.precio_total ?? source.total_estimado ?? source.monto;
  const precio = typeof precioRaw === "number" ? precioRaw : Number(precioRaw ?? 0);

  return {
    id: String(source._id ?? source.id ?? `${profesionalId}-${fecha}-${horaInicio}`).trim(),
    fecha,
    profesional_id: profesionalId,
    hora_inicio: horaInicio,
    hora_fin: horaFin,
    estado: String(source.estado ?? source.status ?? source.estado_cita ?? "").trim(),
    ...(clienteNombre ? { cliente_nombre: clienteNombre } : {}),
    ...(servicioNombre ? { servicio_nombre: servicioNombre } : {}),
    ...(precio > 0 ? { precio } : {}),
  };
}

export function normalizeScheduleRecord(raw: unknown): TeamScheduleRecord | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const diaSemana = normalizeWeekday(source.dia_semana);
  const horaInicio = String(source.hora_inicio ?? "").trim();
  const horaFin = String(source.hora_fin ?? "").trim();

  if (!diaSemana || !horaInicio || !horaFin) {
    return null;
  }

  const estado = normalizeText(source.estado);
  const activo =
    typeof source.activo === "boolean"
      ? source.activo
      : estado === ""
        ? true
        : estado !== "inactivo";

  return {
    dia_semana: diaSemana,
    hora_inicio: horaInicio,
    hora_fin: horaFin,
    activo,
  };
}

export function buildStylistDashboardRows(params: {
  stylists: Estilista[];
  invoices: FacturaConverted[];
  appointments: TeamAppointmentRecord[];
  schedulesByStylist: Record<string, TeamScheduleRecord[]>;
  range: DateRangeValue;
}): StylistDashboardRow[] {
  const { stylists, invoices, appointments, schedulesByStylist, range } = params;
  const rowsById = new Map<string, StylistDashboardRow>();

  for (const stylist of stylists) {
    rowsById.set(stylist.profesional_id, {
      profesionalId: stylist.profesional_id,
      nombre: stylist.nombre,
      email: stylist.email,
      rol: stylist.rol,
      activo: Boolean(stylist.activo),
      citas: 0,
      ocupacion: null,
      totalVentaServicios: 0,
      totalVentaProductos: 0,
      totalVentas: 0,
      comisionesServicios: 0,
      comisionesProductos: 0,
      totalComisiones: 0,
      serviciosAsignados: Array.isArray(stylist.especialidades_detalle)
        ? stylist.especialidades_detalle.length
        : Array.isArray(stylist.especialidades)
          ? stylist.especialidades.length
          : 0,
    });
  }

  for (const invoice of invoices) {
    const profesionalId = String(invoice.profesional_id ?? "").trim();
    if (!profesionalId) {
      continue;
    }

    const row = rowsById.get(profesionalId);
    if (!row) {
      continue;
    }

    const items = Array.isArray(invoice.items) ? invoice.items : [];
    if (items.length === 0) {
      row.totalVentas += toNumber(invoice.total);
      continue;
    }

    for (const item of items) {
      const subtotal = toNumber(item.subtotal);
      const commission = toNumber(item.comision);
      const kind = normalizeItemKind(item);

      row.totalVentas += subtotal;

      if (kind === "service") {
        row.totalVentaServicios += subtotal;
        row.comisionesServicios += commission;
        continue;
      }

      if (kind === "product") {
        row.totalVentaProductos += subtotal;
        row.comisionesProductos += commission;
      }
    }
  }

  const appointmentsByStylist = new Map<string, TeamAppointmentRecord[]>();
  for (const appointment of appointments) {
    if (isCancelledAppointment(appointment.estado)) {
      continue;
    }

    const current = appointmentsByStylist.get(appointment.profesional_id) ?? [];
    current.push(appointment);
    appointmentsByStylist.set(appointment.profesional_id, current);
  }

  const rangeDates = enumerateDateRange(range)
    .map((value) => parseDateToDate(value))
    .filter((value): value is Date => Boolean(value));

  for (const [profesionalId, row] of rowsById.entries()) {
    row.totalComisiones = row.comisionesServicios + row.comisionesProductos;

    const stylistAppointments = appointmentsByStylist.get(profesionalId) ?? [];
    row.citas = stylistAppointments.length;

    const bookedMinutes = stylistAppointments.reduce((total, appointment) => {
      const start = timeToMinutes(appointment.hora_inicio);
      const end = timeToMinutes(appointment.hora_fin);
      return total + Math.max(0, end - start);
    }, 0);

    const schedules = schedulesByStylist[profesionalId] ?? [];
    if (schedules.length === 0 || rangeDates.length === 0) {
      row.ocupacion = null;
      continue;
    }

    const availableMinutes = rangeDates.reduce((total, date) => {
      const weekday = getWeekday(date);
      const matchingSchedules = schedules.filter(
        (schedule) => schedule.activo && schedule.dia_semana === weekday,
      );

      return (
        total +
        matchingSchedules.reduce((minutes, schedule) => {
          return minutes + Math.max(0, timeToMinutes(schedule.hora_fin) - timeToMinutes(schedule.hora_inicio));
        }, 0)
      );
    }, 0);

    if (availableMinutes <= 0) {
      row.ocupacion = null;
      continue;
    }

    row.ocupacion = Math.max(
      0,
      Math.min(100, Math.round((bookedMinutes / availableMinutes) * 100)),
    );
  }

  return Array.from(rowsById.values()).sort((a, b) => {
    const salesDiff = b.totalVentas - a.totalVentas;
    if (salesDiff !== 0) return salesDiff;
    return a.nombre.localeCompare(b.nombre);
  });
}

export function buildVendorRows(
  users: SystemUser[],
  selectedSedeIds: string[],
  stylists: Estilista[],
  invoices: FacturaConverted[],
): VendorRow[] {
  const allowedSedeIds = new Set(
    selectedSedeIds.map((sedeId) => String(sedeId ?? "").trim()).filter(Boolean),
  );

  const stylistEmails = new Set(
    stylists
      .map((stylist) => normalizeText(stylist.email))
      .filter(Boolean),
  );

  const rows = users
    .filter((user) => {
      if (!user.activo) return false;
      if (user.role === "super_admin" || user.role === "call_center" || user.role === "estilista") {
        return false;
      }

      const belongsToSede =
        allowedSedeIds.has(String(user.sede_id ?? "").trim()) ||
        (Array.isArray(user.sedes_permitidas) &&
          user.sedes_permitidas.some((sedeId) => allowedSedeIds.has(String(sedeId ?? "").trim())));

      if (!belongsToSede) {
        return false;
      }

      return !stylistEmails.has(normalizeText(user.email));
    })
    .map((user) => ({
      id: user._id,
      nombre: user.nombre,
      email: user.email,
      role: user.role,
      activo: user.activo,
      totalVentaProductos: 0,
      comisionesProductos: 0,
      totalComisiones: 0,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  const rowsByIdentity = new Map<string, VendorRow>();
  for (const row of rows) {
    rowsByIdentity.set(normalizeText(row.nombre), row);

    const normalizedEmail = normalizeText(row.email);
    if (normalizedEmail) {
      rowsByIdentity.set(normalizedEmail, row);
    }
  }

  for (const invoice of invoices) {
    // Solo usar vendido_por — el vendedor explícito de la factura.
    // facturado_por es quien cerró la caja/registró la factura,
    // usarlo como fallback infla los totales incorrectamente.
    const soldBy = normalizeText(invoice.vendido_por);
    if (!soldBy) {
      continue;
    }

    const row = rowsByIdentity.get(soldBy);
    if (!row) {
      continue;
    }

    const items = Array.isArray(invoice.items) ? invoice.items : [];
    for (const item of items) {
      if (normalizeItemKind(item) !== "product") {
        continue;
      }

      row.totalVentaProductos += toNumber(item.subtotal);
      row.comisionesProductos += toNumber(item.comision);
    }
  }

  for (const row of rows) {
    row.totalComisiones = row.comisionesProductos;
  }

  return rows;
}
