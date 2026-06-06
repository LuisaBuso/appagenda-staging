import React, { useState, useCallback, useEffect, useMemo } from "react";
import { createBloqueo, updateBloqueo, type Bloqueo } from "./bloqueosApi";
import { useAuth } from "../../components/Auth/AuthContext";
import { getSedes, type Sede } from "../Branch/sedesApi";
import { getEstilistas, type Estilista } from "../Professionales/estilistasApi";
import { formatSedeNombre } from "../../lib/sede";
import TimeInputWithPicker from "../ui/time-input-with-picker";
import { formatAgendaTime, normalizeAgendaTimeValue } from "../../lib/agenda";
import { DatePicker } from "../ui/DatePicker";
import { toLocalYMD } from "../../lib/dateFormat";

interface BloqueosProps {
  onClose: () => void;
  estilistaId?: string;
  fecha?: string;
  horaInicio?: string;
  compact?: boolean;
  editingBloqueo?: Bloqueo | null;
  citasExistentes?: unknown[];
  onBloqueoGuardado?: (bloqueo: Bloqueo, action: "create" | "update") => void;
}

const DIAS_SEMANA = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
];

const normalizeFecha = (valor?: string) => {
  if (!valor) return "";
  return valor.includes("T") ? valor.split("T")[0] : valor.split(" ")[0];
};

