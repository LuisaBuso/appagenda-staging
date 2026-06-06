"use client";

// Filtros del módulo de Comisiones (SUPER_ADMIN):
// obliga a elegir sede y estilista; arma payload que se envía al servicio de comisiones.

import { useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { PeriodoSelector, type PeriodoId } from "../../../components/ui/PeriodoSelector";
import { profesionalesService } from "./Api/profesionalesService";
import { Professional } from "../../../types/commissions";
import { sedeService } from "../Sedes/sedeService";
import type { Sede } from "../../../types/sede";
import { formatSedeNombre } from "../../../lib/sede";
import { formatLocalDate } from "../../../lib/dateFormat";

interface ComisionesFiltersProps {
  onFiltersChange?: (filters: {
    profesional_id?: string;
    sede?: string;
    nombre?: string;
    estado?: string;
    tipo_comision?: string;
    fecha_inicio?: string;
    fecha_fin?: string;
  }) => void;
}


export function ComisionesFilters({ onFiltersChange }: ComisionesFiltersProps) {
  const [selectedSede, setSelectedSede] = useState<string>("");
  const [estilistaSeleccionado, setEstilistaSeleccionado] =
    useState<string>("placeholder");
  const [tipoComisionSeleccionado, setTipoComisionSeleccionado] =
    useState<string>("placeholder");
  const [fechaInicio, setFechaInicio] = useState<string>("");
  const [fechaFin, setFechaFin] = useState<string>("");
  const [periodoActivo, setPeriodoActivo] = useState<PeriodoId>("mes");
  const [rangoAplicado, setRangoAplicado] = useState<{ from: Date; to: Date } | undefined>(undefined);

  const [estilistas, setEstilistas] = useState<Professional[]>([]);
  const [sedes, setSedes] = useState<Sede[]>([]);

  const [cargandoEstilistas, setCargandoEstilistas] = useState(false);
  const [cargandoSedes, setCargandoSedes] = useState(false);

  const [sedeIdMap, setSedeIdMap] = useState<Record<string, string>>({});

  const tiposComision = [
    { id: "placeholder", nombre: "Todos los tipos" },
    { id: "servicios", nombre: "Servicios" },
    { id: "productos", nombre: "Productos" },
    { id: "mixto", nombre: "Mixto" },
  ];

  // ==================================================
  // Cargar sedes
  // ==================================================
  useEffect(() => {
    const cargarSedes = async () => {
      setCargandoSedes(true);
      try {
        const token = sessionStorage.getItem("access_token");
        if (!token) throw new Error("No hay token");

        const sedesData = await sedeService.getSedes(token);
        setSedes(sedesData);

        // Mapa interno: _id → sede_id (SD-XXXX)
        const idMap: Record<string, string> = {};
        sedesData.forEach((sede) => {
          if (sede._id && sede.nombre) {
            idMap[sede._id] = sede.nombre;
          }
        });
        setSedeIdMap(idMap);

        if (sedesData.length === 1) {
          setSelectedSede(sedesData[0]._id);
        }
      } catch (error) {
        console.error("Error cargando sedes:", error);
        setSedes([]);
      } finally {
        setCargandoSedes(false);
      }
    };

    cargarSedes();
  }, []);

  // ==================================================
  // Cargar estilistas por sede
  // ==================================================
  useEffect(() => {
    const cargarEstilistas = async () => {
      if (!selectedSede) {
        setEstilistas([]);
        setEstilistaSeleccionado("placeholder");
        return;
      }

      setCargandoEstilistas(true);
      try {
        const data = await profesionalesService.getProfessionals();
        const sedeApiId = sedeIdMap[selectedSede];

        const filtrados = data.filter((e) =>
          sedeApiId ? e.sede_id === sedeApiId : true
        );

        setEstilistas(filtrados);

        setEstilistaSeleccionado(
          filtrados.length === 1 ? filtrados[0].profesional_id : "placeholder"
        );
      } catch (error) {
        console.error("Error cargando estilistas:", error);
        setEstilistas([]);
        setEstilistaSeleccionado("placeholder");
      } finally {
        setCargandoEstilistas(false);
      }
    };

    cargarEstilistas();
  }, [selectedSede, sedeIdMap]);

  // ==================================================
  // Emitir filtros
  // ==================================================
  useEffect(() => {
    if (!onFiltersChange) return;

    const timer = setTimeout(() => {
      const filters: any = { estado: "pendiente" };

      if (selectedSede && sedeIdMap[selectedSede]) {
        filters.sede_id = sedeIdMap[selectedSede];
      }

      if (
        estilistaSeleccionado &&
        estilistaSeleccionado !== "placeholder"
      ) {
        filters.profesional_id = estilistaSeleccionado;
      }

      if (
        tipoComisionSeleccionado &&
        tipoComisionSeleccionado !== "placeholder"
      ) {
        filters.tipo_comision = tipoComisionSeleccionado;
      }

      if (fechaInicio) filters.fecha_inicio = fechaInicio;
      if (fechaFin) filters.fecha_fin = fechaFin;

      onFiltersChange(filters);
    }, 300);

    return () => clearTimeout(timer);
  }, [
    selectedSede,
    estilistaSeleccionado,
    tipoComisionSeleccionado,
    fechaInicio,
    fechaFin,
    sedeIdMap,
    onFiltersChange,
  ]);

  // ==================================================
  // Fechas por defecto
  // ==================================================
  const formatDate = (date: Date): string =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(date.getDate()).padStart(2, "0")}`;

  const getDefaultDates = () => {
    const hoy = new Date();
    return {
      inicio: formatDate(new Date(hoy.getFullYear(), hoy.getMonth(), 1)),
      fin: formatDate(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0)),
    };
  };

  useEffect(() => {
    const { inicio, fin } = getDefaultDates();
    setFechaInicio(inicio);
    setFechaFin(fin);
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
      console.log('[SuperAdmin ComisionesFilters] Custom range applied:', {
        from: fechas.from,
        to: fechas.to,
        from_month: fechas.from.getMonth(),
        to_month: fechas.to.getMonth(),
      });
      setFechaInicio(formatDate(fechas.from)); setFechaFin(formatDate(fechas.to));
    }
  };

  // ==================================================
  // UI
  // ==================================================
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:flex-wrap">
      {/* Sede */}
      <div className="min-w-[250px]">
        <Select
          value={selectedSede}
          onValueChange={setSelectedSede}
          disabled={cargandoSedes}
        >
          <SelectTrigger className="w-full bg-white border-gray-300">
            <SelectValue
              placeholder={
                cargandoSedes ? "Cargando sedes..." : "Selecciona una sede *"
              }
            />
          </SelectTrigger>
          <SelectContent className="bg-white border-gray-300 max-h-60">
            <SelectItem value="none" disabled>
              -- Selecciona una sede --
            </SelectItem>
            {sedes.map((sede) => (
              <SelectItem key={sede.nombre} value={sede.nombre}>
                {formatSedeNombre(sede.nombre)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Estado */}
      <div className="flex items-center gap-2 rounded-lg border border-gray-300 bg-gray-100 px-4 py-2.5">
        <span className="text-sm font-medium">Estado:</span>
        <span className="text-sm font-semibold text-gray-700">
          Pendiente
        </span>
      </div>

      {/* Estilista */}
      <div className="min-w-[250px]">
        <Select
          value={estilistaSeleccionado}
          onValueChange={setEstilistaSeleccionado}
          disabled={!selectedSede || cargandoEstilistas}
        >
          <SelectTrigger className="w-full bg-white border-gray-300">
            <SelectValue placeholder="Selecciona un estilista" />
          </SelectTrigger>
          <SelectContent className="bg-white border-gray-300 max-h-60">
            <SelectItem value="placeholder" disabled>
              -- Selecciona un estilista --
            </SelectItem>
            {estilistas.map((e) => (
              <SelectItem
                key={e.profesional_id}
                value={e.profesional_id}
              >
                {e.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tipo */}
      <div className="min-w-[200px]">
        <Select
          value={tipoComisionSeleccionado}
          onValueChange={setTipoComisionSeleccionado}
          disabled={!selectedSede}
        >
          <SelectTrigger className="w-full bg-white border-gray-300">
            <SelectValue placeholder="Tipo de comisión" />
          </SelectTrigger>
          <SelectContent>
            {tiposComision.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.nombre}
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
    </div>
  );
}
