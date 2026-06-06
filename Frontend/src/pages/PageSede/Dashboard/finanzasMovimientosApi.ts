// API service para el módulo Finanzas / Movimientos
// Base URL: /finanzas/movimientos
import { API_BASE_URL } from "../../../types/config";
import { toBackendDate } from "../../../lib/dateFormat";

// ─── Tipos de respuesta ───────────────────────────────────────────────────────

export interface ResumenPL {
  ingresos: number;
  egresos: number;
  egresos_mayor_total: number;
  egresos_menor_total: number;
  egresos_mayor_por_categoria: Record<string, number>;
  utilidad: number;
  aclaracion?: string;
}

export interface ResumenCajas {
  caja_menor: number;
  caja_mayor: number;
  consolidado: number;
}

export interface ResumenTraslados {
  menor_a_mayor: number;
  mayor_a_menor: number;
  cantidad: number;
}

export interface ResumenFinanciero {
  pl: ResumenPL;
  cajas: ResumenCajas;
  traslados: ResumenTraslados;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

const getBaseUrl = () =>
  API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`;

const buildHeaders = (token: string): HeadersInit => ({
  "Content-Type": "application/json",
  Accept: "application/json",
  Authorization: `Bearer ${token}`,
});

const parseError = async (res: Response, fallback: string): Promise<string> => {
  try {
    const data = await res.json();
    if (typeof data?.detail === "string" && data.detail.trim()) return data.detail;
    if (Array.isArray(data?.detail)) {
      return data.detail
        .map((item: any) => {
          if (typeof item === "string") return item;
          const loc = Array.isArray(item?.loc) ? item.loc.join(".") : "";
          const msg = typeof item?.msg === "string" ? item.msg : "";
          return [loc, msg].filter(Boolean).join(": ");
        })
        .filter(Boolean)
        .join(" | ");
    }
    if (typeof data?.message === "string" && data.message.trim()) return data.message;
  } catch {
    // ignore
  }
  return fallback;
};

const post = async <T>(token: string, path: string, body: Record<string, any>): Promise<T> => {
  const url = `${getBaseUrl()}finanzas/movimientos/${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: buildHeaders(token),
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("No se pudo conectar con el servidor. Verifica tu conexión.");
  }
  if (!res.ok) {
    const msg = await parseError(res, `Error ${res.status}: ${res.statusText}`);
    throw new Error(msg);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
};

// ─── Mapeo de categorías ──────────────────────────────────────────────────────

// Convierte las etiquetas del UI al valor que espera el backend
const CATEGORIA_EGRESO_MAYOR_MAP: Record<string, string> = {
  arriendo: "arriendo",
  "nómina administrativa": "nomina",
  "comisiones estilistas": "comisiones",
  "servicios públicos": "servicios_publicos",
  impuestos: "impuestos",
  "insumos / proveedores": "proveedor",
  mantenimiento: "mantenimiento",
  "marketing y publicidad": "marketing",
  "software y herramientas": "software",
  "seguros": "seguros",
  "honorarios": "honorarios",
  "transporte": "transporte",
  "otro gasto fijo": "otro",
  "otro gasto operativo": "otro",
  otro: "otro",
};

const CATEGORIA_INGRESO_MAYOR_MAP: Record<string, string> = {
  "devolución de proveedor": "devolucion_proveedor",
  "devolucion de proveedor": "devolucion_proveedor",
  "intereses bancarios": "intereses",
  intereses: "intereses",
  "ingreso extraordinario": "ingreso_extraordinario",
  "ajuste contable": "otro",
  otro: "otro",
};

const CATEGORIA_EGRESO_MENOR_MAP: Record<string, string> = {
  "gasto operativo": "gasto_operativo",
  propina: "propinas",
  alimentación: "almuerzos",
  "domicilio / mensajería": "domicilios",
  "papelería / insumos menores": "otro",
  otro: "otro",
};

const METODO_PAGO_MAP: Record<string, string> = {
  efectivo: "efectivo",
  transferencia: "transferencia",
  tarjeta: "tarjeta_corporativa",
  tarjeta_credito: "tarjeta_corporativa",
  tarjeta_debito: "debito_automatico",
  link_de_pago: "pse",
  pse: "pse",
  cheque: "cheque",
  debito_automatico: "debito_automatico",
  tarjeta_corporativa: "tarjeta_corporativa",
  giftcard: "efectivo",
  addi: "efectivo",
  abono_transferencia: "transferencia",
  descuento_nomina: "transferencia",
  sin_pago: "efectivo",
  otros: "efectivo",
};

export const normalizeCategoria = (
  tipo: "egreso-mayor" | "ingreso-mayor" | "egreso-menor",
  value: string
): string => {
  const key = value.trim().toLowerCase();
  const map =
    tipo === "egreso-mayor"
      ? CATEGORIA_EGRESO_MAYOR_MAP
      : tipo === "ingreso-mayor"
        ? CATEGORIA_INGRESO_MAYOR_MAP
        : CATEGORIA_EGRESO_MENOR_MAP;
  return map[key] ?? "otro";
};

export const normalizeMetodoPago = (value: string): string =>
  METODO_PAGO_MAP[value.trim().toLowerCase()] ?? "efectivo";

// ─── Endpoints ────────────────────────────────────────────────────────────────

/** GET /finanzas/movimientos/resumen */
export const getResumenFinanciero = async (
  token: string,
  params: { sede_id: string; fecha_inicio: string; fecha_fin: string }
): Promise<ResumenFinanciero> => {
  const url = new URL(`${getBaseUrl()}finanzas/movimientos/resumen`);
  url.searchParams.set("sede_id", params.sede_id);
  url.searchParams.set("fecha_inicio", toBackendDate(params.fecha_inicio));
  url.searchParams.set("fecha_fin", toBackendDate(params.fecha_fin));

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      headers: buildHeaders(token),
    });
  } catch {
    throw new Error("No se pudo conectar con el servidor. Verifica tu conexión.");
  }
  if (!res.ok) {
    const msg = await parseError(res, `Error ${res.status}: ${res.statusText}`);
    throw new Error(msg);
  }

  // ── Mapear respuesta del backend al shape que espera el frontend ──
  const raw = await res.json();
  return {
    pl: {
      ingresos: raw.pl?.ingresos_manuales_mayor ?? raw.pl?.ingresos ?? 0,
      egresos:  raw.pl?.egresos ?? 0,
      egresos_mayor_total: raw.pl?.egresos_mayor_total ?? 0,
      egresos_menor_total: raw.pl?.egresos_menor_total ?? 0,
      egresos_mayor_por_categoria: raw.pl?.egresos_mayor_por_categoria ?? {},
      utilidad: raw.pl?.utilidad ?? 0,
      aclaracion: raw.pl?.aclaracion,
    },
    cajas: {
      caja_menor:  raw.caja_menor?.saldo_neto_efectivo ?? 0,
      caja_mayor:  raw.caja_mayor?.saldo               ?? 0,
      consolidado: raw.consolidado                     ?? 0,
    },
    traslados: raw.traslados ?? { menor_a_mayor: 0, mayor_a_menor: 0, cantidad: 0 },
  };
};

