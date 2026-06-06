import { API_BASE_URL } from "../../../types/config";
import { PAYROLL_PAYMENT_METHOD, normalizePaymentMethodForBackend } from "../../../lib/payment-methods";

export type PaymentMethod =
  | "efectivo"
  | "transferencia"
  | "tarjeta"
  | "tarjeta_credito"
  | "tarjeta_debito"
  | "giftcard"
  | "addi"
  | typeof PAYROLL_PAYMENT_METHOD
  | string;

interface ApiErrorBody {
  detail?: string | Array<{ msg?: string }>;
  message?: string;
  error?: string;
}

export interface InventoryProductRaw {
  _id?: string;
  id?: string;
  producto_id?: string;
  nombre?: string;
  categoria?: string;
  descripcion?: string;
  activo?: boolean;
  stock?: number | string;
  stock_actual?: number | string;
  precio_local?: number | string;
  precio?: number | string;
  moneda_local?: string;
  precios?: Record<string, number | string>;
  referencia?: string;
  ref?: string;
  sku?: string;
  codigo?: string;
  codigo_producto?: string;
}

export interface InventoryProduct {
  productId: string;
  inventoryId: string;
  name: string;
  ref: string;
  category: string;
  description: string;
  active: boolean;
  stockAvailable: number;
  unitPrice: number;
  currency: string;
}

export interface DirectSaleLineItem {
  productId: string;
  inventoryId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface DirectSaleClientRef {
  id: string;
  nombre?: string;
  email?: string;
  telefono?: string;
}

export interface DirectSaleSellerRef {
  id: string;
  nombre: string;
  tipo: "profesional" | "recepcionista" | "usuario";
  profesionalId?: string;
  email?: string;
  rol?: string;
  sedeId?: string;
}

export interface CreateDirectSaleInput {
  token: string;
  sedeId: string;
  total: number;
  deliveryCost?: number;
  paymentMethod: PaymentMethod;
  giftCardCode?: string;
  items: DirectSaleLineItem[];
  client?: DirectSaleClientRef;
  seller?: DirectSaleSellerRef;
  notes?: string;
}

export interface RegisterDirectSalePaymentInput {
  token: string;
  saleId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  giftCardCode?: string;
}

export interface CreatedDirectSale {
  saleId: string;
  raw: Record<string, unknown> | null;
}

interface GetInventoryDetailParams {
  token: string;
  inventoryId: string;
  fallbackInventoryId?: string;
  currency: string;
}

interface VerifyBillingSaleParams {
  token: string;
  sedeId: string;
  saleId: string;
}

interface SearchDirectSaleSellersOptions {
  sedeId?: string;
  limit?: number;
}

export interface DirectSaleSellerOption {
  id: string;
  nombre: string;
  tipo: "profesional" | "recepcionista" | "usuario";
  profesionalId?: string;
  email?: string;
  rol?: string;
  sedeId?: string;
}

interface AuthUserRaw {
  id?: string;
  _id?: string;
  nombre?: string;
  correo_electronico?: string;
  email?: string;
  rol?: string;
  sede_id?: string | null;
  activo?: boolean;
  profesional_id?: string;
}

const AUTH_USERS_CACHE_TTL_MS = 60_000;
const directSaleAuthUsersCache = new Map<string, { expiresAt: number; items: DirectSaleSellerOption[] }>();

function buildAuthHeadersWithSede(token: string, sedeId?: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...(sedeId ? { "X-Sede-Id": sedeId } : {}),
  };
}

function buildAuthHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

function toNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeDirectSalePaymentMethod(method: PaymentMethod): PaymentMethod {
  return normalizePaymentMethodForBackend(method) as PaymentMethod;
}

function pickFirstNumber(values: unknown[]): number | null {
  for (const current of values) {
    const numeric = toNumeric(current);
    if (numeric !== null) {
      return numeric;
    }
  }
  return null;
}

function resolveUnitPrice(raw: InventoryProductRaw, currency: string): number {
  const directPrice = pickFirstNumber([raw.precio_local, raw.precio]);
  if (directPrice !== null) {
    return roundToTwo(directPrice);
  }

  if (raw.precios && typeof raw.precios === "object") {
    const currencyPrice = toNumeric(raw.precios[currency]);
    if (currencyPrice !== null) {
      return roundToTwo(currencyPrice);
    }

    const fallbackPrice = pickFirstNumber(Object.values(raw.precios));
    if (fallbackPrice !== null) {
      return roundToTwo(fallbackPrice);
    }
  }

  return 0;
}

