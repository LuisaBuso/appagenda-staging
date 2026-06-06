// src/types/commissions.ts

// Interfaz para respuesta de comisiones (lista)
export interface Commission {
  id: string;
  profesional_id: string;
  profesional_nombre: string;
  sede_id: string;
  moneda: string;
  tipo_comision: 'servicios' | 'productos' | 'mixto';
  total_servicios: number;
  total_comisiones: number;
  periodo_inicio: string;
  periodo_fin: string;
  estado: 'pendiente' | 'aprobado' | 'pagado';
  creado_en: string;
  liquidada_por?: string | null;
  liquidada_en?: string | null;
}

// Interfaz para detalle completo de comisión
export interface CommissionDetail {
  id: string;
  profesional_id: string;
  profesional_nombre: string;
  sede_id: string;
  moneda: string;
  tipo_comision: 'servicios' | 'productos' | 'mixto';
  total_servicios: number;
  total_comisiones: number;
  total_comisiones_servicios: number;
  total_comisiones_productos: number;
  servicios_detalle: ServiceDetail[];
  periodo_inicio: string;
  periodo_fin: string;
  estado: string;
  creado_en: string;
  liquidada_por?: string;
  liquidada_en?: string;
}

export interface ServiceDetail {
  servicio_id: string;
  servicio_nombre: string;
  valor_servicio: number;
  porcentaje: number;
  valor_comision_servicio: number;
  valor_comision_productos: number;
  valor_comision_total: number;
  fecha: string;
  numero_comprobante: string;
  tipo_comision_sede: string;
}

// Interfaz para estilistas
export interface Professional {
  _id: string;
  nombre: string;
  email: string;
  sede_id: string;
  activo: boolean;
  comision: number;
  profesional_id: string;
  rol: string;
  sede_nombre: string;
  created_at: string;
  updated_at: string;
}

// Filtros para búsqueda de comisiones
export interface CommissionFilters {
  profesional_id?: string;
  sede_id?: string;
  estado?: string;
  tipo_comision?: string;
  fecha_inicio?: string;
  fecha_fin?: string;
}

// Tipos para el resumen de comisiones en frontend
export interface CommissionSummary {
  servicios: ServiceCommission[];
  productos: ProductCommission[];
  totales: CommissionTotals;
  moneda: string;
}

export interface ServiceCommission {
  id: string;
  nombre: string;
  precio: number;
  comisionEstilistaPorcentaje: number;
  comisionEstilistaMonto: number;
  comisionCasaPorcentaje: number;
  comisionCasaMonto: number;
  fecha: string;
}

export interface ProductCommission {
  id: string;
  nombre: string;
  precio: number;
  comisionEstilistaPorcentaje: number;
  comisionEstilistaMonto: number;
  comisionCasaPorcentaje: number;
  comisionCasaMonto: number;
}

export interface CommissionTotals {
  totalServicios: number;
  totalProductos: number;
  totalComisionEstilista: number;
  totalComisionCasa: number;
  descuentosNomina: number;
  anticiposBonos: number;
  totalAPagar: number;
}

export interface PendientesResumen {
  total_comisiones_pendientes: number;
  monto_total_pendiente: number;
  total_comisiones_servicios: number;
  total_comisiones_productos: number;
  moneda: string;
  por_profesional: PendienteProfesional[];
}

export interface PendienteProfesional {
  profesional_id: string;
  profesional_nombre: string;
  cantidad_periodos: number;
  total_comisiones: number;
  total_comisiones_servicios: number;
  total_comisiones_productos: number;
  moneda: string;
  tipo_comision: string;
}

export interface ComisionPendiente {
  id: string;
  profesional_id: string;
  profesional_nombre: string;
  sede_id: string;
  moneda: string;
  tipo_comision: 'servicios' | 'productos' | 'mixto';
  total_servicios: number;
  total_comisiones: number;
  periodo_inicio: string;
  periodo_fin: string;
  estado: 'pendiente';
  creado_en: string;
}
