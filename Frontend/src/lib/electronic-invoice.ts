import { API_BASE_URL } from "../types/config";
import { getActiveSedeIdFromStorage } from "./sede-context";

export type ElectronicInvoiceTarget = {
  saleId?: string | null;
  invoiceId?: string | null;
};

export type ElectronicInvoiceResult = {
  data: unknown;
  message: string;
  sedeId?: string | null;
};

export type ElectronicInvoiceStatusResult = {
  status: string | null;
  data: unknown;
  invoiceId?: string | null;
  saleId?: string | null;
  provider?: string | null;
};

const normalizeBaseUrl = (value: string): string =>
  value.endsWith("/") ? value.slice(0, -1) : value;

const resolveToken = (token?: string | null): string | null => {
  const explicit = String(token ?? "").trim();
  if (explicit) return explicit;
  if (typeof window === "undefined") return null;
  return (
    sessionStorage.getItem("access_token") ||
    localStorage.getItem("access_token")
  );
};

const resolveSedeId = (sedeId?: string | null): string | null => {
  const explicit = String(sedeId ?? "").trim();
  if (explicit) return explicit;
  return getActiveSedeIdFromStorage();
};

const parseResponseBody = async (response: Response): Promise<any> => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const extractElectronicTargets = (payload: any): ElectronicInvoiceTarget => {
  if (!payload || typeof payload !== "object") return {};

  const pickFirst = (keys: string[]): string | null => {
    for (const key of keys) {
      const value = (payload as any)[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };

  return {
    saleId: pickFirst([
      "sale_id",
      "saleId",
      "venta_id",
      "ventaId",
      "id_venta",
      "venta",
      "_id", // algunos endpoints devuelven _id para la venta
    ]),
    invoiceId: pickFirst([
      "invoice_id",
      "invoiceId",
      "factura_id",
      "facturaId",
      "id_factura",
      "factura",
    ]),
  };
};

export async function emitElectronicInvoice({
  saleId,
  invoiceId,
  token,
  sedeId,
}: {
  saleId?: string | null;
  invoiceId?: string | null;
  token?: string | null;
  sedeId?: string | null;
}): Promise<ElectronicInvoiceResult> {
  const targetSaleId = saleId?.trim();
  const targetInvoiceId = invoiceId?.trim();

  if (!targetSaleId && !targetInvoiceId) {
    throw new Error("Falta sale_id o invoice_id para enviar la factura electrónica");
  }

  const authToken = resolveToken(token);
  if (!authToken) {
    throw new Error("No se encontró token de autenticación para FE");
  }

  const resolvedSedeId = resolveSedeId(sedeId);
  const baseUrl = normalizeBaseUrl(API_BASE_URL);
  const path = targetSaleId
    ? `/api/billing/sales/${encodeURIComponent(targetSaleId)}/electronic/emit`
    : `/api/billing/invoices/${encodeURIComponent(targetInvoiceId as string)}/electronic/emit`;

  const headers: HeadersInit = {
    Authorization: `Bearer ${authToken}`,
    Accept: "application/json",
  };

  if (resolvedSedeId) {
    headers["X-Sede-Id"] = resolvedSedeId;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
  });

  const body = await parseResponseBody(response);
  if (!response.ok) {
    const message =
      (body && (body.detail || body.message || body.error)) ||
      `Error ${response.status}: No fue posible enviar la factura electrónica`;
    throw new Error(message);
  }

  const message =
    (body && (body.message || body.detail || body.status)) ||
    "Factura electrónica enviada";

  return {
    data: body,
    message,
    sedeId: resolvedSedeId,
  };
}

export async function fetchElectronicInvoiceStatus({
  saleId,
  invoiceId,
  token,
  sedeId,
  signal,
}: {
  saleId?: string | null;
  invoiceId?: string | null;
  token?: string | null;
  sedeId?: string | null;
  signal?: AbortSignal;
}): Promise<ElectronicInvoiceStatusResult> {
  const targetSaleId = saleId?.trim();
  const targetInvoiceId = invoiceId?.trim();

  if (!targetSaleId && !targetInvoiceId) {
    throw new Error(
      "Falta sale_id o invoice_id para consultar estado de factura electrónica",
    );
  }

  const authToken = resolveToken(token);
  if (!authToken) {
    throw new Error("No se encontró token de autenticación para FE");
  }

  const resolvedSedeId = resolveSedeId(sedeId);
  const baseUrl = normalizeBaseUrl(API_BASE_URL);
  const path = targetSaleId
    ? `/api/billing/sales/${encodeURIComponent(targetSaleId)}/electronic/status`
    : `/api/billing/invoices/${encodeURIComponent(targetInvoiceId as string)}/electronic/status`;

  const headers: HeadersInit = {
    Authorization: `Bearer ${authToken}`,
    Accept: "application/json",
  };

  if (resolvedSedeId) {
    headers["X-Sede-Id"] = resolvedSedeId;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers,
    signal,
  });

  const body = await parseResponseBody(response);
  if (!response.ok) {
    const message =
      (body && (body.detail || body.message || body.error)) ||
      `Error ${response.status}: No fue posible consultar estado de factura electrónica`;
    throw new Error(message);
  }

  const electronic = (body && (body.electronic_invoice || body)) || null;
  const status =
    (electronic && (electronic.status as string | null | undefined)) ||
    (body && (body.status as string | null | undefined)) ||
    null;

  return {
    status: status ?? null,
    data: electronic,
    invoiceId:
      (electronic && (electronic.invoice_id as string | null | undefined)) ||
      (body && (body.invoice_id as string | null | undefined)) ||
      targetInvoiceId ||
      null,
    saleId:
      (electronic && (electronic.sale_id as string | null | undefined)) ||
      (body && (body.sale_id as string | null | undefined)) ||
      targetSaleId ||
      null,
    provider:
      (electronic && (electronic.provider as string | null | undefined)) ||
      null,
  };
}
