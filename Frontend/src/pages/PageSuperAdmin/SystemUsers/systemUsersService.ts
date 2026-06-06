import { API_BASE_URL } from "../../../types/config";
import type { CreateSystemUserPayload, SystemUser, SystemUserRole } from "../../../types/system-user";

const stringifyApiError = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    return value
      .map((item) => stringifyApiError(item))
      .map((item) => item.trim())
      .filter(Boolean)
      .join(" | ");
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const loc = Array.isArray(obj.loc)
      ? obj.loc.map((item) => stringifyApiError(item)).filter(Boolean).join(".")
      : "";
    const msg = stringifyApiError(obj.msg ?? obj.message ?? obj.detail);

    if (loc && msg) return `${loc}: ${msg}`;
    if (msg) return msg;

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
};

const parseErrorMessage = async (response: Response): Promise<string> => {
  const raw = await response.text().catch(() => "");
  if (!raw) return `Error ${response.status}: ${response.statusText}`;

  try {
    const parsed = JSON.parse(raw);
    const detail = stringifyApiError(parsed?.detail);
    if (detail) return detail;

    const message = stringifyApiError(parsed?.message ?? parsed?.error);
    if (message) return message;

    const fallback = stringifyApiError(parsed);
    if (fallback) return fallback;

    return raw;
  } catch {
    return raw;
  }
};

const normalizeRole = (role: string | null | undefined) =>
  String(role || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const normalizeCommissionValue = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0 || parsed > 100) return null;
  return Math.round(parsed * 100) / 100;
};

const isFallbackCandidate = (response: Response) => response.status === 404 || response.status === 405;

const SEDES_PERMITIDAS_UNSUPPORTED_MESSAGE =
  "El backend actual no permite guardar `sedes_permitidas` en `/auth/users/{id}`. Multi-sede por perfil requiere ese campo habilitado en backend.";

const matchesSedesPermitidasContractError = (status: number, message: string): boolean => {
  if (!message) return false;
  if (status !== 400 && status !== 422) return false;

  return /sedes_permitidas|sede.*permitida|extra.*field|extra.*input|extra_forbidden|unexpected|not permitted|unprocessable|validation/i.test(
    message
  );
};

const resolveCanonicalRole = (rawRole: string | null | undefined): SystemUserRole | null => {
  const role = normalizeRole(rawRole);
  if (!role) return null;

  if (role === "super_admin" || role === "superadmin") return "super_admin";
  if (role === "admin_sede" || role === "adminsede" || role === "admin") return "admin_sede";
  if (role === "call_center" || role === "callcenter" || role === "soporte") return "call_center";
  if (role === "recepcionista" || role === "recepcionoista") return "recepcionista";
  if (
    role === "estilista" ||
    role === "stylist" ||
    role === "profesional" ||
    role === "professional" ||
    role === "staff_stylist"
  ) {
    return "estilista";
  }

  return null;
};

const toCanonicalRole = (rawRole: string | null | undefined): SystemUserRole => {
  const resolved = resolveCanonicalRole(rawRole);
  if (resolved) return resolved;
  return "admin_sede";
};

const toLegacySystemUserRole = (role: SystemUserRole): string => {
  if (role === "super_admin") return "superadmin";
  return role;
};

const SYSTEM_ROLES = new Set<SystemUserRole>([
  "super_admin",
  "admin_sede",
  "recepcionista",
  "call_center",
  "estilista",
]);

const isSystemUser = (user: SystemUser) => {
  const role = toCanonicalRole(user.role);
  const userType = normalizeRole(user.user_type);
  return SYSTEM_ROLES.has(role) || userType === "system" || userType === "";
};

const hasValue = (value: unknown) => String(value ?? "").trim().length > 0;

const resolveRoleFromUserRecord = (rawUser: any): SystemUserRole => {
  const roleCandidates = [
    rawUser?.role,
    rawUser?.rol,
    rawUser?.tipo_rol,
    rawUser?.user_role,
    rawUser?.role_name,
    rawUser?.tipo_usuario,
    rawUser?.tipo,
    rawUser?.user?.role,
    rawUser?.user?.rol,
    rawUser?.user?.tipo_rol,
    rawUser?.user?.tipo_usuario,
    rawUser?.user_type,
    rawUser?.user?.user_type,
  ];

  for (const candidate of roleCandidates) {
    const resolved = resolveCanonicalRole(candidate);
    if (resolved) return resolved;
  }

  // Algunos payloads de usuarios no incluyen role/rol pero sí un identificador profesional.
  const hasProfessionalMarker =
    hasValue(rawUser?.profesional_id) ||
    hasValue(rawUser?.estilista_id) ||
    hasValue(rawUser?.stylist_id) ||
    hasValue(rawUser?.professional_id);

  if (hasProfessionalMarker) return "estilista";

  return "admin_sede";
};

