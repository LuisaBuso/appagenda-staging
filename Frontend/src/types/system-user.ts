export type SystemUserRole =
  | "super_admin"
  | "admin_sede"
  | "recepcionista"
  | "call_center"
  | "estilista";

export interface SystemUser {
  _id: string;
  nombre: string;
  email: string;
  role: SystemUserRole;
  comision_productos?: number | null;
  sede_id?: string | null;
  sede_id_principal?: string | null;
  sedes_permitidas?: string[];
  sede_nombre?: string | null;
  especialidades?: string[];
  activo: boolean;
  user_type: "system" | "staff" | string;
  fecha_creacion?: string;
  creado_por?: string;
}

export interface CreateSystemUserPayload {
  nombre: string;
  email: string;
  role: SystemUserRole;
  comision_productos?: number | null;
  sede_id?: string | null;
  sedes_permitidas?: string[];
  especialidades?: string[];
  password?: string;
  activo?: boolean;
}
