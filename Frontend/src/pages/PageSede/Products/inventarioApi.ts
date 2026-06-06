import { API_BASE_URL } from "../../../types/config";

// ─── Filtro de tiempo ─────────────────────────────────────────────────────────

export interface FiltroTiempo {
  modo: "relativo" | "personalizado";
  dias?: number;
  fecha_desde?: string;
  fecha_hasta?: string;
}

export const RANGOS_RELATIVOS = [
  { label: "Últimos 7 días", dias: 7 },
  { label: "Últimos 15 días", dias: 15 },
  { label: "Último mes", dias: 30 },
  { label: "Últimos 3 meses", dias: 90 },
] as const;

// ─── Entradas ─────────────────────────────────────────────────────────────────

export interface EntradaItem {
  producto_id: string;
  cantidad: number;
}

export interface CrearEntradaBody {
  motivo: string;
  sede_id?: string;
  observaciones?: string;
  items: EntradaItem[];
}

export interface EntradaRespuesta {
  msg: string;
  reporte_id: string;
  items: Array<{
    producto_id: string;
    nombre_producto: string;
    cantidad: number;
    stock_anterior: number;
    stock_nuevo: number;
  }>;
}

export interface EntradaHistorial {
  _id: string;
  tipo: "entrada";
  sede_id: string;
  motivo: string;
  observaciones: string | null;
  items: Array<{
    producto_id: string;
    nombre_producto: string;
    cantidad: number;
    stock_anterior: number;
    stock_nuevo: number;
  }>;
  fecha: string;
  creado_por: string;
  anulada?: boolean;
}

// ─── Salidas ──────────────────────────────────────────────────────────────────

export interface CrearSalidaBody {
  motivo: string;
  sede_id?: string;
  observaciones?: string;
  items: EntradaItem[];
}

export interface SalidaHistorial {
  _id: string;
  motivo: string;
  sede_id: string;
  observaciones: string | null;
  items: Array<{ producto_id: string; cantidad: number }>;
  fecha_creacion: string;
  creado_por: string;
}

// ─── Movimientos ──────────────────────────────────────────────────────────────

export interface Movimiento {
  id: string;
  producto: string;
  producto_id: string;
  tipo: "Entrada" | "Salida";
  cantidad: number;
  saldo: number;
  motivo: string;
  observaciones?: string;
  usuario: string;
  fecha: string;
  sede: string;
  referencia_tipo: string;
  referencia_id: string;
  origen: "sistema" | "manual";
  cliente_nombre?: string;
  cliente_id?: string;
}

export interface MovimientosResponse {
  data: Movimiento[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  tiene_siguiente: boolean;
  tiene_anterior: boolean;
}

export interface TopProducto {
  producto_id: string;
  nombre_producto: string;
  total_vendido: number;
  stock_actual: number | null;
}

export interface ProductoSinMovimiento {
  producto_id: string;
  nombre_producto: string;
  categoria: string | null;
  stock_actual: number;
  stock_minimo: number;
  sede_id: string;
  dias_sin_movimiento: number;
}

// ─── Alertas ──────────────────────────────────────────────────────────────────

export interface AlertaStockBajo {
  _id: string;
  producto_id: string;
  sede_id: string;
  nombre: string;
  stock_actual: number;
  stock_minimo: number;
  diferencia: number;
  fecha_ultima_actualizacion: string;
  producto_nombre: string;
  producto_codigo: string;
  categoria: string | null;
}

// ─── Catálogo de productos ────────────────────────────────────────────────────

export interface CatalogoProducto {
  _id: string;
  nombre: string;
  codigo: string;
  categoria?: string;
  descripcion?: string;
  activo?: boolean;
  precios?: { COP?: number; MXN?: number; USD?: number };
}

// ─── Helpers internos ────────────────────────────────────────────────────────

const buildHeaders = (token: string, hasBody = false): Record<string, string> => ({
  accept: "application/json",
  Authorization: `Bearer ${token}`,
  ...(hasBody ? { "Content-Type": "application/json" } : {}),
});

const buildFiltroParams = (filtro: FiltroTiempo): URLSearchParams => {
  const params = new URLSearchParams();
  if (filtro.modo === "personalizado" && filtro.fecha_desde) {
    params.set("fecha_desde", filtro.fecha_desde);
    if (filtro.fecha_hasta) params.set("fecha_hasta", filtro.fecha_hasta);
  } else {
    params.set("dias", String(filtro.dias ?? 7));
  }
  return params;
};

const parseApiError = async (res: Response): Promise<string> => {
  const raw = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.detail)) {
      return (parsed.detail as Array<{ msg?: string }>)
        .map((e) => e.msg ?? String(e))
        .join(", ");
    }
    return parsed.detail || parsed.message || raw || res.statusText;
  } catch {
    return raw || res.statusText || `Error ${res.status}`;
  }
};

// ─── Entradas API ─────────────────────────────────────────────────────────────

