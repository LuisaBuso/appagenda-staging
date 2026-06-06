// src/api/inventario.ts
import { API_BASE_URL } from "../../../types/config";

export interface InventarioProducto {
  _id: string;
  nombre: string;
  producto_id: string;
  sede_id: string;
  stock_actual: number;
  stock_minimo: number;
  fecha_creacion: string;
  fecha_ultima_actualizacion: string;
  creado_por: string;
  producto_nombre: string;
  producto_codigo: string;
  categoria: string;
  // Campos opcionales usados solo para UI (no todos vienen del backend)
  ventas?: number;
  precio?: number;
  costo?: number;
  imagen_url?: string;
  producto_tipo?: string;
  sku?: string;
}

export interface CrearInventarioInput {
  producto_id: string;
  sede_id: string;
  stock_actual: number;
  stock_minimo: number;
}

export class InventarioService {
  private readonly CACHE_TTL_MS = 45_000;
  private readonly SESSION_CACHE_TTL_MS = 180_000;
  private readonly SESSION_CACHE_PREFIX = "inventario-cache:";
  private inMemoryCache = new Map<
    string,
    { data: InventarioProducto[]; expiresAt: number }
  >();
  private pendingRequests = new Map<string, Promise<InventarioProducto[]>>();

  // No almacenar token en el constructor
  private getHeaders(token: string | null) {
    const headers: HeadersInit = {
      "accept": "application/json",
      "Content-Type": "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    return headers;
  }

  private parseErrorDetail(detail: unknown): string {
    if (typeof detail === "string") {
      return detail;
    }

    if (Array.isArray(detail)) {
      const mensajes = detail
        .map((item) => {
          if (item && typeof item === "object" && "msg" in item) {
            const msg = (item as { msg?: unknown }).msg;
            return typeof msg === "string" ? msg : null;
          }
          return null;
        })
        .filter((msg): msg is string => Boolean(msg));

      if (mensajes.length > 0) {
        return mensajes.join(", ");
      }
    }

    return "No se pudo procesar la solicitud";
  }

  private getCacheKey(sedeId: string, stockBajo: boolean): string {
    return `${sedeId}:${stockBajo ? "low" : "all"}`;
  }

  private getSessionCacheKey(cacheKey: string): string {
    return `${this.SESSION_CACHE_PREFIX}${cacheKey}`;
  }

  private getSessionStorage(): Storage | null {
    if (typeof window === "undefined") {
      return null;
    }

    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  }

  private getStoredValue(key: string): string | null {
    const storage = this.getSessionStorage();
    return storage?.getItem(key) ?? null;
  }

  private readSessionCache(cacheKey: string): InventarioProducto[] | null {
    const storage = this.getSessionStorage();
    if (!storage) {
      return null;
    }

    const sessionKey = this.getSessionCacheKey(cacheKey);
    const raw = storage.getItem(sessionKey);

    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as {
        expiresAt?: number;
        data?: InventarioProducto[];
      };

      if (!parsed || !Array.isArray(parsed.data)) {
        storage.removeItem(sessionKey);
        return null;
      }

      if (typeof parsed.expiresAt !== "number" || parsed.expiresAt <= Date.now()) {
        storage.removeItem(sessionKey);
        return null;
      }

      return parsed.data;
    } catch {
      storage.removeItem(sessionKey);
      return null;
    }
  }

  private writeSessionCache(cacheKey: string, data: InventarioProducto[]): void {
    const storage = this.getSessionStorage();
    if (!storage) {
      return;
    }

    try {
      storage.setItem(
        this.getSessionCacheKey(cacheKey),
        JSON.stringify({
          expiresAt: Date.now() + this.SESSION_CACHE_TTL_MS,
          data,
        })
      );
    } catch {
      // Evitar interrumpir flujo por errores de almacenamiento
    }
  }

  private getCachedInventario(cacheKey: string): InventarioProducto[] | null {
    const memoryEntry = this.inMemoryCache.get(cacheKey);

    if (memoryEntry && memoryEntry.expiresAt > Date.now()) {
      return memoryEntry.data;
    }

    if (memoryEntry) {
      this.inMemoryCache.delete(cacheKey);
    }

    const sessionEntry = this.readSessionCache(cacheKey);
    if (sessionEntry) {
      this.inMemoryCache.set(cacheKey, {
        data: sessionEntry,
        expiresAt: Date.now() + this.CACHE_TTL_MS,
      });
      return sessionEntry;
    }

    return null;
  }

  private cacheInventario(cacheKey: string, data: InventarioProducto[]): void {
    const safeData = Array.isArray(data) ? data : [];
    this.inMemoryCache.set(cacheKey, {
      data: safeData,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });
    this.writeSessionCache(cacheKey, safeData);
  }

  private invalidateCacheForSede(sedeId?: string | null): void {
    const storage = this.getSessionStorage();

    if (sedeId) {
      const keys = [
        this.getCacheKey(sedeId, false),
        this.getCacheKey(sedeId, true),
      ];

      keys.forEach((key) => {
        this.inMemoryCache.delete(key);
        if (storage) {
          storage.removeItem(this.getSessionCacheKey(key));
        }
      });

      return;
    }

    this.inMemoryCache.clear();

    if (!storage) {
      return;
    }

    for (let i = storage.length - 1; i >= 0; i -= 1) {
      const key = storage.key(i);
      if (key?.startsWith(this.SESSION_CACHE_PREFIX)) {
        storage.removeItem(key);
      }
    }
  }