function normalizeInventoryProduct(raw: InventoryProductRaw, currency: string): InventoryProduct | null {
  const productId = String(raw.id ?? raw.producto_id ?? raw._id ?? "").trim();
  const inventoryId = String(raw._id ?? raw.id ?? raw.producto_id ?? "").trim();

  if (!productId || !inventoryId) {
    return null;
  }

  const stock = pickFirstNumber([raw.stock_actual, raw.stock]) ?? 0;

  return {
    productId,
    inventoryId,
    name: String(raw.nombre ?? "Producto sin nombre").trim(),
    ref: String(raw.referencia ?? raw.ref ?? raw.sku ?? raw.codigo ?? raw.codigo_producto ?? "").trim(),
    category: String(raw.categoria ?? "Sin categoría").trim(),
    description: String(raw.descripcion ?? "").trim(),
    active: raw.activo !== false,
    stockAvailable: Math.max(0, Math.trunc(stock)),
    unitPrice: resolveUnitPrice(raw, currency),
    currency: String(raw.moneda_local ?? currency).toUpperCase(),
  };
}

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function parseApiError(response: Response): Promise<string> {
  const fallback = `Error ${response.status}: ${response.statusText}`;
  const body = await parseJsonSafely<ApiErrorBody>(response);

  if (!body) {
    return fallback;
  }

  if (typeof body.detail === "string" && body.detail.trim().length > 0) {
    return body.detail;
  }

  if (Array.isArray(body.detail) && body.detail.length > 0) {
    const firstDetail = body.detail[0];
    if (firstDetail?.msg) {
      return firstDetail.msg;
    }
  }

  if (typeof body.message === "string" && body.message.trim().length > 0) {
    return body.message;
  }

  if (typeof body.error === "string" && body.error.trim().length > 0) {
    return body.error;
  }

  return fallback;
}

function extractSaleId(data: Record<string, unknown> | null): string | null {
  if (!data) {
    return null;
  }

  const directId = data.venta_id ?? data.sale_id ?? data.id ?? data._id;
  if (typeof directId === "string" && directId.trim().length > 0) {
    return directId;
  }

  const nestedData = data.data;
  if (nestedData && typeof nestedData === "object") {
    const record = nestedData as Record<string, unknown>;
    const nestedId = record.venta_id ?? record.sale_id ?? record.id ?? record._id;
    if (typeof nestedId === "string" && nestedId.trim().length > 0) {
      return nestedId;
    }
  }

  return null;
}

function buildCreateSalePayload(
  input: CreateDirectSaleInput,
  includeModernFields: boolean
): Record<string, unknown> {
  const giftCardCode = typeof input.giftCardCode === "string" ? input.giftCardCode.trim() : "";
  const clientId = typeof input.client?.id === "string" ? input.client.id.trim() : "";
  const sellerName = typeof input.seller?.nombre === "string" ? input.seller.nombre.trim() : "";
  const sellerProfessionalId =
    typeof input.seller?.profesionalId === "string" ? input.seller.profesionalId.trim() : "";
  const deliveryCost = toNumeric(input.deliveryCost);
  const payload: Record<string, unknown> = {
    sede_id: input.sedeId,
    productos: input.items.map((item) => ({
      producto_id: item.productId,
      cantidad: Math.trunc(item.quantity),
      precio_unitario: roundToTwo(item.unitPrice),
      nombre: item.name,
    })),
    metodo_pago: normalizeDirectSalePaymentMethod(input.paymentMethod),
    abono: 0,
  };

  if (input.notes && input.notes.trim().length > 0) {
    payload.notas = input.notes.trim();
  }

  if (giftCardCode.length > 0) {
    payload.codigo_giftcard = giftCardCode;
  }

  if (clientId.length > 0) {
    payload.cliente_id = clientId;
  }

  if (sellerName.length > 0) {
    payload.vendido_por = sellerName;
  }

  if (sellerProfessionalId.length > 0) {
    payload.estilista_id = sellerProfessionalId;
  }

  if (deliveryCost !== null && deliveryCost >= 0) {
    payload.domicilio = roundToTwo(deliveryCost);
  }

  if (includeModernFields) {
    payload.tipo = "venta_directa";
    payload.total = roundToTwo(input.total);
  }

  return payload;
}

