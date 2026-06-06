// types/cliente.ts - Interfaz Cliente actualizada
export interface Cliente {
  id: string;
  cliente_id?: string;
  nombre: string;
  telefono: string;
  email: string;
  diasSinVenir: number;
  diasSinComprar: number;
  ltv: number;
  ticketPromedio: number;
  rizotipo: string;
  nota: string;
  sede_id: string;
  cedula?: string;
  ciudad?: string;
  fecha_de_nacimiento?: string;
  fecha_creacion?: string;
  fecha_registro?: string;
  ultima_visita?: string;
  
  // Historiales - ACTUALIZADO: cambiar estilista por profesional
  historialCitas: Array<{
    fecha: string;
    servicio: string;
    profesional: string; // ✅ CAMBIADO: estilista → profesional
    notas?: string;
    metodo_pago?: string;
    estado_pago?: string;
    valor_total?: string | number;
    moneda?: string;
    hora_inicio?: string;
    hora_fin?: string;
    estado?: string;
    datos_completos?: any;
  }>;
  
  historialCabello: Array<{
    tipo: string;
    fecha: string;
  }>;
  
  historialProductos: Array<{
    producto: string;
    fecha: string;
    precio?: string | number;
    profesional?: string; // ✅ CAMBIADO: estilista → profesional
    estado_pago?: string;
    metodo_pago?: string;
  }>;
  
  notas_historial?: Array<{
    contenido: string;
    fecha: string;
    autor?: string;
  }>;

  fichas?: Array<{
    _id: string;
    cliente_id: string;
    sede_id: string;
    cliente_id_antiguo?: string;
    servicio_id: string;
    servicio_nombre: string;
    profesional_id: string;
    profesional_nombre?: string; // ✅ SOLO este campo para el profesional
    sede_nombre?: string;
    fecha_ficha: string;
    fecha_reserva: string;
    email: string | null;
    nombre: string;
    apellido: string | null;
    cedula: string;
    telefono: string;
    
    fotos?: {
      antes?: string[];
      despues?: string[];
      antes_urls?: string[];
      despues_urls?: string[];
    };
    
    antes_url?: string;
    despues_url?: string;
    precio: string | number;
    estado: string;
    estado_pago: string;
    local: string;
    notas_cliente?: string;
    comentario_interno: string;
    
    respuestas?: Array<{
      pregunta: string;
      respuesta: boolean;
      observaciones: string;
    }>;
    
    tipo_ficha?: string;
    datos_especificos?: any;
    descripcion_servicio?: string;
    autorizacion_publicacion?: boolean;
    created_at?: string;
    created_by?: string;
    user_id?: string;
    procesado_imagenes?: boolean;
    origen?: string;
    source_file?: string;
    migrated_at?: string;
    imagenes_actualizadas_at?: string;
    
    // Campos para compatibilidad - ACTUALIZADOS
    servicio: string;
    sede: string;
    sede_estilista: string; // ❌ Nota: Este nombre debería cambiarse, pero lo dejamos por compatibilidad
    
    // ❌ ELIMINADO: estilista: string; // Ya no usamos este campo
    
    // Campos adicionales que podrían venir
    servicio_nombre_backup?: string;
    fecha_ficha_formatted?: string;
  }>;
}
