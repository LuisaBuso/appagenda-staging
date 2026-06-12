// Módulo de Comisiones para ADMIN_SEDE: contenedor principal de la vista.
"use client";

import { useState, useCallback } from "react";
import { Sidebar } from "../../../components/Layout/Sidebar";
import { PageHeader } from "../../../components/Layout/PageHeader";
import { ComisionesFilters } from "./comisiones-filters";
import { ComisionesResumen } from "./comisiones-resumen";
import { ComisionesPendientes } from "./comisiones-pendientes";
import { Button } from "../../../components/ui/button";

type Tab = "resumen" | "pendientes";

export default function ComisionesPage() {
  const [activeTab, setActiveTab] = useState<Tab>("pendientes");
  const [currentFilters, setCurrentFilters] = useState({});

  // Usar useCallback para evitar re-renders innecesarios
  const handleFiltersChange = useCallback((filters: any) => {
    console.log("🔧 Filters changed:", filters);
    setCurrentFilters(filters);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-white overflow-hidden">
      <Sidebar />

      <div className="flex-1 overflow-auto">
        <div className="w-full p-4 md:p-8">
          {/* Header */}
          <PageHeader
            title="Comisiones"
            subtitle="Gestión de liquidaciones de comisiones"
            actions={
              <Button
                className="bg-black text-white hover:bg-gray-800"
                onClick={() => {
                  if (activeTab !== "resumen") {
                    setActiveTab("resumen");
                  }
                }}
              >
                Nueva Liquidación
              </Button>
            }
          />

          {/* Title */}
          <h2 className="mb-6 text-2xl font-bold text-gray-900">Liquidación de comisiones</h2>

          {/* Filters - Solo mostrar en la pestaña de resumen */}
          {activeTab === "resumen" && (
            <ComisionesFilters onFiltersChange={handleFiltersChange} />
          )}

          {/* Tabs */}
          <div className="mb-6 flex gap-8 border-b border-gray-300">
            <button
              onClick={() => setActiveTab("pendientes")}
              className={`pb-3 text-base font-medium transition-colors ${
                activeTab === "pendientes"
                  ? "border-b-2 border-black text-black"
                  : "text-gray-600 hover:text-black"
              }`}
            >
              Resumen Pendientes
            </button>
            
            <button
              onClick={() => setActiveTab("resumen")}
              className={`pb-3 text-base font-medium transition-colors ${
                activeTab === "resumen"
                  ? "border-b-2 border-black text-black"
                  : "text-gray-600 hover:text-black"
              }`}
            >
              Liquidar Estilista
            </button>
          </div>

          {/* Content */}
          {activeTab === "resumen" ? (
            <ComisionesResumen filters={currentFilters} />
          ) : (
            <ComisionesPendientes />
          )}
        </div>
      </div>
    </div>
  );
}
