"use client"
import { memo, useCallback, useMemo, useState } from "react"
import { Search, ChevronLeft, ChevronRight, Loader2, X } from "lucide-react"
import type { Cliente } from "../../../types/cliente"
import type { Sede } from "../Sedes/sedeService"
import type { ClientesPaginadosMetadata } from "./clientesService"
import { formatSedeNombre } from "../../../lib/sede"

interface ClientsListProps {
  onSelectClient: (client: Cliente) => void
  onAddClient: () => void
  clientes: Cliente[]
  selectedId?: string
  metadata?: ClientesPaginadosMetadata
  error?: string | null
  onRetry?: () => void
  onPageChange?: (page: number, filtro?: string) => void
  onSearch?: (filtro: string) => void
  searchValue: string
  onSedeChange?: (sedeId: string) => void
  selectedSede?: string
  sedes?: Sede[]
  onItemsPerPageChange?: (value: number) => void
  itemsPerPage?: number
  isFetching?: boolean
  isInitialLoading?: boolean
}

type FilterType = 'Todos' | 'Activos' | 'En riesgo' | 'Perdidos' | 'Nuevos'

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CO")
const ini = (n: string) =>
  n.split(" ").map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()

const fmtDate = (s?: string): string => {
  if (!s) return '—'
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  return s
}

const getSegmento = (cliente: Cliente): { label: string; cls: string } => {
  const days = cliente.diasSinVenir ?? 0
  const hasVisit = Boolean(cliente.ultima_visita)
  if (!hasVisit && days === 0) return { label: 'Nuevo', cls: 'tag-gray' }
  if (days <= 30) return { label: 'Activa', cls: 'tag-green' }
  if (days <= 60) return { label: 'Tibia', cls: 'tag-yellow' }
  if (days <= 120) return { label: 'En riesgo', cls: 'tag-red' }
  return { label: 'Perdida', cls: 'tag-gray' }
}

const getRecurrencia = (cliente: Cliente): string => {
  const visits = cliente.historialCitas?.length ?? 0
  if (visits <= 1) return '—'
  return `${Math.round((cliente.diasSinVenir ?? 0) / Math.max(1, visits))}d`
}