const mapToSystemUser = (rawUser: any): SystemUser => {
  const id = String(rawUser?._id ?? rawUser?.id ?? "");
  return {
    _id: id,
    nombre: String(rawUser?.nombre ?? rawUser?.name ?? ""),
    email: String(rawUser?.email ?? rawUser?.correo_electronico ?? ""),
    role: resolveRoleFromUserRecord(rawUser),
    comision_productos: normalizeCommissionValue(rawUser?.comision_productos),
    sede_id: rawUser?.sede_id ?? null,
    sede_nombre: rawUser?.sede_nombre ?? rawUser?.nombre_local ?? null,
    sedes_permitidas: Array.isArray(rawUser?.sedes_permitidas)
      ? rawUser.sedes_permitidas.map((sedeId: unknown) => String(sedeId ?? "").trim()).filter(Boolean)
      : [],
    especialidades: Array.isArray(rawUser?.especialidades) ? rawUser.especialidades : [],
    activo: Boolean(rawUser?.activo ?? true),
    user_type: String(rawUser?.user_type ?? "system"),
    fecha_creacion: rawUser?.fecha_creacion,
    creado_por: rawUser?.creado_por,
  };
};

const getAuthPatchRoleCandidates = (role: CreateSystemUserPayload["role"]): string[] => {
  const normalized = normalizeRole(role);

  if (normalized === "super_admin" || normalized === "superadmin") {
    return ["super_admin", "superadmin"];
  }

  if (normalized === "admin_sede" || normalized === "adminsede" || normalized === "admin") {
    return ["admin_sede", "adminsede", "admin"];
  }

  if (normalized === "call_center") {
    return ["call_center", "callcenter", "soporte"];
  }

  if (normalized === "recepcionista") {
    return ["recepcionista", "recepcionoista"];
  }

  if (normalized === "estilista" || normalized === "stylist" || normalized === "profesional") {
    return ["estilista", "stylist", "profesional"];
  }

  return [normalized];
};

const normalizeSedesPermitidas = (payload: CreateSystemUserPayload): string[] => {
  const values = Array.isArray(payload.sedes_permitidas) ? payload.sedes_permitidas : [];
  return Array.from(new Set(values.map((sedeId) => String(sedeId ?? "").trim()).filter(Boolean)));
};

const toSystemUserCreateRequest = (payload: CreateSystemUserPayload): Record<string, unknown> => {
  const requestData: Record<string, unknown> = {
    nombre: payload.nombre.trim(),
    email: payload.email.trim().toLowerCase(),
    role: toLegacySystemUserRole(payload.role),
    activo: payload.activo ?? true,
  };

  const comisionProductos = normalizeCommissionValue(payload.comision_productos);
  if (comisionProductos !== null) {
    requestData.comision_productos = comisionProductos;
  }

  const sedeId = payload.sede_id?.trim();
  if (sedeId) {
    requestData.sede_id = sedeId;
  }

  const sedesPermitidas = normalizeSedesPermitidas(payload);
  if (sedesPermitidas.length > 0) {
    requestData.sedes_permitidas = sedesPermitidas;
  }

  if (Array.isArray(payload.especialidades)) {
    requestData.especialidades = payload.especialidades
      .map((id) => id?.trim())
      .filter((id): id is string => Boolean(id));
  }

  const password = payload.password?.trim();
  if (password) {
    requestData.password = password;
  }

  return requestData;
};

const buildAuthRegisterForm = (payload: CreateSystemUserPayload, roleValue: string): URLSearchParams => {
  const form = new URLSearchParams();
  form.set("nombre", payload.nombre.trim());
  form.set("correo_electronico", payload.email.trim().toLowerCase());
  form.set("password", payload.password?.trim() || "");
  form.set("rol", roleValue);

  const sedeId = payload.sede_id?.trim();
  if (sedeId) {
    form.set("sede_id", sedeId);
  }

  return form;
};

