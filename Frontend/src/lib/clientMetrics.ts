import { parseDateToDate } from "./dateFormat";

export interface DiasSinVenirSource {
  dias_sin_visitar?: number | null;
  ultima_visita?: string | null;
  fecha_creacion?: string | null;
  created_at?: string | null;
}

const calcularDiasSinVisitar = (fechaCreacion: string): number => {
  const fechaUltimaVisita = new Date(fechaCreacion);
  const hoy = new Date();
  const diferenciaMs = hoy.getTime() - fechaUltimaVisita.getTime();
  return Math.floor(diferenciaMs / (1000 * 60 * 60 * 24));
};

const calcularDiasDesdeFecha = (fecha?: string): number | undefined => {
  const parsed = parseDateToDate(fecha);
  if (!parsed) return undefined;
  const diffMs = Date.now() - parsed.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
};

export const calcularDiasSinVenir = (cliente: DiasSinVenirSource): number => {
  return (
    cliente.dias_sin_visitar ??
    calcularDiasDesdeFecha(cliente.ultima_visita ?? undefined) ??
    calcularDiasSinVisitar(cliente.fecha_creacion || cliente.created_at || "")
  );
};