function ClientsListComponent({
  onSelectClient, onAddClient, clientes, selectedId,
  metadata, error, onRetry, isFetching = false, isInitialLoading = false,
  onPageChange, onSearch, searchValue,
  onSedeChange, selectedSede = "all", sedes = [],
  onItemsPerPageChange, itemsPerPage = 10,
}: ClientsListProps) {
  const [activeFilter, setActiveFilter] = useState<FilterType>('Todos')

  const sedeMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of sedes) {
      map.set(s.sede_id, formatSedeNombre(s.nombre))
      if (s._id) map.set(s._id, formatSedeNombre(s.nombre))
    }
    return map
  }, [sedes])

  const totalPages = metadata?.total_paginas ?? 1
  const currentPage = metadata?.pagina ?? 1
  const tieneAnterior = metadata?.tiene_anterior ?? currentPage > 1
  const tieneSiguiente = metadata?.tiene_siguiente ?? currentPage < totalPages
  const clientCount = metadata?.total ?? clientes.length

  const handlePageChange = useCallback((page: number) => {
    onPageChange?.(Math.max(1, Math.min(page, totalPages)), searchValue)
  }, [onPageChange, searchValue, totalPages])

  const handleSearchChange = useCallback((v: string) => onSearch?.(v), [onSearch])
  const clearSearch = useCallback(() => onSearch?.(""), [onSearch])

  return (
    <div className="glw-page">
      {/* Header */}
      <div className="glw-page-header">
        <div>
          <h1>Clientes</h1>
          <p>Base de datos · Todas las sedes</p>
        </div>
        <button className="glw-btn glw-btn-primary" onClick={onAddClient}>+ Nuevo cliente</button>
      </div>

      {/* Filter bar */}
      <div className="glw-filter-bar">
        <div className="glw-search-wrap">
          <Search className="glw-search-icon" />
          <input
            className="glw-search-box"
            placeholder="Buscar por nombre, teléfono o email…"
            value={searchValue}
            onChange={e => handleSearchChange(e.target.value)}
          />
          {searchValue && (
            <button onClick={clearSearch} className="glw-search-clear" aria-label="Limpiar">
              <X style={{ width: 12, height: 12 }} />
            </button>
          )}
        </div>

        <div className="glw-filter-sep" />

        {(['Todos', 'Activos', 'En riesgo', 'Perdidos', 'Nuevos'] as FilterType[]).map(f => (
          <span
            key={f}
            className={`glw-filter-chip ${activeFilter === f ? 'active' : ''}`}
            onClick={() => setActiveFilter(f)}
          >
            {f}
          </span>
        ))}

        <div className="glw-filter-sep" />

        {/* Sede selector */}
        {sedes.length > 0 && (
          <select
            className={`glw-filter-select ${selectedSede !== 'all' ? 'active-filter' : ''}`}
            value={selectedSede}
            onChange={e => onSedeChange?.(e.target.value)}
          >
            <option value="all">Todas las sedes</option>
            {sedes.map(s => (
              <option key={s.sede_id} value={s.sede_id}>
                {formatSedeNombre(s.nombre)}
              </option>
            ))}
          </select>
        )}

        <span className="glw-count-badge">
          {isInitialLoading ? 'Cargando...' : `${clientCount.toLocaleString('es-CO')} clientes`}
          {isFetching && !isInitialLoading && (
            <Loader2 style={{ width: 12, height: 12, animation: 'spin 1s linear infinite', marginLeft: 6 }} />
          )}
        </span>
      </div>

      {/* Table */}
      <div className="glw-table-wrap">
        {error && clientes.length === 0 && !isInitialLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#aaa', fontSize: 13 }}>
            Error al cargar clientes<br />
            <button onClick={onRetry} className="glw-btn" style={{ marginTop: 8 }}>Reintentar</button>
          </div>
        ) : isInitialLoading ? (
          <table className="glw-table">
            <thead>
              <tr>
                <th style={{ width: 280 }}>Cliente</th><th>LTV</th><th>Última visita</th>
                <th>Días sin venir</th><th>Recurrencia</th><th>Sede habitual</th>
                <th>Retención</th><th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  <td><div className="glw-client-cell"><div className="glw-avatar-skel" /><div><div className="glw-skel" style={{ width: 140, height: 13, marginBottom: 4 }} /><div className="glw-skel" style={{ width: 90, height: 10 }} /></div></div></td>
                  <td><div className="glw-skel" style={{ width: 60, height: 13 }} /></td>
                  <td><div className="glw-skel" style={{ width: 70, height: 13 }} /></td>
                  <td><div className="glw-skel" style={{ width: 30, height: 13 }} /></td>
                  <td><div className="glw-skel" style={{ width: 30, height: 13 }} /></td>
                  <td><div className="glw-skel" style={{ width: 80, height: 13 }} /></td>
                  <td><div className="glw-skel" style={{ width: 50, height: 20, borderRadius: 4 }} /></td>
                  <td style={{ textAlign: 'right' }}><div className="glw-skel" style={{ width: 70, height: 26, borderRadius: 7, marginLeft: 'auto' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : clientes.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#aaa', fontSize: 13 }}>
            {searchValue ? 'Sin resultados para la búsqueda' : 'Sin clientes registrados'}
          </div>
        ) : (
          <table className="glw-table">
            <thead>
              <tr>
                <th style={{ width: 280 }}>Cliente</th><th>LTV</th><th>Última visita</th>
                <th>Días sin venir</th><th>Recurrencia</th><th>Sede habitual</th>
                <th>Retención</th><th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {clientes.map(c => {
                const seg = getSegmento(c)
                const days = c.diasSinVenir ?? 0
                const hasVisit = Boolean(c.ultima_visita)
                return (
                  <tr key={c.id} className={c.id === selectedId ? 'active-row' : ''} onClick={() => onSelectClient(c)}>
                    <td>
                      <div className="glw-client-cell">
                        <div className="glw-avatar">{ini(c.nombre)}</div>
                        <div><div className="glw-client-name">{c.nombre}</div><div className="glw-client-phone">{c.telefono}</div></div>
                      </div>
                    </td>
                    <td><div className="glw-col-num">{fmt(c.ltv)}</div></td>
                    <td><div className="glw-col-num">{fmtDate(c.ultima_visita)}</div></td>
                    <td><div className="glw-col-num">{!hasVisit ? '—' : days === 0 ? '—' : `${days}d`}</div></td>
                    <td><div className="glw-col-num">{getRecurrencia(c)}</div></td>
                    <td><div style={{ fontSize: 12.5 }}>{sedeMap.get(c.sede_id) || c.sede_id || '—'}</div></td>
                    <td><span className={`glw-tag ${seg.cls}`}>{seg.label}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="glw-btn glw-btn-sm" onClick={e => {
                        e.stopPropagation()
                        if (c.telefono && c.telefono !== 'No disponible')
                          window.open(`https://wa.me/${c.telefono.replace(/\D/g, '')}`, '_blank', 'noopener')
                      }}>WhatsApp</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {!isInitialLoading && totalPages > 1 && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 24px', borderTop: '1px solid #e8e8e8', flexShrink: 0,
          fontSize: 12, color: '#3d3d3d', background: '#fff', minHeight: 44,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#717171' }}>Mostrar</span>
            <select
              value={itemsPerPage ?? 10}
              onChange={e => onItemsPerPageChange?.(Number(e.target.value))}
              style={{
                border: '1px solid #d0d0d0', borderRadius: 6, padding: '4px 8px',
                fontSize: 12, fontFamily: 'inherit', background: '#fff', color: '#3d3d3d',
                outline: 'none', cursor: 'pointer',
              }}
            >
              {[10, 25, 50, 100].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <span style={{ color: '#717171' }}>por página</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={!tieneAnterior}
              style={{
                background: '#fff', border: '1px solid #d0d0d0', borderRadius: 6,
                padding: '6px 10px', cursor: tieneAnterior ? 'pointer' : 'default',
                color: tieneAnterior ? '#3d3d3d' : '#ccc', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center',
              }}
            >
              <ChevronLeft style={{ width: 16, height: 16 }} />
            </button>
            <span style={{ fontSize: 12, color: '#3d3d3d', fontWeight: 500 }}>Pág {currentPage} / {totalPages}</span>
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={!tieneSiguiente}
              style={{
                background: '#fff', border: '1px solid #d0d0d0', borderRadius: 6,
                padding: '6px 10px', cursor: tieneSiguiente ? 'pointer' : 'default',
                color: tieneSiguiente ? '#3d3d3d' : '#ccc', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center',
              }}
            >
              <ChevronRight style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export const ClientsList = memo(ClientsListComponent)
