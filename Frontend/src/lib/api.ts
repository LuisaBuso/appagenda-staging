export const apiFetch = (
  url: string,
  options: RequestInit & { headers?: Record<string, string> } = {},
  sedeId?: string,
): Promise<Response> => {
  const token =
    sessionStorage.getItem("access_token") ?? localStorage.getItem("access_token");
  const activeSede =
    sedeId ??
    sessionStorage.getItem("beaux-sede_id") ??
    localStorage.getItem("beaux-sede_id");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };

  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (activeSede) headers["X-Sede-Id"] = activeSede;

  return fetch(url, { ...options, headers });
};
