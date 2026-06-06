// services/sedesApi.ts
import { API_BASE_URL } from "../../types/config";

export interface Sede {
  _id: string;
  unique_id?: string;
  sede_id?: string; // 🔥 NUEVO: agregar este campo
  nombre: string;
  direccion: string;
  telefono: string;
  estado: string;
}

const buildHeaders = (token: string): HeadersInit => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
});

export async function getSedes(token: string): Promise<Sede[]> {
  const res = await fetch(`${API_BASE_URL}admin/locales/`, {
    headers: buildHeaders(token),
    credentials: "include",
  });
  
  if (!res.ok) throw new Error("Error al cargar sedes");
  const data = await res.json();
  return data.locales || data || [];
}

export async function getSedeById(token: string, sedeId: string): Promise<Sede | null> {
  const res = await fetch(`${API_BASE_URL}admin/locales/${encodeURIComponent(sedeId)}`, {
    headers: buildHeaders(token),
    credentials: "include",
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Error al cargar sede ${sedeId}`);
  }

  const data = await res.json();
  return data || null;
}
