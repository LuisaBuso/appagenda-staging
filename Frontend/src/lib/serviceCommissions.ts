export type ServiceCommissionType = "%" | "$";

export interface ServiceCommissionEntry {
  servicio_id: string;
  valor: number;
  tipo: ServiceCommissionType;
}

export type ServiceCommissionScope = "direct" | "by_sede";
export type ServiceCommissionCollectionType = "array" | "object";

export interface ServiceCommissionCatalogItem {
  id: string;
  categoria?: string | null;
}

export interface ServiceCommissionBinding {
  key: string;
  scope: ServiceCommissionScope;
  collectionType: ServiceCommissionCollectionType;
}

export interface ResolvedServiceCommissions {
  binding: ServiceCommissionBinding | null;
  entries: ServiceCommissionEntry[];
}

export const SERVICE_COMMISSION_DIRECT_KEYS = [
  "comisiones_por_servicio",
  "comisiones_servicios",
  "comision_por_servicio",
  "service_commissions",
] as const;

export const SERVICE_COMMISSION_BY_SEDE_KEYS = [
  "comisiones_por_sede",
  "comisiones_servicios_por_sede",
  "service_commissions_by_sede",
] as const;

export const SERVICE_COMMISSION_CATEGORY_KEY = "comisiones_por_categoria";

const ITEM_ID_KEYS = [
  "servicio_id",
  "servicioId",
  "service_id",
  "serviceId",
  "id",
  "servicio",
] as const;

const ITEM_VALUE_KEYS = [
  "valor",
  "value",
  "comision",
  "amount",
  "monto",
  "porcentaje",
  "percentage",
] as const;

const ITEM_TYPE_KEYS = [
  "tipo",
  "tipo_comision",
  "tipoComision",
  "type",
  "unidad",
  "unit",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function sanitizeNumber(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) {
    return 0;
  }
  return Math.max(0, numeric);
}

function normalizeType(value: unknown): ServiceCommissionType {
  if (typeof value !== "string") {
    return "%";
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized.includes("$") ||
    normalized.includes("monto") ||
    normalized.includes("fixed") ||
    normalized.includes("fijo")
  ) {
    return "$";
  }

  return "%";
}

function readCollectionType(value: unknown): ServiceCommissionCollectionType {
  if (Array.isArray(value)) {
    return "array";
  }
  if (isRecord(value)) {
    return "object";
  }
  return "array";
}

function findValueByKeys(
  source: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    if (hasOwn(source, key)) {
      return source[key];
    }
  }
  return undefined;
}

function parseEntry(
  item: unknown,
  fallbackServiceId?: string,
): ServiceCommissionEntry | null {
  if (typeof item === "number" || typeof item === "string") {
    if (!fallbackServiceId) {
      return null;
    }
    return {
      servicio_id: fallbackServiceId,
      valor: sanitizeNumber(item),
      tipo: "%",
    };
  }

  if (!isRecord(item)) {
    return null;
  }

  const serviceIdRaw = findValueByKeys(item, ITEM_ID_KEYS) ?? fallbackServiceId;
  if (typeof serviceIdRaw !== "string" || serviceIdRaw.trim() === "") {
    return null;
  }

  const valueRaw = findValueByKeys(item, ITEM_VALUE_KEYS);
  const typeRaw = findValueByKeys(item, ITEM_TYPE_KEYS);

  return {
    servicio_id: serviceIdRaw,
    valor: sanitizeNumber(valueRaw),
    tipo: normalizeType(typeRaw),
  };
}

function normalizeCollection(collection: unknown): ServiceCommissionEntry[] {
  const mapped = new Map<string, ServiceCommissionEntry>();

  if (Array.isArray(collection)) {
    for (const item of collection) {
      const parsed = parseEntry(item);
      if (!parsed) {
        continue;
      }
      mapped.set(parsed.servicio_id, parsed);
    }

    return Array.from(mapped.values());
  }

  if (!isRecord(collection)) {
    return [];
  }

  for (const [serviceId, item] of Object.entries(collection)) {
    const parsed = parseEntry(item, serviceId);
    if (!parsed) {
      continue;
    }
    mapped.set(parsed.servicio_id, parsed);
  }

  return Array.from(mapped.values());
}

