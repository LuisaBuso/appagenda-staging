"use client"

import { Sidebar } from "../../../components/Layout/Sidebar"
import { VentasFacturadasList } from './ventas-facturadas-list';

export default function VentasFacturadasPage() {
  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8">
          <VentasFacturadasList />
        </div>
      </main>
    </div>
  )
}
