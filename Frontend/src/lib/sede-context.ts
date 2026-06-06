const STORAGE_KEYS = {
  ACTIVE_SEDE_ID: "beaux-active-sede_id",
  LEGACY_ACTIVE_SEDE_ID: "beaux-selected-sede_id",
  PRIMARY_SEDE_ID: "beaux-sede_id_principal",
  CURRENT_SEDE_ID: "beaux-sede_id",
  SEDES_PERMITIDAS: "beaux-sedes_permitidas",
} as const;

const normalizeSedeId = (value: string | null | undefined): string | null => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
};

const uniqueSedeIds = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    const normalized = normalizeSedeId(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });

  return result;
};

const readStorage = (key: string): string | null => {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(key) ?? localStorage.getItem(key);
};

const removeFromStorages = (key: string) => {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(key);
  localStorage.removeItem(key);
};

export const parseSedesPermitidas = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return uniqueSedeIds(value.map((item) => (typeof item === "string" ? item : null)));
  }

  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return uniqueSedeIds(parsed.map((item) => (typeof item === "string" ? item : null)));
      }
    } catch {
      return [];
    }
  }

  return [];
};

export const getSedesPermitidasFromStorage = (): string[] => {
  const raw = readStorage(STORAGE_KEYS.SEDES_PERMITIDAS);
  return parseSedesPermitidas(raw);
};

export const getPrimarySedeIdFromStorage = (): string | null => {
  return (
    normalizeSedeId(readStorage(STORAGE_KEYS.PRIMARY_SEDE_ID)) ??
    normalizeSedeId(readStorage(STORAGE_KEYS.CURRENT_SEDE_ID))
  );
};

export const getActiveSedeIdFromStorage = (): string | null => {
  return (
    normalizeSedeId(readStorage(STORAGE_KEYS.ACTIVE_SEDE_ID)) ??
    normalizeSedeId(readStorage(STORAGE_KEYS.LEGACY_ACTIVE_SEDE_ID)) ??
    normalizeSedeId(readStorage(STORAGE_KEYS.CURRENT_SEDE_ID)) ??
    getPrimarySedeIdFromStorage()
  );
};

export const isSedeAuthorizedForUser = ({
  sedeId,
  role,
  primarySedeId,
  sedesPermitidas,
}: {
  sedeId: string | null | undefined;
  role?: string | null;
  primarySedeId?: string | null;
  sedesPermitidas?: string[] | null;
}): boolean => {
  const normalizedSedeId = normalizeSedeId(sedeId);
  if (!normalizedSedeId) return false;

  const normalizedRole = String(role ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (normalizedRole === "super_admin" || normalizedRole === "superadmin") {
    return true;
  }

  const allowed = new Set(
    uniqueSedeIds([primarySedeId, ...(sedesPermitidas || [])]).map((id) => id.toUpperCase())
  );

  return allowed.has(normalizedSedeId.toUpperCase());
};

export const resolveActiveSedeId = ({
  role,
  preferredSedeId,
  primarySedeId,
  sedesPermitidas,
}: {
  role?: string | null;
  preferredSedeId?: string | null;
  primarySedeId?: string | null;
  sedesPermitidas?: string[] | null;
}): string | null => {
  const preferred = normalizeSedeId(preferredSedeId);
  if (
    preferred &&
    isSedeAuthorizedForUser({
      sedeId: preferred,
      role,
      primarySedeId,
      sedesPermitidas,
    })
  ) {
    return preferred;
  }

  const storedActive = getActiveSedeIdFromStorage();
  if (
    storedActive &&
    isSedeAuthorizedForUser({
      sedeId: storedActive,
      role,
      primarySedeId,
      sedesPermitidas,
    })
  ) {
    return storedActive;
  }

  const normalizedPrimary = normalizeSedeId(primarySedeId);
  if (normalizedPrimary) return normalizedPrimary;

  const [firstAllowed] = uniqueSedeIds(sedesPermitidas || []);
  return firstAllowed || null;
};

export const persistSedeContext = ({
  activeSedeId,
  primarySedeId,
  sedesPermitidas,
}: {
  activeSedeId?: string | null;
  primarySedeId?: string | null;
  sedesPermitidas?: string[] | null;
}) => {
  if (typeof window === "undefined") return;

  const normalizedActive = normalizeSedeId(activeSedeId);
  const normalizedPrimary = normalizeSedeId(primarySedeId);
  const normalizedPermitidas = uniqueSedeIds(sedesPermitidas || []);

  if (normalizedPrimary) {
    sessionStorage.setItem(STORAGE_KEYS.PRIMARY_SEDE_ID, normalizedPrimary);
  } else {
    removeFromStorages(STORAGE_KEYS.PRIMARY_SEDE_ID);
  }

  if (normalizedPermitidas.length > 0) {
    sessionStorage.setItem(STORAGE_KEYS.SEDES_PERMITIDAS, JSON.stringify(normalizedPermitidas));
  } else {
    removeFromStorages(STORAGE_KEYS.SEDES_PERMITIDAS);
  }

  if (normalizedActive) {
    sessionStorage.setItem(STORAGE_KEYS.ACTIVE_SEDE_ID, normalizedActive);
    sessionStorage.setItem(STORAGE_KEYS.LEGACY_ACTIVE_SEDE_ID, normalizedActive);
    sessionStorage.setItem(STORAGE_KEYS.CURRENT_SEDE_ID, normalizedActive);
    return;
  }

  removeFromStorages(STORAGE_KEYS.ACTIVE_SEDE_ID);
  removeFromStorages(STORAGE_KEYS.LEGACY_ACTIVE_SEDE_ID);

  if (normalizedPrimary) {
    sessionStorage.setItem(STORAGE_KEYS.CURRENT_SEDE_ID, normalizedPrimary);
  } else {
    removeFromStorages(STORAGE_KEYS.CURRENT_SEDE_ID);
  }
};

export const clearSedeContext = () => {
  Object.values(STORAGE_KEYS).forEach(removeFromStorages);
};

