// src/types/factura.ts
export interface Factura {
  identificador: string;
  fecha_pago: string;
  local: string;
  sede_id: string;
  venta_id?: string;
  moneda: string;
  tipo_comision: string;
  cliente_id: string;
  nombre_cliente: string;
  cedula_cliente: string;
  email_cliente: string;
  telefono_cliente: string;
  total: number;
  comprobante_de_pago: string;
  numero_comprobante: string;
  fecha_comprobante: string;
  monto: number;
  profesional_id: string;
  profesional_nombre: string;
  metodo_pago: string;
  facturado_por: string;
  vendido_por?: string;
  estado: string;
  // Campos opcionales para detalle
  items?: Array<{
    tipo: string;
    servicio_id?: string;
    producto_id?: string;
    nombre: string;
    cantidad: number;
    precio_unitario: number;
    subtotal: number;
    moneda: string;
    comision: number;
  }>;
  historial_pagos?: Array<{
    fecha: string;
    monto: number;
    metodo: string;
    tipo: string;
    registrado_por: string;
    saldo_despues: number;
    notas: string;
  }>;
  desglose_pagos?: {
    efectivo: number;
    total: number;
    tarjeta?: number;
    transferencia?: number;
    tarjeta_credito?: number;
    tarjeta_debito?: number;
    addi?: number;
  };
  electronic_invoice_status?: string;
  electronic_invoice_id?: string;
}
