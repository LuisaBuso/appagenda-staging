"use client";

import { useState, useEffect, useCallback } from 'react';
import { Cita } from '../../../types/fichas';
import { API_BASE_URL } from '../../../types/config';
import { facturaService } from '../../PageSede/Sales-invoiced/facturas';
import { toLocalYMD } from '../../../lib/dateFormat';

const getStoredSedeId = () =>
  sessionStorage.getItem("beaux-active-sede_id") ||
  sessionStorage.getItem("beaux-sede_id") ||
  localStorage.getItem("beaux-active-sede_id") ||
  localStorage.getItem("beaux-sede_id") ||
  "";

export function useEstilistaData() {
  const [citas, setCitas] = useState<Cita[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comisionServiciosPct, setComisionServiciosPct] = useState<number | null>(null);
  const [comisionProductosPct, setComisionProductosPct] = useState<number | null>(null);
  const [comisionesPorCategoria, setComisionesPorCategoria] = useState<Record<string, number> | null>(null);
  const [totalesPorCategoriaHoy, setTotalesPorCategoriaHoy] = useState<Record<string, number>>({});
  const [comisionesTotalesHoy, setComisionesTotalesHoy] = useState<number | null>(null);

  const fetchCitas = useCallback(async (isInitial = true) => {
    try {
      if (isInitial) {
        setLoading(true);
      } else {
        setIsRefreshing(true);
      }
      const token = localStorage.getItem("access_token") || sessionStorage.getItem("access_token");
      
      if (!token) {
        throw new Error('No hay token de autenticación.');
      }

      const response = await fetch(`${API_BASE_URL}scheduling/quotes/citas/estilista`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`Error ${response.status}`);
      }
      
      const data = await response.json();
      
      if (Array.isArray(data)) {
        const citasFormateadas = data.map((cita: any) => {
          const notasCallCenter =
            cita.notas_call_center ??
            cita.nota_call_center ??
            cita.notasCallCenter ??
            cita.notas ??
            cita.comentario ??
            cita.comentarios ??
            cita.observaciones ??
            "";

          return {
            cita_id: cita.cita_id || cita._id || "",
            cliente: {
              cliente_id: cita.cliente?.cliente_id || cita.cliente_id || "",
              nombre: cita.cliente?.nombre || cita.cliente_nombre || "",
              apellido: cita.cliente?.apellido || cita.cliente_apellido || "",
              telefono: cita.cliente?.telefono || cita.cliente_telefono || "",
              email: cita.cliente?.email || cita.cliente_email || "",
            },
            servicios: cita.servicios || [], // ✅ Array directo del backend
            precio_total: cita.precio_total || 0,
            cantidad_servicios: cita.cantidad_servicios || 0,
            tiene_precio_personalizado: cita.tiene_precio_personalizado || false,
            sede: cita.sede || { sede_id: cita.sede_id || "", nombre: cita.sede_nombre || "" },
            estilista_id: cita.estilista_id || cita.profesional_id || "",
            profesional_id: cita.profesional_id || cita.estilista_id || "",
            fecha: cita.fecha || "",
            hora_inicio: cita.hora_inicio || "",
            hora_fin: cita.hora_fin || "",
            estado: cita.estado || "",
            comentario: notasCallCenter,
            notas: cita.notas ?? cita.comentarios ?? cita.observaciones ?? "",
            notas_call_center: cita.notas_call_center ?? cita.nota_call_center ?? cita.notasCallCenter ?? "",
          };
        });
        
        const requierePrecioReal = citasFormateadas.some(
          (c) => (c.precio_total ?? 0) <= 1 && (c.servicios?.length ?? 0) > 0
        );

        const citasConPrecio = requierePrecioReal
          ? await hidratarPreciosReales(citasFormateadas, token)
          : citasFormateadas;

        console.log('✅ Citas cargadas:', citasConPrecio);
        setCitas(citasConPrecio);
        setError(null);

        // Calcular totales por categoría de servicios (solo citas de hoy y completadas)
        const hoyStr = new Date().toDateString();
        const categorias: Record<string, number> = {};
        citasConPrecio.forEach((cita: any) => {
          try {
            const fechaCita = new Date(cita.fecha).toDateString();
            const estado = (cita.estado || '').toLowerCase();
            const esHoy = fechaCita === hoyStr;
            const esCompletada = ['completado', 'completada', 'finalizado', 'finalizada', 'terminado', 'terminada', 'realizado', 'realizada'].some((flag) =>
              estado.includes(flag),
            );
            if (!esHoy || !esCompletada) return;

            if (Array.isArray(cita.servicios)) {
              cita.servicios.forEach((srv: any) => {
                const categoria = srv.categoria || srv.categoria_servicio || "Servicios";
                const subtotal = srv.subtotal ?? srv.precio ?? srv.precio_local ?? 0;
                categorias[categoria] = (categorias[categoria] || 0) + Number(subtotal || 0);
              });
            }
          } catch {
            /* ignore */
          }
        });
        setTotalesPorCategoriaHoy(categorias);

        // Intentar obtener la comisión configurada del estilista
        const profesionalIdFromData =
          citasFormateadas[0]?.profesional_id || citasFormateadas[0]?.estilista_id || "";
        const profesionalIdFromStorage =
          localStorage.getItem("beaux-profesional_id") ||
          sessionStorage.getItem("beaux-profesional_id") ||
          "";
        const profesionalId = profesionalIdFromData || profesionalIdFromStorage;

        if (profesionalId) {
          try {
            const profResp = await fetch(`${API_BASE_URL}admin/profesionales/${profesionalId}`, {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
              },
            });

            if (profResp.ok) {
              const profData = await profResp.json();
              const normalize = (value: unknown): number | null => {
                const num = typeof value === "number" ? value : Number(value);
                return Number.isFinite(num) ? num : null;
              };
              setComisionServiciosPct(normalize(profData?.comision));
              setComisionProductosPct(normalize(profData?.comision_productos));
              if (profData?.comisiones_por_categoria && typeof profData.comisiones_por_categoria === "object") {
                setComisionesPorCategoria(profData.comisiones_por_categoria as Record<string, number>);
              }
            }
          } catch (profError) {
            console.error("❌ Error obteniendo comisiones del estilista:", profError);
          }

          // Fetch today's invoices and sum item.comision for this professional
          // (mirrors the logic in Reportes to ensure consistent commission display)
          try {
            const sedeId = getStoredSedeId();
            if (sedeId) {
              const todayStr = toLocalYMD(new Date());
              const facturas = await facturaService.getVentasBySedeAllPages(
                sedeId,
                todayStr,
                todayStr,
                undefined,
                { pageSize: 200 },
              );

              let totalComision = 0;
              let hasAnyComision = false;

              for (const factura of facturas) {
                const facturaProId = factura.profesional_id
                  ? String(factura.profesional_id).trim().toLowerCase()
                  : "";
                const belongsToPro =
                  facturaProId === String(profesionalId).trim().toLowerCase();

                const items = Array.isArray(factura.items) ? factura.items : [];
                for (const item of items) {
                  const itemProId = item.profesional_id
                    ? String(item.profesional_id).trim().toLowerCase()
                    : "";
                  const itemBelongs = itemProId
                    ? itemProId === String(profesionalId).trim().toLowerCase()
                    : belongsToPro;

                  if (itemBelongs) {
                    const c = item.comision;
                    if (typeof c === "number" && Number.isFinite(c)) {
                      totalComision += c;
                      hasAnyComision = true;
                    }
                  }
                }
              }

              setComisionesTotalesHoy(hasAnyComision ? totalComision : null);
            }
          } catch {
            // not critical — widget will fall back to percentage calc
          }
        }
      }
    } catch (err) {
      console.error('❌ Error:', err);
      setError(err instanceof Error ? err.message : 'Error desconocido');
      setCitas([]);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchCitas(true);
  }, [fetchCitas]);

  // Polling automático cada 30 segundos + event listeners para cambios de estado
  useEffect(() => {
    // Polling cada 30 segundos para detectar cambios hechos por admin/call center
    const pollInterval = setInterval(() => {
      fetchCitas(false); // Recarga silenciosa sin mostrar spinner
    }, 30000);

    // Recargar inmediatamente cuando el usuario vuelve al foco
    const handleFocus = () => {
      fetchCitas(false);
    };

    // Recargar cuando la app vuelve a ser visible (minimizada/maximizada)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchCitas(false);
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(pollInterval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchCitas]);

  const getCurrentToken = useCallback(() => {
    return localStorage.getItem("access_token") || sessionStorage.getItem("access_token");
  }, []);

  const updateCitaStatus = useCallback(async (cita_id: string, action: string) => {
    try {
      const token = getCurrentToken();
      if (!token) throw new Error('No hay token');

      const response = await fetch(`${API_BASE_URL}scheduling/quotes/${cita_id}/${action}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) throw new Error(`Error ${response.status}`);
      
      const data = await response.json();
      
      if (data.success) {
        setCitas(prevCitas => 
          prevCitas.map(cita => 
            cita.cita_id === cita_id 
              ? { ...cita, estado: action === 'confirmar' ? 'Confirmado' : 
                                  action === 'cancelar' ? 'Cancelado' :
                                  action === 'completar' ? 'Completado' :
                                  action === 'no-asistio' ? 'No Asistió' : cita.estado }
              : cita
          )
        );
        return { success: true, data };
      }
      
      throw new Error(data.message || 'Error al actualizar');
    } catch (err) {
      console.error('❌ Error:', err);
      throw err;
    }
  }, [getCurrentToken]);

  const confirmarCita = useCallback((cita_id: string) => 
    updateCitaStatus(cita_id, 'confirmar'), [updateCitaStatus]);
  
  const cancelarCita = useCallback((cita_id: string) => 
    updateCitaStatus(cita_id, 'cancelar'), [updateCitaStatus]);
  
  const completarCita = useCallback((cita_id: string) => 
    updateCitaStatus(cita_id, 'completar'), [updateCitaStatus]);
  
  const marcarNoAsistio = useCallback((cita_id: string) => 
    updateCitaStatus(cita_id, 'no-asistio'), [updateCitaStatus]);

  // Estadísticas simples
  const citasHoy = citas.filter(cita => {
    try {
      const fechaCita = new Date(cita.fecha).toDateString();
      const hoy = new Date().toDateString();
      return fechaCita === hoy;
    } catch {
      return false;
    }
  }).length;

  const serviciosCompletadosHoy = citas.filter(cita => {
    try {
      const fechaCita = new Date(cita.fecha).toDateString();
      const hoy = new Date().toDateString();
      const estado = (cita.estado || '').toLowerCase();
      return fechaCita === hoy && ['completado', 'completada', 'finalizado', 'finalizada'].includes(estado);
    } catch {
      return false;
    }
  }).length;

  const totalVentasHoy = citas
    .filter(cita => {
      try {
        const fechaCita = new Date(cita.fecha).toDateString();
        const hoy = new Date().toDateString();
        const estado = (cita.estado || '').toLowerCase();
        return fechaCita === hoy && ['completado', 'completada', 'finalizado', 'finalizada'].includes(estado);
      } catch {
        return false;
      }
    })
    .reduce((total, cita) => total + (cita.precio_total || 0), 0);

  return {
    citas,
    citasHoy,
    serviciosCompletadosHoy,
    totalVentasHoy,
    comisionServiciosPct,
    comisionProductosPct,
    comisionesPorCategoria,
    totalesPorCategoriaHoy,
    comisionesTotalesHoy,
    loading,
    isRefreshing,
    error,
    refetchCitas: fetchCitas,
    confirmarCita,
    cancelarCita,
    completarCita,
    marcarNoAsistio,
    getCurrentToken,
  };
}

// 🔥 Si el endpoint de estilista devuelve precio 0/1, traer el valor real desde /scheduling/quotes
const hidratarPreciosReales = async (citas: any[], token: string) => {
  const citasPorFecha: Record<string, any[]> = {};

  citas.forEach((cita) => {
    if (!cita.fecha) return;
    if (!citasPorFecha[cita.fecha]) citasPorFecha[cita.fecha] = [];
    citasPorFecha[cita.fecha].push(cita);
  });

  const resultado = [...citas];

  for (const [fecha, citasDia] of Object.entries(citasPorFecha)) {
    const profesionalId = citasDia[0].profesional_id || citasDia[0].estilista_id;
    if (!profesionalId) continue;

    try {
      const resp = await fetch(
        `${API_BASE_URL}scheduling/quotes/?profesional_id=${profesionalId}&fecha=${fecha}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        }
      );

      if (!resp.ok) continue;
      const payload = await resp.json();
      const citasBackend: any[] = payload?.citas || [];

      citasBackend.forEach((raw) => {
        const rawId = raw.cita_id || raw._id || raw.id;
        const precioReal =
          raw.valor_total ||
          raw.precio_total ||
          (Array.isArray(raw.servicios)
            ? raw.servicios.reduce(
                (sum: number, s: any) =>
                  sum +
                  (s.subtotal ||
                    s.precio ||
                    s.precio_local ||
                    0),
                0
              )
            : 0);

        if (!precioReal || !rawId) return;

        const idx = resultado.findIndex(
          (c) => c.cita_id === rawId || c.cita_id === String(rawId)
        );

        if (idx !== -1) {
          resultado[idx] = {
            ...resultado[idx],
            precio_total: precioReal,
            valor_total: precioReal,
          };
        }
      });
    } catch (error) {
      console.warn('No se pudo hidratar precios para', fecha, error);
    }
  }

  return resultado;
};
