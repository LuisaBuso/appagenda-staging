"use client"

// Filtros del módulo de Comisiones (ADMIN_SEDE).
// No pide sede porque la sede activa viene del token; solo arma filtros de profesional, tipo y fechas.

import { useState, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select"
import { PeriodoSelector, type PeriodoId } from "../../../components/ui/PeriodoSelector";
import { profesionalesService } from "./Api/profesionalesService";
import { Professional } from "../../../types/commissions";
import { formatLocalDate } from "../../../lib/dateFormat";

interface ComisionesFiltersProps {
  onFiltersChange?: (filters: {
    profesional_id?: string;
    sede_id?: string;
    estado?: string;
    tipo_comision?: string;
    fecha_inicio?: string;
    fecha_fin?: string;
  }) => void;
}

export function ComisionesFilters({ onFiltersChange }: ComisionesFiltersProps) {
  const [estilistaSeleccionado, setEstilistaSeleccionado] = useState<string>("placeholder");
  const [tipoComisionSeleccionado, setTipoComisionSeleccionado] = useState<string>("placeholder");
  const [fechaInicio, setFechaInicio] = useState<string>("");
  const [fechaFin, setFechaFin] = useState<string>("");
  const [periodoActivo, setPeriodoActivo] = useState<PeriodoId>("mes");
  const [rangoAplicado, setRangoAplicado] = useState<{ from: Date; to: Date } | undefined>(undefined);
  const [estilistas, setEstilistas] = useState<Professional[]>([]);
  const [cargandoEstilistas, setCargandoEstilistas] = useState(false);

  const tiposComision = [
    { id: "placeholder", nombre: "Todos los tipos" },
    { id: "servicios", nombre: "Servicios" },
    { id: "productos", nombre: "Productos" },
    { id: "mixto", nombre: "Mixto" },
  ];

  useEffect(() => {
    const cargarEstilistas = async () => {
      setCargandoEstilistas(true);
      try {
        const data = await profesionalesService.getProfessionals();
        setEstilistas(data);
      } catch (error) {
        console.error("Error cargando estilistas:", error);
        setEstilistas([]);
      } finally {
        setCargandoEstilistas(false);
      }
    };

    cargarEstilistas();
  }, []);

  useEffect(() => {
    if (onFiltersChange) {
      const timer = setTimeout(() => {
        const filters: any = {
          estado: "pendiente"
        };

        if (estilistaSeleccionado && estilistaSeleccionado !== "placeholder") {
          filters.profesional_id = estilistaSeleccionado;
        }

        if (tipoComisionSeleccionado && tipoComisionSeleccionado !== "placeholder") {
          filters.tipo_comision = tipoComisionSeleccionado;
        }

        if (fechaInicio) {
          filters.fecha_inicio = fechaInicio;
        }

        if (fechaFin) {
          filters.fecha_fin = fechaFin;
        }

        const userSedeId = localStorage.getItem('beaux-sede_id') ||
          sessionStorage.getItem('beaux-sede_id');
        const userRole = localStorage.getItem('beaux-role') ||
          sessionStorage.getItem('beaux-role');

        if (userRole === 'admin_sede' && userSedeId) {
          filters.sede_id = userSedeId;
        }

        console.log("📤 Filtros enviados a API:", filters);
        onFiltersChange(filters);
      }, 300);

      return () => clearTimeout(timer);
    }
  }, [estilistaSeleccionado, tipoComisionSeleccionado, fechaInicio, fechaFin, onFiltersChange]);
  
  const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getDefaultDates = () => {
    const hoy = new Date();
    const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const ultimoDiaMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);

    return {
      inicio: formatDate(primerDiaMes),
      fin: formatDate(ultimoDiaMes)
    };
  };

  useEffect(() => {
    const defaultDates = getDefaultDates();
    setFechaInicio(defaultDates.inicio);
    setFechaFin(defaultDates.fin);
  }, []);

  const handlePeriodoChange = (periodo: PeriodoId, fechas?: { from: Date; to: Date }) => {
    setPeriodoActivo(periodo);
    const hoy = new Date();
    const todayStr = formatDate(hoy);
    if (periodo === "hoy") {
      setFechaInicio(todayStr); setFechaFin(todayStr);
    } else if (periodo === "7dias") {
      const s = new Date(hoy); s.setDate(s.getDate() - 6);
      setFechaInicio(formatDate(s)); setFechaFin(todayStr);
    } else if (periodo === "mes") {
      const s = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      const e = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
      setFechaInicio(formatDate(s)); setFechaFin(formatDate(e));
    } else if (periodo === "30dias") {
      const s = new Date(hoy); s.setDate(s.getDate() - 29);
      setFechaInicio(formatDate(s)); setFechaFin(todayStr);
    } else if (periodo === "rango" && fechas) {
      setRangoAplicado(fechas);
      // ✅ DEBUG: Verify custom range dates
      console.log('[ComisionesFilters] Custom range applied:', {
        from: fechas.from,
        to: fechas.to,
        from_month: fechas.from.getMonth(),
        to_month: fechas.to.getMonth(),
      });
      setFechaInicio(formatDate(fechas.from)); setFechaFin(formatDate(fechas.to));
    }
  };

  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:flex-wrap">
      {/* Estado fijo - Pendiente */}
      <div className="flex items-center gap-2 rounded-lg border border-gray-300 bg-gray-100 px-4 py-2.5 min-w-[150px]">
        <span className="text-sm font-medium text-gray-900">Estado:</span>
        <span className="text-sm font-semibold text-gray-700">Pendiente</span>
      </div>

      {/* Selector de estilista - CORREGIDO */}
      <div className="min-w-[250px]">
        <Select
          value={estilistaSeleccionado}
          onValueChange={setEstilistaSeleccionado}
        >
          <SelectTrigger className="w-full bg-white border-gray-300 text-gray-900 hover:bg-gray-50">
            <SelectValue placeholder="Selecciona un estilista *" />
          </SelectTrigger>
          <SelectContent className="bg-white border-gray-300">
            <SelectItem value="placeholder" className="bg-white hover:bg-gray-100 text-gray-900">
              -- Selecciona un estilista --
            </SelectItem>
            {cargandoEstilistas ? (
              <SelectItem value="cargando" disabled className="bg-white text-gray-500">
                Cargando estilistas...
              </SelectItem>
            ) : estilistas.length > 0 ? (
              estilistas.map((estilista) => (
                <SelectItem 
                  key={estilista.profesional_id} 
                  value={estilista.profesional_id}
                  className="bg-white hover:bg-gray-100 text-gray-900"
                >
                  {estilista.nombre} ({estilista.profesional_id})
                </SelectItem>
              ))
            ) : (
              <SelectItem value="sin-datos" disabled className="bg-white text-gray-500">
                No hay estilistas disponibles
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Selector de tipo de comisión - CORREGIDO */}
      <div className="min-w-[200px]">
        <Select
          value={tipoComisionSeleccionado}
          onValueChange={setTipoComisionSeleccionado}
        >
          <SelectTrigger className="w-full bg-white border-gray-300 text-gray-900 hover:bg-gray-50">
            <SelectValue placeholder="Tipo de comisión" />
          </SelectTrigger>
          <SelectContent className="bg-white border-gray-300">
            {tiposComision.map((tipo) => (
              <SelectItem 
                key={tipo.id} 
                value={tipo.id}
                className="bg-white hover:bg-gray-100 text-gray-900"
              >
                {tipo.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Selector de período */}
      <PeriodoSelector
        periodoActivo={periodoActivo}
        onPeriodoChange={handlePeriodoChange}
        rangoAplicado={rangoAplicado}
      />

      {/* Botón para limpiar filtros - CORREGIDO */}
      {(estilistaSeleccionado !== "placeholder" || tipoComisionSeleccionado !== "placeholder") && (
        <button
          onClick={() => {
            setEstilistaSeleccionado("placeholder");
            setTipoComisionSeleccionado("placeholder");
            const defaultDates = getDefaultDates();
            setFechaInicio(defaultDates.inicio);
            setFechaFin(defaultDates.fin);
          }}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 hover:text-gray-900 hover:border-gray-400 transition-colors"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}
