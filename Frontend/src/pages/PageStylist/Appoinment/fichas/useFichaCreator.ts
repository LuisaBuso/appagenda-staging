// src/hooks/useFichaCreator.ts
"use client";

import { useState } from 'react';
import { API_BASE_URL } from '../../../../types/config';

// ⭐ NUEVO: Interfaz para servicios
interface ServicioEnFicha {
  servicio_id: string;
  nombre?: string;
  precio?: number;
}

interface FichaBaseData {
  cliente_id: string;
  profesional_id: string;
  sede_id: string;
  tipo_ficha: 'COLOR' | 'CORTE' | 'TRATAMIENTO' | 'MASAJE' | 'OTRO';
  
  // ⭐ CAMBIO: Ahora puede recibir uno o múltiples servicios
  servicio_id?: string;  // Mantener para compatibilidad
  servicios?: ServicioEnFicha[];  // NUEVO: Array de servicios
  
  [key: string]: any;
}

interface UseFichaCreatorProps {
  onSuccess?: (data: any) => void;
  onError?: (error: string) => void;
}

export function useFichaCreator({ onSuccess, onError }: UseFichaCreatorProps = {}) {
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const createFicha = async (
    fichaData: FichaBaseData,
    fotosAntes: File[] = [],
    fotosDespues: File[] = []
  ) => {
    try {
      setLoading(true);
      setUploadProgress(0);

      const token = localStorage.getItem("access_token") || sessionStorage.getItem("access_token");
      
      if (!token) {
        throw new Error('No hay token de autenticación. Por favor, inicia sesión nuevamente.');
      }

      // ⭐ PREPARAR DATOS: Convertir servicio_id a servicios si es necesario
      const dataToSend = { ...fichaData };
      
      // Si viene servicio_id único, convertirlo a array
      if (fichaData.servicio_id && !fichaData.servicios) {
        dataToSend.servicios = [{
          servicio_id: fichaData.servicio_id,
          nombre: fichaData.servicio_nombre,
          precio: fichaData.precio
        }];
        // Mantener servicio_id para compatibilidad
        console.log('🔄 Convirtiendo servicio_id único a array:', dataToSend.servicios);
      }
      
      // Si viene servicios (array), usarlo directamente
      if (fichaData.servicios && fichaData.servicios.length > 0) {
        console.log('✅ Usando array de servicios:', dataToSend.servicios);
      }

      // Validar que tenga al menos un servicio
      if (!dataToSend.servicios || dataToSend.servicios.length === 0) {
        throw new Error('Debe especificar al menos un servicio');
      }

      console.log('📤 Datos a enviar:', {
        ...dataToSend,
        fotosAntes: fotosAntes.length,
        fotosDespues: fotosDespues.length
      });

      // 1. Crear FormData para enviar archivos
      const formData = new FormData();

      // 2. Agregar las fotos "antes"
      fotosAntes.forEach((file) => {
        formData.append(`fotos_antes`, file);
      });

      // 3. Agregar las fotos "después"
      fotosDespues.forEach((file) => {
        formData.append(`fotos_despues`, file);
      });

      // 4. Agregar los datos de la ficha como JSON stringify
      formData.append('data', JSON.stringify(dataToSend));

      // 5. Enviar la petición
      const response = await fetch(`${API_BASE_URL}scheduling/quotes/create-ficha`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          // NO incluir 'Content-Type': FormData lo establecerá automáticamente con boundary
        },
        body: formData,
      });

      // 6. Manejar progreso de subida
      if (response.body) {
        const reader = response.body.getReader();
        const contentLength = parseInt(response.headers.get('Content-Length') || '0', 10);
        
        let receivedLength = 0;
        const chunks = [];
        
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            break;
          }
          
          chunks.push(value);
          receivedLength += value.length;
          
          if (contentLength) {
            setUploadProgress(Math.round((receivedLength / contentLength) * 100));
          }
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Error del servidor:', errorText);
        
        // Intentar parsear el error como JSON
        let errorMessage = `Error ${response.status}`;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.detail || errorData.message || errorText;
        } catch {
          errorMessage = errorText || response.statusText;
        }
        
        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log('✅ Ficha creada:', data);
      
      if (data.success) {
        if (onSuccess) {
          onSuccess(data);
        }
        return data;
      } else {
        throw new Error(data.message || 'Error al crear la ficha');
      }

    } catch (error) {
      console.error('❌ Error al crear ficha:', error);
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      
      if (onError) {
        onError(errorMessage);
      }
      
      throw error;
    } finally {
      setLoading(false);
      setUploadProgress(0);
    }
  };

  return {
    createFicha,
    loading,
    uploadProgress,
  };
}

// ⭐ HELPER: Función para crear datos de ficha desde una cita
export function prepararFichaDesdeServicioUnico(
  servicio_id: string,
  servicio_nombre?: string,
  precio?: number
): ServicioEnFicha[] {
  return [{
    servicio_id,
    nombre: servicio_nombre,
    precio
  }];
}

// ⭐ EJEMPLO DE USO:
/*
// Opción 1: Con servicio único (compatibilidad)
const fichaData = {
  cliente_id: "CL-123",
  profesional_id: "ES-456",
  sede_id: "SD-789",
  servicio_id: "SV-001",  // Se convertirá automáticamente a array
  tipo_ficha: "CORTE"
};

// Opción 2: Con múltiples servicios (nuevo formato)
const fichaData = {
  cliente_id: "CL-123",
  profesional_id: "ES-456",
  sede_id: "SD-789",
  servicios: [
    { servicio_id: "SV-001", nombre: "CORTE", precio: 50000 },
    { servicio_id: "SV-002", nombre: "BARBA", precio: 35000 }
  ],
  tipo_ficha: "CORTE"
};
*/
