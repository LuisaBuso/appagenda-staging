export interface Estilista {
  _id: string;
  nombre: string;
  email: string;
  especialidades: string[] | boolean; // puede venir como lista o boolean desde el backend
  especialidades_detalle: Array<{ id: string; nombre: string }>;
  servicios_no_presta?: string[]; // IDs de servicios que NO presta
  servicios_presta?: Array<{ id: string; nombre: string }>; // Servicios que sí presta
  activo: boolean;
  rol: string;
  profesional_id: string;
  sede_id: string;
  sede_nombre?: string;
  telefono?: string;
  franquicia_id: string | null;
  comision_productos?: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
  comision: number | null;
  comisiones_por_categoria?: Record<string, number>;
}

export type CreateEstilistaData = {
  nombre: string;
  email: string;
  sede_id: string;
  especialidades: string[] | boolean;
  comision: number | null;
  comision_productos?: number | null;
  telefono?: string;
  password: string;
  activo?: boolean;
};

export type UpdateEstilistaData = {
  nombre?: string;
  email?: string;
  sede_id?: string;
  especialidades?: string[] | boolean;
  comision?: number | null;
  comision_productos?: number | null;
  comisiones_por_categoria?: Record<string, number>;
  activo?: boolean;
};
