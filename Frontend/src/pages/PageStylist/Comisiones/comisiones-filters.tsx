"use client"

// Filtros del módulo Comisiones para ESTILISTA: por ahora solo estructura visual.

import { useState } from "react";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select"
import { Calendar } from "lucide-react";
import { formatSedeNombre } from "../../../lib/sede";

// Interfaces para los datos
interface Estilista {
  id: string;
  nombre: string;
}

interface Sede {
  id: string;
  nombre: string;
}

export function ComisionesFilters() {
  // Estados para los filtros
  const [estilistaSeleccionado, setEstilistaSeleccionado] = useState<string>("");
  const [sedeSeleccionada, setSedeSeleccionada] = useState<string>("");
  const [estadoSeleccionado, setEstadoSeleccionado] = useState<string>("");

  // En una implementación real, estos vendrían de una API
  const estilistas: Estilista[] = []; // Array vacío - se llenaría con API
  const sedes: Sede[] = []; // Array vacío - se llenaría con API

  const estados = [
    { id: "todos", nombre: "Todos" },
    { id: "pendiente", nombre: "Pendiente" },
    { id: "aprobado", nombre: "Aprobado" },
    { id: "pagado", nombre: "Pagado" },
  ];

  // Función para formatear fecha actual
  const getFechaActual = () => {
    const hoy = new Date();
    const mes = hoy.getMonth() + 1; // Los meses van de 0 a 11
    const año = hoy.getFullYear();
    return `1 - ${hoy.getDate()} de ${getNombreMes(mes)}, ${año}`;
  };

  const getNombreMes = (mes: number): string => {
    const meses = [
      "enero", "febrero", "marzo", "abril", "mayo", "junio",
      "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
    ];
    return meses[mes - 1];
  };

  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center">
      {/* Selector de rango de fechas */}
      <div className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5">
        <Calendar className="h-4 w-4 text-gray-400" />
        <span className="text-sm">{getFechaActual()}</span>
      </div>

      {/* Selector de estilista */}
      <div className="min-w-[200px]">
        <Select 
          value={estilistaSeleccionado} 
          onValueChange={setEstilistaSeleccionado}
        >
          <SelectContent>
            <SelectItem value="todos">Todos los estilistas</SelectItem>
            {estilistas.length > 0 ? (
              estilistas.map((estilista) => (
                <SelectItem key={estilista.id} value={estilista.id}>
                  {estilista.nombre}
                </SelectItem>
              ))
            ) : (
              <SelectItem value="sin-datos" disabled>
                No hay estilistas disponibles
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Selector de sede */}
      <div className="min-w-[200px]">
        <Select 
          value={sedeSeleccionada} 
          onValueChange={setSedeSeleccionada}
        >
          <SelectContent>
            <SelectItem value="todas">Todas las sedes</SelectItem>
              {sedes.length > 0 ? (
                sedes.map((sede) => (
                  <SelectItem key={sede.id} value={sede.id}>
                    {formatSedeNombre(sede.nombre)}
                  </SelectItem>
                ))
              ) : (
              <SelectItem value="sin-datos" disabled>
                No hay sedes disponibles
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Selector de estado */}
      <div className="min-w-[200px]">
        <Select 
          value={estadoSeleccionado} 
          onValueChange={setEstadoSeleccionado}
        >
          <SelectContent>
            {estados.map((estado) => (
              <SelectItem key={estado.id} value={estado.id}>
                {estado.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Botón para limpiar filtros */}
      {(estilistaSeleccionado || sedeSeleccionada || estadoSeleccionado) && (
        <button
          onClick={() => {
            setEstilistaSeleccionado("");
            setSedeSeleccionada("");
            setEstadoSeleccionado("");
          }}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}
