// components/Quotes/ClientSearch.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DatePicker } from '../../../../components/ui/DatePicker';
import { Search, Plus, User, X, Loader2 } from 'lucide-react';
import { buscarClientes, crearCliente, Cliente, CrearClienteRequest } from '../../../../components/Quotes/clientsService';
import { useAuth } from '../../../../components/Auth/AuthContext';

const SEARCH_DEBOUNCE_MS = 300;

interface ClientSearchProps {
  sedeId: string;
  selectedClient: Cliente | null;
  onClientSelect: (cliente: Cliente) => void;
  onClientClear: () => void;
  required?: boolean;
}

interface NewClientForm extends CrearClienteRequest {
  nombre: string;
  correo?: string;
  telefono?: string;
  cedula?: string;
  ciudad?: string;
  fecha_de_nacimiento?: string;
  notas?: string;
}

export const ClientSearch: React.FC<ClientSearchProps> = ({
  sedeId,
  selectedClient,
  onClientSelect,
  onClientClear,
  required = true
}) => {
  const { user, activeSedeId } = useAuth();

  const resolvedSedeId = String(
    sedeId ||
      activeSedeId ||
      user?.sede_id ||
      sessionStorage.getItem('beaux-sede_id') ||
      localStorage.getItem('beaux-sede_id') ||
      ''
  ).trim();

  const [clientSearch, setClientSearch] = useState('');
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loadingClientes, setLoadingClientes] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [showClientModal, setShowClientModal] = useState(false);
  const [creatingClient, setCreatingClient] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const [newClient, setNewClient] = useState<NewClientForm>({
    nombre: '',
    correo: '',
    telefono: '',
    cedula: '',
    ciudad: '',
    fecha_de_nacimiento: '',
    sede_id: resolvedSedeId,
    notas: ''
  });

  useEffect(() => {
    setNewClient(prev =>
      prev.sede_id === resolvedSedeId ? prev : { ...prev, sede_id: resolvedSedeId }
    );
  }, [resolvedSedeId]);

  // Búsqueda con debounce → rapidfuzz backend. Sin re-filtro ni re-orden en frontend.
  useEffect(() => {
    const q = clientSearch.trim();

    if (!q || !user?.access_token) {
      setClientes([]);
      setLoadingClientes(false);
      return;
    }

    cancelRef.current = false;
    setLoadingClientes(true);

    const timer = setTimeout(async () => {
      try {
        const results = await buscarClientes(user.access_token, q, 25);
        if (!cancelRef.current) setClientes(results);
      } catch {
        if (!cancelRef.current) setClientes([]);
      } finally {
        if (!cancelRef.current) setLoadingClientes(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelRef.current = true;
      clearTimeout(timer);
    };
  }, [clientSearch, user?.access_token]);

  const highlight = useCallback((text: string, query: string) => {
    if (!text) return '—';
    const q = query.trim();
    if (!q) return text;
    const lower = text.toLowerCase();
    const idx = lower.indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span className="bg-yellow-100 text-gray-900">{text.slice(idx, idx + q.length)}</span>
        {text.slice(idx + q.length)}
      </>
    );
  }, []);

  const handleSelectClient = (cliente: Cliente) => {
    onClientSelect(cliente);
    setClientSearch(cliente.nombre);
    setIsFocused(false);
  };

  const handleClearClient = () => {
    onClientClear();
    setClientSearch('');
    setClientes([]);
  };

  const handleCreateClient = async () => {
    if (!newClient.nombre.trim()) { setError('El nombre del cliente es requerido'); return; }
    if (!user?.access_token) { setError('No hay sesión activa'); return; }

    const targetSedeId = String(newClient.sede_id || resolvedSedeId).trim();
    if (!targetSedeId) { setError('No se pudo determinar la sede activa'); return; }

    setCreatingClient(true);
    setError(null);

    try {
      const result = await crearCliente(user.access_token, { ...newClient, sede_id: targetSedeId });

      if (result.success) {
        onClientSelect(result.cliente);
        setClientSearch(result.cliente.nombre);
        setShowClientModal(false);
        setNewClient({ nombre: '', correo: '', telefono: '', cedula: '', ciudad: '', fecha_de_nacimiento: '', sede_id: targetSedeId, notas: '' });
      }
    } catch (err: any) {
      setError(err.message || 'Error al crear cliente');
    } finally {
      setCreatingClient(false);
    }
  };

  const formatDateForInput = (d?: string) => d ? d.split('T')[0] : '';

  const showDropdown = isFocused && clientSearch.trim().length > 0;

  return (
    <>
      <div className="space-y-1">
        <label className="block text-xs font-semibold text-gray-700">
          Cliente {required && '*'}
        </label>

        {selectedClient ? (
          <div className="flex items-center justify-between p-2 bg-gray-50 border border-gray-300 rounded">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center">
                <User className="w-3 h-3 text-gray-700" />
              </div>
              <div>
                <div className="text-xs font-medium text-gray-900">{selectedClient.nombre}</div>
                <div className="text-[10px] text-gray-600">
                  {selectedClient.telefono && `📞 ${selectedClient.telefono}`}
                  {selectedClient.correo && ` • 📧 ${selectedClient.correo}`}
                </div>
              </div>
            </div>
            <button onClick={handleClearClient} className="text-gray-500 hover:text-gray-700">
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar cliente..."
              value={clientSearch}
              onChange={e => setClientSearch(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setTimeout(() => setIsFocused(false), 150)}
              className="w-full border border-gray-300 rounded px-8 py-1.5 text-xs focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
            />
            <button
              onClick={() => setShowClientModal(true)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
              title="Crear nuevo cliente"
            >
              <Plus className="w-3 h-3" />
            </button>

            {showDropdown && (
              <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded shadow max-h-52 overflow-y-auto">
                {loadingClientes && (
                  <div className="flex items-center gap-2 px-2 py-2 text-[11px] text-gray-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                    Buscando...
                  </div>
                )}

                {!loadingClientes && clientes.length === 0 && (
                  <div className="px-2 py-2 text-[11px] text-gray-500">
                    Sin resultados —{' '}
                    <button
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => setShowClientModal(true)}
                      className="text-gray-900 font-medium underline"
                    >
                      crear cliente
                    </button>
                  </div>
                )}

                {clientes.map(c => (
                  <button
                    key={c.cliente_id || c._id}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => handleSelectClient(c)}
                    className="w-full text-left px-2 py-1.5 hover:bg-gray-100 border-b border-gray-200 last:border-b-0 flex items-center gap-2 text-xs"
                  >
                    <div className="w-5 h-5 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <User className="w-2.5 h-2.5 text-gray-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 truncate">
                        {highlight(c.nombre, clientSearch)}
                      </div>
                      <div className="text-[10px] text-gray-500 flex gap-2 truncate">
                        {c.telefono && <span>{highlight(c.telefono, clientSearch)}</span>}
                        {c.cedula && <span>{highlight(c.cedula, clientSearch)}</span>}
                        {c.correo && <span className="text-gray-400 truncate">{c.correo}</span>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showClientModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded border border-gray-300 w-full max-w-sm max-h-[80vh] overflow-y-auto">
            <div className="p-3 border-b border-gray-300">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Nuevo Cliente</h3>
                <button onClick={() => setShowClientModal(false)} className="p-1 hover:bg-gray-100 rounded">
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="p-3 space-y-3">
              {error && (
                <div className="p-2 bg-gray-100 border border-gray-300 rounded text-xs text-gray-700">{error}</div>
              )}

              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-700">Nombre completo *</label>
                <input
                  type="text"
                  value={newClient.nombre}
                  onChange={e => setNewClient({ ...newClient, nombre: e.target.value })}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
                  placeholder="Ej: María González"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-700">Cédula</label>
                  <input
                    type="text"
                    value={newClient.cedula}
                    onChange={e => setNewClient({ ...newClient, cedula: e.target.value })}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
                    placeholder="123456789"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-700">Teléfono</label>
                  <input
                    type="tel"
                    value={newClient.telefono}
                    onChange={e => setNewClient({ ...newClient, telefono: e.target.value })}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
                    placeholder="3001234567"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-700">Email</label>
                <input
                  type="email"
                  value={newClient.correo}
                  onChange={e => setNewClient({ ...newClient, correo: e.target.value })}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
                  placeholder="cliente@email.com"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-700">Ciudad</label>
                  <input
                    type="text"
                    value={newClient.ciudad}
                    onChange={e => setNewClient({ ...newClient, ciudad: e.target.value })}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none"
                    placeholder="Bogotá"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-700">Fecha de nacimiento</label>
                  <DatePicker
                    value={formatDateForInput(newClient.fecha_de_nacimiento)}
                    onChange={(v) => setNewClient({ ...newClient, fecha_de_nacimiento: v })}
                    fromYear={1920}
                    toYear={new Date().getFullYear()}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-700">Notas (opcional)</label>
                <textarea
                  value={newClient.notas}
                  onChange={e => setNewClient({ ...newClient, notas: e.target.value })}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none resize-none"
                  rows={2}
                  placeholder="Información adicional..."
                />
              </div>
            </div>

            <div className="p-3 border-t border-gray-300 flex gap-2">
              <button
                onClick={() => setShowClientModal(false)}
                disabled={creatingClient}
                className="flex-1 px-3 py-1.5 border border-gray-300 text-gray-700 rounded text-xs hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateClient}
                disabled={!newClient.nombre.trim() || creatingClient}
                className="flex-1 px-3 py-1.5 bg-gray-900 text-white rounded text-xs hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
              >
                {creatingClient ? (
                  <><div className="animate-spin rounded-full h-2.5 w-2.5 border-b-2 border-white" />Creando...</>
                ) : 'Crear Cliente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showClientModal && (
        <div className="fixed inset-0 z-[9998]" onClick={() => { if (!creatingClient) setShowClientModal(false); }} />
      )}
    </>
  );
};
