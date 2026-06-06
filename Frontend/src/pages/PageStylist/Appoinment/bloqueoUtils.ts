// src/utils/bloqueoUtils.ts
import { Bloqueo } from "../../../components/Quotes/bloqueosApi";

// Verificar si un horario está bloqueado
export const isHorarioBloqueado = (
  profesionalId: string,
  fecha: string,
  horaInicio: string,
  horaFin: string,
  bloqueos: Bloqueo[]
): boolean => {
  if (!bloqueos.length) return false;

  const [horaInicioCita, minutoInicioCita] = horaInicio.split(':').map(Number);
  const [horaFinCita, minutoFinCita] = horaFin.split(':').map(Number);
  
  // Buscar bloqueos para este profesional y fecha
  const bloqueosDelDia = bloqueos.filter(b => 
    b.profesional_id === profesionalId && 
    b.fecha === fecha
  );

  // Verificar cada bloqueo
  for (const bloqueo of bloqueosDelDia) {
    const [horaInicioBloqueo, minutoInicioBloqueo] = bloqueo.hora_inicio.split(':').map(Number);
    const [horaFinBloqueo, minutoFinBloqueo] = bloqueo.hora_fin.split(':').map(Number);
    
    // Convertir a minutos para facilitar la comparación
    const inicioCitaMin = horaInicioCita * 60 + minutoInicioCita;
    const finCitaMin = horaFinCita * 60 + minutoFinCita;
    const inicioBloqueoMin = horaInicioBloqueo * 60 + minutoInicioBloqueo;
    const finBloqueoMin = horaFinBloqueo * 60 + minutoFinBloqueo;
    
    // Verificar solapamiento
    if (inicioCitaMin < finBloqueoMin && finCitaMin > inicioBloqueoMin) {
      return true; // Hay solapamiento
    }
  }
  
  return false;
};

// Obtener bloqueos para un día específico
export const getBloqueosParaFecha = (
  fecha: string,
  bloqueos: Bloqueo[]
): Bloqueo[] => {
  return bloqueos.filter(b => b.fecha === fecha);
};

// Obtener bloqueos para un profesional específico
export const getBloqueosParaProfesional = (
  profesionalId: string,
  bloqueos: Bloqueo[]
): Bloqueo[] => {
  return bloqueos.filter(b => b.profesional_id === profesionalId);
};

// Formatear bloqueos para mostrar en UI
export const formatearBloqueo = (bloqueo: Bloqueo) => {
  return {
    id: bloqueo._id,
    motivo: bloqueo.motivo,
    profesionalId: bloqueo.profesional_id,
    fecha: bloqueo.fecha,
    horaInicio: bloqueo.hora_inicio,
    horaFin: bloqueo.hora_fin,
    sedeId: bloqueo.sede_id,
    creadoPor: bloqueo.creado_por,
    fechaCreacion: bloqueo.fecha_creacion
  };
};