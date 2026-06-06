// src/lib/sede.ts
const SEDE_ID_PATTERN = /\s*(?:-|\||ID:)?\s*[\(\[]?SD-[A-Za-z0-9]+[\)\]]?\s*$/i;

export function formatSedeNombre(value?: string | null, fallback: string = ""): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;

  const cleaned = trimmed
    .replace(SEDE_ID_PATTERN, "")
    .replace(/\s*[-|]+$/g, "")
    .trim();

  return cleaned || fallback;
}
