// src/services/apiClient.ts
import { API_BASE_URL } from '../../../../types/config';
import { normalizeBackendDateParams } from '../../../../lib/dateFormat';

export interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  status: number;
}

export class ApiClient {
  private baseURL: string;
  private defaultHeaders: HeadersInit;
  private abortControllers: Map<string, AbortController>;

  constructor(baseURL: string = API_BASE_URL) {
    // Asegurar que el baseURL termine con /
    this.baseURL = baseURL.endsWith('/') ? baseURL : baseURL + '/';
    this.defaultHeaders = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
    this.abortControllers = new Map();
  }

  private getAuthToken(): string | null {
    // Buscar token en localStorage o sessionStorage
    return localStorage.getItem('access_token') || 
           sessionStorage.getItem('access_token');
  }

  // Generar una clave única para identificar requests
  private generateRequestKey(endpoint: string, params?: Record<string, any>): string {
    const paramsString = params ? JSON.stringify(params) : '';
    return `${endpoint}|${paramsString}`;
  }

  // Cancelar request anterior para la misma clave
  private cancelPreviousRequest(key: string): void {
    const existingController = this.abortControllers.get(key);
    if (existingController && !existingController.signal.aborted) {
      existingController.abort();
      console.log(`Cancelled previous request for key: ${key}`);
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    params?: Record<string, any>,
    requestKey?: string
  ): Promise<ApiResponse<T>> {
    // Crear clave para este request si no se proporciona
    const key = requestKey || this.generateRequestKey(endpoint, params);
    
    // Cancelar request anterior para la misma clave
    this.cancelPreviousRequest(key);

    // Crear nuevo abort controller
    const abortController = new AbortController();
    this.abortControllers.set(key, abortController);

    try {
      const token = this.getAuthToken();
      
      // Quitar / al inicio del endpoint si existe para evitar doble //
      const cleanEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
      
      // Construir URL con parámetros
      let url = `${this.baseURL}${cleanEndpoint}`;
      if (params) {
        const normalizedParams = normalizeBackendDateParams(params);
        const queryParams = new URLSearchParams();
        Object.entries(normalizedParams).forEach(([key, value]) => {
          if (value !== null && value !== undefined && value !== '') {
            queryParams.append(key, String(value));
          }
        });
        const queryString = queryParams.toString();
        if (queryString) {
          url += `?${queryString}`;
        }
      }

      const headers = {
        ...this.defaultHeaders,
        ...(token && { 'Authorization': `Bearer ${token}` }),
        ...options.headers,
      };

      console.log(`🌐 GET ${url}`);

      const response = await fetch(url, {
        ...options,
        headers,
        signal: abortController.signal,
      });

      // Limpiar el controller después de que la request se complete
      this.abortControllers.delete(key);

      // Manejar respuestas vacías
      if (response.status === 204 || response.headers.get('content-length') === '0') {
        return {
          status: response.status,
          data: {} as T,
        };
      }

      const text = await response.text();
      const data = text ? JSON.parse(text) : null;

      if (!response.ok) {
        return {
          status: response.status,
          error: data?.detail || data?.error || `Error ${response.status}: ${response.statusText}`,
        };
      }

      return {
        status: response.status,
        data: data as T,
      };
    } catch (error: any) {
      // Limpiar el controller en caso de error
      this.abortControllers.delete(key);

      // Si fue abortado, no es un error real
      if (error.name === 'AbortError') {
        console.log(`Request aborted: ${key}`);
        return {
          status: 0,
          error: 'Request aborted',
        };
      }

      console.error('API request failed:', error);
      return {
        status: 500,
        error: error instanceof Error ? error.message : 'Error de conexión',
      };
    }
  }

  async get<T>(endpoint: string, params?: Record<string, any>, requestKey?: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET' }, params, requestKey);
  }

  async post<T>(endpoint: string, body?: any, params?: Record<string, any>): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }, params);
  }

  async put<T>(endpoint: string, body?: any, params?: Record<string, any>): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    }, params);
  }

  async delete<T>(endpoint: string, params?: Record<string, any>): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE' }, params);
  }

  // Método para cancelar todos los requests pendientes
  cancelAllRequests(): void {
    this.abortControllers.forEach((controller, key) => {
      if (!controller.signal.aborted) {
        controller.abort();
        console.log(`Cancelled request: ${key}`);
      }
    });
    this.abortControllers.clear();
  }

  // Método para cancelar un request específico
  cancelRequest(endpoint: string, params?: Record<string, any>): void {
    const key = this.generateRequestKey(endpoint, params);
    this.cancelPreviousRequest(key);
  }
}

export const apiClient = new ApiClient();
