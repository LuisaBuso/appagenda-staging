// services/horariosApi.ts
import { API_BASE_URL } from "../../types/config";

export interface Horario {
  _id: string;
  horario_id?: string;
  estilista_id: string;
  dia_semana: string;
  hora_inicio: string;
  hora_fin: string;
  estado: string;
}

export interface Bloqueo {
  _id: string;
  bloqueo_id?: string;
  estilista_id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  motivo: string;
}

export async function getHorariosEstilista(token: string, estilista_id: string): Promise<Horario[]> {
  const res = await fetch(`${API_BASE_URL}scheduling/schedule/stylist/${estilista_id}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    credentials: "include",
  });
  
  if (!res.ok) throw new Error("Error al cargar horarios");
  const data = await res.json();
  return data.horarios || data || [];
}

export async function getBloqueosEstilista(token: string, estilista_id: string): Promise<Bloqueo[]> {
  const res = await fetch(`${API_BASE_URL}scheduling/block/estilista/${estilista_id}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    credentials: "include",
  });
  
  if (!res.ok) throw new Error("Error al cargar bloqueos");
  const data = await res.json();
  return data.bloqueos || data || [];
}