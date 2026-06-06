// Página contenedor del módulo de Comisiones (perfil SUPER_ADMIN).
// Renderiza el sidebar principal y la vista de comisiones pendientes.
"use client";

import { Sidebar } from "../../../components/Layout/Sidebar";
import { PageHeader } from "../../../components/Layout/PageHeader";
import { ComisionesPendientes } from "./comisiones-pendientes";

export default function ComisionesPage() {
  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      <Sidebar />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl p-4 md:p-8">
          <PageHeader title="Comisiones" />

          {/* Content */}
          <ComisionesPendientes />
        </div>
      </div>
    </div>
  );
}