function normalizeRole(rawRole: unknown): string {
  const normalized = String(rawRole ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (normalized === "superadmin") return "super_admin";
  if (normalized === "adminsede") return "admin_sede";
  if (normalized === "callcenter") return "call_center";
  if (normalized === "recepcionoista") return "recepcionista";
  return normalized;
}

function resolveSellerTypeByRole(role: string): DirectSaleSellerOption["tipo"] {
  if (role === "estilista") return "profesional";
  if (role === "recepcionista" || role === "admin_sede") return "recepcionista";
  return "usuario";
}

function normalizeSellerOptionFromAuthUser(raw: AuthUserRaw): DirectSaleSellerOption | null {
  const id = String(raw.id ?? raw._id ?? "").trim();
  const nombre = String(raw.nombre ?? "").trim();

  if (!id || !nombre) {
    return null;
  }

  const rol = normalizeRole(raw.rol);
  const profesionalId = String(raw.profesional_id ?? "").trim() || undefined;
  const email = String(raw.correo_electronico ?? raw.email ?? "").trim() || undefined;
  const sedeId = String(raw.sede_id ?? "").trim() || undefined;

  return {
    id,
    nombre,
    tipo: resolveSellerTypeByRole(rol),
    profesionalId,
    email,
    rol: rol || undefined,
    sedeId,
  };
}

async function fetchDirectSaleSellersFromAuthUsers(token: string, sedeId?: string): Promise<DirectSaleSellerOption[]> {
  const now = Date.now();
  const cacheKey = sedeId ? `${token}|${sedeId}` : token;
  const cached = directSaleAuthUsersCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.items;
  }

  const response = await fetch(`${API_BASE_URL}auth/users?activo=true`, {
    method: "GET",
    headers: buildAuthHeadersWithSede(token, sedeId),
  });

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }

  const data = await parseJsonSafely<AuthUserRaw[] | Record<string, unknown>>(response);
  const rawUsers = Array.isArray(data) ? data : [];
  const items = rawUsers
    .map((user) => normalizeSellerOptionFromAuthUser(user))
    .filter((item): item is DirectSaleSellerOption => Boolean(item))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  directSaleAuthUsersCache.set(cacheKey, {
    expiresAt: now + AUTH_USERS_CACHE_TTL_MS,
    items,
  });

  return items;
}

function sellerMatchesQuery(seller: DirectSaleSellerOption, normalizedQuery: string): boolean {
  const searchable = [
    seller.nombre,
    seller.email || "",
    seller.rol || "",
    seller.profesionalId || "",
    seller.id,
  ]
    .join(" ")
    .toLowerCase();

  return searchable.includes(normalizedQuery);
}

export async function fetchInventoryProducts(token: string, currency: string): Promise<InventoryProduct[]> {
  const url = `${API_BASE_URL}inventary/product/productos/?moneda=${encodeURIComponent(currency)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: buildAuthHeaders(token),
  });

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }

  const data = await parseJsonSafely<InventoryProductRaw[] | Record<string, unknown>>(response);
  const source = Array.isArray(data) ? data : [];

  return source
    .map((raw) => normalizeInventoryProduct(raw, currency))
    .filter((product): product is InventoryProduct => Boolean(product))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchInventoryProductDetailByPath(
  token: string,
  inventoryId: string,
  currency: string
): Promise<InventoryProduct> {
  const url = `${API_BASE_URL}inventary/product/productos/${encodeURIComponent(inventoryId)}?moneda=${encodeURIComponent(currency)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: buildAuthHeaders(token),
  });

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }

  const raw = await parseJsonSafely<InventoryProductRaw>(response);
  const normalized = raw ? normalizeInventoryProduct(raw, currency) : null;

  if (!normalized) {
    throw new Error("No se pudo normalizar el detalle del producto");
  }

  return normalized;
}

export async function fetchInventoryProductDetail(params: GetInventoryDetailParams): Promise<InventoryProduct> {
  try {
    return await fetchInventoryProductDetailByPath(params.token, params.inventoryId, params.currency);
  } catch (error) {
    if (!params.fallbackInventoryId || params.fallbackInventoryId === params.inventoryId) {
      throw error;
    }
    return fetchInventoryProductDetailByPath(params.token, params.fallbackInventoryId, params.currency);
  }
}

