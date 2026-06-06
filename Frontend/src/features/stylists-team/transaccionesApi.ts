// API service para Detalle de Transacciones
// Endpoint: GET /api/billing/transacciones
import { API_BASE_URL } from "../../types/config";
import { toBackendDate } from "../../lib/dateFormat";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface TransaccionItem {
  fecha: string;
  comprobante: string;
  tipo: string;
  responsable: string;
  tipo_item: string;
  nombre_item: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  comision: number;
  porcentaje_comision: number;
  cliente: string;
}

export interface TransaccionesResponse {
  total: number;
  page: number;
  page_size: number;
  pages: number;
  sede_id: string;
  sede_nombre: string;
  desde: string;
  hasta: string;
  tipo_item: string;
  profesional_filtro: string | null;
  items: TransaccionItem[];
}

export interface TransaccionesParams {
  sede_id: string;
  fecha_desde: string; // YYYY-MM-DD
  fecha_hasta: string; // YYYY-MM-DD
  tipo_item?: string;  // "todos" | "servicio" | "producto" | "membresia" | "paquete"
  profesional?: string;
  page?: number;
  page_size?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getBase = () =>
  API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`;

const buildHeaders = (token: string): HeadersInit => ({
  Accept: "application/json",
  Authorization: `Bearer ${token}`,
});

// ─── GET /api/billing/transacciones ──────────────────────────────────────────

export const getTransacciones = async (
  token: string,
  params: TransaccionesParams,
): Promise<TransaccionesResponse | null> => {
  const url = new URL(`${getBase()}api/billing/transacciones`);

  url.searchParams.set("sede_id", params.sede_id);
  url.searchParams.set("fecha_desde", toBackendDate(params.fecha_desde));
  url.searchParams.set("fecha_hasta", toBackendDate(params.fecha_hasta));

  if (params.tipo_item && params.tipo_item !== "todos")
    url.searchParams.set("tipo_item", params.tipo_item);
  if (params.profesional)
    url.searchParams.set("profesional", params.profesional);
  if (params.page !== undefined)
    url.searchParams.set("page", String(params.page));
  if (params.page_size !== undefined)
    url.searchParams.set("page_size", String(params.page_size));

  try {
    const res = await fetch(url.toString(), { headers: buildHeaders(token) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};
