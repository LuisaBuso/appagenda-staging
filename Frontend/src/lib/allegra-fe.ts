const stripDiacritics = (value: string): string =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const normalizeKey = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const normalized = stripDiacritics(String(value))
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized : null;
};

const parseAllowlist = (raw?: string): string[] => {
  return String(raw ?? "")
    .split(",")
    .map((item) => normalizeKey(item))
    .filter((item): item is string => Boolean(item));
};

const DEFAULT_NAME_HINTS = [
  "EL POBLADO",
  "POBLADO",
  "RF POBLADO",
  "RIZOS FELICES - EL POBLADO",
  "RIZOS FELICES EL POBLADO",
] as const;

export type AllegraGateInput = {
  sedeId?: string | null;
  sedeNombre?: string | null;
  allowlistOverride?: string[];
};

export type AllegraGateResult = {
  allowed: boolean;
  matchedBy: "id" | "name" | null;
  reason?: string;
};

export const resolveAllegraGate = ({
  sedeId,
  sedeNombre,
  allowlistOverride,
}: AllegraGateInput): AllegraGateResult => {
  const normalizedId = normalizeKey(sedeId);
  const normalizedName = normalizeKey(sedeNombre);

  const envAllowlist = parseAllowlist(
    // Soportar variable previa si existe
    (import.meta as any)?.env?.VITE_ALLEGRA_SEDE_IDS ??
      (import.meta as any)?.env?.VITE_EL_POBLADO_SEDE_IDS
  );
  const allowlist = allowlistOverride?.map(normalizeKey).filter(Boolean) as string[] | undefined;
  const finalAllowlist = allowlist?.length ? allowlist : envAllowlist;

  if (normalizedId && finalAllowlist.includes(normalizedId)) {
    return { allowed: true, matchedBy: "id" };
  }

  const hintMatch =
    normalizedName &&
    DEFAULT_NAME_HINTS.some((hint) => normalizedName.includes(normalizeKey(hint) as string));

  if (hintMatch) {
    return { allowed: true, matchedBy: "name" };
  }

  return {
    allowed: false,
    matchedBy: null,
    reason: "Solo disponible en la sede El Poblado",
  };
};

export const formatAllegraGateLabel = (result: AllegraGateResult): string => {
  if (result.allowed) return "Disponible para FE Allegra";
  return result.reason || "FE Allegra no disponible para esta sede";
};