const toMinutes = (hora: string) => {
  const [h, m] = hora.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

const Bloqueos: React.FC<BloqueosProps> = ({
  onClose,
  estilistaId,
  fecha,
  horaInicio,
  compact = false,
  editingBloqueo = null,
  citasExistentes: _citasExistentes = [],
  onBloqueoGuardado,
}) => {
  const { user } = useAuth();
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [estilistas, setEstilistas] = useState<Estilista[]>([]);
  const [loadingSedes, setLoadingSedes] = useState(false);
  const [loadingEstilistas, setLoadingEstilistas] = useState(false);
  
  // Determinar si el usuario actual es un estilista
  const esEstilista = user?.role === 'estilista';
  const useCompactView = compact || esEstilista;
  const [createFromExisting, setCreateFromExisting] = useState(false);
  const isEditing = Boolean(editingBloqueo?._id) && !createFromExisting;
  
  const [formData, setFormData] = useState({
    profesional_id: editingBloqueo?.profesional_id || estilistaId || "",
    sede_id: editingBloqueo?.sede_id || user?.sede_id || "",
    fecha: normalizeFecha(editingBloqueo?.fecha) || fecha || "",
    hora_inicio: normalizeAgendaTimeValue(editingBloqueo?.hora_inicio || horaInicio || "09:00") || "09:00",
    hora_fin: normalizeAgendaTimeValue(editingBloqueo?.hora_fin || "10:00") || "10:00",
    motivo: editingBloqueo?.motivo || "",
  });
  
  const [loading, setLoading] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [isRecurrent, setIsRecurrent] = useState(false);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [repeatUntil, setRepeatUntil] = useState("");

  // Cargar sedes según el tipo de usuario y estilistaId
  const cargarSedes = useCallback(async () => {
    if (!user?.access_token) return;

    setLoadingSedes(true);
    try {
      const sedesData = await getSedes(user.access_token);
      
      let sedesFiltradas = sedesData;

      // CASO 1: Si el usuario es estilista
      if (esEstilista && user.sede_id) {
        // Estilista solo puede ver su propia sede
        const sedeUsuario = sedesData.find((s: Sede) => s.sede_id === user.sede_id);
        if (sedeUsuario) {
          sedesFiltradas = [sedeUsuario];
          setFormData(prev => ({ 
            ...prev, 
            sede_id: user.sede_id || prev.sede_id,
            // El estilista no puede seleccionar otro profesional, se establece cuando carguemos los estilistas
          }));
        } else {
          sedesFiltradas = [];
        }
      }
      // CASO 2: Si hay estilistaId pasado como prop
      else if (estilistaId) {
        try {
          const estilistasData = await getEstilistas(user.access_token);
          const estilista = estilistasData.find((e: Estilista) => e.profesional_id === estilistaId);
          
          if (estilista?.sede_id) {
            // Si encontramos el estilista y tiene sede, filtrar solo esa sede
            sedesFiltradas = sedesData.filter((s: Sede) => s.sede_id === estilista.sede_id);
            
            // Establecer automáticamente la sede del estilista
            setFormData(prev => ({ 
              ...prev, 
              sede_id: estilista.sede_id || prev.sede_id || user?.sede_id || "",
              profesional_id: estilistaId
            }));
          }
        } catch (err) {
          console.error("Error al buscar estilista:", err);
        }
      }
      // CASO 3: Si es admin sede, filtrar solo su sede
      else if (user.role === 'admin_sede' && user.sede_id) {
        const sedeUsuario = sedesData.find((s: Sede) => s.sede_id === user.sede_id);
        if (sedeUsuario) {
          sedesFiltradas = [sedeUsuario];
          setFormData(prev => ({ ...prev, sede_id: sedeUsuario.sede_id || "" }));
        } else {
          sedesFiltradas = [];
        }
      }
      // CASO 4: Super admin - mostrar todas las sedes (no filtrar)
      
      setSedes(sedesFiltradas);
    } catch (err) {
      console.error("Error cargando sedes:", err);
      setSedes([]);
    } finally {
      setLoadingSedes(false);
    }
  }, [user, estilistaId, esEstilista]);

  // Cargar estilistas según la sede seleccionada O según estilistaId
  const cargarEstilistas = useCallback(async () => {
    if (!user?.access_token) {
      setEstilistas([]);
      return;
    }

    setLoadingEstilistas(true);
    try {
      const estilistasData = await getEstilistas(user.access_token);
      
      if (!Array.isArray(estilistasData)) {
        setEstilistas([]);
        return;
      }

      let estilistasFiltrados = estilistasData;

      // IMPORTANTE: Cuando el usuario es estilista, necesitamos encontrar SU propio profesional_id
      if (esEstilista) {
        // Buscar el estilista por email para obtener su profesional_id
        const estilistaActual = estilistasData.find((e: Estilista) => 
          e.email === user.email
        );
        
        if (estilistaActual) {
          estilistasFiltrados = [estilistaActual];
          
          // Establecer automáticamente el estilista y sede
          setFormData(prev => ({ 
            ...prev, 
            profesional_id: estilistaActual.profesional_id || prev.profesional_id,
            sede_id: estilistaActual.sede_id || prev.sede_id || user?.sede_id || ""
          }));
        } else {
          // Si no encontramos al estilista por email, mostrar mensaje
          console.warn("No se encontró el perfil de estilista para el usuario:", user.email);
          setEstilistas([]);
          setMensaje("❌ No se encontró tu perfil de estilista. Contacta al administrador.");
        }
      }
      // Si hay un estilistaId específico, mostrarlo primero
      else if (estilistaId) {
        const estilistaEspecifico = estilistasData.find((e: Estilista) => 
          e.profesional_id === estilistaId
        );
        
        if (estilistaEspecifico) {
          // Filtrar solo estilistas de la misma sede que el estilista específico
          estilistasFiltrados = estilistasData.filter((est: Estilista) => 
            est.sede_id === estilistaEspecifico.sede_id
          );
          
          // Establecer automáticamente el estilista
          setFormData(prev => ({ 
            ...prev, 
            profesional_id: estilistaId,
            sede_id: estilistaEspecifico.sede_id || prev.sede_id || user?.sede_id || ""
          }));
        }
      }
      // Si es admin sede, filtrar solo estilistas de su sede
      else if (user.role === 'admin_sede' && user.sede_id) {
        estilistasFiltrados = estilistasData.filter((est: Estilista) => 
          est.sede_id === user.sede_id
        );
      }
      // Si se ha seleccionado una sede específica, filtrar por esa sede
      else if (formData.sede_id) {
        estilistasFiltrados = estilistasData.filter((est: Estilista) => 
          est.sede_id === formData.sede_id
        );
      }

      setEstilistas(estilistasFiltrados);

    } catch (err) {
      console.error("Error cargando estilistas:", err);
      setEstilistas([]);
    } finally {
      setLoadingEstilistas(false);
    }
  }, [user, formData.sede_id, estilistaId, esEstilista]);

  // Cargar sedes al montar el componente
  useEffect(() => {
    cargarSedes();
  }, [cargarSedes]);

  // Cargar estilistas cuando cambia la sede seleccionada
  useEffect(() => {
    if (formData.sede_id || estilistaId || esEstilista) {
      cargarEstilistas();
    } else {
      setEstilistas([]);
    }
  }, [formData.sede_id, cargarEstilistas, estilistaId, esEstilista]);

  useEffect(() => {
    setCreateFromExisting(false);
    if (editingBloqueo?._id) {
      setFormData((prev) => ({
        ...prev,
        profesional_id: editingBloqueo.profesional_id || prev.profesional_id,
        sede_id: editingBloqueo.sede_id || prev.sede_id,
        fecha: normalizeFecha(editingBloqueo.fecha) || prev.fecha,
        hora_inicio: normalizeAgendaTimeValue(editingBloqueo.hora_inicio) || prev.hora_inicio,
        hora_fin: normalizeAgendaTimeValue(editingBloqueo.hora_fin) || prev.hora_fin,
        motivo: editingBloqueo.motivo || "",
      }));
      setIsRecurrent(false);
      setSelectedDays([]);
      setRepeatUntil("");
      setMensaje("");
      return;
    }

    setFormData((prev) => ({
      ...prev,
      fecha: fecha || prev.fecha,
      hora_inicio: horaInicio || prev.hora_inicio,
    }));
  }, [editingBloqueo, fecha, horaInicio]);

  const handleCreateFromExisting = useCallback(() => {
    if (!editingBloqueo?._id) return;
    setCreateFromExisting(true);
    setMensaje("ℹ️ Modo crear: se guardará un nuevo bloqueo superpuesto.");
  }, [editingBloqueo]);

  const handleReturnToEdit = useCallback(() => {
    setCreateFromExisting(false);
    setMensaje("");
  }, []);

  const handleInputChange = useCallback((field: string, value: any) => {
    if (isEditing && (field === "sede_id" || field === "profesional_id" || field === "fecha")) {
      setMensaje("❌ En edición no puedes cambiar sede, estilista o fecha");
      return;
    }

    // Si hay estilistaId o el usuario es estilista, no permitir cambiar sede ni profesional
    if ((estilistaId || esEstilista) && (field === 'sede_id' || field === 'profesional_id')) {
      setMensaje("❌ No puedes cambiar la sede o estilista en este modo");
      return;
    }
    
    setFormData(prev => {
      const newData = { ...prev, [field]: value };
      
      // Si cambia la sede, limpiar el estilista seleccionado (solo si no es estilista ni hay estilistaId)
      if (field === 'sede_id' && !estilistaId && !esEstilista) {
        newData.profesional_id = "";
      }
      
      return newData;
    });
  }, [estilistaId, esEstilista, isEditing]);

  const handleToggleDay = useCallback((day: number) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((item) => item !== day) : [...prev, day]
    );
  }, []);

  const bloqueoRecurrenteEstimado = useMemo(() => {
    if (!isRecurrent || !formData.fecha || !repeatUntil || selectedDays.length === 0) {
      return 0;
    }

    if (repeatUntil < formData.fecha) {
      return 0;
    }

    const inicio = new Date(`${formData.fecha}T00:00:00`);
    const fin = new Date(`${repeatUntil}T00:00:00`);
    let total = 0;

    const cursor = new Date(inicio);
    while (cursor <= fin) {
      if (selectedDays.includes(cursor.getDay())) {
        total += 1;
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    return total;
  }, [isRecurrent, formData.fecha, repeatUntil, selectedDays]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.access_token) {
      setMensaje("❌ No hay token de autenticación");
      return;
    }

    // Validaciones básicas
    if (!formData.profesional_id.trim()) {
      setMensaje("❌ Debes seleccionar un estilista");
      return;
    }
    if (!formData.sede_id.trim()) {
      setMensaje("❌ La sede es requerida");
      return;
    }
    if (!formData.fecha.trim()) {
      setMensaje("❌ La fecha es requerida");
      return;
    }

    // Validar que hora_fin sea mayor que hora_inicio
    if (formData.hora_fin <= formData.hora_inicio) {
      setMensaje("❌ La hora de fin debe ser mayor a la hora de inicio");
      return;
    }

    const inicioMinutos = toMinutes(formData.hora_inicio);
    const finMinutos = toMinutes(formData.hora_fin);

    if (inicioMinutos === null || finMinutos === null) {
      setMensaje("❌ Horario inválido");
      return;
    }

    if (isEditing && !editingBloqueo?._id) {
      setMensaje("❌ No se encontró el ID del bloqueo a editar");
      return;
    }

    if (isRecurrent) {
      if (selectedDays.length === 0) {
        setMensaje("❌ Selecciona al menos un día para la recurrencia");
        return;
      }

      if (!repeatUntil) {
        setMensaje("❌ Debes seleccionar la fecha límite de repetición");
        return;
      }

      if (repeatUntil < formData.fecha) {
        setMensaje("❌ La fecha límite no puede ser menor que la fecha inicial");
        return;
      }

      if (bloqueoRecurrenteEstimado <= 0) {
        setMensaje("❌ No hay fechas válidas para crear bloqueos con esa configuración");
        return;
      }
    }

    try {
      setLoading(true);
      setMensaje("");

      if (isEditing && editingBloqueo?._id) {
        const payload = {
          hora_inicio: formData.hora_inicio,
          hora_fin: formData.hora_fin,
          motivo: formData.motivo.trim() || "Bloqueo de agenda",
        };

        const response = await updateBloqueo(editingBloqueo._id, payload, user.access_token);
        const responseObj = response && typeof response === "object" ? response : {};
        const bloqueoResponse = "bloqueo" in responseObj
          ? (responseObj as { bloqueo?: Partial<Bloqueo> }).bloqueo
          : (responseObj as Partial<Bloqueo>);

        const bloqueoActualizado: Bloqueo = {
          ...editingBloqueo,
          ...payload,
          ...(bloqueoResponse || {}),
          fecha: normalizeFecha((bloqueoResponse || {}).fecha || editingBloqueo.fecha) || formData.fecha,
        };

        setMensaje("✅ Bloqueo actualizado correctamente");
        onBloqueoGuardado?.(bloqueoActualizado, "update");
        setTimeout(onClose, 900);
        return;
      }

      const payloadBase = {
        profesional_id: formData.profesional_id.trim(),
        sede_id: formData.sede_id.trim(),
        hora_inicio: formData.hora_inicio,
        hora_fin: formData.hora_fin,
        motivo: formData.motivo.trim() || "Bloqueo de agenda",
      };

      const dataToSend = isRecurrent
        ? {
            ...payloadBase,
            recurrente: true,
            dias_semana: [...selectedDays].sort((a, b) => a - b),
            fecha_inicio: formData.fecha,
            fecha_fin: repeatUntil,
          }
        : {
            ...payloadBase,
            fecha: formData.fecha,
          };

      const response = await createBloqueo(dataToSend, user.access_token);
      const responseObj = response && typeof response === "object" ? response : {};
      const bloqueosRespuesta = Array.isArray((responseObj as { bloqueos?: Partial<Bloqueo>[] }).bloqueos)
        ? ((responseObj as { bloqueos?: Partial<Bloqueo>[] }).bloqueos || [])
        : [];
      const bloqueoRespuesta = "bloqueo" in responseObj
        ? (responseObj as { bloqueo?: Partial<Bloqueo> }).bloqueo
        : (responseObj as Partial<Bloqueo>);

      const bloqueosCreadosRaw = bloqueosRespuesta.length > 0
        ? bloqueosRespuesta
        : [bloqueoRespuesta];

      const bloqueosCreados = bloqueosCreadosRaw
        .filter((item): item is Partial<Bloqueo> => Boolean(item && typeof item === "object"))
        .map((item) => ({
          profesional_id: formData.profesional_id.trim(),
          sede_id: formData.sede_id.trim(),
          hora_inicio: formData.hora_inicio,
          hora_fin: formData.hora_fin,
          motivo: formData.motivo.trim() || "Bloqueo de agenda",
          ...item,
          fecha: normalizeFecha(item.fecha || formData.fecha) || formData.fecha,
        }));

      bloqueosCreados.forEach((bloqueoCreado) => {
        onBloqueoGuardado?.(bloqueoCreado, "create");
      });

      if (isRecurrent) {
        const creados = Number((responseObj as any)?.resumen?.creados ?? bloqueosCreados.length);
        const omitidos = Number((responseObj as any)?.resumen?.omitidos ?? 0);
        if ((responseObj as any)?.resumen) {
          setMensaje(
            `✅ Bloqueos recurrentes creados correctamente (${creados} creados${omitidos > 0 ? `, ${omitidos} omitidos` : ""})`
          );
        } else {
          setMensaje(`✅ Bloqueo recurrente creado correctamente (${creados} bloqueos)`);
        }
      } else {
        setMensaje("✅ Bloqueo creado exitosamente");
      }

      setTimeout(onClose, 1200);
    } catch (err: any) {
      console.error("Error guardando bloqueo:", err);
      const rawMessage = String(err?.message || "").trim();
      const lowerMessage = rawMessage.toLowerCase();
      const isUnauthorized =
        lowerMessage.includes("no autorizado") ||
        lowerMessage.includes("forbidden") ||
        lowerMessage.includes("http 403");

      if (isEditing && isUnauthorized) {
        setMensaje("❌ No tienes permisos para editar este bloqueo.");
      } else {
        setMensaje(`❌ ${rawMessage || "Error al guardar el bloqueo"}`);
      }
    } finally {
      setLoading(false);
    }
  }, [
    formData,
    user,
    onClose,
    isRecurrent,
    selectedDays,
    repeatUntil,
    bloqueoRecurrenteEstimado,
    isEditing,
    editingBloqueo,
    onBloqueoGuardado,
  ]);

  // Calcular hora mínima para fin
  const minHoraFin = formData.hora_inicio;

  // Obtener el nombre de la sede actual para mostrar
  const nombreSedeActual = formatSedeNombre(
    sedes.find(s => s.sede_id === formData.sede_id)?.nombre,
    ""
  );

  // Obtener el nombre del estilista actual para mostrar
  const nombreEstilistaActual = estilistas.find(e => e.profesional_id === formData.profesional_id)?.nombre || "";

  // Determinar qué rol mostrar
  const getRolDisplay = () => {
    switch(user?.role) {
      case 'super_admin': return 'Super Admin';
      case 'admin_sede': return 'Admin Sede';
      case 'estilista': return 'Estilista';
      default: return user?.role || 'Usuario';
    }
  };

  const fieldLabelClass = useCompactView
    ? "block text-xs font-medium text-gray-700 mb-1"
    : "block text-sm font-medium text-gray-800 mb-1";

  const controlClass = useCompactView
    ? "w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-gray-500 focus:border-gray-500 transition-colors"
    : "w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500 transition-colors";

  const readonlyControlClass = useCompactView
    ? "w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50"
    : "w-full p-3 border border-gray-300 rounded-lg bg-gray-50";

  return (
    <div className={useCompactView ? "p-4 pb-[max(env(safe-area-inset-bottom),1rem)] text-sm" : "p-5"}>
      <h2 className={`${useCompactView ? "text-lg mb-3" : "text-2xl mb-4"} font-bold text-gray-900`}>
        {isEditing ? "Editar bloqueo" : "Bloqueo de horario"}
      </h2>

      {editingBloqueo?._id && (
        <div className={`${useCompactView ? "mb-3" : "mb-4"} flex items-center justify-end`}>
          {isEditing ? (
            <button
              type="button"
              onClick={handleCreateFromExisting}
              className={`${useCompactView ? "px-3 py-1.5 text-xs rounded-md" : "px-3 py-2 text-sm rounded-lg"} border border-gray-300 text-gray-800 font-medium hover:bg-gray-100 transition-colors`}
            >
              Crear nuevo superpuesto
            </button>
          ) : (
            <button
              type="button"
              onClick={handleReturnToEdit}
              className={`${useCompactView ? "px-3 py-1.5 text-xs rounded-md" : "px-3 py-2 text-sm rounded-lg"} border border-gray-300 text-gray-800 font-medium hover:bg-gray-100 transition-colors`}
            >
              Volver a edición
            </button>
          )}
        </div>
      )}

      {/* Información del usuario */}
      <div className={`${useCompactView ? "mb-3 p-2.5 rounded-md" : "mb-4 p-3 rounded-lg"} bg-gray-100 border border-gray-300`}>
        <p className={useCompactView ? "text-xs text-gray-700" : "text-sm text-gray-800"}>
          <span className="font-semibold">Usuario:</span> {user?.email}
        </p>
        <p className={useCompactView ? "text-xs text-gray-700" : "text-sm text-gray-800"}>
          <span className="font-semibold">Rol:</span> {getRolDisplay()}
        </p>
        
        {(estilistaId || esEstilista || editingBloqueo?._id) && (
          <div className="mt-2 pt-2 border-t border-gray-300">
            <p className={`${useCompactView ? "text-[11px]" : "text-xs"} text-gray-700`}>
              <span className="font-semibold">⚠️ Modo especial:</span> 
              {isEditing
                ? " Editando bloqueo existente"
                : createFromExisting
                  ? " Creando nuevo bloqueo superpuesto"
                : estilistaId
                  ? " Creando bloqueo para estilista específico"
                  : esEstilista
                    ? " Creando bloqueo para tu propio horario"
                    : ""}
            </p>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className={useCompactView ? "space-y-4" : "space-y-4"}>
        {/* Motivo */}
        <div>
          <label className={fieldLabelClass}>
            Motivo del bloqueo
          </label>
          <input
            type="text"
            value={formData.motivo}
            onChange={(e) => handleInputChange('motivo', e.target.value)}
            className={controlClass}
            placeholder="Ej: Capacitación, Reunión, Descanso, Vacaciones"
            required
          />
        </div>

        {/* Sede - Solo editable para Super Admin Y cuando no hay restricciones */}
        <div>
          <label className={fieldLabelClass}>
            Sede
          </label>
          {user?.role === 'admin_sede' || estilistaId || esEstilista || isEditing ? (
            // Para Admin Sede, estilistaId o usuario estilista: solo mostrar (no editable)
            <div className={readonlyControlClass}>
              <div className="flex items-center justify-between">
                <span className={`${useCompactView ? "text-sm" : "text-gray-900"} font-medium`}>
                  {nombreSedeActual || "Cargando sede..."}
                </span>
                <span className={`${useCompactView ? "text-[11px]" : "text-xs"} text-gray-600`}>
                  {isEditing
                    ? "(No editable)"
                    : esEstilista
                      ? "(Tu sede)"
                      : estilistaId
                        ? "(Sede del estilista)"
                        : "(Tu sede)"}
                </span>
              </div>
              <input
                type="hidden"
                value={formData.sede_id}
                readOnly
              />
            </div>
          ) : (
            // Para Super Admin: selector editable solo si no hay restricciones
            <select
              value={formData.sede_id}
              onChange={(e) => handleInputChange('sede_id', e.target.value)}
              required
              className={controlClass}
              disabled={loadingSedes || !!estilistaId || esEstilista || isEditing}
              >
                <option value="">{loadingSedes ? "Cargando sedes..." : "Seleccionar sede"}</option>
                {sedes.map(sede => (
                  <option key={sede._id || sede.sede_id} value={sede.sede_id}>
                    {formatSedeNombre(sede.nombre)}
                  </option>
                ))}
              </select>
          )}
        </div>

        {/* Estilista - Si hay estilistaId o es estilista, mostrar como read-only */}
        <div>
          <label className={fieldLabelClass}>
            Estilista
          </label>
          {estilistaId || esEstilista || isEditing ? (
            // Mostrar como read-only si se pasó estilistaId o el usuario es estilista
            <div className={readonlyControlClass}>
              <div className="flex items-center justify-between">
                <span className={`${useCompactView ? "text-sm" : "text-gray-900"} font-medium`}>
                  {nombreEstilistaActual || "Cargando estilista..."}
                </span>
                <span className={`${useCompactView ? "text-[11px]" : "text-xs"} text-gray-600`}>
                  {isEditing ? "(No editable)" : esEstilista ? "(Tú)" : "(Pre-seleccionado)"}
                </span>
              </div>
              <input
                type="hidden"
                value={formData.profesional_id}
                readOnly
              />
            </div>
          ) : (
            // Selector normal si no hay restricciones
            <select
              value={formData.profesional_id}
              onChange={(e) => handleInputChange('profesional_id', e.target.value)}
              required
              className={controlClass}
              disabled={!formData.sede_id || loadingEstilistas}
            >
              <option value="">
                {loadingEstilistas ? "Cargando estilistas..." : 
                 !formData.sede_id ? "Primero selecciona una sede" : 
                 "Seleccionar estilista"}
              </option>
              {estilistas.map(estilista => (
                <option key={estilista.profesional_id} value={estilista.profesional_id}>
                  {estilista.nombre}
                </option>
              ))}
            </select>
          )}
          {estilistas.length === 0 && formData.sede_id && !loadingEstilistas && !estilistaId && !esEstilista && !isEditing && (
            <p className="mt-1 text-sm text-gray-800">
              No hay estilistas disponibles en esta sede
            </p>
          )}
        </div>

        {/* Fecha */}
        <div>
          <label className={fieldLabelClass}>
            Fecha
          </label>
          <DatePicker
            value={formData.fecha}
            onChange={(v) => handleInputChange('fecha', v)}
            min={isEditing ? undefined : toLocalYMD(new Date())}
            disabled={isEditing}
          />
          {isEditing && (
            <p className="mt-1 text-xs text-gray-600">
              La fecha no se puede editar en este flujo.
            </p>
          )}
        </div>

        {/* Recurrencia */}
        {!isEditing && (
        <div className={`${useCompactView ? "p-2.5 rounded-md space-y-2.5" : "p-3 rounded-lg space-y-3"} border border-gray-300 bg-gray-50`}>
          <label className={`flex items-center gap-2 ${useCompactView ? "text-xs" : "text-sm"} font-medium text-gray-800`}>
            <input
              type="checkbox"
              checked={isRecurrent}
              onChange={(e) => setIsRecurrent(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500"
            />
            ¿Bloqueo recurrente?
          </label>

          {isRecurrent && (
            <>
              <div>
                <p className={`${useCompactView ? "text-xs mb-1.5" : "text-sm mb-2"} font-medium text-gray-800`}>Repetir en días</p>
                <div className={useCompactView ? "grid grid-cols-1 gap-2" : "grid grid-cols-2 gap-2 sm:grid-cols-4"}>
                  {DIAS_SEMANA.map((day) => (
                    <label
                      key={day.value}
                      className={`flex items-center gap-2 ${useCompactView ? "text-xs px-2 py-1.5 rounded-md" : "text-sm px-2 py-1.5 rounded"} text-gray-700 bg-white border border-gray-200`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedDays.includes(day.value)}
                        onChange={() => handleToggleDay(day.value)}
                        className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500"
                      />
                      {day.label}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className={fieldLabelClass}>
                  Repetir hasta
                </label>
                <DatePicker
                  value={repeatUntil}
                  onChange={(v) => setRepeatUntil(v)}
                  min={formData.fecha || toLocalYMD(new Date())}
                />
              </div>

              <div className={`rounded border border-gray-200 bg-white ${useCompactView ? "p-2 text-[11px]" : "p-2 text-xs"} text-gray-700`}>
                Se crearán <span className="font-semibold">{bloqueoRecurrenteEstimado}</span> bloqueos entre{" "}
                <span className="font-semibold">{formData.fecha || "fecha inicial"}</span> y{" "}
                <span className="font-semibold">{repeatUntil || "fecha final"}</span>.
              </div>
            </>
          )}
        </div>
        )}

        {/* Horas */}
        <div className={useCompactView ? "space-y-3" : "grid grid-cols-2 gap-3"}>
          <div>
            <label className={fieldLabelClass}>
              Hora inicio
            </label>
            <TimeInputWithPicker
              value={formData.hora_inicio}
              onChange={(e) => handleInputChange('hora_inicio', e.target.value)}
              required
              inputClassName={controlClass}
              showButton={false}
              openPickerOnInputClick
            />
          </div>
          <div>
            <label className={fieldLabelClass}>
              Hora fin
            </label>
            <TimeInputWithPicker
              value={formData.hora_fin}
              onChange={(e) => handleInputChange('hora_fin', e.target.value)}
              required
              min={minHoraFin}
              inputClassName={controlClass}
              showButton={false}
              openPickerOnInputClick
            />
          </div>
        </div>
        <p className={`${useCompactView ? "text-[11px]" : "text-xs"} text-gray-500`}>
          Horario: {formatAgendaTime(formData.hora_inicio)} - {formatAgendaTime(formData.hora_fin)}
        </p>

        {/* Mensaje */}
        {mensaje && (
          <div className={`${useCompactView ? "p-2.5 text-xs rounded-md" : "p-3 text-sm rounded-lg"} text-center font-medium border ${
            mensaje.includes("✅") ? "bg-gray-100 text-gray-900 border-gray-300" : "bg-gray-100 text-gray-900 border-gray-300"
          }`}>
            {mensaje}
          </div>
        )}

        {/* Botones */}
        <div className={useCompactView ? "space-y-2 mt-4 pt-3 border-t border-gray-300" : "flex justify-end space-x-3 mt-6 pt-4 border-t border-gray-300"}>
          <button
            type="button"
            onClick={onClose}
            className={`${useCompactView ? "w-full h-12 px-4 text-sm rounded-xl" : "px-6 py-2.5 rounded-lg"} border border-gray-300 text-gray-800 font-medium transition-colors`}
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading || loadingSedes || loadingEstilistas}
            className={`${useCompactView ? "w-full h-12 px-4 text-sm rounded-xl" : "px-6 py-2.5 rounded-lg"} bg-black text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
          >
            {loading
              ? isEditing
                ? "Actualizando bloqueo..."
                : "Creando bloqueo..."
              : isEditing
                ? "Guardar cambios"
                : isRecurrent
                  ? "Crear bloqueos"
                  : "Crear bloqueo"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default React.memo(Bloqueos);
