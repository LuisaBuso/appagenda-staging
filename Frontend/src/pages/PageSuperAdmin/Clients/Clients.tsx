"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Sidebar } from "../../../components/Layout/Sidebar"
import { ClientsList } from "./clients-list"
import { ClientDetail } from "./client-detail"
import { ClientFormModal } from "./ClientFormModal"
import type { Cliente } from "../../../types/cliente"
import type { Sede } from "../Sedes/sedeService"
import { clientesService, type ClientesPaginadosMetadata } from "./clientesService"
import { sedeService } from "../Sedes/sedeService"
import { useAuth } from "../../../components/Auth/AuthContext"
import { Loader } from "lucide-react"
import { rankClientsByRelevance } from "../../../lib/client-search"

const SEARCH_DEBOUNCE_MS = 300

export default function ClientsPage() {
  const [selectedClient, setSelectedClient] = useState<Cliente | null>(null)
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [metadata, setMetadata] = useState<ClientesPaginadosMetadata | null>(null)
  const [sedes, setSedes] = useState<Sede[]>([])
  const [selectedSede, setSelectedSede] = useState<string>("all")
  const [itemsPorPagina, setItemsPorPagina] = useState(10)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isFetching, setIsFetching] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const hasLoadedInitialRef = useRef(false)
  const latestRequestIdRef = useRef(0)
  const latestCedulaHydrationRef = useRef(0)
  const cedulaCacheRef = useRef<Map<string, string | null>>(new Map())

  const { user, isLoading: authLoading } = useAuth()
  const getAccessToken = useCallback((): string => {
    if (user?.access_token) return user.access_token
    return sessionStorage.getItem("access_token") || localStorage.getItem("access_token") || ""
  }, [user?.access_token])

  const loadSedes = useCallback(async () => {
    const token = getAccessToken()
    if (!token) return
    try {
      const sedesData = await sedeService.getSedes(token)
      setSedes(sedesData)
    } catch (err) {
      console.error('Error cargando sedes:', err)
    }
  }, [getAccessToken])

  const applyCedulaCache = useCallback((listado: Cliente[]): Cliente[] => {
    return listado.map((cliente) => {
      const cachedCedula = cedulaCacheRef.current.get(cliente.id)
      if (!cachedCedula || cliente.cedula?.trim()) return cliente
      return { ...cliente, cedula: cachedCedula }
    })
  }, [])

  const loadClientes = useCallback(async (
    pagina: number = 1, filtro: string = "", sedeId: string = "all", options: { initial?: boolean } = {}
  ) => {
    const isInitialRequest = options.initial ?? false
    const token = getAccessToken()
    if (!token) {
      setError('No hay token de autenticación disponible')
      setIsInitialLoading(false)
      setIsFetching(false)
      return
    }

    const requestId = ++latestRequestIdRef.current
    try {
      if (isInitialRequest) setIsInitialLoading(true)
      else setIsFetching(true)
      setError(null)

      const result = await clientesService.getClientesPaginados(token, {
        pagina, limite: itemsPorPagina, filtro,
        sedeId: sedeId !== "all" ? sedeId : undefined,
      })
      if (requestId !== latestRequestIdRef.current) return

      const sorted = filtro.trim()
        ? rankClientsByRelevance(result.clientes, filtro, result.clientes.length).map(r => r.cliente)
        : result.clientes
      setClientes(applyCedulaCache(sorted))
      setMetadata(result.metadata)
    } catch (err) {
      if (requestId !== latestRequestIdRef.current) return
      setError(err instanceof Error ? err.message : 'Error al cargar los clientes')
    } finally {
      if (isInitialRequest) { setIsInitialLoading(false); return }
      if (requestId !== latestRequestIdRef.current) return
      setIsFetching(false)
    }
  }, [getAccessToken, itemsPorPagina, applyCedulaCache])

  useEffect(() => {
    if (!authLoading && user) loadSedes()
  }, [user, authLoading, loadSedes])

  useEffect(() => {
    const token = getAccessToken()
    if (!token) {
      setError((prev) => prev || "No hay token de autenticación disponible")
      setIsInitialLoading(false)
      return
    }
    if (!hasLoadedInitialRef.current) {
      hasLoadedInitialRef.current = true
      loadClientes(1, searchTerm, selectedSede, { initial: true })
      return
    }
    const timeout = setTimeout(() => { loadClientes(1, searchTerm, selectedSede) }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [getAccessToken, searchTerm, selectedSede, itemsPorPagina, loadClientes])

  useEffect(() => {
    if (!authLoading && !user) setIsInitialLoading(false)
  }, [authLoading, user])

  useEffect(() => {
    const token = getAccessToken()
    if (!token || clientes.length === 0) return
    const idsParaEnriquecer = clientes
      .filter((cliente) => {
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
      if (updates.size === 0) return
      setClientes((prev) =>
        prev.map((cliente) => {
          const enriched = updates.get(cliente.id)
          if (!enriched) return cliente
          return { ...cliente, cedula: enriched.cedula || cliente.cedula, ltv: enriched.ltv || cliente.ltv, diasSinVenir: enriched.diasSinVenir || cliente.diasSinVenir, ultima_visita: enriched.ultima_visita || (cliente as any).ultima_visita }
        })
      )
    }
    void hydrateCedulas()
    return () => { cancelled = true }
  }, [clientes, getAccessToken])

  const handleSedeChange = useCallback((sedeId: string) => { setSelectedSede(sedeId) }, [])
  const handlePageChange = useCallback((pagina: number, filtro: string = "") => { loadClientes(pagina, filtro, selectedSede) }, [loadClientes, selectedSede])
  const handleSearch = useCallback((value: string) => { setSearchTerm(value) }, [])
  const handleItemsPerPageChange = useCallback((value: number) => { setItemsPorPagina(value) }, [])
  const handleRetry = useCallback(() => { loadClientes(1, searchTerm, selectedSede) }, [loadClientes, searchTerm, selectedSede])

  const handleSelectClient = useCallback(async (client: Cliente) => {
    const token = getAccessToken()
    if (!token) return
    try {
      const clienteCompleto = await clientesService.getClienteById(token, client.id)
      setSelectedClient(clienteCompleto)
      setIsPanelOpen(true)
    } catch (err) {
      console.error('Error cargando detalles:', err)
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
      setIsSaving(true); setError(null)
      await loadClientes(1, searchTerm, selectedSede)
      setIsModalOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear el cliente')
    } finally { setIsSaving(false) }
  }, [loadClientes, searchTerm, selectedSede])

  const handleClientUpdated = useCallback(async () => {
    const token = getAccessToken()
    if (!token || !selectedClient) return
    try {
      const clienteActualizado = await clientesService.getClienteById(token, selectedClient.id)
      setSelectedClient(clienteActualizado)
      await loadClientes(metadata?.pagina ?? 1, searchTerm, selectedSede)
    } catch (err) { console.error('Error refrescando cliente:', err) }
  }, [getAccessToken, selectedClient, loadClientes, metadata?.pagina, searchTerm, selectedSede])

  if (authLoading) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center bg-white">
        <div className="flex items-center gap-3">
          <Loader className="h-6 w-6 animate-spin text-gray-700" />
          <span className="text-lg text-gray-600">Verificando autenticación...</span>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center bg-white">
        <div className="text-center">
          <div className="text-red-600 text-lg mb-4">No autenticado</div>
          <div className="text-gray-600">Por favor inicia sesión para acceder</div>
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
        onRetry={handleRetry}
        onPageChange={handlePageChange}
        onSearch={handleSearch}
        searchValue={searchTerm}
        onSedeChange={handleSedeChange}
        selectedSede={selectedSede}
        sedes={sedes}
        onItemsPerPageChange={handleItemsPerPageChange}
        itemsPerPage={itemsPorPagina}
        isFetching={isFetching}
        isInitialLoading={isInitialLoading}
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
        sedeId={selectedSede !== "all" ? selectedSede : ""}
      />
    </div>
  )
}
