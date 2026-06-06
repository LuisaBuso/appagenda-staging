import type { Cliente } from "../types/cliente"
import { formatDateDMY } from "./dateFormat"

export type MatchType =
  | "exact"
  | "startsWith"
  | "wordStart"
  | "partial"
  | "phone"
  | "id"
  | "fuzzy"

export interface RankedClient {
  cliente: Cliente
  score: number
  matchType: MatchType
  matchedField: string
}

export const normalizeSearchText = (value?: string): string =>
  (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()

export const normalizePhone = (value?: string): string => {
  if (!value) return ""
  const digits = String(value).replace(/\D+/g, "")
  if (!digits) return ""
  // Si viene con indicativo, nos quedamos con los últimos 10 dígitos
  if (digits.length > 10) {
    return digits.slice(-10)
  }
  return digits
}

const startsWithWord = (text: string, query: string): boolean => {
  if (!text || !query) return false
  return text.split(" ").some((word) => word.startsWith(query))
}

// Distancia de Levenshtein con corte temprano
const levenshteinDistance = (a: string, b: string, maxDistance: number = 3): number => {
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > maxDistance) return maxDistance + 1

  const prev: number[] = Array.from({ length: lb + 1 }, (_, i) => i)
  let curr: number[] = []

  for (let i = 1; i <= la; i++) {
    curr = [i]
    let rowMin = curr[0]
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const insertion = curr[j - 1] + 1
      const deletion = prev[j] + 1
      const substitution = prev[j - 1] + cost
      const val = Math.min(insertion, deletion, substitution)
      curr[j] = val
      rowMin = Math.min(rowMin, val)
    }
    if (rowMin > maxDistance) return maxDistance + 1
    prev.splice(0, prev.length, ...curr)
  }

  return prev[lb]
}

const updateBest = (
  current: { score: number; matchType: MatchType; matchedField: string },
  candidateScore: number,
  matchType: MatchType,
  matchedField: string
) => {
  if (candidateScore > current.score) {
    current.score = candidateScore
    current.matchType = matchType
    current.matchedField = matchedField
  }
}

const evaluateTextField = (
  fieldValue: string,
  query: string,
  label: string,
  best: { score: number; matchType: MatchType; matchedField: string }
) => {
  const normalized = normalizeSearchText(fieldValue)
  if (!normalized || !query) return

  if (normalized === query) {
    updateBest(best, 100, "exact", label)
    return
  }

  if (normalized.startsWith(query)) {
    updateBest(best, 90, "startsWith", label)
  }

  if (startsWithWord(normalized, query)) {
    updateBest(best, 85, "wordStart", label)
  }

  if (normalized.includes(query)) {
    updateBest(best, 70, "partial", label)
  }

  const maxDistance = query.length <= 3 ? 1 : 2
  const distance = levenshteinDistance(normalized, query, maxDistance)
  if (distance <= maxDistance) {
    const closeness = Math.max(0, query.length - distance)
    // Score base 60, sube ligeramente si la palabra es larga y la distancia pequeña
    const fuzzyScore = Math.min(78, 60 + closeness * 2 - distance * 3)
    updateBest(best, fuzzyScore, "fuzzy", label)
  }
}

const evaluateNumericField = (
  normalizedNumericValue: string,
  normalizedQueryDigits: string,
  label: string,
  best: { score: number; matchType: MatchType; matchedField: string }
) => {
  if (!normalizedNumericValue || !normalizedQueryDigits) return

  if (
    normalizedNumericValue === normalizedQueryDigits ||
    normalizedNumericValue.endsWith(normalizedQueryDigits)
  ) {
    updateBest(best, 100, "phone", label)
    return
  }

  if (normalizedNumericValue.startsWith(normalizedQueryDigits)) {
    updateBest(best, 90, "phone", label)
  } else if (normalizedNumericValue.includes(normalizedQueryDigits)) {
    updateBest(best, 80, "phone", label)
  }
}

