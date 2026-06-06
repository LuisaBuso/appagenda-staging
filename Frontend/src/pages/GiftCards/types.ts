export type GiftCardStatus =
  | "activa"
  | "usada"
  | "cancelada"
  | "vencida"
  | "parcialmente_usada"
  | string;

export interface GiftCardHistoryMovement {
  tipo?: string;
  cita_id?: string;
  factura_id?: string;
  numero_comprobante?: string;
  monto?: number;
  fecha?: string;
  registrado_por?: string;
  motivo?: string;
  [key: string]: unknown;
}

export interface GiftCard {
  _id: string;
  codigo: string;
  sede_id: string;
  sede_nombre?: string;
  moneda: string;
  comprador_cliente_id?: string | null;
  comprador_nombre?: string | null;
  comprador_email?: string | null;
  beneficiario_cliente_id?: string | null;
  beneficiario_nombre?: string | null;
  beneficiario_email?: string | null;
  valor: number;
  saldo_disponible: number;
  saldo_reservado?: number;
  saldo_usado?: number;
  fecha_emision?: string;
  fecha_vencimiento?: string | null;
  fecha_primer_uso?: string | null;
  estado: GiftCardStatus;
  notas?: string | null;
  creada_por?: string;
  created_at?: string;
  historial?: GiftCardHistoryMovement[];
  [key: string]: unknown;
}

export interface GiftCardPagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface GiftCardsListResponse {
  success: boolean;
  pagination: GiftCardPagination;
  giftcards: GiftCard[];
}

export interface GiftCardResponse {
  success: boolean;
  message?: string;
  giftcard: GiftCard;
  alerta_vencimiento?: string | null;
}

export interface GiftCardDeleteResponse {
  success: boolean;
  message: string;
  codigo: string;
}

export interface GiftCardCreatePayload {
  sede_id: string;
  comprador_cliente_id?: string;
  beneficiario_cliente_id?: string;
  comprador_nombre?: string;
  beneficiario_nombre?: string;
  valor: number;
  moneda?: string;
  dias_vigencia?: number | null;
  notas?: string;
  metodo_pago: string;
  numero_comprobante?: string;
}

export interface GiftCardUpdatePayload {
  beneficiario_cliente_id?: string;
  beneficiario_nombre?: string;
  dias_vigencia?: number | null;
  notas?: string;
  estado?: string;
}

export interface GiftCardReservePayload {
  cita_id: string;
  monto: number;
  codigo: string;
}

export interface GiftCardReleasePayload {
  cita_id: string;
}

export interface GiftCardRedeemPayload {
  cita_id: string;
  factura_id?: string;
  numero_comprobante?: string;
  monto: number;
}

export interface GiftCardHistoryResponse {
  success: boolean;
  codigo: string;
  valor_original: number;
  saldo_disponible: number;
  saldo_usado: number;
  moneda: string;
  estado: GiftCardStatus;
  total_movimientos: number;
  historial: GiftCardHistoryMovement[];
}

export interface GiftCardListParams {
  estado?: string;
  cliente_id?: string;
  page?: number;
  limit?: number;
}

export interface GiftCardClientOption {
  id: string;
  nombre: string;
  email?: string;
  telefono?: string;
}
