import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ChevronLeft, ChevronRight, ChevronDown, Check, X,
  Clock, Calendar as CalendarIcon, Search, Wand2
} from 'lucide-react';
import { useAuth } from '../../components/Auth/AuthContext';
import { getEstilistas, getEstilistaCompleto, Estilista } from '../../components/Professionales/estilistasApi';
import { getServicios, Servicio } from '../../components/Quotes/serviciosApi';
import { Cliente, getHistorialCliente } from './clientsService';
import { ClientSearch } from '../../pages/PageSuperAdmin/Appoinment/Clients/ClientSearch';
import { crearCita } from './citasApi';
import { PAYMENT_METHOD_OPTIONS } from '../../lib/payment-methods';

interface EstilistaCompleto extends Estilista {
  servicios_no_presta: string[];
  especialidades: boolean;
}

interface SelectedService {
  servicio_id: string;
  nombre: string;
  duracion: number;
  precio_base: number;
  precio_personalizado: number | null;
  precio_final: number;
}

interface AppointmentSchedulerProps {
  onClose: () => void;
  sedeId: string;
  estilistaId?: string;
  fecha: string;
  horaSeleccionada?: string;
  estilistas?: EstilistaCompleto[];
}

// ─── Constants ────────────────────────────────────────────────────────────────


const PAYMENT_METHODS = PAYMENT_METHOD_OPTIONS;

const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DAY_HEADERS = ['Do','Lu','Ma','Mi','Ju','Vi','Sá'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDateSafely(s: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, mo, d] = s.split('-').map(Number);
    return new Date(y, mo - 1, d);
  }
  return new Date(s);
}

function formatDateForBackend(d: Date): string {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}

function formatDateShort(d: Date): string {
  return `${DAY_HEADERS[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()].substring(0, 3)} ${d.getFullYear()}`;
}

// ─── TimePicker ───────────────────────────────────────────────────────────────

const PICKER_MINUTES = ['00','05','10','15','20','25','30','35','40','45','50','55'];

function to12h(time24: string): { h: string; m: string; ampm: 'a.m.' | 'p.m.' } {
  const [hh, mm] = time24.split(':').map(Number);
  const ampm: 'a.m.' | 'p.m.' = hh < 12 ? 'a.m.' : 'p.m.';
  const h12 = hh % 12 || 12;
  return { h: h12.toString().padStart(2, '0'), m: mm.toString().padStart(2, '0'), ampm };
}

function to24h(h: string, m: string, ampm: 'a.m.' | 'p.m.'): string {
  let hour = parseInt(h, 10);
  if (ampm === 'a.m.' && hour === 12) hour = 0;
  if (ampm === 'p.m.' && hour !== 12) hour += 12;
  return `${hour.toString().padStart(2, '0')}:${m}`;
}

