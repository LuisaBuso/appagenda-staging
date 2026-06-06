import { API_BASE_URL } from "../../../types/config";

export type FacturarTipo = "cita" | "venta";

export interface FacturarProducto {
  producto_id: string;
  nombre: string;
  precio: number;
  cantidad: number;
  categoria?: string;
}

export interface HandleFacturarInput {
  id: string;
  tipo: FacturarTipo;
  token: string;
  productos: FacturarProducto[];
  total_productos: number;
  total_final: number;
}

export async function handleFacturarRequest({
  id,
  tipo,
  token,
  productos,
  total_productos,
  total_final,
}: HandleFacturarInput): Promise<any> {
  if (!id?.trim()) {
    throw new Error("ID inválido para facturar");
  }

  if (!token?.trim()) {
    throw new Error("No se encontró token de autenticación");
  }

  const baseUrl = API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  const endpoint = `${baseUrl}/api/billing/quotes/facturar/${encodeURIComponent(id)}?tipo=${tipo}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      productos,
      total_productos,
      total_final,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Error ${response.status}`);
  }

  return response.json();
}
