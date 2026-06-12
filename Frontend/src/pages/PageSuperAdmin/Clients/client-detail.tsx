"use client"
import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Cliente } from "../../../types/cliente"
import { EditClientModal } from "./EditClientModal"
import { clientesService } from "./clientesService"
import { useAuth } from "../../../components/Auth/AuthContext"
import { API_BASE_URL } from "../../../types/config"

interface ClientDetailProps {
  client: Cliente
  isOpen: boolean
  onClose: () => void
  onClientUpdated?: () => void
}

type Tab = 'resumen' | 'perfil' | 'evolucion' | 'historial' | 'notas'

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CO")
const ini = (n: string) =>
  n.split(" ").map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()

const fmtDate = (s?: string): string => {
  if (!s) return '—'
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  return s
}

const fmtDateLong = (s?: string): string => {
  if (!s) return '—'
  try {
    const d = new Date(s)
    if (isNaN(d.getTime())) return fmtDate(s)
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
  } catch { return fmtDate(s) }
}

const cleanPhone = (phone: string): string => phone.replace(/\D/g, '')
const whatsappUrl = (phone: string) => `https://wa.me/${cleanPhone(phone)}`

function ResumenTab({ client }: { client: Cliente }) {
  const visits = client.historialCitas?.length ?? 0
  const daysSince = client.diasSinVenir ?? 0
  const overdue = daysSince > 30
  const extraDays = overdue ? daysSince - 30 : 0
  const recPct = Math.min(100, Math.round((daysSince / Math.max(30, 1)) * 100))
  const recColor = daysSince <= 30 ? 'fill-green' : daysSince <= 60 ? 'fill-yellow' : 'fill-red'
  const segLabel = daysSince <= 30 ? 'Activa' : daysSince <= 60 ? 'Tibia' : daysSince <= 120 ? 'En riesgo' : 'Perdida'
  const segCls = daysSince <= 30 ? 'tag-green' : daysSince <= 60 ? 'tag-yellow' : daysSince <= 120 ? 'tag-red' : 'tag-gray'
  const lastFour = (client.historialCitas ?? []).slice(0, 4)

  return (
    <>
      <div className="glw-kpi-strip">
        <div className="glw-kpi">
          <div className="glw-kpi-label">LTV</div>
          <div className="glw-kpi-value">{fmt(client.ltv)}</div>
          <div className="glw-kpi-sub">{visits} visitas</div>
        </div>
        <div className="glw-kpi">
          <div className="glw-kpi-label">Ticket prom.</div>
          <div className="glw-kpi-value">{fmt(client.ticketPromedio)}</div>
          <div className="glw-kpi-sub">por visita</div>
        </div>
        <div className="glw-kpi">
          <div className="glw-kpi-label">Días sin venir</div>
          <div className="glw-kpi-value">{daysSince === 0 ? 'Hoy' : daysSince}</div>
          <div className="glw-kpi-sub">{overdue ? 'Fuera de ciclo' : 'Dentro del rango'}</div>
        </div>
        <div className="glw-kpi">
          <div className="glw-kpi-label">Segmento</div>
          <div className="glw-kpi-value" style={{ fontSize: 13, marginTop: 5 }}>
            <span className={`glw-tag ${segCls}`}>{segLabel}</span>
          </div>
          <div className="glw-kpi-sub">{overdue ? `${extraDays}d extra` : 'En ciclo'}</div>
        </div>
      </div>

      <div className="glw-rec-block">
        <div className="glw-rec-label">Indicador de recurrencia</div>
        <div className="glw-bar-track">
          <div className={`glw-bar-fill ${recColor}`} style={{ width: `${recPct}%` }} />
        </div>
        <div className="glw-rec-meta">
          <span>Última visita: {fmtDate(client.ultima_visita)}</span>
          <span>{daysSince} días transcurridos</span>
        </div>
        {overdue && (
          <div className="glw-rec-note">
            Lleva <strong>{extraDays} días extra</strong> sin visitar — el ciclo esperado era 30 días.
          </div>
        )}
      </div>

      <div className="glw-s-title">Información personal</div>
      <div className="glw-info-grid">
        <div className="glw-info-item"><label>Teléfono</label><span>{client.telefono}</span></div>
        <div className="glw-info-item"><label>Email</label><span>{client.email}</span></div>
        {client.cedula && <div className="glw-info-item"><label>Cédula</label><span>{client.cedula}</span></div>}
        <div className="glw-info-item"><label>Cliente desde</label><span>{fmtDate(client.fecha_creacion)}</span></div>
      </div>

      {overdue && (
        <>
          <div className="glw-s-title">Oportunidades</div>
          <div className="glw-op-list">
            <div className="glw-op-item">
              <div className="glw-op-icon">⏰</div>
              <div className="glw-op-body">
                <div className="glw-op-title">Reagendamiento urgente</div>
                <div className="glw-op-desc">{extraDays} días extra sin visitar. Enviar WhatsApp de reactivación.</div>
              </div>
              <button className="glw-btn glw-btn-sm" onClick={() => {
                if (client.telefono && client.telefono !== 'No disponible')
                  window.open(whatsappUrl(client.telefono), '_blank', 'noopener')
              }}>Enviar</button>
            </div>
          </div>
        </>
      )}

      {lastFour.length > 0 && (
        <>
          <div className="glw-s-title">Últimas visitas</div>
          <table className="glw-hist-table">
            <thead><tr><th>Fecha</th><th>Servicio</th><th>Profesional</th><th style={{ textAlign: 'right' }}>Valor</th></tr></thead>
            <tbody>
              {lastFour.map((h, i) => (
                <tr key={i}>
                  <td>{fmtDate(h.fecha)}</td>
                  <td style={{ fontWeight: 500 }}>{h.servicio}</td>
                  <td>{h.profesional}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    {typeof h.valor_total === 'number' ? fmt(h.valor_total) : h.valor_total || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  )
}

function PerfilCapilarTab({ client }: { client: Cliente }) {
  const lastFicha = client.fichas?.[0]
  const datos = lastFicha?.datos_especificos || lastFicha?.contenido
  const { user } = useAuth()
  const [verTodas, setVerTodas] = useState(false)
  const [descargando, setDescargando] = useState<string | null>(null)
  const fichas = client.fichas ?? []
  const fichasMostradas = verTodas ? fichas : fichas.slice(0, 5)

  const fichaRizotipo = fichas.find((f: any) => f.tipo_ficha === 'DIAGNOSTICO_RIZOTIPO')
  const rizoDatos = fichaRizotipo?.datos_especificos || fichaRizotipo?.contenido

  const getDescargaId = (ficha: any): string | undefined =>
    ficha.contenido?.cita_id ||       // real cita_id first
    ficha.datos_especificos?.cita_id ||
    ficha.cita_id ||
    ficha.id ||                        // ficha._id as last resort — backend detects this as a direct ficha lookup
    ficha._id

  const handleDescargar = async (ficha: any) => {
    const token = user?.access_token || localStorage.getItem('access_token') || sessionStorage.getItem('access_token')
    const citaId = getDescargaId(ficha)
    if (!citaId || !token) return
    const fichaKey = ficha._id || ficha.id
    setDescargando(fichaKey)
    try {
      const res = await fetch(`${API_BASE_URL}api/pdf/generar-pdf/${client.id}/${citaId}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' } })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `ficha_${(ficha.nombre || 'cliente').replace(/\s+/g, '_').toLowerCase()}_${(ficha.fecha_ficha || '').split('T')[0]}.pdf`
      document.body.appendChild(link); link.click()
      setTimeout(() => { document.body.removeChild(link); window.URL.revokeObjectURL(url) }, 100)
    } catch { /* silent */ } finally { setDescargando(null) }
  }

  return (
    <>
      <div className="glw-s-title" style={{ marginTop: 0 }}>Rizotipo</div>
      {rizoDatos ? (
        <div className="glw-cap-grid">
          <div className="glw-cap-card"><div className="glw-cap-card-label">Exterior Lipídico</div><div className="glw-cap-card-value">{rizoDatos.exterior_lipidico_valor || rizoDatos.exterior_lipidico || '—'}</div></div>
          <div className="glw-cap-card"><div className="glw-cap-card-label">Porosidad</div><div className="glw-cap-card-value">{rizoDatos.porosidad_valor || rizoDatos.porosidad || '—'}</div></div>
          <div className="glw-cap-card"><div className="glw-cap-card-label">Permeabilidad</div><div className="glw-cap-card-value">{rizoDatos.permeabilidad_valor || rizoDatos.permeabilidad || '—'}</div></div>
          <div className="glw-cap-card"><div className="glw-cap-card-label">Plasticidad</div><div className="glw-cap-card-value">{rizoDatos.plasticidad_valor || rizoDatos.plasticidad || '—'}</div></div>
          <div className="glw-cap-card"><div className="glw-cap-card-label">Textura</div><div className="glw-cap-card-value">{rizoDatos.textura_valor || rizoDatos.textura || '—'}</div></div>
          <div className="glw-cap-card"><div className="glw-cap-card-label">Grosor</div><div className="glw-cap-card-value">{rizoDatos.grosor_valor || rizoDatos.grosor || '—'}</div></div>
          <div className="glw-cap-card"><div className="glw-cap-card-label">Oleosidad</div><div className="glw-cap-card-value">{rizoDatos.oleosidad_valor || rizoDatos.oleosidad || '—'}</div></div>
          <div className="glw-cap-card"><div className="glw-cap-card-label">Densidad</div><div className="glw-cap-card-value">{rizoDatos.densidad_valor || rizoDatos.densidad || '—'}</div></div>
          <div className="glw-cap-card" style={{ gridColumn: '1 / -1' }}><div className="glw-cap-card-label">Tipo de Textura</div><div className="glw-cap-card-value">{rizoDatos.tipo_textura || '—'}</div></div>
        </div>
      ) : <div className="glw-empty-state">Sin datos de rizotipo</div>}

      <div className="glw-s-title">Características capilares</div>
      <div className="glw-cap-grid">
        <div className="glw-cap-card"><div className="glw-cap-card-label">Porosidad</div><div className="glw-cap-card-value">{datos?.porosidad || '—'}</div></div>
        <div className="glw-cap-card"><div className="glw-cap-card-label">Densidad</div><div className="glw-cap-card-value">{datos?.densidad || '—'}</div></div>
        <div className="glw-cap-card"><div className="glw-cap-card-label">Elasticidad</div><div className="glw-cap-card-value">{datos?.elasticidad || '—'}</div></div>
        <div className="glw-cap-card"><div className="glw-cap-card-label">Estado del cuero</div><div className="glw-cap-card-value">{datos?.oleosidad || datos?.exterior_lipidico || '—'}</div></div>
      </div>

      <div className="glw-s-title">Fichas del cliente</div>
      {fichas.length === 0 ? <div className="glw-empty-state">Sin fichas registradas</div> : (
        <>
          <table className="glw-hist-table">
            <thead><tr><th>Fecha</th><th>Servicio</th><th>Profesional</th><th>Sede</th><th style={{ textAlign: 'right' }}></th></tr></thead>
            <tbody>
              {fichasMostradas.map((ficha: any) => {
                const fichaKey = ficha._id || ficha.id
                const descargaId = getDescargaId(ficha)
                const tieneCitaId = !!descargaId
                return (
                  <tr key={fichaKey}>
                    <td>{fmtDate(ficha.fecha_ficha)}</td>
                    <td style={{ fontWeight: 500 }}>{ficha.servicio_nombre || ficha.servicio || '—'}</td>
                    <td>{ficha.profesional_nombre || '—'}</td>
                    <td>{ficha.sede_nombre || ficha.sede || '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {tieneCitaId ? (
                        <button onClick={() => handleDescargar(ficha)} disabled={descargando === fichaKey} className="glw-btn glw-btn-sm" style={{ fontSize: 11 }}>
                          {descargando === fichaKey ? 'Descargando...' : '↓ Descargar'}
                        </button>
                      ) : <span style={{ fontSize: 10, color: '#aaa' }}>—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {fichas.length > 5 && <button onClick={() => setVerTodas(v => !v)} className="glw-btn glw-btn-sm" style={{ marginTop: 8 }}>{verTodas ? 'Ver menos' : `Ver todas (${fichas.length})`}</button>}
        </>
      )}

      {datos?.recomendaciones_personalizadas && (
        <><div className="glw-s-title">Recomendaciones del especialista</div><div className="glw-nota"><div className="glw-nota-text">{datos.recomendaciones_personalizadas}</div></div></>
      )}
    </>
  )
}

function EvolucionTab({ client }: { client: Cliente }) {
  const fichas = client.fichas ?? []
  if (fichas.length === 0 && (client.historialCitas?.length ?? 0) === 0) return <div className="glw-empty-state">Sin datos de evolución</div>

  const entries = fichas.length > 0
    ? fichas.map(f => ({ date: fmtDateLong(f.fecha_ficha), service: f.servicio_nombre || f.servicio || '—', profesional: `${f.profesional_nombre || '—'} · ${f.sede_nombre || f.sede || ''}`, notes: f.comentario_interno || f.notas_cliente || '' }))
    : client.historialCitas.map(h => ({ date: fmtDateLong(h.fecha), service: h.servicio, profesional: h.profesional, notes: h.notas || '' }))

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div className="glw-s-title" style={{ margin: '0 0 2px' }}>Progreso del cabello</div>
          <div style={{ fontSize: 11.5, color: '#717171' }}>Seguimiento de indicadores capilares</div>
        </div>
      </div>
      <div className="glw-s-title">Registros</div>
      {entries.map((ev, i) => (
        <div key={i} className="glw-evo-entry">
          <div className="glw-evo-entry-head">
            <div><div className="glw-evo-entry-date">{ev.date}</div><div className="glw-evo-entry-svc">{ev.service}</div></div>
            <div className="glw-evo-entry-prof">{ev.profesional}</div>
          </div>
          {ev.notes && <div className="glw-evo-notes">{ev.notes}</div>}
        </div>
      ))}
    </>
  )
}

function HistorialTab({ client }: { client: Cliente }) {
  const historial = client.historialCitas ?? []
  const total = historial.reduce((s, h) => s + (typeof h.valor_total === 'number' ? h.valor_total : Number(h.valor_total) || 0), 0)
  if (historial.length === 0) return <div className="glw-empty-state">Sin historial de servicios</div>

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className="glw-s-title" style={{ margin: 0 }}>Historial completo</div>
        <span style={{ fontSize: 11.5, color: '#717171' }}>{historial.length} visitas · {fmt(total)}</span>
      </div>
      <table className="glw-hist-table">
        <thead><tr><th>Fecha</th><th>Servicio</th><th>Profesional</th><th>Estado</th><th style={{ textAlign: 'right' }}>Valor</th></tr></thead>
        <tbody>
          {historial.map((h, i) => (
            <tr key={i}>
              <td>{fmtDate(h.fecha)}</td>
              <td><div style={{ fontWeight: 500 }}>{h.servicio}</div></td>
              <td>{h.profesional}</td>
              <td><span className={`glw-tag ${h.estado_pago === 'pagado' ? 'tag-green' : 'tag-gray'}`}>{h.estado_pago === 'pagado' ? 'Facturada' : h.estado_pago || h.estado || 'Pendiente'}</span></td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{typeof h.valor_total === 'number' ? fmt(h.valor_total) : h.valor_total || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function NotasTab({ client, onNoteAdded }: { client: Cliente; onNoteAdded?: () => void }) {
  const { user } = useAuth()
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const getToken = () => user?.access_token || sessionStorage.getItem("access_token") || localStorage.getItem("access_token") || ""
  const autorName = user?.name || user?.nombre_local || ''

  const handleSave = useCallback(async () => {
    if (!newNote.trim()) return
    const token = getToken()
    if (!token) return
    setSaving(true)
    try { await clientesService.agregarNota(token, client.id, newNote.trim(), autorName); setNewNote(''); onNoteAdded?.() }
    catch (err) { console.error("Error guardando nota:", err) }
    finally { setSaving(false) }
  }, [newNote, client.id, onNoteAdded, autorName])

  const notes = Array.isArray(client.notas_historial) && client.notas_historial.length > 0
    ? client.notas_historial : client.nota ? [{ contenido: client.nota, fecha: '', autor: '' }] : []

  return (
    <>
      {notes.length === 0 ? <div className="glw-empty-state">Sin notas registradas</div> : notes.map((n, i) => (
        <div key={i} className="glw-nota">
          <div className="glw-nota-meta"><span>{fmtDate(n.fecha)}</span>{n.autor && <span>{n.autor}</span>}</div>
          <div className="glw-nota-text">{n.contenido}</div>
        </div>
      ))}
      <textarea className="glw-nota-add" value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Agregar nota…"
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSave() }} />
      {newNote.trim() && (
        <div className="glw-nota-actions">
          <button onClick={handleSave} disabled={saving} className="glw-btn glw-btn-sm glw-btn-primary">{saving ? 'Guardando...' : 'Guardar nota'}</button>
        </div>
      )}
    </>
  )
}

export function ClientDetail({ client, isOpen, onClose, onClientUpdated }: ClientDetailProps) {
  const [tab, setTab] = useState<Tab>('resumen')
  const [isEditOpen, setIsEditOpen] = useState(false)
  const navigate = useNavigate()
  const { user: authUser } = useAuth()
  const token = (authUser as any)?.access_token || sessionStorage.getItem("access_token") || localStorage.getItem("access_token") || ""

  const handleWhatsApp = useCallback(() => {
    if (client.telefono && client.telefono !== 'No disponible') window.open(whatsappUrl(client.telefono), '_blank', 'noopener,noreferrer')
  }, [client.telefono])

  const handleAgendarCita = useCallback(() => {
    navigate('/agenda', { state: { clienteNombre: client.nombre, clienteId: client.id, clienteTelefono: client.telefono } })
  }, [navigate, client.nombre, client.id, client.telefono])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'resumen', label: 'Resumen' }, { key: 'perfil', label: 'Perfil Capilar' },
    { key: 'evolucion', label: 'Evolución' }, { key: 'historial', label: 'Historial' }, { key: 'notas', label: 'Notas' },
  ]

  return (
    <>
      <div className={`glw-overlay ${isOpen ? 'open' : ''}`} onClick={onClose} />
      <div className={`glw-slide-panel ${isOpen ? 'open' : ''}`}>
        <div className="glw-panel-header">
          <div className="glw-panel-avatar">{ini(client.nombre)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="glw-panel-name">{client.nombre}</div>
            <div className="glw-panel-sub">
              <span>{client.telefono}</span><span>{client.email}</span>
              {client.fecha_creacion && <span>Cliente desde {fmtDate(client.fecha_creacion)}</span>}
            </div>
            <div className="glw-panel-actions">
              <button className="glw-btn glw-btn-sm" onClick={handleWhatsApp}>WhatsApp</button>
              <button className="glw-btn glw-btn-sm" onClick={() => setIsEditOpen(true)}>Editar</button>
              <button className="glw-btn glw-btn-sm glw-btn-primary" onClick={handleAgendarCita}>Agendar cita</button>
            </div>
          </div>
          <button className="glw-panel-close" onClick={onClose}>✕</button>
        </div>
        <div className="glw-panel-tabs">
          {tabs.map(t => <div key={t.key} className={`glw-panel-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</div>)}
        </div>
        <div className="glw-panel-body">
          {tab === 'resumen' && <ResumenTab client={client} />}
          {tab === 'perfil' && <PerfilCapilarTab client={client} />}
          {tab === 'evolucion' && <EvolucionTab client={client} />}
          {tab === 'historial' && <HistorialTab client={client} />}
          {tab === 'notas' && <NotasTab client={client} onNoteAdded={onClientUpdated} />}
        </div>
      </div>
      {isEditOpen && (
        <EditClientModal cliente={client} token={token} isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)} onSuccess={() => { setIsEditOpen(false); onClientUpdated?.() }} />
      )}
    </>
  )
}