function detectBinding(
  source: Record<string, unknown>,
  sedeId?: string,
): ServiceCommissionBinding | null {
  for (const key of SERVICE_COMMISSION_BY_SEDE_KEYS) {
    if (!hasOwn(source, key)) {
      continue;
    }

    const scoped = isRecord(source[key]) ? (source[key] as Record<string, unknown>) : null;
    const sedeValue = sedeId && scoped ? scoped[sedeId] : undefined;
    const sampleValue =
      sedeValue ??
      (scoped
        ? Object.values(scoped).find(
            (value) => Array.isArray(value) || isRecord(value),
          )
        : undefined);

    return {
      key,
      scope: "by_sede",
      collectionType: readCollectionType(sampleValue),
    };
  }

  for (const key of SERVICE_COMMISSION_DIRECT_KEYS) {
    if (!hasOwn(source, key)) {
      continue;
    }

    return {
      key,
      scope: "direct",
      collectionType: readCollectionType(source[key]),
    };
  }

  return null;
}

function serializeEntryWithTemplate(
  entry: ServiceCommissionEntry,
  template: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!template) {
    return {
      servicio_id: entry.servicio_id,
      valor: entry.valor,
      tipo: entry.tipo,
    };
  }

  const next: Record<string, unknown> = { ...template };
  const idKey = ITEM_ID_KEYS.find((key) => hasOwn(template, key)) ?? "servicio_id";
  const typeKey = ITEM_TYPE_KEYS.find((key) => hasOwn(template, key));
  const genericValueKey = ["valor", "value", "comision", "amount"].find((key) =>
    hasOwn(template, key),
  );
  const hasPorcentaje = hasOwn(template, "porcentaje");
  const hasMonto = hasOwn(template, "monto");

  next[idKey] = entry.servicio_id;

  if (typeKey) {
    next[typeKey] = entry.tipo;
  }

  if (hasPorcentaje && hasMonto) {
    next.porcentaje = entry.tipo === "%" ? entry.valor : 0;
    next.monto = entry.tipo === "$" ? entry.valor : 0;
    return next;
  }

  if (hasPorcentaje && !genericValueKey) {
    next.porcentaje = entry.valor;
    return next;
  }

  if (hasMonto && !genericValueKey) {
    next.monto = entry.valor;
    return next;
  }

  if (!genericValueKey) {
    return {
      servicio_id: entry.servicio_id,
      valor: entry.valor,
      tipo: entry.tipo,
    };
  }

  next[genericValueKey] = entry.valor;
  return next;
}

function serializeAsArray(
  referenceCollection: unknown,
  entries: ServiceCommissionEntry[],
): unknown[] {
  const template = Array.isArray(referenceCollection)
    ? referenceCollection.find(isRecord) ?? null
    : null;

  return entries.map((entry) => serializeEntryWithTemplate(entry, template));
}