export async function crearEntrada(
  token: string,
  body: CrearEntradaBody
): Promise<EntradaRespuesta> {
  const res = await fetch(`${API_BASE_URL}inventary/entradas/`, {
    method: "POST",
    headers: buildHeaders(token, true),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json();
}

export async function getEntradas(
  token: string,
  filtro: FiltroTiempo,
  sedeId?: string
): Promise<EntradaHistorial[]> {
  const params = buildFiltroParams(filtro);
  if (sedeId) params.set("sede_id", sedeId);
  const res = await fetch(`${API_BASE_URL}inventary/entradas/?${params}`, {
    headers: buildHeaders(token),
  });
  if (!res.ok) throw new Error(await parseApiError(res));
  const data: unknown = await res.json();
  return Array.isArray(data) ? (data as EntradaHistorial[]) : [];
}

// ─── Salidas API ──────────────────────────────────────────────────────────────

export async function crearSalida(
  token: string,
  body: CrearSalidaBody
): Promise<{ msg: string; salida: SalidaHistorial }> {
  const res = await fetch(`${API_BASE_URL}inventary/exit/`, {
    method: "POST",
    headers: buildHeaders(token, true),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json();
}

export async function getSalidas(
  token: string,
  filtro: FiltroTiempo,
  sedeId?: string
): Promise<SalidaHistorial[]> {
  const params = buildFiltroParams(filtro);
  if (sedeId) params.set("sede_id", sedeId);
  const res = await fetch(`${API_BASE_URL}inventary/exit/?${params}`, {
    headers: buildHeaders(token),
  });
  if (!res.ok) throw new Error(await parseApiError(res));
  const data: unknown = await res.json();
  return Array.isArray(data) ? (data as SalidaHistorial[]) : [];
}

// ─── Movimientos API ──────────────────────────────────────────────────────────

const EMPTY_MOVIMIENTOS: MovimientosResponse = {
  data: [],
  total: 0,
  page: 1,
  page_size: 20,
  total_pages: 0,
  tiene_siguiente: false,
  tiene_anterior: false,
};

export async function getMovimientos(
  token: string,
  options: {
    filtro?: FiltroTiempo;
    tipo?: "Entrada" | "Salida";
    producto_id?: string;
    page?: number;
    page_size?: number;
    sede_id?: string;
  } = {}
): Promise<MovimientosResponse> {
  const params = options.filtro
    ? buildFiltroParams(options.filtro)
    : new URLSearchParams({ dias: "7" });

  if (options.tipo) params.set("tipo", options.tipo);
  if (options.producto_id) params.set("producto_id", options.producto_id);
  if (options.page) params.set("page", String(options.page));
  if (options.page_size) params.set("page_size", String(options.page_size));
  if (options.sede_id) params.set("sede_id", options.sede_id);

  const res = await fetch(`${API_BASE_URL}inventary/movimientos/?${params}`, {
    headers: buildHeaders(token),
  });
  if (res.status === 404) return EMPTY_MOVIMIENTOS;
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json();
}

export async function getTopProductos(
  token: string,
  filtro: FiltroTiempo,
  limit = 10,
  sedeId?: string
): Promise<TopProducto[]> {
  const params = buildFiltroParams(filtro);
  params.set("limit", String(limit));
  if (sedeId) params.set("sede_id", sedeId);
  const res = await fetch(
    `${API_BASE_URL}inventary/movimientos/top-productos?${params}`,
    { headers: buildHeaders(token) }
  );
  if (!res.ok) throw new Error(await parseApiError(res));
  const data: unknown = await res.json();
  return Array.isArray(data) ? (data as TopProducto[]) : [];
}

export async function getSinMovimiento(
  token: string,
  filtro: FiltroTiempo,
  sedeId?: string
): Promise<ProductoSinMovimiento[]> {
  const params = buildFiltroParams(filtro);
  if (sedeId) params.set("sede_id", sedeId);
  const res = await fetch(
    `${API_BASE_URL}inventary/movimientos/sin-movimiento?${params}`,
    { headers: buildHeaders(token) }
  );
  if (!res.ok) throw new Error(await parseApiError(res));
  const data: unknown = await res.json();
  return Array.isArray(data) ? (data as ProductoSinMovimiento[]) : [];
}

// ─── Alertas stock bajo ───────────────────────────────────────────────────────

export async function getAlertasStockBajo(
  token: string,
  sedeId?: string
): Promise<AlertaStockBajo[]> {
  const params = new URLSearchParams();
  if (sedeId) params.set("sede_id", sedeId);
  const query = params.toString() ? `?${params}` : "";
  const res = await fetch(
    `${API_BASE_URL}inventary/inventarios/inventarios/alertas/stock-bajo${query}`,
    { headers: buildHeaders(token) }
  );
  if (!res.ok) throw new Error(await parseApiError(res));
  const data: unknown = await res.json();
  return Array.isArray(data) ? (data as AlertaStockBajo[]) : [];
}

// ─── Catálogo de productos CRUD ───────────────────────────────────────────────

export async function getCatalogoProductos(
  token: string,
  sedeId?: string,
  moneda = "COP"
): Promise<CatalogoProducto[]> {
  const params = new URLSearchParams({ moneda });
  if (sedeId) params.set("sede_id", sedeId);
  const res = await fetch(
    `${API_BASE_URL}inventary/product/productos/?${params}`,
    { headers: buildHeaders(token) }
  );
  if (!res.ok) throw new Error(await parseApiError(res));
  const data: unknown = await res.json();
  const items = Array.isArray(data)
    ? data
    : Array.isArray((data as { results?: unknown[] }).results)
    ? (data as { results: unknown[] }).results
    : [];
  return items as CatalogoProducto[];
}

export async function crearProductoCatalogo(
  token: string,
  body: Omit<CatalogoProducto, "_id">
): Promise<CatalogoProducto> {
  const res = await fetch(`${API_BASE_URL}inventary/product/productos/`, {
    method: "POST",
    headers: buildHeaders(token, true),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json();
}

export async function actualizarProductoCatalogo(
  token: string,
  id: string,
  body: Partial<Omit<CatalogoProducto, "_id">>
): Promise<CatalogoProducto> {
  const res = await fetch(`${API_BASE_URL}inventary/product/productos/${id}`, {
    method: "PUT",
    headers: buildHeaders(token, true),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json();
}

export async function eliminarProductoCatalogo(
  token: string,
  id: string
): Promise<{ msg: string }> {
  const res = await fetch(`${API_BASE_URL}inventary/product/productos/${id}`, {
    method: "DELETE",
    headers: buildHeaders(token),
  });
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json();
}