export const scoreClientMatch = (cliente: Cliente, rawQuery: string): RankedClient | null => {
  const query = normalizeSearchText(rawQuery)
  const queryDigits = normalizePhone(rawQuery)

  if (!query && !queryDigits) return null

  const best = { score: 0, matchType: "partial" as MatchType, matchedField: "" }

  evaluateTextField(cliente.nombre || "", query, "nombre", best)
  evaluateTextField((cliente as any).apellido || "", query, "apellido", best)
  evaluateTextField(cliente.email || "", query, "email", best)
  evaluateTextField(cliente.cedula || "", query, "cedula", best)
  evaluateTextField(cliente.cliente_id || cliente.id || "", query, "id", best)
  evaluateTextField(cliente.telefono || "", query, "telefono", best)

  const normalizedPhone = normalizePhone(cliente.telefono)
  evaluateNumericField(normalizedPhone, queryDigits, "telefono", best)
  const normalizedCedula = normalizePhone(cliente.cedula)
  evaluateNumericField(normalizedCedula, queryDigits, "cedula", best)

  if (best.score === 0) return null

  return {
    cliente,
    score: best.score,
    matchType: best.matchType,
    matchedField: best.matchedField || "nombre",
  }
}

export const dedupeClientes = (clientes: Cliente[]): Cliente[] => {
  const map = new Map<string, Cliente>()
  for (const cliente of clientes) {
    const key =
      cliente.id ||
      cliente.cliente_id ||
      `${normalizeSearchText(cliente.nombre)}-${normalizePhone(cliente.telefono)}-${normalizeSearchText(cliente.email)}`
    if (!map.has(key)) {
      map.set(key, cliente)
    }
  }
  return Array.from(map.values())
}

export const rankClientsByRelevance = (
  clientes: Cliente[],
  rawQuery: string,
  limit: number = 10
): RankedClient[] => {
  const ranked = clientes
    .map((cliente) => scoreClientMatch(cliente, rawQuery))
    .filter((match): match is RankedClient => Boolean(match))

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.cliente.nombre.localeCompare(b.cliente.nombre, "es")
  })

  return ranked.slice(0, limit)
}

export const getLastVisitLabel = (cliente: Cliente): string => {
  const ultimaVisita =
    (cliente as any).ultima_visita ||
    (cliente as any).ultimaVisita ||
    (cliente as any).fecha_ultima_visita ||
    cliente.historialCitas?.[0]?.fecha

  if (ultimaVisita) {
    return formatDateDMY(ultimaVisita, "—")
  }

  if (Number.isFinite(cliente.diasSinVenir) && cliente.diasSinVenir > 0) {
    return `Hace ${Math.trunc(cliente.diasSinVenir)} días`
  }

  return "Sin visitas registradas"
}

export const toClienteFromPartial = (partial: any): Cliente => {
  const nombre = partial?.nombre || partial?.fullName || ""
  return {
    id: partial?.id || partial?.cliente_id || partial?._id || "",
    cliente_id: partial?.cliente_id || partial?.id || partial?._id,
    nombre,
    telefono: partial?.telefono || partial?.phone || partial?.celular || "",
    email: partial?.email || partial?.correo || "",
    cedula: partial?.cedula || partial?.documento || partial?.numeroDocumento || "",
    ciudad: partial?.ciudad || "",
    sede_id: partial?.sede_id || partial?.sedeId || "",
    diasSinVenir: partial?.diasSinVenir ?? 0,
    diasSinComprar: partial?.diasSinComprar ?? 0,
    ltv: partial?.ltv ?? 0,
    ticketPromedio: partial?.ticketPromedio ?? 0,
    rizotipo: partial?.rizotipo || "",
    nota: partial?.nota || "",
    fecha_creacion: partial?.fecha_creacion,
    fecha_registro: partial?.fecha_registro,
    ultima_visita: partial?.ultima_visita || partial?.ultimaVisita,
    historialCitas: Array.isArray(partial?.historialCitas) ? partial.historialCitas : [],
    historialCabello: Array.isArray(partial?.historialCabello) ? partial.historialCabello : [],
    historialProductos: Array.isArray(partial?.historialProductos) ? partial.historialProductos : [],
    fichas: Array.isArray(partial?.fichas) ? partial.fichas : [],
  }
}
