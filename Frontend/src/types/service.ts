export interface Service {
  id: string;
  nombre: string;
  descripcion: string;
  precio: number;
  duracion: number;
  categoria: string;
  activo: boolean;
  comision_porcentaje: number;
  imagen: string;
  // Campos opcionales para compatibilidad con backend
  servicio_id?: string;
  requiere_producto?: boolean;
  creado_por?: string;
  created_at?: string;
  updated_at?: string;
}