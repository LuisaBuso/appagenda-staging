import { API_BASE_URL } from "../../types/config";
import { getActiveSedeIdFromStorage } from "../../lib/sede-context";
import type {
  GiftCard,
  GiftCardCreatePayload,
  GiftCardDeleteResponse,
  GiftCardHistoryResponse,
  GiftCardListParams,
  GiftCardRedeemPayload,
  GiftCardReleasePayload,
  GiftCardReservePayload,
  GiftCardsListResponse,
  GiftCardResponse,
  GiftCardUpdatePayload,
} from "./types";

interface ApiErrorBody {
  detail?: string | Array<{ msg?: string }>;
  message?: string;
  error?: string;
}

interface ClientsResponse {
  clientes?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
  metadata?: {
    total_paginas?: number;
    total_pages?: number;
    tiene_siguiente?: boolean;
    has_next?: boolean;
  };
  pagination?: {
    total_paginas?: number;
    total_pages?: number;
    tiene_siguiente?: boolean;
    has_next?: boolean;
  };
}

type GiftCardClientSelectorOption = { id: string; nombre: string; email?: string; telefono?: string };
type GiftCardClientSearchResult = {
  clients: GiftCardClientSelectorOption[];
  hasNext: boolean;
  page: number;
  limit: number;
  totalPages: number | null;
};

const CLIENTS_PAGE_LIMIT = 100;
const CLIENTS_CACHE_TTL_MS = 5 * 60 * 1000;
const CLIENTS_SEARCH_DEFAULT_LIMIT = 80;
const CLIENTS_SEARCH_CACHE_TTL_MS = 60 * 1000;

let clientsCache: GiftCardClientSelectorOption[] | null = null;
let clientsCacheAt = 0;
let clientsInflightPromise: Promise<GiftCardClientSelectorOption[]> | null = null;
const clientsSearchCache = new Map<string, { data: GiftCardClientSearchResult; at: number }>();

function buildHeaders(token: string, hasJsonBody = false): HeadersInit {
  const activeSedeId = String(getActiveSedeIdFromStorage() ?? "").trim();

  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
    ...(activeSedeId ? { "X-Sede-Id": activeSedeId } : {}),
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
    const detailMessage = body.detail[0]?.msg;
    if (detailMessage) {
      return detailMessage;
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

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function buildGiftcardsUrl(path: string): string {
  return `${API_BASE_URL}api/giftcards${path}`;
}

function getClientRecords(
  payload: ClientsResponse | Array<Record<string, unknown>> | null
): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.clientes)) {
    return payload.clientes;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  return [];
}

function getPaginationInfo(payload: ClientsResponse | Array<Record<string, unknown>> | null): {
  totalPages: number | null;
  hasNext: boolean | null;
} {
  if (!payload || Array.isArray(payload)) {
    return { totalPages: null, hasNext: null };
  }

  const source = payload.metadata ?? payload.pagination;
  if (!source) {
    return { totalPages: null, hasNext: null };
  }

  const totalPagesRaw = source.total_paginas ?? source.total_pages;
  const totalPages =
    typeof totalPagesRaw === "number" && Number.isFinite(totalPagesRaw) && totalPagesRaw > 0
      ? Math.floor(totalPagesRaw)
      : null;

  const hasNextRaw = source.tiene_siguiente ?? source.has_next;
  const hasNext = typeof hasNextRaw === "boolean" ? hasNextRaw : null;

  return { totalPages, hasNext };
}

