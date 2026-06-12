"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Sidebar } from "../../../components/Layout/Sidebar"
import { ClientsList, type FilterType } from "./clients-list"
import { ClientDetail } from "./client-detail"
import { ClientFormModal } from "./ClientFormModal"
import type { Cliente } from "../../../types/cliente"
import { clientesService, type ClientesPaginadosMetadata } from "./clientesService"
import { useAuth } from "../../../components/Auth/AuthContext"
import { Loader } from "lucide-react"
import { rankClientsByRelevance } from "../../../lib/client-search"

const SEARCH_DEBOUNCE_MS = 300

const normalizarFichas = (raw: any): any[] | undefined => {
  if (Array.isArray(raw)) return raw
  if (Array.isArray(raw?.data)) return raw.data
  if (Array.isArray(raw?.fichas)) return raw.fichas
  if (Array.isArray(raw?.items)) return raw.items
  return undefined
}

const firstNonEmptyString = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === "string" || typeof value === "number") {
      const normalized = String(value).trim()
      if (normalized) return normalized
    }
  }
  return ""
}

const extractCedula = (clienteData: any): string =>
  firstNonEmptyString(
    clienteData?.cedula, clienteData?.numero_cedula, clienteData?.numeroDocumento,
    clienteData?.numero_documento, clienteData?.documento, clienteData?.identificacion, clienteData?.dni
  )

const asegurarClienteCompleto = (clienteData: any): Cliente => {
  const fichasNormalizadas = normalizarFichas(clienteData?.fichas) ?? normalizarFichas(clienteData?.data?.fichas)
  return {
    ...clienteData,
    id: clienteData.id || clienteData._id || clienteData.cliente_id || "",
    nombre: clienteData.nombre || "",
    email: clienteData.email || clienteData.correo || "No disponible",
    telefono: clienteData.telefono || "No disponible",
    cedula: extractCedula(clienteData),
    ciudad: clienteData.ciudad || "",
    sede_id: clienteData.sede_id || "",
    diasSinVenir: clienteData.diasSinVenir ?? clienteData.dias_sin_visitar ?? 0,
    diasSinComprar: clienteData.diasSinComprar ?? 0,
    ltv: clienteData.ltv ?? clienteData.total_gastado ?? 0,
    ticketPromedio: clienteData.ticketPromedio ?? clienteData.ticket_promedio ?? 0,
    rizotipo: clienteData.rizotipo || "",
    nota: clienteData.nota || clienteData.notas || "",
    historialCitas: Array.isArray(clienteData.historialCitas) ? clienteData.historialCitas : [],
    historialCabello: Array.isArray(clienteData.historialCabello) ? clienteData.historialCabello : [],
    historialProductos: Array.isArray(clienteData.historialProductos) ? clienteData.historialProductos : [],
    fichas: fichasNormalizadas
  }
}