const tryCreateWithAuthRegister = async (
  token: string,
  payload: CreateSystemUserPayload
): Promise<{ success: boolean; user: SystemUser } | null> => {
  const roleCandidates = getAuthPatchRoleCandidates(payload.role);
  let fallbackResponse: Response | null = null;

  for (const roleCandidate of roleCandidates) {
    const response = await fetch(`${API_BASE_URL}auth/register`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${token}`,
      },
      body: buildAuthRegisterForm(payload, roleCandidate).toString(),
    });

    if (response.ok) {
      return {
        success: true,
        user: {
          _id: "",
          nombre: payload.nombre.trim(),
          email: payload.email.trim().toLowerCase(),
          role: toCanonicalRole(roleCandidate),
          sede_id: payload.sede_id?.trim() || null,
          especialidades: payload.especialidades || [],
          activo: payload.activo ?? true,
          user_type: "system",
          comision_productos: normalizeCommissionValue(payload.comision_productos),
        },
      };
    }

    if (isFallbackCandidate(response)) {
      fallbackResponse = response;
      break;
    }

    const errorMessage = await parseErrorMessage(response);
    const isRoleIssue = /rol/i.test(errorMessage) || /role/i.test(errorMessage);
    if (!isRoleIssue) {
      throw new Error(errorMessage);
    }
  }

  if (fallbackResponse) return null;
  throw new Error("El backend rechazó el rol seleccionado para /auth/register.");
};

const tryPatchAuthUser = async (
  token: string,
  userId: string,
  payload: CreateSystemUserPayload
): Promise<{ success: boolean; user?: SystemUser; warning?: string } | null> => {
  let fallbackResponse: Response | null = null;
  const sedesPermitidas = normalizeSedesPermitidas(payload);

  for (const roleCandidate of getAuthPatchRoleCandidates(payload.role)) {
    const requestDataBase: Record<string, unknown> = {
      nombre: payload.nombre.trim(),
      correo_electronico: payload.email.trim().toLowerCase(),
      rol: roleCandidate,
      sede_id: payload.sede_id?.trim() || null,
      activo: payload.activo ?? true,
    };

    const comisionProductos = normalizeCommissionValue(payload.comision_productos);
    if (comisionProductos !== null) {
      requestDataBase.comision_productos = comisionProductos;
    } else if (payload.comision_productos === null) {
      requestDataBase.comision_productos = null;
    }

    const password = payload.password?.trim();
    if (password) {
      requestDataBase.password = password;
    }

    const requestDataWithSedes =
      sedesPermitidas.length > 0
        ? {
            ...requestDataBase,
            sedes_permitidas: sedesPermitidas,
          }
        : requestDataBase;

    const executePatch = async (requestData: Record<string, unknown>) =>
      fetch(`${API_BASE_URL}auth/users/${userId}`, {
        method: "PATCH",
        headers: {
          accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestData),
      });

    const response = await executePatch(requestDataWithSedes);

    if (response.ok) {
      return await response.json();
    }

    const firstErrorMessage = await parseErrorMessage(response);
    if (
      sedesPermitidas.length > 0 &&
      matchesSedesPermitidasContractError(response.status, firstErrorMessage)
    ) {
      const retryResponse = await executePatch(requestDataBase);
      if (retryResponse.ok) {
        const retryData = await retryResponse.json();
        return {
          ...(typeof retryData === "object" && retryData ? retryData : { success: true }),
          warning: SEDES_PERMITIDAS_UNSUPPORTED_MESSAGE,
        };
      }

      if (isFallbackCandidate(retryResponse)) {
        fallbackResponse = retryResponse;
        break;
      }

      const retryErrorMessage = await parseErrorMessage(retryResponse);
      const isRoleIssueOnRetry = /rol/i.test(retryErrorMessage) || /role/i.test(retryErrorMessage);
      if (!isRoleIssueOnRetry) {
        throw new Error(retryErrorMessage);
      }
      continue;
    }

    if (isFallbackCandidate(response)) {
      fallbackResponse = response;
      break;
    }

    const isRoleIssue = /rol/i.test(firstErrorMessage) || /role/i.test(firstErrorMessage);
    if (!isRoleIssue) {
      throw new Error(firstErrorMessage);
    }
  }

  if (fallbackResponse) return null;
  throw new Error("El backend rechazó el rol seleccionado para /auth/users/{id}.");
};

const syncSedesPermitidasAfterCreate = async (token: string, payload: CreateSystemUserPayload) => {
  const sedesPermitidas = normalizeSedesPermitidas(payload);
  const comisionProductos = normalizeCommissionValue(payload.comision_productos);
  const shouldPatch = sedesPermitidas.length > 0 || payload.comision_productos !== undefined;
  if (!shouldPatch) return;

  const targetEmail = payload.email.trim().toLowerCase();
  if (!targetEmail) return;

  const usersResponse = await fetch(`${API_BASE_URL}auth/users`, {
    method: "GET",
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!usersResponse.ok) {
    return;
  }

  const usersData = await usersResponse.json();
  if (!Array.isArray(usersData)) return;

  const createdUser = usersData.find((rawUser) => {
    const email = String(rawUser?.email ?? rawUser?.correo_electronico ?? "").trim().toLowerCase();
    return email === targetEmail;
  });

  const userId = String(createdUser?._id ?? createdUser?.id ?? "").trim();
  if (!userId) return;

  const patchResult = await tryPatchAuthUser(token, userId, {
    ...payload,
    password: undefined,
    sedes_permitidas: sedesPermitidas,
    comision_productos: payload.comision_productos ?? comisionProductos ?? null,
  });

  return patchResult?.warning;
};

export const systemUsersService = {
  async getSystemUsers(token: string): Promise<SystemUser[]> {
    const authResponse = await fetch(`${API_BASE_URL}auth/users`, {
      method: "GET",
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (authResponse.ok) {
      const data = await authResponse.json();
      if (!Array.isArray(data)) return [];
      return data.map(mapToSystemUser).filter(isSystemUser);
    }

    if (!isFallbackCandidate(authResponse)) {
      throw new Error(await parseErrorMessage(authResponse));
    }

    const legacyResponse = await fetch(`${API_BASE_URL}superadmin/system-users/`, {
      method: "GET",
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!legacyResponse.ok) {
      throw new Error(await parseErrorMessage(legacyResponse));
    }

    const legacyData = await legacyResponse.json();
    if (!Array.isArray(legacyData)) return [];
    return legacyData.map(mapToSystemUser).filter(isSystemUser);
  },

  async createSystemUser(
    token: string,
    payload: CreateSystemUserPayload
  ): Promise<{ success: boolean; user: SystemUser; warning?: string }> {
    const authCreateResult = await tryCreateWithAuthRegister(token, payload);
    if (authCreateResult) {
      const warning = await syncSedesPermitidasAfterCreate(token, payload);
      return warning ? { ...authCreateResult, warning } : authCreateResult;
    }

    const requestData = toSystemUserCreateRequest(payload);
    const response = await fetch(`${API_BASE_URL}superadmin/system-users/`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorMessage = await parseErrorMessage(response);
      if (
        normalizeSedesPermitidas(payload).length > 0 &&
        matchesSedesPermitidasContractError(response.status, errorMessage)
      ) {
        throw new Error(SEDES_PERMITIDAS_UNSUPPORTED_MESSAGE);
      }
      throw new Error(errorMessage);
    }

    return await response.json();
  },

  async updateSystemUser(
    token: string,
    userId: string,
    payload: CreateSystemUserPayload
  ): Promise<{ success: boolean; user?: SystemUser; warning?: string }> {
    const authPatchResult = await tryPatchAuthUser(token, userId, payload);
    if (authPatchResult) return authPatchResult;

    const requestData = toSystemUserCreateRequest(payload);
    const response = await fetch(`${API_BASE_URL}superadmin/system-users/${userId}`, {
      method: "PATCH",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      throw new Error(await parseErrorMessage(response));
    }

    return await response.json();
  },

  async deleteSystemUser(token: string, userId: string): Promise<{ success: boolean; softDeleted?: boolean }> {
    const endpoint = `${API_BASE_URL}superadmin/system-users/${userId}`;

    const response = await fetch(endpoint, {
      method: "DELETE",
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.ok) {
      return await response.json();
    }

    if (!isFallbackCandidate(response)) {
      throw new Error(await parseErrorMessage(response));
    }

    const legacyDeleteResponse = await fetch(`${API_BASE_URL}auth/users/${userId}`, {
      method: "DELETE",
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (legacyDeleteResponse.ok) {
      return await legacyDeleteResponse.json();
    }

    if (!isFallbackCandidate(legacyDeleteResponse)) {
      throw new Error(await parseErrorMessage(legacyDeleteResponse));
    }

    const softDeleteResponse = await fetch(`${API_BASE_URL}auth/users/${userId}`, {
      method: "PATCH",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ activo: false }),
    });

    if (!softDeleteResponse.ok) {
      throw new Error(await parseErrorMessage(softDeleteResponse));
    }

    return { success: true, softDeleted: true };
  },
};
