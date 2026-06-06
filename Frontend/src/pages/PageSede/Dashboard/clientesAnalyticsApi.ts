// API service para Analytics de Clientes
// Endpoints: GET /clientes/analytics  y  GET /clientes/analytics/nuevos
import { API_BASE_URL } from "../../../types/config";
import { toBackendDate } from "../../../lib/dateFormat";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ClientesAnalyticsLTV {
  ltv_promedio: number;
  ticket_promedio: number;
  clientes_con_datos: number;
  formula?: string;
}

export interface ClientesAnalyticsRecurrencia {
  promedio_dias: number;
  texto: string;
  clientes_recurrentes: number;
  total_con_frecuencia: number;
  pct_recurrentes: number;
  nota?: string;
}

export interface ClientesAnalyticsEstadoBase {
  activos: number;
  en_riesgo: number;
  perdidos: number;
  sin_visita: number;
  total: number;
}

export interface ClientesAnalyticsResponse {
  success: boolean;
  sede_id?: string;
  zona_horaria?: string;
  generado_en?: string;
  ltv: ClientesAnalyticsLTV;
  recurrencia: ClientesAnalyticsRecurrencia;
  estado_base: ClientesAnalyticsEstadoBase;
}

// ─────────────────────────────────────────────────────────────────────────────

export interface ClienteNuevo {
  cliente_id: string;
  nombre: string;
  telefono: string;
  fecha_creacion: string;
  creado_por: string;
}

export interface ClientesNuevosResponse {
  success: boolean;
  sede_id?: string;
  periodo?: { inicio: string; fin: string };
  total: number;
  mostrando: number;
  hay_mas: boolean;
  descarga_url?: string;
  clientes: ClienteNuevo[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getBase = () =>
  API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`;

const buildHeaders = (token: string): HeadersInit => ({
  Accept: "application/json",
  Authorization: `Bearer ${token}`,
});

const safeJson = async <T>(res: Response, fallback: T): Promise<T> => {
  if (!res.ok) return fallback;
  try { return await res.json(); } catch { return fallback; }
};

// ─── GET /clientes/analytics ──────────────────────────────────────────────────

export const getClientesAnalytics = async (
  token: string,
  sedeId?: string,
): Promise<ClientesAnalyticsResponse | null> => {
  const url = new URL(`${getBase()}clientes/analytics`);
  if (sedeId && sedeId !== "global") url.searchParams.set("sede_id", sedeId);

  try {
    const res = await fetch(url.toString(), { headers: buildHeaders(token) });
    return await safeJson<ClientesAnalyticsResponse | null>(res, null);
  } catch {
    return null;
  }
};

// ─── GET /clientes/analytics/nuevos ───────────────────────────────────────────

export const getClientesNuevos = async (
  token: string,
  params?: {
    mes?: string;          // YYYY-MM
    fecha_inicio?: string; // YYYY-MM-DD
    fecha_fin?: string;    // YYYY-MM-DD
    sede_id?: string;
  },
): Promise<ClientesNuevosResponse | null> => {
  const url = new URL(`${getBase()}clientes/analytics/nuevos`);
  if (params?.mes) url.searchParams.set("mes", params.mes);
  if (params?.fecha_inicio) url.searchParams.set("fecha_inicio", toBackendDate(params.fecha_inicio));
  if (params?.fecha_fin) url.searchParams.set("fecha_fin", toBackendDate(params.fecha_fin));
  if (params?.sede_id && params.sede_id !== "global")
    url.searchParams.set("sede_id", params.sede_id);

  try {
    const res = await fetch(url.toString(), { headers: buildHeaders(token) });
    return await safeJson<ClientesNuevosResponse | null>(res, null);
  } catch {
    return null;
  }
};
