export type CashResumen = {
  ingresos: number;
  egresos: number;
  balance: number;
  moneda?: string;
};

export type CashEgreso = {
  id: string;
  sede_id?: string;
  monto: number;
  motivo: string;
  fecha: string;
  creado_en?: string;
  metodo_pago?: string;
  tipo?: string;
  concepto?: string;
   motivo_edicion?: string;
};

export type CashIngreso = {
  id: string;
  sede_id?: string;
  monto: number;
  motivo: string;
  // Algunos endpoints devuelven "concepto" como sinónimo de motivo
  concepto?: string;
  tipo?: string;
  metodo_pago?: string;
  fecha: string;
  creado_en?: string;
  motivo_edicion?: string;
};

export type CashCierre = {
  id: string;
  sede_id?: string;
  fecha_apertura?: string;
  fecha_cierre?: string;
  ingresos?: number;
  egresos?: number;
  balance?: number;
  notas?: string;
  estado?: string;
};

export type CashReporteRaw = Record<string, any>;
