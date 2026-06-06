import { API_BASE_URL } from "../types/config";
import { getActiveSedeIdFromStorage } from "./sede-context";

let installed = false;

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "");

const resolveRequestUrl = (input: RequestInfo | URL): string | null => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return null;
};

const shouldAttachSedeHeader = (headers: Headers): boolean => {
  if (headers.has("Authorization") || headers.has("authorization")) {
    return true;
  }

  if (typeof window === "undefined") return false;
  return Boolean(sessionStorage.getItem("access_token") || localStorage.getItem("access_token"));
};

export const installApiFetchInterceptor = () => {
  if (installed || typeof window === "undefined") return;

  const apiBase = normalizeBaseUrl(API_BASE_URL);
  const nativeFetch = window.fetch.bind(window);

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = resolveRequestUrl(input);
    if (!requestUrl || !normalizeBaseUrl(requestUrl).startsWith(apiBase)) {
      return nativeFetch(input, init);
    }

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );

    if (shouldAttachSedeHeader(headers)) {
      const activeSedeId = getActiveSedeIdFromStorage();
      if (activeSedeId && !headers.has("X-Sede-Id") && !headers.has("x-sede-id")) {
        headers.set("X-Sede-Id", activeSedeId);
      }
    }

    if (input instanceof Request) {
      const nextRequest = new Request(input, { ...init, headers });
      return nativeFetch(nextRequest);
    }

    return nativeFetch(input, { ...init, headers });
  }) as typeof window.fetch;

  installed = true;
};