export async function searchDirectSaleSellers(
  token: string,
  query: string,
  options: SearchDirectSaleSellersOptions = {}
): Promise<DirectSaleSellerOption[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }

  const sedeId = typeof options.sedeId === "string" ? options.sedeId.trim() || undefined : undefined;
  const normalizedQuery = trimmedQuery.toLowerCase();
  const source = await fetchDirectSaleSellersFromAuthUsers(token, sedeId);
  const normalizedLimit =
    typeof options.limit === "number" && Number.isFinite(options.limit)
      ? Math.max(1, Math.min(100, Math.trunc(options.limit)))
      : 20;

  return source
    .filter((seller) => sellerMatchesQuery(seller, normalizedQuery))
    .slice(0, normalizedLimit);
}

export async function createDirectSale(input: CreateDirectSaleInput): Promise<CreatedDirectSale> {
  const attempts = [
    buildCreateSalePayload(input, true),
    buildCreateSalePayload(input, false),
  ];

  let lastError = "No se pudo crear la venta directa";

  for (let index = 0; index < attempts.length; index += 1) {
    const response = await fetch(`${API_BASE_URL}sales/`, {
      method: "POST",
      headers: {
        ...buildAuthHeaders(input.token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(attempts[index]),
    });

    if (response.ok) {
      const data = await parseJsonSafely<Record<string, unknown>>(response);
      const saleId = extractSaleId(data);

      if (!saleId) {
        throw new Error("La API no devolvió el identificador de la venta");
      }

      return {
        saleId,
        raw: data,
      };
    }

    lastError = await parseApiError(response);
    const canRetry = response.status === 422 && index < attempts.length - 1;
    if (!canRetry) {
      break;
    }
  }

  throw new Error(lastError);
}

export async function registerDirectSalePayment(
  input: RegisterDirectSalePaymentInput
): Promise<Record<string, unknown> | null> {
  const baseUrl = `${API_BASE_URL}sales/${encodeURIComponent(input.saleId)}/pago`;
  const amount = roundToTwo(input.amount);
  const giftCardCode = typeof input.giftCardCode === "string" ? input.giftCardCode.trim() : "";
  const bodyPayload = {
    monto: amount,
    metodo_pago: normalizeDirectSalePaymentMethod(input.paymentMethod),
    ...(giftCardCode.length > 0 ? { codigo_giftcard: giftCardCode } : {}),
  };

  const bodyResponse = await fetch(baseUrl, {
    method: "POST",
    headers: {
      ...buildAuthHeaders(input.token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodyPayload),
  });

  if (bodyResponse.ok) {
    return parseJsonSafely<Record<string, unknown>>(bodyResponse);
  }

  if (![400, 405, 422].includes(bodyResponse.status)) {
    throw new Error(await parseApiError(bodyResponse));
  }

  const query = new URLSearchParams({
    monto: String(amount),
    metodo_pago: normalizeDirectSalePaymentMethod(input.paymentMethod),
  });
  if (giftCardCode.length > 0) {
    query.append("codigo_giftcard", giftCardCode);
  }

  const queryResponse = await fetch(`${baseUrl}?${query.toString()}`, {
    method: "POST",
    headers: buildAuthHeaders(input.token),
  });

  if (!queryResponse.ok) {
    throw new Error(await parseApiError(queryResponse));
  }

  return parseJsonSafely<Record<string, unknown>>(queryResponse);
}

export async function deleteDirectSaleProduct(token: string, saleId: string, productId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}sales/${encodeURIComponent(saleId)}/productos/${encodeURIComponent(productId)}`,
    {
      method: "DELETE",
      headers: buildAuthHeaders(token),
    }
  );

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }
}

export async function deleteAllDirectSaleProducts(token: string, saleId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}sales/${encodeURIComponent(saleId)}/productos`, {
    method: "DELETE",
    headers: buildAuthHeaders(token),
  });

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }
}

export async function fetchAllDirectSaleSellers(token: string, sedeId?: string): Promise<DirectSaleSellerOption[]> {
  return fetchDirectSaleSellersFromAuthUsers(token, sedeId);
}

export async function verifyDirectSaleInBillingReport(
  params: VerifyBillingSaleParams
): Promise<Record<string, unknown> | null> {
  const url = `${API_BASE_URL}api/billing/sales/${encodeURIComponent(params.sedeId)}/${encodeURIComponent(params.saleId)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: buildAuthHeaders(params.token),
  });

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }

  return parseJsonSafely<Record<string, unknown>>(response);
}
