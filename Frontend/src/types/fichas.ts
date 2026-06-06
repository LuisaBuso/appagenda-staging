// src/types/fichas.ts

// 🔥 NUEVA INTERFAZ PARA SERVICIO INDIVIDUAL
export interface Servicio {
  servicio_id: string;
  nombre: string;
  precio: number;
  precio_personalizado?: boolean;
}

// 🔥 INTERFAZ ACTUALIZADA PARA CITA CON MÚLTIPLES SERVICIOS
export interface Cita {
  cita_id: string;
  cliente: {
    cliente_id: string;
    nombre: string;
    apellido: string;
    telefono: string;
    email: string;
  };
  
  // 🆕 NUEVO: Array de servicios (formato actual)
  servicios?: Servicio[];
  
  // 🆕 NUEVO: Campos calculados del backend
  precio_total?: number;
  cantidad_servicios?: number;
  tiene_precio_personalizado?: boolean;
  
  sede: {
    sede_id: string;
    nombre: string;
  };
  estilista_id: string;
  profesional_id?: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  estado: string;
  estado_pago?: string;
  comentario?: string;
  // Notas adicionales (ej: call center)
  notas?: string;
  notas_call_center?: string;
  nota_call_center?: string;
  
  // 🆕 NUEVO: Campos adicionales de pago
  metodo_pago_inicial?: string;
  metodo_pago_actual?: string;
  abono?: number;
  valor_total?: number;
  saldo_pendiente?: number;
  moneda?: string;
  
  // 🆕 NUEVO: Campos de productos
  productos?: Array<{
    producto_id: string;
    nombre: string;
    cantidad: number;
    precio_unitario: number;
    subtotal: number;
  }>;
  
  // 🆕 NUEVO: Información de creación
  creada_por?: string;
  creada_por_rol?: string;
  fecha_creacion?: string;
  ultima_actualizacion?: string;
  
  // 🆕 NUEVO: Historial
  historial_pagos?: Array<{
    fecha: string;
    monto: number;
    metodo: string;
    realizado_por?: string;
  }>;
}

export interface FichaBase {
  tipo_ficha: string;
  cita_id: string;
  cliente_id: string;
  servicio_id: string;
  profesional_id: string;
  datos_especificos: Record<string, any>;
  fecha_ficha: string;
  autorizacion_publicacion?: boolean;
}

// Tipos específicos para cada ficha
export interface DiagnosticoRizotipoData {
  plasticidad: "ALTA" | "MEDIA" | "BAJA" | "MUY BAJA";
  permeabilidad: "ALTA" | "MEDIA" | "BAJA" | "OTRA";
  porosidad: "ALTA" | "BAJA";
  exterior_lipidico: "ALTA" | "MEDIA" | "BAJA";
  densidad: "EXTRA ALTA" | "ALTA" | "MEDIA" | "BAJA";
  oleosidad: "ALTA" | "MEDIA" | "BAJA";
  grosor: "GRUESO" | "MEDIO" | "DELGADO";
  textura: "Lanoso / Ulótrico" | "Ensotijado / Lisótrico" | "Laminado / Cinótrico" | "Procesado o dañado";
  recomendaciones_personalizadas: string;
  frecuencia_corte: string;
  tecnicas_estilizado: string;
  productos_sugeridos: string;
  observaciones_generales: string;
  autoriza_publicar: boolean;
}

export interface FichaColorData {
  respuestas: Array<{
    pregunta: string;
    respuesta: boolean;
    observaciones: string;
  }>;
  autoriza_publicar: boolean;
}

export interface AsesoriaCorteData {
  descripcion: string;
  observaciones: string;
  autoriza_publicar: boolean;
}

export interface CuidadoPostColorData {
  observaciones_personalizadas: string;
  tenga_en_cuenta: string;
  recomendaciones_seleccionadas: boolean[];
}

export interface ValoracionPruebaColorData {
  acuerdos: string;
  recomendaciones: string;
  servicio_valorado: string;
}
