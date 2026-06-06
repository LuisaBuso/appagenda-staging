"use client";

// Módulo de Comisiones para perfil ESTILISTA (solo ve sus propias comisiones).

import { useState } from "react";
import StylistBottomNav from "../../../components/Layout/StylistBottomNav";
import { ComisionesFilters } from "./comisiones-filters";
import { ComisionesResumen } from "./comisiones-resumen";
import { ComisionesDetalle } from "./comisiones-detalle";

type Tab = "resumen" | "detalle";

export default function ComisionesPage() {
  const [activeTab] = useState<Tab>("resumen");

  return (
    <div className="min-h-screen w-full max-w-[480px] mx-auto bg-gray-50 pb-24">
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white px-4 py-4">
        <h1 className="text-xl font-bold text-gray-900">Comisiones</h1>
        <p className="text-sm text-gray-600">Consulta y detalle de tus comisiones</p>
      </header>

      <main className="space-y-5 px-4 pt-4">
        <div className="mb-2">
          <ComisionesFilters />
        </div>

        <div className="bg-white rounded-2xl border border-gray-200">
          {activeTab === "resumen" ? <ComisionesResumen /> : <ComisionesDetalle />}
        </div>
      </main>

      <StylistBottomNav active="reports" />
    </div>
  );
}
