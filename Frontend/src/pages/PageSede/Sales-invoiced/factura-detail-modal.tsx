"use client"

import type React from "react"
import { X, FileText, User, CreditCard, Calendar, CheckCircle, Clock, Package, Scissors, DollarSign, ListChecks } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "../../../components/ui/dialog"
import { Button } from "../../../components/ui/button"
import type { Factura } from "../../../types/factura"
import { formatDateDMY } from "../../../lib/dateFormat"

interface FacturaDetailModalProps {
  factura: Factura
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FacturaDetailModal({ factura, open, onOpenChange }: FacturaDetailModalProps) {
  // Imprimir factura en la misma página (ventana de impresión)
  const handlePrintFactura = () => {
    // Crear HTML simple para la factura
    const printContent = `
      <html>
        <head>
          <title>Factura ${factura.identificador}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            h1 { text-align: center; }
            .section { margin-bottom: 24px; }
            .label { font-weight: bold; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
            th { background: #f5f5f5; }
          </style>
        </head>
        <body>
          <h1>Factura</h1>
          <div class="section">
            <span class="label">Cliente:</span> ${factura.nombre_cliente}<br/>
            <span class="label">Profesional:</span> ${factura.profesional_nombre}<br/>
            <span class="label">Identificador:</span> ${factura.identificador}<br/>
            <span class="label">Fecha de pago:</span> ${factura.fecha_pago ? formatDateDMY(factura.fecha_pago) : "-"}<br/>
            <span class="label">Método de pago:</span> ${factura.metodo_pago}<br/>
            <span class="label">Total:</span> ${formatCurrency(factura.total, factura.moneda)}<br/>
          </div>
          <div class="section">
            <span class="label">Items Facturados:</span>
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Tipo</th>
                  <th>Cantidad</th>
                  <th>Precio Unitario</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                ${(factura.items || []).map(item => `
                  <tr>
                    <td>${item.nombre || ''}</td>
                    <td>${item.tipo || ''}</td>
                    <td>${item.cantidad || 0}</td>
                    <td>${formatCurrency(item.precio_unitario, factura.moneda)}</td>
                    <td>${formatCurrency(item.subtotal, factura.moneda)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </body>
      </html>
    `;
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (printWindow) {
      printWindow.document.open();
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 500);
    }
  };
  
  const formatDate = (dateString: string) => formatDateDMY(dateString, "-")

  const formatCurrency = (amount: number | undefined, currency: string | undefined) => {
    const safeCurrency = String(currency || factura.moneda || "COP").toUpperCase();
    const safeAmount = Number.isFinite(amount) ? Number(amount) : 0;
    const locale = safeCurrency === "USD" ? "en-US" : safeCurrency === "MXN" ? "es-MX" : "es-CO";
    return `${safeCurrency} ${Math.round(safeAmount).toLocaleString(locale)}`;
  }

  const getStatusIcon = (estado: string) => {
    const normalized = String(estado || "").trim().toLowerCase()

    return normalized === "pagado" ? (
      <CheckCircle className="h-4 w-4 text-emerald-600" />
    ) : (
      <Clock className="h-4 w-4 text-amber-600" />
    )
  }

  const getStatusColor = (estado: string) => {
    const normalized = String(estado || "").trim().toLowerCase()

    if (normalized === "pagado") {
      return "bg-emerald-50 text-emerald-700 border-emerald-200"
    }

    if (normalized === "abonado") {
      return "bg-yellow-50 text-yellow-700 border-yellow-200"
    }

    return "bg-amber-50 text-amber-700 border-amber-200"
  }

  // Función para obtener el icono según el tipo de item
  const getItemIcon = (tipo: string) => {
    return tipo === "servicio" ? (
      <Scissors className="h-4 w-4 text-blue-600" />
    ) : (
      <Package className="h-4 w-4 text-purple-600" />
    )
  }

  // Calcular subtotal de items
  const calcularSubtotalItems = () => {
    if (!factura.items || factura.items.length === 0) return 0
    return factura.items.reduce((total, item) => total + (item.subtotal || 0), 0)
  }

  // Calcular comisión total
  const calcularComisionTotal = () => {
    if (!factura.items || factura.items.length === 0) return 0
    return factura.items.reduce((total, item) => total + (item.comision || 0), 0)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto p-0 bg-white border border-gray-200 shadow-2xl">
        {/* Overlay blanco solido */}
        <div className="absolute inset-0 bg-white" />
        
        {/* Header con fondo blanco solido */}
        <div className="relative z-10 bg-white border-b border-gray-100 px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-50 rounded-lg">
                <FileText className="h-6 w-6 text-gray-800" />
              </div>
              <div>
                <DialogTitle className="text-2xl font-bold text-gray-900 mb-1">
                  Detalle de Factura
                </DialogTitle>
                <p className="text-sm text-gray-600">
                  </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className={`px-3 py-1.5 rounded-full border text-sm font-medium flex items-center gap-1.5 ${getStatusColor(factura.estado || 'pagado')}`}>
                {getStatusIcon(factura.estado || 'pagado')}
                <span className="capitalize">{factura.estado || 'pagado'}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                className="rounded-full hover:bg-gray-100 bg-white"
              >
                <X className="h-5 w-5 text-gray-700" />
              </Button>
            </div>
          </div>
        </div>

        {/* Contenido principal con fondo blanco solido */}
        <div className="relative z-10 bg-white px-8 py-6 space-y-8">
          {/* Resumen Superior */}
          <div className="grid grid-cols-3 gap-4">
            <InfoCard
              icon={<User className="h-5 w-5" />}
              title="Cliente"
              value={factura.nombre_cliente || ''}
              subtitle=""
            />
            <InfoCard
              icon={<User className="h-5 w-5" />}
              title="Profesional"
              value={factura.profesional_nombre || ''}
              subtitle=""
            />
            <InfoCard
              icon={<CreditCard className="h-5 w-5" />}
              title="Total"
              value={formatCurrency(factura.total, factura.moneda)}
              subtitle={factura.metodo_pago || ''}
              highlight
            />
          </div>

          {/* Grid de Información */}
          <div className="grid grid-cols-2 gap-8">
            {/* Columna Izquierda */}
            <div className="space-y-6">
              {/* Información General */}
              <Section title="Información General">
                <DetailRow label="Identificador" value={factura.identificador || ''} />
                <DetailRow label="Fecha de pago" value={formatDate(factura.fecha_pago)} />
                <DetailRow label="Local" value={factura.local || ''} />
                <DetailRow label="Moneda" value={factura.moneda || 'COP'} />
                <DetailRow label="Tipo de comisión" value={factura.tipo_comision || ''} />
              </Section>

              {/* Items de la Factura */}
              <Section title="Items Facturados" icon={<ListChecks className="h-4 w-4" />}>
                {factura.items && factura.items.length > 0 ? (
                  <div className="space-y-4">
                    {factura.items.map((item, index) => (
                      <div key={index} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {getItemIcon(item.tipo || 'servicio')}
                            <div>
                              <p className="font-medium text-gray-900">{item.nombre || ''}</p>
                              <p className="text-xs text-gray-500 capitalize">
                                {item.tipo || 'servicio'} • {item.servicio_id || item.producto_id || "N/A"}
                              </p>
                            </div>
                          </div>
                          <span className="text-sm font-semibold text-gray-900">
                            {formatCurrency(item.subtotal, item.moneda)}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs text-gray-600">
                          <div>
                            <span className="font-medium">Cantidad:</span> {item.cantidad || 0}
                          </div>
                          <div>
                            <span className="font-medium">Precio unitario:</span> {formatCurrency(item.precio_unitario, item.moneda)}
                          </div>
                          <div className="text-right">
                            <span className="font-medium">Comisión:</span> {formatCurrency(item.comision, item.moneda)}
                          </div>
                        </div>
                      </div>
                    ))}
                    
                    {/* Resumen de Items */}
                    <div className="border-t border-gray-200 pt-4 mt-4 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Subtotal items:</span>
                        <span className="font-semibold text-gray-900">
                          {formatCurrency(calcularSubtotalItems(), factura.moneda)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Comisión total:</span>
                        <span className="font-semibold text-gray-900">
                          {formatCurrency(calcularComisionTotal(), factura.moneda)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm font-bold border-t border-gray-200 pt-2">
                        <span className="text-gray-700">Total factura:</span>
                        <span className="text-gray-900">
                          {formatCurrency(factura.total, factura.moneda)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-4">No hay items registrados</p>
                )}
              </Section>
            </div>

            {/* Columna Derecha */}
            <div className="space-y-6">
              {/* Información del Cliente */}
              <Section title="Información del Cliente" icon={<User className="h-4 w-4" />}>
                <DetailRow label="Nombre" value={factura.nombre_cliente || ''} />
                {/* <DetailRow label="Cédula" value={factura.cedula_cliente || "N/A"} /> */}
                <DetailRow label="Email" value={factura.email_cliente || ''} />
                <DetailRow label="Teléfono" value={factura.telefono_cliente || ''} />
              </Section>

              {/* Historial de Pagos */}
              <Section title="Historial de Pagos" icon={<CreditCard className="h-4 w-4" />}>
                {factura.historial_pagos && factura.historial_pagos.length > 0 ? (
                  <div className="space-y-3">
                    {factura.historial_pagos.map((pago, index) => (
                      <div key={index} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                        <div className="flex justify-between items-start mb-1">
                          <div className="flex items-center gap-2">
                            <DollarSign className="h-4 w-4 text-gray-600" />
                            <span className="font-medium text-gray-900 capitalize">{pago.metodo || ''}</span>
                          </div>
                          <span className="font-semibold text-gray-900">
                            {formatCurrency(pago.monto, factura.moneda)}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                          <div>
                            <span className="font-medium">Fecha:</span> {formatDate(pago.fecha)}
                          </div>
                          <div className="text-right">
                            <span className="font-medium">Tipo:</span> {pago.tipo?.replace('_', ' ') || ''}
                          </div>
                          <div>
                            <span className="font-medium">Registrado por:</span> {pago.registrado_por || ''}
                          </div>
                          <div className="text-right">
                            <span className="font-medium">Saldo después:</span> {formatCurrency(pago.saldo_despues, factura.moneda)}
                          </div>
                        </div>
                        {pago.notas && (
                          <div className="mt-2 text-xs text-gray-600">
                            <span className="font-medium">Notas:</span> {pago.notas}
                          </div>
                        )}
                      </div>
                    ))}
                    {/* Desglose de Pagos */}
                    {factura.desglose_pagos && (
                      <div className="border-t border-gray-200 pt-4 mt-4 space-y-2">
                        <h4 className="font-medium text-gray-900 text-sm mb-2">Desglose de Pagos</h4>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          {factura.desglose_pagos.efectivo !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Efectivo:</span>
                              <span className="font-semibold text-gray-900">
                                {formatCurrency(factura.desglose_pagos.efectivo, factura.moneda)}
                              </span>
                            </div>
                          )}
                          {factura.desglose_pagos.tarjeta !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Tarjeta:</span>
                              <span className="font-semibold text-gray-900">
                                {formatCurrency(factura.desglose_pagos.tarjeta, factura.moneda)}
                              </span>
                            </div>
                          )}
                          {factura.desglose_pagos.tarjeta_credito !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Tarjeta crédito:</span>
                              <span className="font-semibold text-gray-900">
                                {formatCurrency(factura.desglose_pagos.tarjeta_credito, factura.moneda)}
                              </span>
                            </div>
                          )}
                          {factura.desglose_pagos.tarjeta_debito !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Tarjeta débito:</span>
                              <span className="font-semibold text-gray-900">
                                {formatCurrency(factura.desglose_pagos.tarjeta_debito, factura.moneda)}
                              </span>
                            </div>
                          )}
                          {factura.desglose_pagos.addi !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Addi:</span>
                              <span className="font-semibold text-gray-900">
                                {formatCurrency(factura.desglose_pagos.addi, factura.moneda)}
                              </span>
                            </div>
                          )}
                          {factura.desglose_pagos.transferencia !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Transferencia:</span>
                              <span className="font-semibold text-gray-900">
                                {formatCurrency(factura.desglose_pagos.transferencia, factura.moneda)}
                              </span>
                            </div>
                          )}
                          <div className="flex justify-between font-bold col-span-2 border-t border-gray-200 pt-2">
                            <span className="text-gray-700">Total pagado:</span>
                            <span className="text-gray-900">
                              {formatCurrency(factura.desglose_pagos.total, factura.moneda)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-4">No hay historial de pagos</p>
                )}
              </Section>

              {/* Información de Facturación */}
              <Section title="Información de Facturación">
                <DetailRow label="Comprobante" value={factura.comprobante_de_pago || ''} />
                <DetailRow label="N° Comprobante" value={factura.numero_comprobante || ''} />
                <DetailRow label="Fecha comprobante" value={formatDate(factura.fecha_comprobante)} />
                <DetailRow label="Método de pago" value={factura.metodo_pago || ''} />
                <DetailRow
                  label="Vendido por"
                  value={factura.vendido_por || factura.facturado_por || ''}
                />
                <DetailRow label="Facturado por" value={factura.facturado_por || factura.vendido_por || ''} />
              </Section>
            </div>
          </div>
        </div>

        {/* Footer con fondo blanco solido */}
        <div className="relative z-10 bg-white border-t border-gray-100 px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span>Generado el {formatDate(factura.fecha_comprobante)}</span>
              </div>
            </div>
            <div className="flex gap-3">
              <Button 
                variant="outline" 
                onClick={() => onOpenChange(false)}
                className="border-gray-300 text-gray-700 hover:bg-gray-50 bg-white"
              >
                Cerrar
              </Button>
              <Button className="bg-gray-900 hover:bg-gray-800 text-white" onClick={handlePrintFactura}>
                <FileText className="mr-2 h-4 w-4" />
                Imprimir factura
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Componente de sección
interface SectionProps {
  title: string
  children: React.ReactNode
  icon?: React.ReactNode
}

function Section({ title, children, icon }: SectionProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
        {icon && <div className="text-gray-700">{icon}</div>}
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

// Componente de fila de detalle
interface DetailRowProps {
  label: string
  value: React.ReactNode
  highlight?: boolean
}

function DetailRow({ label, value, highlight }: DetailRowProps) {
  return (
    <div className="flex justify-between items-start py-2 bg-white">
      <span className="text-sm font-medium text-gray-600">{label}</span>
      <span className={`text-sm text-right ${highlight ? "font-bold text-gray-900 text-base" : "text-gray-900"}`}>
        {value}
      </span>
    </div>
  )
}

// Componente de tarjeta de información
interface InfoCardProps {
  icon: React.ReactNode
  title: string
  value: string
  subtitle: string
  highlight?: boolean
}

function InfoCard({ icon, title, value, subtitle, highlight }: InfoCardProps) {
  return (
    <div className={`bg-white rounded-xl border ${highlight ? "border-gray-300 shadow-sm" : "border-gray-200"} p-5`}>
      <div className="flex items-start gap-3">
        <div className={`p-2.5 rounded-lg ${highlight ? "bg-gray-900" : "bg-gray-100"}`}>
          <div className={highlight ? "text-white" : "text-gray-700"}>{icon}</div>
        </div>
        <div>
          <p className="text-sm text-gray-600 mb-1">{title}</p>
          <p className={`text-lg font-semibold ${highlight ? "text-gray-900" : "text-gray-900"} mb-1`}>
            {value}
          </p>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
      </div>
    </div>  
  )
}
