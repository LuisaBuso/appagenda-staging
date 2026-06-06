"use client";

import { Clock, PlayCircle, Ban, Trash2, X, UserX, CheckCircle, Tag, Pencil, FileText, AlertCircle } from "lucide-react";
import { Cita } from '../../../types/fichas';
import { Bloqueo, deleteBloqueo } from '../../../components/Quotes/bloqueosApi';
import { useState } from "react";
import { toast } from "sonner";
import { confirmAction } from "../../../components/ui/confirm-dialog";
import BloqueosModal from "../../../components/Quotes/Bloqueos";
import BottomSheet from "../../../components/ui/bottom-sheet";

interface AppointmentsListProps {
  appointments: Cita[];
  bloqueos: Bloqueo[];
  onCitaSelect: (cita: Cita) => void;
  citaSeleccionada: Cita | null;
  fechaFiltro?: string;
  citasValidacion?: Cita[];
  onBloqueoEliminado?: (bloqueoId?: string) => void;
  onBloqueoActualizado?: (bloqueo: Bloqueo) => void;
}

// 🔥 HELPER: Obtener nombres de servicios
const obtenerNombresServicios = (cita: any): string => {
  // Si tiene array de servicios (NUEVO FORMATO)
  if (cita.servicios && Array.isArray(cita.servicios) && cita.servicios.length > 0) {
    return cita.servicios.map((s: any) => s.nombre).join(', ');
  }
  
  // Si tiene servicio único (FORMATO ANTIGUO)
  if (cita.servicio?.nombre) {
    return cita.servicio.nombre;
  }
  
  return 'Sin servicio';
};

// 🔥 HELPER: Calcular precio total
const calcularPrecioTotal = (cita: any): number => {
  const valor =
    cita.valor_total ||
    cita.precio_total ||
    0;

  if (valor > 1) return valor;

  // Si viene en servicios, considerar subtotal como prioridad
  if (cita.servicios && Array.isArray(cita.servicios) && cita.servicios.length > 0) {
    const totalServicios = cita.servicios.reduce((total: number, servicio: any) => {
      const subtotal = servicio.subtotal ?? servicio.precio ?? servicio.precio_local ?? 0;
      return total + subtotal;
    }, 0);
    if (totalServicios > 0) return totalServicios;
  }

  if (cita.servicio?.precio) return cita.servicio.precio;

  return valor; // 0 o 1 si no hay datos
};

