// src/hooks/useFichasCliente.ts
"use client";

import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../../../types/config';

// ⭐ NUEVA INTERFAZ: Servicio en ficha
interface ServicioEnFicha {
  servicio_id: string;
  nombre: string;
  precio: number;
}

interface FichaCliente {
  id: string;
  cliente_id: string;
  nombre: string;
  apellido: string | null;
  telefono: string;
  cedula: string;
  
  // ⭐ CAMBIO: Ahora soporta múltiples servicios
  servicios: ServicioEnFicha[];  // NUEVO: Array de servicios
  
  // ⭐ COMPATIBILIDAD: Mantener campos antiguos
  servicio_id?: string;  // Opcional para compatibilidad
  servicio_nombre?: string;  // Opcional para compatibilidad
  
  profesional_id: string;
  sede_id: string;
  fecha_ficha: string;
  fecha_reserva: string;
  tipo_ficha: string;
  precio: number;
  estado: string;
  estado_pago: string;
  contenido: any;
  profesional_nombre: string;
  sede_nombre: string;
  cita_id?: string;  // ⭐ NUEVO: Para vincular con citas
}

interface UseFichasClienteProps {
  cliente_id?: string;
  cita_id?: string;  // ⭐ NUEVO: Filtrar por cita específica
  fecha?: string;  // ⭐ NUEVO: Filtrar por fecha
  solo_hoy?: boolean;  // ⭐ NUEVO: Solo fichas de hoy
  limit?: number;  // ⭐ NUEVO: Límite de resultados
}

export function useFichasCliente({ 
  cliente_id, 
  cita_id,
  fecha,
  solo_hoy = false,
  limit = 10
}: UseFichasClienteProps) {
  const [fichas, setFichas] = useState<FichaCliente[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFichas = useCallback(async () => {
    if (!cliente_id) {
      setFichas([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const token = localStorage.getItem("access_token") || sessionStorage.getItem("access_token");
      
      if (!token) {
        throw new Error('No hay token de autenticación');
      }

      // ⭐ CONSTRUIR QUERY PARAMS DINÁMICAMENTE
      const params = new URLSearchParams({
        cliente_id,
        limit: limit.toString()
      });

      if (cita_id) params.append('cita_id', cita_id);
      if (fecha) params.append('fecha', fecha);
      if (solo_hoy) params.append('solo_hoy', 'true');

      console.log('🔍 Buscando fichas con params:', params.toString());

      const response = await fetch(
        `${API_BASE_URL}fichas?${params.toString()}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error ${response.status}: ${errorText || response.statusText}`);
      }

      const data = await response.json();
      console.log('✅ Fichas recibidas:', data);
      
      if (data.success && Array.isArray(data.fichas)) {
        // ⭐ NORMALIZAR DATOS: Asegurar que todas las fichas tengan array de servicios
        const fichasNormalizadas = data.fichas.map((ficha: any) => {
          // Si tiene array de servicios, usarlo
          if (ficha.servicios && Array.isArray(ficha.servicios)) {
            return ficha;
          }
          
          // Si solo tiene servicio_id, convertirlo a array
          if (ficha.servicio_id) {
            return {
              ...ficha,
              servicios: [{
                servicio_id: ficha.servicio_id,
                nombre: ficha.servicio_nombre || 'Servicio',
                precio: ficha.precio || 0
              }]
            };
          }
          
          // Si no tiene ninguno, array vacío
          return {
            ...ficha,
            servicios: []
          };
        });

        setFichas(fichasNormalizadas);
      } else {
        setFichas([]);
      }
    } catch (err) {
      console.error('❌ Error al cargar fichas del cliente:', err);
      setError(err instanceof Error ? err.message : 'Error desconocido');
      setFichas([]);
    } finally {
      setLoading(false);
    }
  }, [cliente_id, cita_id, fecha, solo_hoy, limit]);

  useEffect(() => {
    if (cliente_id) {
      fetchFichas();
    }
  }, [cliente_id, fetchFichas]);

  return {
    fichas,
    loading,
    error,
    refetch: fetchFichas
  };
}

// ⭐ HELPERS: Funciones auxiliares para trabajar con fichas

/**
 * Obtiene el precio total de una ficha sumando todos los servicios
 */
export function calcularPrecioTotalFicha(ficha: FichaCliente): number {
  if (ficha.servicios && ficha.servicios.length > 0) {
    return ficha.servicios.reduce((total, servicio) => total + servicio.precio, 0);
  }
  return ficha.precio || 0;
}

/**
 * Obtiene una lista concatenada de nombres de servicios
 */
export function obtenerNombresServicios(ficha: FichaCliente): string {
  if (ficha.servicios && ficha.servicios.length > 0) {
    return ficha.servicios.map(s => s.nombre).join(', ');
  }
  return ficha.servicio_nombre || 'Sin servicio';
}

/**
 * Verifica si una ficha tiene múltiples servicios
 */
export function tieneMultiplesServicios(ficha: FichaCliente): boolean {
  return ficha.servicios && ficha.servicios.length > 1;
}

// ⭐ EJEMPLO DE USO:
/*
// Caso 1: Obtener todas las fichas de un cliente
const { fichas, loading, error, refetch } = useFichasCliente({
  cliente_id: "CL-123"
});

// Caso 2: Obtener ficha de una cita específica (para facturación)
const { fichas } = useFichasCliente({
  cliente_id: "CL-123",
  cita_id: "6941c18a..."
});

// Caso 3: Obtener fichas de hoy
const { fichas } = useFichasCliente({
  cliente_id: "CL-123",
  solo_hoy: true
});

// Caso 4: Usar helpers
fichas.forEach(ficha => {
  const total = calcularPrecioTotalFicha(ficha);
  const servicios = obtenerNombresServicios(ficha);
  const multiple = tieneMultiplesServicios(ficha);
  
  console.log(`Ficha: ${servicios} - Total: ${total} - Múltiple: ${multiple}`);
});
*/