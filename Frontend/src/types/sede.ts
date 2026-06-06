// types/sede.ts
export interface Sede {
  _id: string;
  nombre: string;
  direccion: string;
  informacion_adicional: string;
  zona_horaria: string;
  telefono: string;
  email: string;
  sede_id: string;
  pais?: string;
  moneda?: string;
  es_internacional?: boolean;
  fecha_creacion: string;
  creado_por: string;
  activa: boolean;
}

// Tipo para crear sedes (sin los campos automáticos)
export type SedeInput = Omit<Sede, '_id' | 'fecha_creacion' | 'creado_por' | 'sede_id' | 'activa'>;
