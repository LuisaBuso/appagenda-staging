import { API_BASE_URL } from "../../../types/config";
import { toBackendDate } from "../../../lib/dateFormat";

export interface CategoriaGasto {
  id: string;
  nombre: string;
  descripcion?: string;
}

export interface GastoCrear {
  descripcion: string;
  monto: number;
  categoria_id: string;
  fecha?: string;
  notas?: string;
  moneda?: string;
}

export interface Gasto {
  _id: string;
  descripcion: string;
  monto: number;
  categoria_id: string;
  categoria_nombre?: string;
  fecha: string;
  notas?: string;
  moneda: string;
  creado_por?: string;
  fecha_creacion?: string;
}

export interface PLData {
  periodo: string;
  moneda: string;
  ingresos: number;
  egresos: {
    total: number;
    por_categoria: Array<{ categoria: string; monto: number }>;
  };
  utilidad_neta: number;
  margen_neto_pct: number;
}

export interface PLResponse {
  [moneda: string]: PLData;
}

const buildHeaders = (token: string, json = false): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/json",
  ...(json ? { "Content-Type": "application/json" } : {}),
});

export async function getCategorias(token: string): Promise<CategoriaGasto[]> {
  const res = await fetch(`${API_BASE_URL}gastos/categorias`, {
    headers: buildHeaders(token),
  });
  if (!res.ok) throw new Error(`Error ${res.status} al obtener categorías`);
  const data = await res.json();
  return Array.isArray(data) ? data : data?.categorias ?? [];
}

export async function getGastos(token: string, params?: { desde?: string; hasta?: string; categoria_id?: string }): Promise<Gasto[]> {
  const url = new URL(`${API_BASE_URL}gastos`);
  if (params?.desde) url.searchParams.set("desde", toBackendDate(params.desde));
  if (params?.hasta) url.searchParams.set("hasta", toBackendDate(params.hasta));
  if (params?.categoria_id) url.searchParams.set("categoria_id", params.categoria_id);

  const res = await fetch(url.toString(), { headers: buildHeaders(token) });
  if (!res.ok) throw new Error(`Error ${res.status} al obtener gastos`);
  const data = await res.json();
  return Array.isArray(data) ? data : data?.gastos ?? [];
}

export async function crearGasto(token: string, gasto: GastoCrear): Promise<Gasto> {
  const res = await fetch(`${API_BASE_URL}gastos`, {
    method: "POST",
    headers: buildHeaders(token, true),
    body: JSON.stringify(gasto),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || `Error ${res.status} al crear gasto`);
  }
  return await res.json();
}

export async function eliminarGasto(token: string, gastoId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}gastos/${gastoId}`, {
    method: "DELETE",
    headers: buildHeaders(token),
  });
  if (!res.ok) throw new Error(`Error ${res.status} al eliminar gasto`);
}

export async function getPL(token: string, params?: { desde?: string; hasta?: string }): Promise<PLResponse> {
  const url = new URL(`${API_BASE_URL}gastos/pl`);
  if (params?.desde) url.searchParams.set("desde", toBackendDate(params.desde));
  if (params?.hasta) url.searchParams.set("hasta", toBackendDate(params.hasta));

  const res = await fetch(url.toString(), { headers: buildHeaders(token) });
  if (!res.ok) throw new Error(`Error ${res.status} al obtener P&L`);
  return await res.json();
}