export function AppointmentsList({ 
  appointments, 
  bloqueos, 
  onCitaSelect, 
  citaSeleccionada, 
  fechaFiltro,
  citasValidacion = [],
  onBloqueoEliminado,
  onBloqueoActualizado,
}: AppointmentsListProps) {
  const [bloqueoAEliminar, setBloqueoAEliminar] = useState<Bloqueo | null>(null);
  const [bloqueoEditando, setBloqueoEditando] = useState<Bloqueo | null>(null);
  const [mostrarModalEdicion, setMostrarModalEdicion] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const getAuthToken = () => {
    return localStorage.getItem('access_token') || 
           sessionStorage.getItem('access_token') || 
           '';
  };

  const handleEditBloqueo = (bloqueo: Bloqueo) => {
    if (!bloqueo._id) {
      toast.error("No se puede editar: bloqueo sin ID");
      return;
    }
    setBloqueoEditando(bloqueo);
    setMostrarModalEdicion(true);
  };

  const handleCloseEditModal = () => {
    setMostrarModalEdicion(false);
    setBloqueoEditando(null);
  };

  const handleBloqueoGuardado = (bloqueoActualizado: Bloqueo) => {
    onBloqueoActualizado?.(bloqueoActualizado);
  };

  const handleEliminarBloqueo = async (bloqueo: Bloqueo) => {
    if (!bloqueo._id) {
      console.error("No se puede eliminar: bloqueo sin ID");
      return;
    }

    const confirmar = await confirmAction({
      title: "Eliminar bloqueo",
      message: `¿Eliminar bloqueo de ${bloqueo.hora_inicio} a ${bloqueo.hora_fin}? Motivo: ${bloqueo.motivo}`,
      confirmLabel: "Sí, eliminar",
      variant: "danger",
    });

    if (!confirmar) return;

    try {
      setEliminando(true);
      setBloqueoAEliminar(bloqueo);
      const token = getAuthToken();
      
      if (!token) {
        toast.error("No hay token de autenticación");
        return;
      }

      await deleteBloqueo(bloqueo._id, token);

      if (onBloqueoEliminado) {
        onBloqueoEliminado(bloqueo._id);
      }

      toast.success("Bloqueo eliminado");

    } catch (error) {
      console.error("Error eliminando bloqueo:", error);
      toast.error(error instanceof Error ? error.message : "Error desconocido");
    } finally {
      setEliminando(false);
      setBloqueoAEliminar(null);
    }
  };

  const getEstadoCita = (cita: Cita) => {
    if (cita.estado) {
      const estadoNormalizado = cita.estado.toLowerCase().trim();

      switch (estadoNormalizado) {
        case "cancelada":
        case "cancelado":
          return {
            estado: "Cancelada",
            color: "text-red-700",
            icon: X,
            borderColor: "border-red-200 bg-red-50"
          };

        case "facturada":
        case "facturado":
          return {
            estado: "Facturada",
            color: "text-gray-700",
            icon: Tag,
            borderColor: "border-gray-200 bg-gray-50"
          };

        case "no asistio":
        case "no_asistio":
        case "no asistió":
          return {
            estado: "No Asistió",
            color: "text-yellow-700",
            icon: UserX,
            borderColor: "border-yellow-200 bg-yellow-50"
          };

        case "finalizada":
        case "finalizado":
        case "completada":
        case "completado":
        case "terminada":
        case "terminado":
        case "realizada":
        case "realizado":
          return {
            estado: "Finalizada",
            color: "text-orange-700",
            icon: CheckCircle,
            borderColor: "border-orange-200 bg-orange-50"
          };

        case "en proceso":
        case "en_proceso":
        case "en curso":
          return {
            estado: "En proceso",
            color: "text-green-800",
            icon: PlayCircle,
            borderColor: "border-green-200 bg-green-50"
          };

        case "pre_reservada":
        case "pre-reservada":
        case "pre_cita":
        case "precita":
          return {
            estado: "Pre-cita",
            color: "text-gray-600",
            icon: AlertCircle,
            borderColor: "border-gray-300 bg-gray-100"
          };

        case "pendiente":
        case "reservada":
        case "reservada/pendiente":
        case "confirmada":
        case "agendada":
        case "agendado":
          return {
            estado: "Agendada/Confirmada",
            color: "text-green-700",
            icon: Clock,
            borderColor: "border-green-200 bg-green-50"
          };
      }
    }
    
    try {
      const ahora = new Date();
      const fechaCita = new Date(cita.fecha);
      
      const [horaInicio, minutoInicio] = cita.hora_inicio.split(':').map(Number);
      const [horaFin, minutoFin] = cita.hora_fin.split(':').map(Number);
      
      const inicioCita = new Date(fechaCita);
      inicioCita.setHours(horaInicio, minutoInicio, 0, 0);
      
      const finCita = new Date(fechaCita);
      finCita.setHours(horaFin, minutoFin, 0, 0);
      
      if (ahora < inicioCita) {
        return { 
          estado: "Agendada/Confirmada", 
          color: "text-green-700", 
          icon: Clock,
          borderColor: "border-green-200 bg-green-50"
        };
      } else if (ahora >= inicioCita && ahora <= finCita) {
        return { 
          estado: "En proceso", 
          color: "text-green-800", 
          icon: PlayCircle,
          borderColor: "border-green-200 bg-green-50"
        };
      } else {
        return { 
          estado: "Finalizada", 
          color: "text-orange-700", 
          icon: CheckCircle,
          borderColor: "border-orange-200 bg-orange-50"
        };
      }
    } catch (error) {
      return { 
        estado: "Agendada/Confirmada", 
        color: "text-green-700", 
        icon: Clock,
        borderColor: "border-green-200 bg-green-50"
      };
    }
  };

  const elementosCombinados = [
    ...appointments.map(cita => ({ 
      type: 'cita', 
      data: cita,
      horaInicio: cita.hora_inicio || "00:00",
      id: cita.cita_id 
    })),
    ...bloqueos.map(bloqueo => ({ 
      type: 'bloqueo', 
      data: bloqueo,
      horaInicio: bloqueo.hora_inicio || "00:00",
      id: bloqueo._id || `bloqueo-${bloqueo.hora_inicio}`
    }))
  ].sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));

  if (elementosCombinados.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 text-center">
          <div className="text-gray-300 mb-2">
            <svg className="w-10 h-10 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="font-medium text-gray-700 mb-1 text-sm">
            {fechaFiltro 
              ? `No hay citas ni bloqueos para esta fecha`
              : "No hay citas ni bloqueos programados"
            }
          </h3>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="space-y-3">
      {bloqueos.length > 0 && (
        <div className="flex items-center gap-1 rounded-xl bg-gray-100 px-3 py-2 text-xs text-gray-600">
          <Ban className="h-3 w-3" />
          <span className="ml-1">{bloqueos.length} bloqueo(s) configurado(s)</span>
        </div>
      )}

      {elementosCombinados.map((elemento) => {
        if (elemento.type === 'cita') {
          const appointment = elemento.data as Cita;
          const estadoInfo = getEstadoCita(appointment);
          const IconComponent = estadoInfo.icon;
          const estadoNormalizado = (appointment.estado || "").toLowerCase().trim();
          const citaCancelada = estadoNormalizado.includes("cancel");
          const citaSeleccionadaActual = citaSeleccionada?.cita_id === appointment.cita_id;
          const nombreCliente = appointment.cliente?.nombre || "Cliente";
          const apellidoCliente = appointment.cliente?.apellido || "";
          const emailCliente =
            appointment.cliente?.email ||
            ((appointment as any).cliente_email ?? "");
          const baseNotaRaw =
            (appointment as any).notas_call_center ||
            (appointment as any).nota_call_center ||
            (appointment as any).notasCallCenter ||
            appointment.comentario ||
            (appointment as any).comentarios ||
            (appointment as any).notas ||
            (appointment as any).nota ||
            (appointment as any).observaciones ||
            "";
          const baseNota = baseNotaRaw?.toString().trim();
          const notaCita = baseNota || "";
          
          // 🔥 CAMBIO CRÍTICO: Usar helper para obtener TODOS los servicios
          const nombresServicios = obtenerNombresServicios(appointment);
          const precioTotal = calcularPrecioTotal(appointment);
          
          // 🔥 Contar cantidad de servicios
          const cantidadServicios = appointment.servicios?.length || 1;

          return (
            <div
              key={appointment.cita_id}
              className={`cursor-pointer overflow-hidden rounded-2xl border bg-white p-4 transition-transform active:scale-[0.99] ${
                citaCancelada
                  ? (citaSeleccionadaActual ? "border-red-500" : "border-red-300")
                  : (citaSeleccionadaActual ? "border-gray-900" : "border-gray-200")
              }`}
              onClick={() => onCitaSelect(appointment)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    {/* 🔥 MOSTRAR SERVICIOS CON BADGE SI HAY MÚLTIPLES */}
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <h3
                        className={`line-clamp-2 text-sm font-semibold ${
                          citaCancelada ? "text-red-700" : "text-gray-900"
                        }`}
                      >
                        {nombresServicios}
                      </h3>
                      {cantidadServicios > 1 && (
                        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-[10px] font-semibold text-gray-700">
                          {cantidadServicios}
                        </span>
                      )}
                    </div>
                    
                    {precioTotal > 0 && (
                      <div
                        className={`ml-2 flex shrink-0 items-center gap-1 text-xs font-medium ${
                          citaCancelada ? "text-red-700" : "text-gray-700"
                        }`}
                      >
                        <Tag className="h-3 w-3" />
                        <span>${precioTotal.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                  
                  <div className="mb-2">
                    <div
                      className={`truncate text-xs font-medium ${
                        citaCancelada ? "text-red-700" : "text-gray-700"
                      }`}
                    >
                      {nombreCliente} {apellidoCliente}
                    </div>
                    {emailCliente && (
                      <div
                        className={`truncate text-[11px] ${
                          citaCancelada ? "text-red-600" : "text-gray-500"
                        }`}
                      >
                        {emailCliente}
                      </div>
                    )}
                  </div>

                  {notaCita ? (
                    <div className="mb-2 flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700">
                      <FileText className="mt-[1px] h-3.5 w-3.5 text-gray-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-800">Nota call center</p>
                        <p className="whitespace-pre-wrap break-words text-xs text-gray-700">{notaCita}</p>
                      </div>
                    </div>
                  ) : null}
                  
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div
                      className={`flex items-center gap-2 text-xs ${
                        citaCancelada ? "text-red-600" : "text-gray-500"
                      }`}
                    >
                      <Clock className="h-3 w-3" />
                      <span>{appointment.hora_inicio} - {appointment.hora_fin}</span>
                    </div>
                    
                    <div className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${estadoInfo.borderColor} ${estadoInfo.color}`}>
                      <IconComponent className="h-3 w-3" />
                      <span className="truncate max-w-[110px]">{estadoInfo.estado}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        } else {
          // BLOQUEO
          const bloqueo = elemento.data as Bloqueo;
          
          return (
            <div
              key={bloqueo._id}
              className="overflow-hidden rounded-2xl border border-gray-300 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex items-start gap-2">
                  <Ban className="h-3.5 w-3.5 text-gray-500" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800">
                        {bloqueo.hora_inicio} - {bloqueo.hora_fin}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 break-words text-xs text-gray-600">{bloqueo.motivo}</p>
                  </div>
                </div>
                
                <div className="ml-2 flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleEditBloqueo(bloqueo)}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gray-300 text-gray-700 active:scale-[0.98]"
                    aria-label="Editar bloqueo"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEliminarBloqueo(bloqueo)}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gray-300 text-gray-700 active:scale-[0.98]"
                    aria-label="Eliminar bloqueo"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              
              {eliminando && bloqueoAEliminar?._id === bloqueo._id && (
                <div className="mt-1 text-xs text-gray-600 flex items-center gap-1">
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-600"></div>
                  Eliminando...
                </div>
              )}
            </div>
          );
        }
      })}
    </div>

    <BottomSheet
      open={mostrarModalEdicion}
      onClose={handleCloseEditModal}
      title="Editar bloqueo"
    >
      {bloqueoEditando && (
        <BloqueosModal
          onClose={handleCloseEditModal}
          compact
          estilistaId={bloqueoEditando.profesional_id}
          fecha={bloqueoEditando.fecha?.split("T")[0]}
          horaInicio={bloqueoEditando.hora_inicio}
          editingBloqueo={bloqueoEditando}
          citasExistentes={citasValidacion}
          onBloqueoGuardado={(bloqueo, action) => {
            if (action === "update") {
              handleBloqueoGuardado(bloqueo);
            }
          }}
        />
      )}
    </BottomSheet>
    </>
  );
}