  // Obtener inventario de una sede específica
  async getInventarioBySede(
    sede_id: string,
    stockBajo: boolean = false,
    token: string | null
  ): Promise<InventarioProducto[]> {
    const cacheKey = this.getCacheKey(sede_id, stockBajo);
    const cachedData = this.getCachedInventario(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    const pendingRequest = this.pendingRequests.get(cacheKey);
    if (pendingRequest) {
      return pendingRequest;
    }

    const requestPromise = (async () => {
      try {
        const url = new URL(`${API_BASE_URL}inventary/inventarios/inventarios/`);

        // Agregar parámetros a la URL
        url.searchParams.append('sede_id', sede_id);
        if (stockBajo) {
          url.searchParams.append('stock_bajo', 'true');
        }

        const response = await fetch(url.toString(), {
          method: "GET",
          headers: this.getHeaders(token),
        });

        if (!response.ok) {
          throw new Error(`Error ${response.status}: ${response.statusText}`);
        }

        const data: InventarioProducto[] = await response.json();
        this.cacheInventario(cacheKey, data);
        return data;

      } catch (error) {
        console.error("Error obteniendo inventario de la sede:", error);
        throw error;
      }
    })();

    this.pendingRequests.set(cacheKey, requestPromise);

    try {
      return await requestPromise;
    } finally {
      this.pendingRequests.delete(cacheKey);
    }
  }

  // Obtener inventario del usuario autenticado
  async getInventarioUsuario(
    stockBajo: boolean = false,
    token?: string | null,
    sede_id?: string | null
  ): Promise<InventarioProducto[]> {
    try {
      // Usar el token y sede_id proporcionados, o intentar obtenerlos de sessionStorage
      const actualToken = token || this.getStoredValue("access_token");
      const actualSedeId = sede_id || this.getStoredValue("beaux-sede_id");

      if (!actualSedeId) {
        throw new Error("No se encontró sede_id");
      }

      if (!actualToken) {
        throw new Error("No se encontró token de autenticación");
      }

      return await this.getInventarioBySede(actualSedeId, stockBajo, actualToken);

    } catch (error) {
      console.error("Error obteniendo inventario del usuario:", error);
      throw error;
    }
  }

  // Ajuste de stock: backend espera cantidad_ajuste (delta = nuevoValor - valorActual).
  // PATCH .../inventary/inventarios/inventarios/{inventario_id}/ajustar
  async ajustarInventario(
    inventarioId: string,
    cantidadAjuste: number,
    token?: string | null
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const actualToken = token || this.getStoredValue("access_token");

      if (!actualToken) {
        throw new Error("No se encontró token de autenticación");
      }

      const response = await fetch(
        `${API_BASE_URL}inventary/inventarios/inventarios/${inventarioId}/ajustar`,
        {
          method: "PATCH",
          headers: this.getHeaders(actualToken),
          body: JSON.stringify({
            cantidad_ajuste: cantidadAjuste
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: Array.isArray(data.detail)
            ? data.detail.map((e: any) => e.msg).join(", ")
            : data.detail || "No se pudo ajustar el inventario"

        };
      }

      return {
        success: true,
        message: data.msg || "Inventario ajustado correctamente"
      };

    } catch (error) {
      console.error("Error ajustando inventario:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido"
      };
    } finally {
      this.invalidateCacheForSede(this.getStoredValue("beaux-sede_id"));
    }
  }

  // Crear inventario inicial
  async crearInventario(
    payload: CrearInventarioInput,
    token?: string | null
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const actualToken = token || this.getStoredValue("access_token");

      if (!actualToken) {
        throw new Error("No se encontró token de autenticación");
      }

      const response = await fetch(
        `${API_BASE_URL}inventary/inventarios/inventarios/`,
        {
          method: "POST",
          headers: this.getHeaders(actualToken),
          body: JSON.stringify(payload),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: this.parseErrorDetail((data as { detail?: unknown }).detail),
        };
      }

      return {
        success: true,
        message: (data as { msg?: string }).msg || "Inventario creado correctamente",
      };
    } catch (error) {
      console.error("Error creando inventario:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      };
    } finally {
      this.invalidateCacheForSede(payload.sede_id || this.getStoredValue("beaux-sede_id"));
    }
  }

  // Filtrar productos
  async buscarProductos(filtros: {
    searchTerm?: string;
    categoria?: string;
    stockBajo?: boolean;
  }, token?: string | null, sede_id?: string | null): Promise<InventarioProducto[]> {
    try {
      // Obtener todos los productos del inventario
      let productos = await this.getInventarioUsuario(
        filtros.stockBajo,
        token,
        sede_id
      );

      // Aplicar filtros
      if (filtros.searchTerm) {
        const searchLower = filtros.searchTerm.toLowerCase();
        productos = productos.filter(producto =>
          producto.nombre.toLowerCase().includes(searchLower) ||
          producto.producto_id.toLowerCase().includes(searchLower) ||
          producto.producto_codigo.toLowerCase().includes(searchLower)
        );
      }

      if (filtros.categoria && filtros.categoria !== "all") {
        productos = productos.filter(producto =>
          producto.categoria === filtros.categoria
        );
      }

      return productos;

    } catch (error) {
      console.error("Error buscando productos:", error);
      throw error;
    }
  }
}

// Exportar una instancia única del servicio
export const inventarioService = new InventarioService();