/** POST /finanzas/movimientos/egreso-caja-mayor */
export const crearEgresoMayor = (
  token: string,
  body: {
    sede_id: string;
    fecha: string;
    concepto: string;
    monto: number;
    categoria: string;
    metodo_pago: string;
    referencia_factura?: string;
    observaciones?: string;
  }
) => post(token, "egreso-caja-mayor", body);

/** POST /finanzas/movimientos/ingreso-caja-mayor */
export const crearIngresoMayor = (
  token: string,
  body: {
    sede_id: string;
    fecha: string;
    concepto: string;
    monto: number;
    categoria: string;
    metodo_pago: string;
    referencia_factura?: string;
    observaciones?: string;
  }
) => post(token, "ingreso-caja-mayor", body);

/** POST /finanzas/movimientos/egreso-caja-menor */
export const crearEgresoMenor = (
  token: string,
  body: {
    sede_id: string;
    fecha: string;
    concepto: string;
    monto: number;
    categoria: string;
    metodo_pago?: string;
    observaciones?: string;
  }
) => post(token, "egreso-caja-menor", body);

/** POST /finanzas/movimientos/traslado */
export const crearTraslado = (
  token: string,
  body: {
    sede_id: string;
    fecha: string;
    concepto: string;
    monto: number;
    caja_origen: "caja_menor" | "caja_mayor";
    caja_destino: "caja_menor" | "caja_mayor";
    observaciones?: string;
  }
) => post(token, "traslado", body);