function serializeAsObject(
  referenceCollection: unknown,
  entries: ServiceCommissionEntry[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const referenceRecord = isRecord(referenceCollection) ? referenceCollection : null;
  const values = referenceRecord ? Object.values(referenceRecord) : [];
  const numericShape =
    values.length > 0 &&
    values.every((value) => typeof value === "number" || typeof value === "string");
  const template = values.find(isRecord) ?? null;

  for (const entry of entries) {
    if (numericShape) {
      result[entry.servicio_id] = entry.valor;
      continue;
    }
    result[entry.servicio_id] = serializeEntryWithTemplate(entry, template);
  }

  return result;
}

function normalizeCategory(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveServiceCommissions(
  source: unknown,
  sedeId?: string,
): ResolvedServiceCommissions {
  if (!isRecord(source)) {
    return { binding: null, entries: [] };
  }

  const binding = detectBinding(source, sedeId);
  if (!binding) {
    return { binding: null, entries: [] };
  }

  const collection =
    binding.scope === "direct"
      ? source[binding.key]
      : isRecord(source[binding.key]) && sedeId
        ? (source[binding.key] as Record<string, unknown>)[sedeId]
        : undefined;

  const entries = normalizeCollection(collection).sort((a, b) =>
    a.servicio_id.localeCompare(b.servicio_id),
  );

  return { binding, entries };
}

export function buildServiceCommissionPatch(
  source: unknown,
  binding: ServiceCommissionBinding | null,
  sedeId: string | undefined,
  entries: ServiceCommissionEntry[],
): Record<string, unknown> {
  if (!binding || !isRecord(source)) {
    return {};
  }

  const normalizedEntries = normalizeCollection(
    entries.map((entry) => ({
      servicio_id: entry.servicio_id,
      valor: sanitizeNumber(entry.valor),
      tipo: normalizeType(entry.tipo),
    })),
  );

  const baseCollection =
    binding.scope === "direct"
      ? source[binding.key]
      : isRecord(source[binding.key]) && sedeId
        ? (source[binding.key] as Record<string, unknown>)[sedeId]
        : undefined;

  const serializedCollection =
    binding.collectionType === "object"
      ? serializeAsObject(baseCollection, normalizedEntries)
      : serializeAsArray(baseCollection, normalizedEntries);

  if (binding.scope === "direct") {
    return { [binding.key]: serializedCollection };
  }

  if (!sedeId) {
    return {};
  }

  const bindingValue = source[binding.key];
  const bySede: Record<string, unknown> = isRecord(bindingValue)
    ? bindingValue
    : {};

  return {
    [binding.key]: {
      ...bySede,
      [sedeId]: serializedCollection,
    },
  };
}

export function extractKnownServiceCommissionFields(
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of SERVICE_COMMISSION_DIRECT_KEYS) {
    if (hasOwn(source, key)) {
      result[key] = source[key];
    }
  }

  for (const key of SERVICE_COMMISSION_BY_SEDE_KEYS) {
    if (hasOwn(source, key)) {
      result[key] = source[key];
    }
  }

  return result;
}

export function resolveCategoryCommissionEntries(
  source: unknown,
  services: ServiceCommissionCatalogItem[],
  serviceIds: string[],
): ServiceCommissionEntry[] {
  if (!isRecord(source) || !hasOwn(source, SERVICE_COMMISSION_CATEGORY_KEY)) {
    return [];
  }

  const categoryMap = isRecord(source[SERVICE_COMMISSION_CATEGORY_KEY])
    ? (source[SERVICE_COMMISSION_CATEGORY_KEY] as Record<string, unknown>)
    : null;

  if (!categoryMap) {
    return [];
  }

  const servicesById = new Map(
    services.map((service) => [service.id, normalizeCategory(service.categoria)]),
  );

  return serviceIds
    .filter(Boolean)
    .map((serviceId) => {
      const category = servicesById.get(serviceId) ?? "";
      const value = category && hasOwn(categoryMap, category) ? categoryMap[category] : 0;

      return {
        servicio_id: serviceId,
        valor: sanitizeNumber(value),
        tipo: "%",
      } satisfies ServiceCommissionEntry;
    })
    .sort((a, b) => a.servicio_id.localeCompare(b.servicio_id));
}

export function buildCategoryCommissionPayload(
  services: ServiceCommissionCatalogItem[],
  serviceIds: string[],
  entries: ServiceCommissionEntry[],
): Record<string, number> {
  const servicesById = new Map(
    services.map((service) => [service.id, normalizeCategory(service.categoria)]),
  );
  const entriesByServiceId = new Map(entries.map((entry) => [entry.servicio_id, entry]));
  const payload = new Map<string, number>();

  for (const serviceId of serviceIds.filter(Boolean)) {
    const category = servicesById.get(serviceId) ?? "";
    if (!category) {
      throw new Error(`El servicio ${serviceId} no tiene categoría y no puede guardar comisión.`);
    }

    const entry = entriesByServiceId.get(serviceId);
    const type = entry?.tipo ?? "%";
    if (type !== "%") {
      throw new Error(
        `La categoría "${category}" solo admite comisión en porcentaje con el endpoint actual.`,
      );
    }

    const rawValue = entry?.valor ?? 0;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || Number.isNaN(value) || value < 0 || value > 100) {
      throw new Error(`La comisión de "${category}" debe estar entre 0 y 100.`);
    }

    if (payload.has(category) && payload.get(category) !== value) {
      throw new Error(
        `Todos los servicios de la categoría "${category}" deben compartir el mismo porcentaje.`,
      );
    }

    payload.set(category, value);
  }

  return Object.fromEntries(payload);
}