export default function ClientsPage() {
  const [selectedClient, setSelectedClient] = useState<Cliente | null>(null)
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [metadata, setMetadata] = useState<ClientesPaginadosMetadata | null>(null)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isFetching, setIsFetching] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [activeFilter, setActiveFilter] = useState<FilterType>('Todos')
  const [itemsPorPagina] = useState(10)
  const hasLoadedInitialRef = useRef(false)
  const latestRequestIdRef = useRef(0)
  const latestCedulaHydrationRef = useRef(0)
  const cedulaCacheRef = useRef<Map<string, string | null>>(new Map())
  const hydratedIdsRef = useRef<Set<string>>(new Set())

  const { user, isLoading: authLoading, activeSedeId } = useAuth()
  const getAccessToken = useCallback((): string => {
    if (user?.access_token) return user.access_token
    return sessionStorage.getItem("access_token") || localStorage.getItem("access_token") || ""
  }, [user?.access_token])

  const currentSedeId = String(
    activeSedeId || user?.sede_id || sessionStorage.getItem("beaux-sede_id") || localStorage.getItem("beaux-sede_id") || ""
  ).trim()

  const applyCedulaCache = useCallback((listado: Cliente[]): Cliente[] => {
    return listado.map((cliente) => {
      const cachedCedula = cedulaCacheRef.current.get(cliente.id)
      if (!cachedCedula || cliente.cedula?.trim()) return cliente
      return { ...cliente, cedula: cachedCedula }
    })
  }, [])

  const loadClientes = useCallback(async (
    pagina: number = 1, filtro: string = "", options: { initial?: boolean } = {}
  ) => {
    const isInitialRequest = options.initial ?? false
    const token = getAccessToken()
    if (!token) {
      setError("No hay token de autenticación disponible")
      setIsInitialLoading(false)
      setIsFetching(false)
      return
    }

    const extraParams: { segmento?: string; sede_interacciones?: string } = {}
    if (currentSedeId && activeFilter !== 'Todos') {
      extraParams.sede_interacciones = currentSedeId
    }
    const SEGMENTO_MAP: Partial<Record<FilterType, string>> = {
      Nuevos: 'nuevos',
      Activos: 'activos',
      'En riesgo': 'en_riesgo',
      Perdidos: 'perdidos',
    }
    if (SEGMENTO_MAP[activeFilter]) {
      extraParams.segmento = SEGMENTO_MAP[activeFilter]
    }

    const requestId = ++latestRequestIdRef.current
    try {
      if (isInitialRequest) setIsInitialLoading(true)
      else setIsFetching(true)
      setError(null)

      const result = await clientesService.getClientesPaginados(token, { pagina, limite: itemsPorPagina, filtro, ...extraParams })
      if (requestId !== latestRequestIdRef.current) return

      const clientesNormalizados = result.clientes.map(asegurarClienteCompleto)
      const sorted = filtro.trim()
        ? rankClientsByRelevance(clientesNormalizados, filtro, clientesNormalizados.length).map(r => r.cliente)
        : clientesNormalizados
      setClientes(applyCedulaCache(sorted))
      setMetadata(result.metadata)
    } catch (err) {
      if (requestId !== latestRequestIdRef.current) return
      setError(err instanceof Error ? err.message : "Error al cargar los clientes")
    } finally {
      if (isInitialRequest) { setIsInitialLoading(false); return }
      if (requestId !== latestRequestIdRef.current) return
      setIsFetching(false)
    }
  }, [getAccessToken, itemsPorPagina, applyCedulaCache, activeFilter, currentSedeId])

  useEffect(() => {
    const token = getAccessToken()
    if (!token) {
      setError((prev) => prev || "No hay token de autenticación disponible")
      setIsInitialLoading(false)
      return
    }
    if (!hasLoadedInitialRef.current) {
      hasLoadedInitialRef.current = true
      loadClientes(1, searchTerm, { initial: true })
      return
    }
    const timeout = setTimeout(() => { loadClientes(1, searchTerm) }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [getAccessToken, searchTerm, itemsPorPagina, loadClientes])

  useEffect(() => {
    if (!authLoading && !user) setIsInitialLoading(false)
  }, [authLoading, user])

  useEffect(() => {
    const token = getAccessToken()
    if (!token || clientes.length === 0) return

    const idsParaEnriquecer = clientes
      .filter((cliente) => {
        if (hydratedIdsRef.current.has(cliente.id)) return false
        const sinUltimaVisita = !(cliente as any).ultima_visita
        const sinCedula = !cliente.cedula?.trim() && !cedulaCacheRef.current.has(cliente.id)
        return sinUltimaVisita || sinCedula
      })
      .map((cliente) => cliente.id)
    if (idsParaEnriquecer.length === 0) return

    let cancelled = false
    const hydrationRequestId = ++latestCedulaHydrationRef.current

    const hydrateCedulas = async () => {
      const updates = new Map<string, { cedula: string; ltv: number; diasSinVenir: number; ultima_visita: string }>()
      const results = await Promise.allSettled(
        idsParaEnriquecer.map(async (clienteId) => {
          const data = await clientesService.getClienteCedula(token, clienteId)
          return { clienteId, ...data }
        })
      )
      if (cancelled || hydrationRequestId !== latestCedulaHydrationRef.current) return
      for (const result of results) {
        if (result.status !== "fulfilled") continue
        const { clienteId, cedula, ltv, diasSinVenir, ultima_visita } = result.value
        cedulaCacheRef.current.set(clienteId, cedula || null)
        updates.set(clienteId, { cedula, ltv, diasSinVenir, ultima_visita })
      }
      for (const id of idsParaEnriquecer) hydratedIdsRef.current.add(id)
      if (updates.size === 0) return
      setClientes((prev) =>
        prev.map((cliente) => {
          const enriched = updates.get(cliente.id)
          if (!enriched) return cliente
          return {
            ...cliente,
            cedula: enriched.cedula || cliente.cedula,
            ltv: enriched.ltv || cliente.ltv,
            diasSinVenir: enriched.diasSinVenir || cliente.diasSinVenir,
            ultima_visita: enriched.ultima_visita || (cliente as any).ultima_visita,
          }
        })
      )
    }
    void hydrateCedulas()
    return () => { cancelled = true }
  }, [clientes, getAccessToken])

  const handlePageChange = useCallback((pagina: number, filtro: string = "") => {
    loadClientes(pagina, filtro)
  }, [loadClientes])

  const handleSearch = useCallback((value: string) => { setSearchTerm(value) }, [])

  const handleFilterChange = useCallback((f: FilterType) => {
    setActiveFilter(f)
  }, [])

  const handleSelectClient = useCallback(async (client: Cliente) => {
    const token = getAccessToken()
    if (!token) return
    try {
      const clienteCompleto = await clientesService.getClienteById(token, client.id)
      const clienteNormalizado = asegurarClienteCompleto(clienteCompleto)
      setSelectedClient(clienteNormalizado)
      setIsPanelOpen(true)
      setClientes(prev => prev.map(c =>
        c.id === client.id
          ? { ...c, ltv: clienteNormalizado.ltv || c.ltv, diasSinVenir: clienteNormalizado.diasSinVenir || c.diasSinVenir, ultima_visita: (clienteNormalizado as any).ultima_visita || (c as any).ultima_visita }
          : c
      ))
    } catch (err) {
      console.error("Error cargando detalles:", err)
      setSelectedClient(client)
      setIsPanelOpen(true)
    }
  }, [getAccessToken])

  const handleClosePanel = useCallback(() => {
    setIsPanelOpen(false)
    setTimeout(() => setSelectedClient(null), 220)
  }, [])

  const handleAddClient = useCallback(() => { setIsModalOpen(true) }, [])
  const handleCloseModal = useCallback(() => { setIsModalOpen(false) }, [])

  const handleSaveClient = useCallback(async () => {
    try {
      setIsSaving(true)
      setError(null)
      await loadClientes(1, searchTerm)
      setIsModalOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear el cliente")
    } finally {
      setIsSaving(false)
    }
  }, [loadClientes, searchTerm])

  const handleClientUpdated = useCallback(async () => {
    const token = getAccessToken()
    if (!token || !selectedClient) return
    try {
      const clienteActualizado = await clientesService.getClienteById(token, selectedClient.id)
      setSelectedClient(asegurarClienteCompleto(clienteActualizado))
      await loadClientes(metadata?.pagina ?? 1, searchTerm)
    } catch (err) {
      console.error("Error refrescando cliente actualizado:", err)
    }
  }, [getAccessToken, selectedClient, loadClientes, metadata?.pagina, searchTerm])

  if (authLoading) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center bg-white">
        <div className="flex items-center gap-3">
          <Loader className="h-5 w-5 animate-spin text-gray-600" />
          <span className="text-sm text-gray-600">Cargando...</span>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center bg-white">
        <div className="text-center">
          <div className="text-sm text-gray-600 mb-2">No autenticado</div>
          <div className="text-xs text-gray-500">Inicia sesión para acceder</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      <Sidebar />

      <ClientsList
        onSelectClient={handleSelectClient}
        onAddClient={handleAddClient}
        clientes={clientes}
        selectedId={selectedClient?.id}
        metadata={metadata || undefined}
        error={error}
        isFetching={isFetching}
        isInitialLoading={isInitialLoading}
        onPageChange={handlePageChange}
        onSearch={handleSearch}
        searchValue={searchTerm}
        sedeName={user?.nombre_local}
        activeFilter={activeFilter}
        onFilterChange={handleFilterChange}

      />

      {selectedClient && (
        <ClientDetail
          client={selectedClient}
          isOpen={isPanelOpen}
          onClose={handleClosePanel}
          onClientUpdated={handleClientUpdated}
        />
      )}

      <ClientFormModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSuccess={handleSaveClient}
        isSaving={isSaving}
        sedeId={currentSedeId}
      />
    </div>
  )
}