function normalizeClientOptions(
  records: Array<Record<string, unknown>>
): GiftCardClientSelectorOption[] {
  const clientMap = new Map<string, GiftCardClientSelectorOption>();

  for (const item of records) {
    const id = String(item.cliente_id ?? item.id ?? item._id ?? "").trim();
    const nombre = String(item.nombre ?? "").trim();

    if (!id || !nombre) {
      continue;
    }

    const email = String(item.correo ?? item.email ?? "").trim() || undefined;
    const telefono = String(item.telefono ?? "").trim() || undefined;
    const existing = clientMap.get(id);

    if (!existing) {
      clientMap.set(id, { id, nombre, email, telefono });
      continue;
    }

    clientMap.set(id, {
      id,
      nombre: existing.nombre || nombre,
      email: existing.email || email,
      telefono: existing.telefono || telefono,
    });
  }

  return Array.from(clientMap.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

async function fetchClientsPage(token: string, page: number): Promise<{
  records: Array<Record<string, unknown>>;
  totalPages: number | null;
}> {
  const response = await fetch(
    `${API_BASE_URL}clientes/todos?pagina=${page}&limite=${CLIENTS_PAGE_LIMIT}`,
    {
      method: "GET",
      headers: buildHeaders(token),
    }
  );

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }

  const payload = await parseJsonSafely<ClientsResponse | Array<Record<string, unknown>>>(response);
  const records = getClientRecords(payload);
  const pageInfo = getPaginationInfo(payload);

  return {
    records,
    totalPages: pageInfo.totalPages,
  };
}

function getClientsSearchCacheKey(query: string, limit: number, page: number): string {
  return `${query.trim().toLowerCase()}::${limit}::${page}`;
}

export const giftcardsService = {
  async createGiftCard(token: string, payload: GiftCardCreatePayload): Promise<GiftCardResponse> {
    const response = await fetch(buildGiftcardsUrl("/"), {
      method: "POST",
      headers: buildHeaders(token, true),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const result = await parseJsonSafely<GiftCardResponse>(response);
    if (!result?.giftcard) {
      throw new Error("La API no devolvió la gift card creada");
    }

    return result;
  },

  async getGiftCardsBySede(
    token: string,
    sedeId: string,
    params: GiftCardListParams = {}
  ): Promise<GiftCardsListResponse> {
    const query = new URLSearchParams();

    if (params.estado) query.set("estado", params.estado);
    if (params.cliente_id) query.set("cliente_id", params.cliente_id);
    if (params.page) query.set("page", String(params.page));
    if (params.limit) query.set("limit", String(params.limit));

    const queryString = query.toString();
    const suffix = queryString.length > 0 ? `?${queryString}` : "";

    const response = await fetch(buildGiftcardsUrl(`/sede/${encodeURIComponent(sedeId)}${suffix}`), {
      method: "GET",
      headers: buildHeaders(token),
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const result = await parseJsonSafely<GiftCardsListResponse>(response);
    if (!result) {
      throw new Error("No se pudo leer la respuesta de gift cards");
    }

    return {
      success: Boolean(result.success),
      pagination: result.pagination ?? {
        page: params.page ?? 1,
        limit: params.limit ?? 10,
        total: 0,
        total_pages: 0,
      },
      giftcards: Array.isArray(result.giftcards) ? result.giftcards : [],
    };
  },

  async getGiftCardByCode(token: string, codigo: string): Promise<GiftCardResponse> {
    const response = await fetch(
      buildGiftcardsUrl(`/${encodeURIComponent(normalizeCode(codigo))}`),
      {
        method: "GET",
        headers: buildHeaders(token),
      }
    );

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const result = await parseJsonSafely<GiftCardResponse>(response);
    if (!result?.giftcard) {
      throw new Error("No se encontró información de la gift card");
    }

    return result;
  },

  async updateGiftCard(
    token: string,
    codigo: string,
    payload: GiftCardUpdatePayload
  ): Promise<GiftCardResponse> {
    const response = await fetch(
      buildGiftcardsUrl(`/${encodeURIComponent(normalizeCode(codigo))}`),
      {
        method: "PUT",
        headers: buildHeaders(token, true),
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const result = await parseJsonSafely<GiftCardResponse>(response);
    if (!result?.giftcard) {
      throw new Error("No se pudo actualizar la gift card");
    }

    return result;
  },

  async deleteGiftCard(token: string, codigo: string): Promise<GiftCardDeleteResponse> {
    const response = await fetch(
      buildGiftcardsUrl(`/${encodeURIComponent(normalizeCode(codigo))}`),
      {
        method: "DELETE",
        headers: buildHeaders(token),
      }
    );

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const result = await parseJsonSafely<GiftCardDeleteResponse>(response);
    if (!result) {
      throw new Error("No se pudo cancelar la gift card");
    }

    return result;
  },

  async reserveGiftCard(
    token: string,
    codigo: string,
    payload: GiftCardReservePayload
  ): Promise<GiftCardResponse> {
    const response = await fetch(
      buildGiftcardsUrl(`/${encodeURIComponent(normalizeCode(codigo))}/reservar`),
      {
        method: "POST",
        headers: buildHeaders(token, true),
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const result = await parseJsonSafely<GiftCardResponse>(response);
    if (!result?.giftcard) {
      throw new Error("No se pudo reservar saldo de la gift card");
    }

    return result;
  },

  async releaseGiftCard(
    token: string,
    codigo: string,
    payload: GiftCardReleasePayload
  ): Promise<GiftCardResponse> {
    const response = await fetch(
      buildGiftcardsUrl(`/${encodeURIComponent(normalizeCode(codigo))}/liberar`),
      {
        method: "POST",
        headers: buildHeaders(token, true),
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const result = await parseJsonSafely<GiftCardResponse>(response);
    if (!result?.giftcard) {
      throw new Error("No se pudo liberar saldo de la gift card");
    }

    return result;
  },

  async redeemGiftCard(
    token: string,
    codigo: string,
    payload: GiftCardRedeemPayload
  ): Promise<GiftCardResponse> {
    const response = await fetch(
      buildGiftcardsUrl(`/${encodeURIComponent(normalizeCode(codigo))}/redimir`),
      {
        method: "POST",
        headers: buildHeaders(token, true),
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const result = await parseJsonSafely<GiftCardResponse>(response);
    if (!result?.giftcard) {
      throw new Error("No se pudo redimir la gift card");
    }

    return result;
  },

  async getGiftCardHistory(token: string, codigo: string): Promise<GiftCardHistoryResponse> {
    const response = await fetch(
      buildGiftcardsUrl(`/${encodeURIComponent(normalizeCode(codigo))}/historial`),
      {
        method: "GET",
        headers: buildHeaders(token),
      }
    );

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const result = await parseJsonSafely<GiftCardHistoryResponse>(response);
    if (!result) {
      throw new Error("No se pudo obtener el historial de la gift card");
    }

    return result;
  },

  async searchClientsForSelector(
    token: string,
    query: string,
    options?: { limit?: number; page?: number; forceRefresh?: boolean }
  ): Promise<GiftCardClientSearchResult> {
    const normalizedQuery = String(query || "").trim();
    const limit = Math.min(Math.max(options?.limit ?? CLIENTS_SEARCH_DEFAULT_LIMIT, 1), 50);
    const cacheKey = getClientsSearchCacheKey(normalizedQuery, limit, 1);
    const now = Date.now();

    if (normalizedQuery.length < 2) {
      return { clients: [], hasNext: false, page: 1, limit, totalPages: null };
    }

    if (!options?.forceRefresh) {
      const cached = clientsSearchCache.get(cacheKey);
      if (cached && now - cached.at < CLIENTS_SEARCH_CACHE_TTL_MS) {
        return cached.data;
      }
    }

    const queryParams = new URLSearchParams({
      filtro: normalizedQuery,
      limite: String(limit),
    });

    const response = await fetch(`${API_BASE_URL}clientes/buscar?${queryParams.toString()}`, {
      method: "GET",
      headers: buildHeaders(token),
    });

    if (!response.ok) {
      if (response.status === 400) {
        return { clients: [], hasNext: false, page: 1, limit, totalPages: null };
      }
      throw new Error(await parseApiError(response));
    }

    const payload = await parseJsonSafely<Array<Record<string, unknown>>>(response);
    const records = Array.isArray(payload) ? payload : [];
    const normalized = normalizeClientOptions(records);

    const result: GiftCardClientSearchResult = {
      clients: normalized,
      hasNext: false,
      page: 1,
      limit,
      totalPages: null,
    };

    clientsSearchCache.set(cacheKey, { data: result, at: now });

    return result;
  },

  async fetchClientsForSelector(token: string): Promise<GiftCardClientSelectorOption[]> {
    const now = Date.now();
    if (clientsCache && now - clientsCacheAt < CLIENTS_CACHE_TTL_MS) {
      return clientsCache;
    }

    if (clientsInflightPromise) {
      return clientsInflightPromise;
    }

    clientsInflightPromise = (async () => {
      const firstPage = await fetchClientsPage(token, 1);
      const firstRecords = firstPage.records;
      const totalPages = firstPage.totalPages ?? (firstRecords.length < CLIENTS_PAGE_LIMIT ? 1 : null);

      let allRecords = [...firstRecords];

      if (totalPages && totalPages > 1) {
        const requests: Array<Promise<{ records: Array<Record<string, unknown>>; totalPages: number | null }>> = [];
        for (let page = 2; page <= totalPages; page += 1) {
          requests.push(fetchClientsPage(token, page));
        }

        const pages = await Promise.all(requests);
        for (const pageResult of pages) {
          allRecords = allRecords.concat(pageResult.records);
        }
      } else if (!totalPages) {
        let page = 2;
        let lastCount = firstRecords.length;
        while (lastCount === CLIENTS_PAGE_LIMIT && page <= 1000) {
          const nextPage = await fetchClientsPage(token, page);
          allRecords = allRecords.concat(nextPage.records);
          lastCount = nextPage.records.length;
          page += 1;
        }
      }

      const normalized = normalizeClientOptions(allRecords);
      clientsCache = normalized;
      clientsCacheAt = Date.now();
      return normalized;
    })();

    try {
      return await clientsInflightPromise;
    } finally {
      clientsInflightPromise = null;
    }
  },

  async prefetchClientsForSelector(token: string): Promise<void> {
    if (!token) return;
    await this.fetchClientsForSelector(token);
  },

  async refreshGiftCardAfterCreate(token: string, codigo: string): Promise<GiftCard> {
    const result = await this.getGiftCardByCode(token, codigo);
    return result.giftcard;
  },
};
