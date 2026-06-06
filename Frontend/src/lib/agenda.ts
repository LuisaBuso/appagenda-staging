const NOTE_KEYS = [
  "notas_adicionales",
  "notas",
  "nota_adicional",
  "nota",
  "observaciones",
  "comentarios",
  "notes",
  "additional_notes",
  "additionalNotes",
];

export const normalizeAgendaTimeValue = (value?: string | null): string => {
  if (!value) return "";

  const input = String(value).trim();
  const match = input.match(/(\d{1,2}):(\d{2})/);
  if (!match) return "";

  const rawHours = Number(match[1]);
  const rawMinutes = Number(match[2]);
  if (!Number.isFinite(rawHours) || !Number.isFinite(rawMinutes)) return "";

  const hours = Math.min(23, Math.max(0, rawHours));
  const minutes = Math.min(59, Math.max(0, rawMinutes));
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

export const formatAgendaTime = (
  value?: string | null,
  locale: string = "es-CO"
): string => {
  const normalized = normalizeAgendaTimeValue(value);
  if (!normalized) return "—";

  const [hours, minutes] = normalized.split(":").map(Number);
  const referenceDate = new Date(2000, 0, 1, hours, minutes, 0, 0);

  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(referenceDate);
};

const pickNoteFromSource = (source: unknown): string => {
  if (!source || typeof source !== "object") return "";
  const record = source as Record<string, unknown>;

  for (const key of NOTE_KEYS) {
    const value = record[key];
    if (typeof value === "string") {
      const normalized = value.trim();
      if (normalized) return normalized;
    }
  }

  return "";
};

export const extractAgendaAdditionalNotes = (appointmentLike: unknown): string => {
  if (!appointmentLike || typeof appointmentLike !== "object") return "";
  const entity = appointmentLike as Record<string, unknown>;

  return (
    pickNoteFromSource(entity.rawData) ||
    pickNoteFromSource(entity) ||
    ""
  );
};
