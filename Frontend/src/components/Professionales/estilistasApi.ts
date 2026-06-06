// services/estilistasApi.ts
import { API_BASE_URL } from "../../types/config";

export interface Estilista {
  _id: string;
   profesional_id: string;
  nombre: string;
  email: string;
  especialidad?: string;
  estado: string;
  sede_id?: string;
  servicios_no_presta?: string[];
  especialidades?: boolean;
}

export async function getEstilistas(token: string, sedeId?: string): Promise<Estilista[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  const activeSede =
    sedeId ??
    sessionStorage.getItem("beaux-sede_id") ??
    localStorage.getItem("beaux-sede_id");

  if (activeSede) headers["X-Sede-Id"] = activeSede;

  const res = await fetch(`${API_BASE_URL}admin/profesionales/`, {
    headers,
    credentials: "include",
  });

  if (!res.ok) throw new Error("Error al cargar estilistas");
  const data = await res.json();
  return data.profesionales || data || [];
}

export async function getEstilistaCompleto(token: string, estilistaId: string): Promise<Estilista> {
  const res = await fetch(`${API_BASE_URL}admin/profesionales/${estilistaId}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    credentials: "include",
  });
  
  if (!res.ok) throw new Error("Error al cargar detalles del estilista");
  const data = await res.json();
  return data;
} 