const TimePicker: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const parsed = useMemo(() => to12h(value || '07:00'), [value]);
  const [selH, setSelH] = useState(parsed.h);
  const [selM, setSelM] = useState(parsed.m);
  const [selAmpm, setSelAmpm] = useState<'a.m.' | 'p.m.'>(parsed.ampm);

  // sync local state when value prop changes externally
  useEffect(() => {
    const p = to12h(value || '07:00');
    setSelH(p.h);
    setSelM(p.m);
    setSelAmpm(p.ampm);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);

  const PICKER_HOURS = ['06','07','08','09','10','11','12','01','02','03','04','05'];
  const displayValue = `${selH}:${selM} ${selAmpm}`;

  const pick = (h: string, m: string, ap: 'a.m.' | 'p.m.') => {
    setSelH(h); setSelM(m); setSelAmpm(ap);
    onChange(to24h(h, m, ap));
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between border border-gray-300 rounded-lg px-3 py-2.5 bg-white hover:border-gray-700 transition-colors text-sm"
      >
        <span className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-400" />
          <span className="font-medium text-gray-900">{displayValue}</span>
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden" style={{ minWidth: '200px' }}>
          {/* selected display */}
          <div className="px-3 py-2 border-b border-gray-100 text-center text-sm font-semibold text-gray-900 bg-gray-50">
            {displayValue}
          </div>
          <div className="flex">
            {/* Hours column */}
            <div className="flex-1 max-h-44 overflow-y-auto border-r border-gray-100">
              {PICKER_HOURS.map(h => (
                <button
                  key={h}
                  type="button"
                  onClick={() => pick(h, selM, selAmpm)}
                  className={`w-full py-2 text-sm font-medium transition-colors ${
                    h === selH ? 'bg-[#1976D2] text-white' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {h}
                </button>
              ))}
            </div>
            {/* Minutes column */}
            <div className="flex-1 max-h-44 overflow-y-auto border-r border-gray-100">
              {PICKER_MINUTES.map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => pick(selH, m, selAmpm)}
                  className={`w-full py-2 text-sm font-medium transition-colors ${
                    m === selM ? 'bg-[#1976D2] text-white' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            {/* AM/PM column */}
            <div className="flex-1 flex flex-col">
              {(['a.m.', 'p.m.'] as const).map(ap => (
                <button
                  key={ap}
                  type="button"
                  onClick={() => pick(selH, selM, ap)}
                  className={`flex-1 py-3 text-sm font-medium transition-colors ${
                    ap === selAmpm ? 'bg-[#1976D2] text-white' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {ap}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── MiniCalendar ─────────────────────────────────────────────────────────────

const MiniCalendar: React.FC<{
  selectedDate: Date | null;
  onSelect: (d: Date) => void;
  onClose: () => void;
}> = ({ selectedDate, onSelect, onClose }) => {
  const [view, setView] = useState(() => selectedDate || new Date());

  const cells = useMemo(() => {
    const y = view.getFullYear();
    const mo = view.getMonth();
    const firstDow = new Date(y, mo, 1).getDay();
    const daysInMonth = new Date(y, mo + 1, 0).getDate();
    const prevLast = new Date(y, mo, 0).getDate();
    const arr: { date: Date; current: boolean }[] = [];

    for (let i = 0; i < firstDow; i++) {
      arr.push({ date: new Date(y, mo - 1, prevLast - firstDow + i + 1), current: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      arr.push({ date: new Date(y, mo, d), current: true });
    }
    while (arr.length < 42) {
      arr.push({ date: new Date(y, mo + 1, arr.length - firstDow - daysInMonth + 1), current: false });
    }
    return arr;
  }, [view]);

  const today = new Date();

  return (
    <div className="absolute z-50 top-full mt-1 left-0 bg-white border border-gray-200 rounded-xl shadow-xl p-3 w-60">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setView(v => new Date(v.getFullYear(), v.getMonth() - 1))}
          className="p-1 hover:bg-gray-100 rounded"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-xs font-semibold">
          {MONTH_NAMES[view.getMonth()].substring(0, 3)} {view.getFullYear()}
        </span>
        <button
          onClick={() => setView(v => new Date(v.getFullYear(), v.getMonth() + 1))}
          className="p-1 hover:bg-gray-100 rounded"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {DAY_HEADERS.map(d => (
          <div key={d} className="text-[9px] text-gray-400 text-center font-medium">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map(({ date, current }, i) => {
          const sel = selectedDate?.toDateString() === date.toDateString();
          const isToday = date.toDateString() === today.toDateString();
          return (
            <button
              key={i}
              disabled={!current}
              onClick={() => { if (current) { onSelect(date); onClose(); } }}
              className={`h-6 w-6 mx-auto flex items-center justify-center text-[10px] rounded-full transition-colors
                ${!current ? 'text-gray-300' : ''}
                ${sel ? 'bg-gray-900 text-white' : ''}
                ${isToday && !sel ? 'border border-gray-400' : ''}
                ${current && !sel ? 'hover:bg-gray-100 text-gray-700' : ''}
              `}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-2 pt-2 border-t border-gray-100">
        <button
          onClick={() => { const t = new Date(); onSelect(t); onClose(); }}
          className="w-full text-[10px] text-gray-600 hover:text-gray-900 font-medium py-1 rounded hover:bg-gray-50"
        >
          Hoy
        </button>
      </div>
    </div>
  );
};

// ─── ProgressBar ──────────────────────────────────────────────────────────────

const ProgressBar: React.FC<{ step: number; total: number }> = ({ step, total }) => (
  <div className="flex gap-1 mb-5">
    {Array.from({ length: total }, (_, i) => (
      <div
        key={i}
        className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i < step ? 'bg-gray-900' : 'bg-gray-200'}`}
      />
    ))}
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────

const AppointmentScheduler: React.FC<AppointmentSchedulerProps> = ({
  onClose,
  sedeId,
  estilistaId,
  fecha,
  horaSeleccionada,
  estilistas: estilistasFromProps,
}) => {
  const { user } = useAuth();

  // Step
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [stepError, setStepError] = useState<string | null>(null);

  // Step 1 — client
  const [selectedClient, setSelectedClient] = useState<Cliente | null>(null);
  const [clientHistorial, setClientHistorial] = useState<any[]>([]);
  const [loadingHistorial, setLoadingHistorial] = useState(false);

  // Step 2 — services / pro / time
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState(horaSeleccionada || '10:00');
  const [horaFinValue, setHoraFinValue] = useState('');
  const [horaFinManual, setHoraFinManual] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [servicioSearch, setServicioSearch] = useState('');
  const [serviciosSeleccionados, setServiciosSeleccionados] = useState<SelectedService[]>([]);
  const [selectedStylist, setSelectedStylist] = useState<EstilistaCompleto | null>(null);
  const [estilistas, setEstilistas] = useState<EstilistaCompleto[]>([]);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [loadingEstilistas, setLoadingEstilistas] = useState(false);
  const [loadingServicios, setLoadingServicios] = useState(false);

  // Step 3 — payment
  const [showAbono, setShowAbono] = useState(false);
  const [abonoAmount, setAbonoAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('efectivo');
  const [isPreCita, setIsPreCita] = useState(false);

  // Step 4 — notes / submit
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Currency
  const currency = useMemo(() => {
    const p = user?.pais;
    if (p === 'Colombia') return 'COP';
    if (p === 'México' || p === 'Mexico') return 'MXN';
    return 'USD';
  }, [user?.pais]);

  // Init date / time from props
  useEffect(() => {
    setSelectedDate(fecha ? parseDateSafely(fecha) : new Date());
    if (horaSeleccionada) setSelectedTime(horaSeleccionada);
  }, [fecha, horaSeleccionada]);

  // Load stylists
  useEffect(() => {
    if (!user?.access_token || !sedeId) return;
    setLoadingEstilistas(true);
    const load = async () => {
      try {
        let list: EstilistaCompleto[] = [];
        if (estilistasFromProps?.length) {
          list = estilistasFromProps;
        } else {
          const raw = await getEstilistas(user.access_token, sedeId);
          list = await Promise.all(
            raw.map(async e => {
              try {
                const full = await getEstilistaCompleto(user.access_token, e.profesional_id || e._id);
                return { ...e, servicios_no_presta: full.servicios_no_presta || [], especialidades: full.especialidades || false };
              } catch {
                return { ...e, servicios_no_presta: [], especialidades: false };
              }
            })
          );
        }
        const seen = new Set<string>();
        list = list.filter(e => {
          const k = e.profesional_id || e._id;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        setEstilistas(list);
        const pre = estilistaId
          ? list.find(e => e.profesional_id === estilistaId || e._id === estilistaId) ?? list[0]
          : list[0];
        if (pre) setSelectedStylist(pre);
      } catch {
        setEstilistas([]);
      } finally {
        setLoadingEstilistas(false);
      }
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sedeId, estilistaId, user?.access_token]);

  // Load services
  useEffect(() => {
    if (!user?.access_token) return;
    setLoadingServicios(true);
    getServicios(user.access_token)
      .then(setServicios)
      .catch(() => setServicios([]))
      .finally(() => setLoadingServicios(false));
  }, [user?.access_token]);

  // Fetch client historial
  useEffect(() => {
    if (!selectedClient || !user?.access_token) { setClientHistorial([]); return; }
    const id = selectedClient.cliente_id || (selectedClient as any)._id;
    if (!id) return;
    setLoadingHistorial(true);
    getHistorialCliente(user.access_token, id)
      .then(h => setClientHistorial(Array.isArray(h) ? h : []))
      .catch(() => setClientHistorial([]))
      .finally(() => setLoadingHistorial(false));
  }, [selectedClient, user?.access_token]);

  // Services filtered by stylist + search
  const serviciosFiltrados = useMemo(() => {
    if (!servicios.length) return [];
    let list = servicios;
    if (selectedStylist?.servicios_no_presta?.length) {
      const blocked = new Set(selectedStylist.servicios_no_presta.map(String));
      list = list.filter(s => !blocked.has(s.servicio_id || s._id));
    }
    const q = servicioSearch.toLowerCase().trim();
    if (!q) return list;
    return list.filter(s => s.nombre.toLowerCase().includes(q) || (s.categoria || '').toLowerCase().includes(q));
  }, [servicios, selectedStylist, servicioSearch]);

  // Totals
  const { duracionTotal, montoTotal } = useMemo(() => ({
    duracionTotal: serviciosSeleccionados.reduce((s, x) => s + x.duracion, 0),
    montoTotal: serviciosSeleccionados.reduce((s, x) => s + x.precio_final, 0),
  }), [serviciosSeleccionados]);

  const horaFin = useMemo(
    () => selectedTime ? addMinutes(selectedTime, Math.max(duracionTotal, 60)) : '',
    [selectedTime, duracionTotal]
  );

  useEffect(() => {
    if (!horaFinManual) setHoraFinValue(horaFin);
  }, [horaFin, horaFinManual]);

  const lastServiceName = useMemo(() => {
    if (!clientHistorial.length) return null;
    const last = clientHistorial[0];
    return last?.servicio || last?.servicio_nombre || last?.servicios?.[0]?.nombre || null;
  }, [clientHistorial]);

  // Service handlers
  const addService = useCallback((s: Servicio) => {
    const id = s.servicio_id || s._id;
    if (serviciosSeleccionados.some(x => x.servicio_id === id)) return;
    const price = s.precio_local ?? s.precio ?? 0;
    setServiciosSeleccionados(prev => [...prev, {
      servicio_id: id,
      nombre: s.nombre,
      duracion: s.duracion_minutos || s.duracion || 30,
      precio_base: price,
      precio_personalizado: null,
      precio_final: price,
    }]);
  }, [serviciosSeleccionados]);

  const removeService = useCallback((id: string) => {
    setServiciosSeleccionados(prev => prev.filter(s => s.servicio_id !== id));
  }, []);

  const updateServicePrice = useCallback((id: string, val: string) => {
    setServiciosSeleccionados(prev => prev.map(s => {
      if (s.servicio_id !== id) return s;
      const p = val ? parseFloat(val) : null;
      return { ...s, precio_personalizado: p, precio_final: p ?? s.precio_base };
    }));
  }, []);

  const handleStylistChange = useCallback((id: string) => {
    const s = estilistas.find(e => (e.profesional_id || e._id) === id);
    if (s) { setSelectedStylist(s); setServiciosSeleccionados([]); }
  }, [estilistas]);

  // Navigation
  const handleNext = useCallback(() => {
    setStepError(null);
    if (step === 1) {
      if (!selectedClient) { setStepError('Por favor selecciona un cliente'); return; }
      setStep(2);
    } else if (step === 2) {
      if (serviciosSeleccionados.length === 0) { setStepError('Agrega al menos un servicio'); return; }
      if (!selectedStylist) { setStepError('Selecciona un profesional'); return; }
      if (!selectedDate) { setStepError('Selecciona una fecha'); return; }
      if (!selectedTime) { setStepError('Selecciona una hora'); return; }
      setStep(3);
    } else if (step === 3) {
      setStep(4);
    }
  }, [step, selectedClient, serviciosSeleccionados, selectedStylist, selectedDate, selectedTime]);

  const handleBack = useCallback(() => {
    setStepError(null);
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
    else if (step === 4) setStep(3);
  }, [step]);

  // Submit
  const handleSubmit = async () => {
    if (!selectedClient || !selectedStylist || !selectedDate) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const parsedAbono = Number(abonoAmount) || 0;
      // Si toggle Pre-cita está OFF (false), asegurar que abono > 0 para que backend lo interprete como "confirmada"
      // Si toggle está ON (true), enviar 0 para pre_reservada
      const abonoToSend = isPreCita ? 0 : (parsedAbono > 0 ? parsedAbono : 0.01);
      await crearCita({
        sede_id: sedeId,
        cliente_id: selectedClient.cliente_id,
        profesional_id: selectedStylist.profesional_id || selectedStylist._id,
        servicios: serviciosSeleccionados.map(s => ({
          servicio_id: s.servicio_id,
          precio_personalizado: s.precio_personalizado,
        })),
        fecha: formatDateForBackend(selectedDate),
        hora_inicio: selectedTime,
        hora_fin: horaFinValue || horaFin,
        abono: abonoToSend,
        metodo_pago: isPreCita || abonoToSend === 0 ? 'sin_pago' : paymentMethod,
        notas: notes,
        estado: isPreCita ? 'pre-cita' : 'confirmada',
        valor_total: montoTotal,
        cliente_nombre: selectedClient.nombre,
      }, user!.access_token);
      onClose();
    } catch (err: any) {
      setSubmitError(err?.message || 'Error al crear la cita');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col">
      <ProgressBar step={step} total={4} />
      <div>

      {/* ── STEP 1: CLIENT ─────────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Paso 1 de 4</p>
            <h3 className="text-base font-bold text-gray-900">Selecciona el cliente</h3>
          </div>

          <ClientSearch
            sedeId={sedeId}
            selectedClient={selectedClient}
            onClientSelect={setSelectedClient}
            onClientClear={() => setSelectedClient(null)}
            required
          />

          {selectedClient && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-1">
              <div className="text-sm font-semibold text-gray-900">{selectedClient.nombre}</div>
              {selectedClient.telefono && (
                <div className="text-xs text-gray-500">{selectedClient.telefono}</div>
              )}
              <div className="flex items-center gap-3 pt-1">
                {loadingHistorial ? (
                  <span className="text-xs text-gray-400">Cargando historial…</span>
                ) : (
                  <>
                    <span className="text-xs text-gray-600">
                      <span className="font-semibold text-gray-900">{clientHistorial.length}</span>{' '}
                      visita{clientHistorial.length !== 1 ? 's' : ''}
                    </span>
                    {lastServiceName && (
                      <span className="text-xs text-gray-500">
                        Último: <span className="font-medium text-gray-700">{lastServiceName}</span>
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── STEP 2: SERVICES + PRO + TIME ──────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Paso 2 de 4</p>
            <h3 className="text-base font-bold text-gray-900">Servicio, profesional y hora</h3>
          </div>

          {/* Service search + list */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Servicios *</label>
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                value={servicioSearch}
                onChange={e => setServicioSearch(e.target.value)}
                placeholder="Buscar servicio…"
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-xs focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
              />
            </div>

            <div className="border border-gray-200 rounded-xl max-h-44 overflow-y-auto">
              {loadingServicios ? (
                <p className="p-3 text-xs text-gray-400 text-center">Cargando servicios…</p>
              ) : serviciosFiltrados.length === 0 ? (
                <p className="p-3 text-xs text-gray-400 text-center">No hay servicios disponibles</p>
              ) : (
                serviciosFiltrados.map(s => {
                  const id = s.servicio_id || s._id;
                  const added = serviciosSeleccionados.some(x => x.servicio_id === id);
                  const price = s.precio_local ?? s.precio ?? 0;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => added ? removeService(id) : addService(s)}
                      className={`w-full text-left px-3 py-2.5 flex items-center justify-between border-b border-gray-100 last:border-b-0 transition-colors ${
                        added ? 'bg-gray-900 text-white' : 'hover:bg-gray-50 text-gray-800'
                      }`}
                    >
                      <div>
                        <div className="text-xs font-medium">{s.nombre}</div>
                        <div className={`text-[10px] mt-0.5 ${added ? 'text-gray-300' : 'text-gray-500'}`}>
                          {s.duracion_minutos || s.duracion}min · {currency} {price}
                        </div>
                      </div>
                      {added && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>

            {serviciosSeleccionados.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {serviciosSeleccionados.map(s => (
                  <div key={s.servicio_id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs">
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-gray-900 truncate">{s.nombre}</span>
                      <span className="text-gray-400 ml-1">· {s.duracion}min</span>
                    </div>
                    <input
                      type="number"
                      value={s.precio_personalizado !== null ? s.precio_personalizado : s.precio_base}
                      onChange={e => updateServicePrice(s.servicio_id, e.target.value)}
                      className="w-20 border border-gray-200 rounded px-1.5 py-1 text-[10px] text-right focus:outline-none focus:border-gray-700"
                    />
                    <button onClick={() => removeService(s.servicio_id)} className="text-red-400 hover:text-red-600 flex-shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex justify-end text-xs font-semibold text-gray-900 pr-1">
                  {currency} {montoTotal} · {duracionTotal} min
                </div>
              </div>
            )}
          </div>

          {/* Stylist */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Profesional *</label>
            <select
              value={selectedStylist?.profesional_id || selectedStylist?._id || ''}
              onChange={e => handleStylistChange(e.target.value)}
              disabled={loadingEstilistas}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none bg-white disabled:bg-gray-100"
            >
              {loadingEstilistas
                ? <option>Cargando…</option>
                : <>
                  <option value="">Seleccionar profesional</option>
                  {estilistas.map(e => (
                    <option key={e.profesional_id || e._id} value={e.profesional_id || e._id}>{e.nombre}</option>
                  ))}
                </>
              }
            </select>
          </div>

          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Fecha *</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowCalendar(o => !o)}
                  className="w-full flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2.5 bg-white hover:border-gray-700 text-sm transition-colors"
                >
                  <CalendarIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="text-gray-900 truncate">
                    {selectedDate ? `${selectedDate.getDate()}/${selectedDate.getMonth() + 1}/${selectedDate.getFullYear()}` : 'Fecha'}
                  </span>
                </button>
                {showCalendar && (
                  <MiniCalendar
                    selectedDate={selectedDate}
                    onSelect={setSelectedDate}
                    onClose={() => setShowCalendar(false)}
                  />
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Hora inicio *</label>
              <TimePicker value={selectedTime} onChange={setSelectedTime} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div />
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-gray-700">Hora fin</label>
                <button
                  type="button"
                  onClick={() => { setHoraFinManual(false); setHoraFinValue(horaFin); }}
                  className="inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 transition-colors"
                  style={{ fontSize: 9, color: '#64748B', borderColor: '#E2E8F0', background: '#fff' }}
                >
                  <Wand2 className="h-2.5 w-2.5" />
                  Auto
                </button>
              </div>
              <TimePicker
                value={horaFinValue}
                onChange={(v) => { setHoraFinManual(true); setHoraFinValue(v); }}
              />
            </div>
          </div>

          {showCalendar && (
            <div className="fixed inset-0 z-40" onClick={() => setShowCalendar(false)} />
          )}
        </div>
      )}

      {/* ── STEP 3: SUMMARY + PAYMENT ─────────────────────────────────────── */}
      {step === 3 && selectedClient && selectedStylist && selectedDate && (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Paso 3 de 4</p>
            <h3 className="text-base font-bold text-gray-900">Resumen y pago</h3>
          </div>

          {/* Summary */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
            <div>
              <div className="text-sm font-bold text-gray-900">{selectedClient.nombre}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {clientHistorial.length} visita{clientHistorial.length !== 1 ? 's' : ''}
                {lastServiceName && <> · Último: {lastServiceName}</>}
              </div>
            </div>

            <div className="border-t border-gray-200 pt-2 space-y-1">
              {serviciosSeleccionados.map(s => (
                <div key={s.servicio_id} className="flex justify-between text-xs">
                  <span className="text-gray-700">{s.nombre} <span className="text-gray-400">({s.duracion}min)</span></span>
                  <span className="font-semibold">{currency} {s.precio_final}</span>
                </div>
              ))}
            </div>

            <div className="border-t border-gray-200 pt-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-600">{selectedStylist.nombre}</span>
                <span className="text-sm font-bold text-gray-900">{currency} {montoTotal}</span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {formatDateShort(selectedDate)} · {selectedTime} — {horaFinValue || horaFin}
              </div>
            </div>
          </div>

          {/* Abono */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAbono(o => !o)}
              className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 transition-colors"
            >
              <span className="text-sm font-medium text-gray-900">
                {showAbono ? 'Quitar abono' : '+ Agregar abono'}
              </span>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showAbono ? 'rotate-180' : ''}`} />
            </button>

            {showAbono && !isPreCita && (
              <div className="px-4 pb-4 pt-2 border-t border-gray-100 space-y-3 bg-white">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Monto del abono</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs text-gray-500">{currency}</span>
                    <input
                      type="number"
                      value={abonoAmount}
                      onChange={e => setAbonoAmount(e.target.value)}
                      placeholder="0"
                      className="w-full border border-gray-300 rounded-lg pl-12 pr-3 py-2.5 text-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">Método de pago</label>
                  <div className="flex flex-wrap gap-2">
                    {PAYMENT_METHODS.map(pm => (
                      <button
                        key={pm.id}
                        type="button"
                        onClick={() => setPaymentMethod(pm.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          paymentMethod === pm.id
                            ? 'bg-gray-900 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {pm.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Pre-cita toggle */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <button
              type="button"
              onClick={() => setIsPreCita(o => !o)}
              className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${isPreCita ? 'bg-gray-900' : 'bg-gray-200'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${isPreCita ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
            <div>
              <div className="text-sm font-medium text-gray-900">Pre-cita</div>
              <div className="text-xs text-gray-500">La cita quedará pendiente de confirmar</div>
            </div>
          </label>
        </div>
      )}

      {/* ── STEP 4: NOTES ─────────────────────────────────────────────────── */}
      {step === 4 && (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Paso 4 de 4</p>
            <h3 className="text-base font-bold text-gray-900">Notas adicionales</h3>
            <p className="text-xs text-gray-500 mt-1">Agrega cualquier información relevante para esta cita</p>
          </div>

          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Ej: Cliente prefiere técnica específica, alergias, observaciones importantes…"
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none resize-none"
            rows={5}
          />

          {submitError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start justify-between gap-2">
              <span>{submitError}</span>
              <button onClick={() => setSubmitError(null)} className="flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          {/* Final summary */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs text-gray-600 space-y-1">
            <div>
              <span className="font-semibold text-gray-900">{selectedClient?.nombre}</span>
              {' · '}{serviciosSeleccionados.length} servicio{serviciosSeleccionados.length !== 1 ? 's' : ''}
            </div>
            <div>
              {selectedStylist?.nombre}
              {selectedDate && <> · {formatDateShort(selectedDate)}</>}
              {' · '}{selectedTime}
            </div>
            <div>
              Total: <span className="font-semibold text-gray-900">{currency} {montoTotal}</span>
              {showAbono && !isPreCita && Number(abonoAmount) > 0 && (
                <> · Abono: {currency} {abonoAmount}</>
              )}
              {isPreCita && <> · <span className="text-amber-600 font-semibold">Pre-cita</span></>}
            </div>
          </div>
        </div>
      )}

      {/* Step error */}
      {stepError && (
        <div className="mt-3 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center justify-between">
          <span>{stepError}</span>
          <button onClick={() => setStepError(null)}><X className="w-3 h-3" /></button>
        </div>
      )}
      </div>

      {/* Navigation */}
      <div className="flex gap-2 pt-4 mt-2 border-t border-gray-100">
        {step > 1 && (
          <button
            type="button"
            onClick={handleBack}
            className="flex-1 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            ← Anterior
          </button>
        )}
        {step < 4 ? (
          <button
            type="button"
            onClick={handleNext}
            className="flex-1 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition-colors"
          >
            Siguiente →
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Creando cita…' : 'Confirmar Cita'}
          </button>
        )}
      </div>
    </div>
  );
};

export default React.memo(AppointmentScheduler);
