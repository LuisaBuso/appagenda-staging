"use client";

import { useState } from "react";
import { Search, Edit2, User, Filter, X } from "lucide-react";
import type { Estilista } from "../../../types/estilista";
import { formatSedeNombre } from "../../../lib/sede";

interface EstilistasListProps {
  estilistas: Estilista[];
  selectedEstilista: Estilista | null;
  onSelectEstilista: (estilista: Estilista) => void;
  onEdit?: (estilista: Estilista) => void;
  onDelete?: (estilista: Estilista) => void;
}

export function EstilistasList({
  estilistas,
  selectedEstilista,
  onSelectEstilista,
  onEdit,
}: EstilistasListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterActive, setFilterActive] = useState<boolean | null>(null);

  const safeEstilistas = Array.isArray(estilistas) ? estilistas : [];

  const filteredEstilistas = safeEstilistas.filter((estilista) => {
    if (!estilista) return false;

    const matchesSearch =
      estilista.nombre?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      estilista.email?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesFilter =
      filterActive === null || estilista.activo === filterActive;

    return matchesSearch && matchesFilter;
  });

  const handleEdit = (estilista: Estilista, e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.(estilista);
  };

  const getEspecialidades = (estilista: Estilista) => {
    return Array.isArray(estilista.especialidades)
      ? estilista.especialidades
      : [];
  };

  return (
    <div className="h-full flex flex-col border border-gray-200 rounded-lg bg-white">
      {/* Header con buscador y filtros */}
      <div className="p-3 border-b border-gray-200">
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
          <input
            type="text"
            placeholder="Buscar estilistas..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-8 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:border-black focus:ring-0"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex gap-1.5">
          <button
            onClick={() => setFilterActive(null)}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded border ${
              filterActive === null
                ? "bg-black text-white border-black"
                : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            <Filter className="w-3 h-3" />
            Todos
          </button>
          <button
            onClick={() => setFilterActive(true)}
            className={`flex-1 px-2 py-1 text-xs rounded border ${
              filterActive === true
                ? "bg-black text-white border-black"
                : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            Activos
          </button>
          <button
            onClick={() => setFilterActive(false)}
            className={`flex-1 px-2 py-1 text-xs rounded border ${
              filterActive === false
                ? "bg-black text-white border-black"
                : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            Inactivos
          </button>
        </div>
      </div>

      {/* Contador */}
      <div className="px-3 py-1.5 border-b border-gray-200 bg-gray-50">
        <div className="flex justify-between items-center">
          <p className="text-xs text-gray-600">
            <span className="font-medium">{filteredEstilistas.length}</span> de{" "}
            <span className="font-medium">{safeEstilistas.length}</span>{" "}
            estilistas
          </p>
          {filterActive !== null && (
            <button
              onClick={() => setFilterActive(null)}
              className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-0.5"
            >
              <X className="w-3 h-3" />
              Limpiar filtro
            </button>
          )}
        </div>
      </div>

      {/* Lista de estilistas */}
      <div className="flex-1 overflow-y-auto">
        {filteredEstilistas.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-400">
            <User className="h-6 w-6 mb-1.5" />
            <p className="text-xs">No se encontraron estilistas</p>
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="mt-2 text-xs text-gray-500 hover:text-gray-700"
              >
                Limpiar búsqueda
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredEstilistas.map((estilista) => {
              if (!estilista) return null;

              const especialidades = getEspecialidades(estilista);
              const especialidadesCount = especialidades.length;

              return (
                <div
                  key={estilista.profesional_id}
                  onClick={() => onSelectEstilista(estilista)}
                  className={`p-2.5 cursor-pointer transition-colors relative group ${
                    selectedEstilista?.profesional_id ===
                    estilista.profesional_id
                      ? "bg-gray-100 border-l-2 border-black"
                      : "hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <div className="w-6 h-6 bg-gray-200 rounded flex items-center justify-center flex-shrink-0">
                          <User className="h-3 w-3 text-gray-700" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h3 className="text-sm font-semibold text-gray-900 truncate">
                              {estilista.nombre || "Nombre no disponible"}
                            </h3>
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                estilista.activo
                                  ? "bg-gray-100 text-gray-900 border-gray-300"
                                  : "bg-gray-100 text-gray-900 border-gray-300"
                              }`}
                            >
                              {estilista.activo ? "Activo" : "Inactivo"}
                            </span>
                          </div>

                          <p className="text-xs text-gray-600 truncate mt-0.5">
                            {estilista.email || "Email no disponible"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-1">
                        <span>
                          Sede:{" "}
                          {formatSedeNombre(
                            (estilista as any).sede_nombre,
                            "Sin sede",
                          )}
                        </span>
                      </div>

                      {especialidadesCount > 0 && (
                        <div className="mt-1.5">
                          <div className="flex flex-wrap gap-1">
                            {especialidades
                              .slice(0, 2)
                              .map((especialidad, index) => (
                                <span
                                  key={index}
                                  className="inline-block px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded text-[10px] border border-gray-200"
                                >
                                  {especialidad}
                                </span>
                              ))}
                            {especialidadesCount > 2 && (
                              <span className="inline-block px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded text-[10px] border border-gray-200">
                                +{especialidadesCount - 2} más
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Acción de edición */}
                    <div className="relative">
                      <button
                        onClick={(e) => handleEdit(estilista, e)}
                        className="p-2 rounded-md hover:bg-gray-200 active:scale-95 transition-all"

                        title="Editar estilista"
                      >
                        <Edit2 className="h-3 w-3 text-gray-500 hover:text-gray-700" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
