"use client"

import React, { useState, useEffect } from "react"
import { toast } from "sonner"
import { X, ArrowLeft, CheckCircle, CreditCard, DollarSign, Calendar, Clock, User, Scissors, Link as LinkIcon, Wallet, Gift } from "lucide-react"
import { crearCita } from '../../../../components/Quotes/citasApi'
import { useAuth } from '../../../../components/Auth/AuthContext'
import { getStoredCurrency, normalizeCurrencyCode } from "../../../../lib/currency"
import { getPaymentMethodLabel, normalizePaymentMethodForBackend, PAYROLL_PAYMENT_METHOD } from "../../../../lib/payment-methods"

// 🔥 INTERFAZ PARA LOS DATOS DE LA CITA
interface CitaParaPago {
    cliente: string;
    servicio: string;
    profesional: string;
    fecha: string;
    hora_inicio: string;
    hora_fin: string;
    duracion: string;
    monto_total: number;
    cliente_id: string;
    profesional_id: string;
    
    // ⭐ CAMBIO: En lugar de servicio_id singular, ahora es servicios (array)
    servicios: Array<{
        servicio_id: string;
        precio_personalizado: number | null;  // null si usa precio de BD
    }>;
    
    sede_id: string;
    notas: string;
}

interface PaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    citaData: CitaParaPago | null;
    onSuccess?: () => void;
    onBackToEdit?: () => void;
}

// 🔥 FUNCIÓN PARA CALCULAR ABONO FIJO SEGÚN MONEDA
const getFixedDepositByCurrency = (currency: string): number => {
    const currencyUpper = currency.toUpperCase();
    switch (currencyUpper) {
        case "COP":
            return 50000;
        case "MXN":
            return 250;
        case "USD":
        default:
            return 15;
    }
}

// 🔥 FUNCIÓN PARA VERIFICAR SI REQUIERE PAGO COMPLETO
const requiresFullPayment = (amount: number, currency: string): boolean => {
    const fixedDeposit = getFixedDepositByCurrency(currency);
    return amount <= fixedDeposit;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
    isOpen,
    onClose,
    citaData,
    onSuccess,
    onBackToEdit
}) => {
    const { user } = useAuth();
    
    // 🔥 ESTADOS
    const [step, setStep] = useState<1 | 2>(1);
    const [selectedProcessType, setSelectedProcessType] = useState<"reserva" | "pago">("reserva");
    const [selectedPaymentType, setSelectedPaymentType] = useState<"deposit" | "full">("full");
    const [depositAmountInput, setDepositAmountInput] = useState<string>("");
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>("sin_pago");
    const [giftCardCode, setGiftCardCode] = useState("");
    const [userCurrency, setUserCurrency] = useState<string>(getStoredCurrency("USD"));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const isCopCurrency = userCurrency.toUpperCase() === "COP";

    // 🔥 MÉTODOS DE PAGO COMPLETOS
    const paymentMethods = [
        { id: "link_pago", name: "Pago con link", icon: <LinkIcon className="w-4 h-4" /> },
        { id: "tarjeta_credito", name: "Tarjeta Crédito", icon: <CreditCard className="w-4 h-4" /> },
        { id: "tarjeta_debito", name: "Tarjeta Débito", icon: <CreditCard className="w-4 h-4" /> },
        { id: "giftcard", name: "Gift Card", icon: <Gift className="w-4 h-4" /> },
        ...(isCopCurrency ? [{ id: "addi", name: "Addi", icon: <Wallet className="w-4 h-4" /> }] : []),
        { id: "efectivo", name: "Efectivo", icon: <DollarSign className="w-4 h-4" /> },
        { id: "transferencia", name: "Transferencia", icon: <Wallet className="w-4 h-4" /> },
        { id: PAYROLL_PAYMENT_METHOD, name: "Descuento por nómina", icon: <Wallet className="w-4 h-4" /> },
    ];

    const sanitizePaymentMethod = (method: string): string => {
        const normalizedMethod = normalizePaymentMethodForBackend(method);
        if (!isCopCurrency && normalizedMethod === "addi") return "efectivo";
        return normalizedMethod;
    };

    // 🔥 EFECTO PARA OBTENER MONEDA
    useEffect(() => {
        const getCurrency = () => {
            return normalizeCurrencyCode(user?.moneda || getStoredCurrency("USD"));
        };
        setUserCurrency(getCurrency());
    }, [user?.moneda]);

    // 🔥 INICIALIZAR MÉTODO DE PAGO SEGÚN TIPO DE PROCESO
    useEffect(() => {
        if (selectedProcessType === "reserva") {
            setSelectedPaymentMethod("sin_pago");
        } else {
            // Para modo pago, usar efectivo como default
            setSelectedPaymentMethod("efectivo");
        }
    }, [selectedProcessType]);

    useEffect(() => {
        if (!isCopCurrency && selectedPaymentMethod === "addi") {
            setSelectedPaymentMethod(selectedProcessType === "reserva" ? "sin_pago" : "efectivo");
        }
    }, [isCopCurrency, selectedPaymentMethod, selectedProcessType]);

    useEffect(() => {
        if (selectedPaymentMethod !== "giftcard" && giftCardCode) {
            setGiftCardCode("");
        }
    }, [selectedPaymentMethod, giftCardCode]);

    // 🔥 CALCULOS
    const FIXED_DEPOSIT = getFixedDepositByCurrency(userCurrency);
    const totalAmount = citaData?.monto_total ?? 0;
    const canHaveDeposit = citaData?.monto_total ? citaData.monto_total > FIXED_DEPOSIT : false;
    const requiresFullPaymentNow = citaData?.monto_total ? requiresFullPayment(citaData.monto_total, userCurrency) : false;
    const parsedDepositAmount = Number(depositAmountInput.replace(",", "."));
    const hasValidDepositAmount =
        Number.isFinite(parsedDepositAmount) &&
        parsedDepositAmount > 0 &&
        parsedDepositAmount <= totalAmount;
    const selectedDepositAmount = hasValidDepositAmount
        ? parsedDepositAmount
        : Math.min(FIXED_DEPOSIT, totalAmount);

    // 🔥 REINICIAR ABONO AL ABRIR CAMBIANDO CITA/MONEDA
    useEffect(() => {
        if (!isOpen || !citaData) return;
        const initialDepositAmount = Math.min(FIXED_DEPOSIT, citaData.monto_total);
        setDepositAmountInput(initialDepositAmount.toString());
    }, [isOpen, citaData?.monto_total, FIXED_DEPOSIT]);

    // 🔥 FORMATO DE MONTO
    const formatAmount = (amount: number) => {
        switch (userCurrency) {
            case "COP":
                return `$${Math.round(amount).toLocaleString("es-CO", { maximumFractionDigits: 0 })} COP`;
            case "MXN":
                return `$${Math.round(amount).toLocaleString("es-MX", { maximumFractionDigits: 0 })} MXN`;
            case "USD":
            default:
                return `$${Math.round(amount).toLocaleString("en-US", { maximumFractionDigits: 0 })} USD`;
        }
    };

    // 🔥 FORMATO DE FECHA PARA EL BACKEND
    const formatearFechaParaBackend = (fechaString: string): string => {
        try {
            const fechaParts = fechaString.split(', ');
            if (fechaParts.length < 2) {
                throw new Error("Formato de fecha inválido");
            }

            const diaMesPart = fechaParts[1];
            const [dia, , mesStr] = diaMesPart.split(' ');

            const meses: { [key: string]: string } = {
                'Enero': '01', 'Febrero': '02', 'Marzo': '03', 'Abril': '04',
                'Mayo': '05', 'Junio': '06', 'Julio': '07', 'Agosto': '08',
                'Septiembre': '09', 'Octubre': '10', 'Noviembre': '11', 'Diciembre': '12'
            };

            const mesNum = meses[mesStr];
            if (!mesNum) {
                throw new Error(`Mes no reconocido: ${mesStr}`);
            }

            const añoActual = new Date().getFullYear();
            return `${añoActual}-${mesNum}-${dia.padStart(2, '0')}`;

        } catch (error) {
            console.error('❌ Error formateando fecha:', error);
            throw new Error(`Error al procesar la fecha`);
        }
    };

    // 🔥 FUNCIÓN PARA CREAR CITA
    const handleCreateAppointment = async (withPayment: boolean = false) => {
        if (!citaData || !user?.access_token) {
            setError("Datos de la cita no disponibles");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const metodoPagoSeleccionado = sanitizePaymentMethod(selectedPaymentMethod);
            const codigoGiftcard = giftCardCode.trim();
            if (withPayment && metodoPagoSeleccionado === "giftcard" && !codigoGiftcard) {
                throw new Error("Debes ingresar el codigo de la Gift Card.");
            }

            // 🔥 CALCULAR MONTOS
            let abonoMonto = 0;
            let estadoPago = "pendiente";
            let saldoPendiente = 0;

            if (withPayment) {
                if (selectedPaymentType === "deposit" && canHaveDeposit && !requiresFullPaymentNow) {
                    abonoMonto = Number(selectedDepositAmount);
                    saldoPendiente = Math.max(citaData.monto_total - abonoMonto, 0);
                    estadoPago = saldoPendiente > 0 ? "pendiente" : "pagado";
                } else {
                    abonoMonto = Number(citaData.monto_total);
                    saldoPendiente = 0;
                    estadoPago = "pagado";
                }
            } else {
                // Reserva sin pago
                estadoPago = "pendiente";
                saldoPendiente = citaData.monto_total;
            }

            // 🔥 PREPARAR DATOS
            const citaParaCrear = {
                sede_id: citaData.sede_id,
                cliente_id: citaData.cliente_id,
                profesional_id: citaData.profesional_id,
                servicios: citaData.servicios,
                fecha: formatearFechaParaBackend(citaData.fecha),
                hora_inicio: citaData.hora_inicio,
                hora_fin: citaData.hora_fin,
                estado: "confirmada",
                abono: abonoMonto,
                valor_total: citaData.monto_total,
                saldo_pendiente: saldoPendiente,
                estado_pago: estadoPago,
                moneda: userCurrency,
                notas: citaData.notas || "",
                cliente_nombre: citaData.cliente,
                metodo_pago: metodoPagoSeleccionado,
                ...(metodoPagoSeleccionado === "giftcard" && codigoGiftcard
                    ? { codigo_giftcard: codigoGiftcard }
                    : {}),
            };

            console.log('📤 Creando cita:', citaParaCrear);
            const resultado = await crearCita(citaParaCrear, user.access_token);
            console.log('✅ Cita creada:', resultado);

            // 🔥 ÉXITO
            if (onSuccess) onSuccess();
            
            // 🔥 MOSTRAR ALERTA
            let mensaje = "";
            if (!withPayment) {
                mensaje = `✅ Cita confirmada para ${citaData.cliente}`;
            } else if (selectedPaymentType === "deposit" && canHaveDeposit && !requiresFullPaymentNow) {
                mensaje = `✅ Cita confirmada con abono de ${formatAmount(selectedDepositAmount)}`;
            } else {
                mensaje = `✅ Cita confirmada con pago completo de ${formatAmount(citaData.monto_total)}`;
            }
            toast.success(mensaje.replace(/^✅\s*/, ''));

            onClose();

        } catch (error: any) {
            console.error('❌ ERROR:', error);
            setError(error.message || "Error al crear la cita");
        } finally {
            setLoading(false);
        }
    };

    // 🔥 MANEJADORES DE BOTONES
    const handleNext = () => setStep(2);
    const handleBack = () => {
        if (step === 2) {
            setStep(1);
        } else if (onBackToEdit) {
            onBackToEdit();
        }
    };

    const handleConfirm = () => {
        if (
            selectedProcessType === "pago" &&
            selectedPaymentType === "deposit" &&
            canHaveDeposit &&
            !requiresFullPaymentNow &&
            !hasValidDepositAmount
        ) {
            setError(`Ingresa un monto de abono valido entre 1 y ${Math.round(totalAmount)}.`);
            return;
        }

        if (selectedProcessType === "pago" && selectedPaymentMethod === "giftcard" && !giftCardCode.trim()) {
            setError("Debes ingresar el codigo de la Gift Card para continuar.");
            return;
        }

        if (selectedProcessType === "reserva") {
            handleCreateAppointment(false);
        } else {
            handleCreateAppointment(true);
        }
    };

    // 🔥 SI EL MODAL NO ESTÁ ABIERTO, NO RENDERIZAR
    if (!isOpen || !citaData) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 p-4">
            <div className="bg-white rounded-lg w-full max-w-sm max-h-[85vh] overflow-hidden shadow-xl border border-gray-300">
                {/* HEADER */}
                <div className="px-4 pt-4 pb-3">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleBack}
                                className="p-1 hover:bg-gray-100 rounded transition-colors"
                            >
                                <ArrowLeft className="w-4 h-4 text-gray-700" />
                            </button>
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">
                                    {step === 1 ? "Confirmar cita" : "Procesar pago"}
                                </h2>
                                <p className="text-xs text-gray-600 mt-0.5">
                                    {step === 1 ? "Paso 1 de 2" : "Paso 2 de 2"}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1 hover:bg-gray-100 rounded transition-colors"
                        >
                            <X className="w-4 h-4 text-gray-700" />
                        </button>
                    </div>

                    {/* INDICADOR DE PASOS */}
                    <div className="flex gap-1">
                        <div className={`h-1 flex-1 rounded-full ${step >= 1 ? 'bg-gray-900' : 'bg-gray-300'}`}></div>
                        <div className={`h-1 flex-1 rounded-full ${step >= 2 ? 'bg-gray-900' : 'bg-gray-300'}`}></div>
                    </div>
                </div>

                {/* CONTENIDO */}
                <div className="overflow-y-auto max-h-[calc(85vh-160px)] px-4 pb-4">
                    {error && (
                        <div className="mb-3 p-2.5 bg-gray-100 border border-gray-300 rounded">
                            <div className="text-xs font-medium text-gray-900 mb-1">Error</div>
                            <div className="text-xs text-gray-700">{error}</div>
                        </div>
                    )}

                    {step === 1 && (
                        <div className="space-y-4">
                            {/* RESUMEN DE LA CITA */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <CheckCircle className="w-4 h-4 text-gray-700" />
                                    <h3 className="text-sm font-medium text-gray-900">Resumen de la cita</h3>
                                </div>
                                
                                <div className="space-y-2">
                                    <div className="flex items-center gap-3 p-2 border border-gray-200 rounded">
                                        <User className="w-3.5 h-3.5 text-gray-600" />
                                        <div className="flex-1">
                                            <div className="text-xs text-gray-600">Cliente</div>
                                            <div className="text-sm font-medium text-gray-900">{citaData.cliente}</div>
                                        </div>
                                    </div>
                                    
                                    <div className="p-2 border border-gray-200 rounded">
                                        <div className="flex items-center gap-3 mb-2">
                                            <Scissors className="w-3.5 h-3.5 text-gray-600" />
                                            <div className="flex-1">
                                                <div className="text-xs text-gray-600">Servicio</div>
                                                <div className="text-sm font-medium text-gray-900">{citaData.servicio}</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-xs text-gray-600">Profesional</div>
                                                <div className="text-sm font-medium text-gray-900">{citaData.profesional}</div>
                                            </div>
                                        </div>
                                        
                                        <div className="grid grid-cols-2 gap-2 mt-2">
                                            <div className="flex items-center gap-2">
                                                <Calendar className="w-3 h-3 text-gray-500" />
                                                <div className="text-xs text-gray-700">{citaData.fecha}</div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Clock className="w-3 h-3 text-gray-500" />
                                                <div className="text-xs text-gray-700">{citaData.duracion}</div>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div className="p-2.5 border border-gray-300 rounded bg-gray-50">
                                        <div className="flex items-center justify-between">
                                            <div className="text-xs text-gray-700">Total</div>
                                            <div className="text-base font-bold text-gray-900">
                                                {formatAmount(citaData.monto_total)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* OPCIONES DE PROCESO */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <CreditCard className="w-4 h-4 text-gray-700" />
                                    <h3 className="text-sm font-medium text-gray-900">¿Cómo deseas proceder?</h3>
                                </div>
                                
                                <div className="space-y-2">
                                    <button
                                        onClick={() => setSelectedProcessType("reserva")}
                                        className={`w-full p-3 rounded border text-left transition-colors ${
                                            selectedProcessType === "reserva"
                                                ? 'border-gray-900 bg-gray-50' 
                                                : 'border-gray-300 hover:border-gray-400'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                                selectedProcessType === "reserva" 
                                                    ? 'border-gray-900 bg-gray-900' 
                                                    : 'border-gray-400'
                                            }`}>
                                                {selectedProcessType === "reserva" && (
                                                    <div className="w-2 h-2 rounded-full bg-white"></div>
                                                )}
                                            </div>
                                            <div>
                                                <div className="text-sm font-medium text-gray-900">Reservar sin pago</div>
                                                <div className="text-xs text-gray-600 mt-0.5">Confirma la cita directamente</div>
                                            </div>
                                        </div>
                                    </button>

                                    <button
                                        onClick={() => setSelectedProcessType("pago")}
                                        className={`w-full p-3 rounded border text-left transition-colors ${
                                            selectedProcessType === "pago"
                                                ? 'border-gray-900 bg-gray-50' 
                                                : 'border-gray-300 hover:border-gray-400'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                                selectedProcessType === "pago" 
                                                    ? 'border-gray-900 bg-gray-900' 
                                                    : 'border-gray-400'
                                            }`}>
                                                {selectedProcessType === "pago" && (
                                                    <div className="w-2 h-2 rounded-full bg-white"></div>
                                                )}
                                            </div>
                                            <div>
                                                <div className="text-sm font-medium text-gray-900">Procesar pago</div>
                                                <div className="text-xs text-gray-600 mt-0.5">
                                                    {canHaveDeposit
                                                        ? "Solicitar abono o pago completo"
                                                        : "Pago completo del servicio"
                                                    }
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                </div>
                            </div>

                            {/* RESUMEN DE ACCIÓN */}
                            <div className="p-3 border border-gray-200 rounded bg-gray-50">
                                <div className="text-xs font-medium text-gray-900 mb-1">
                                    {selectedProcessType === "reserva"
                                        ? "Reserva directa sin pago"
                                        : selectedPaymentType === "deposit" && canHaveDeposit && !requiresFullPaymentNow
                                        ? `Abono de ${formatAmount(selectedDepositAmount)}`
                                        : `Pago completo de ${formatAmount(citaData.monto_total)}`
                                    }
                                </div>
                                <div className="text-xs text-gray-700">
                                    {selectedProcessType === "reserva"
                                        ? "La cita se confirmará sin procesar ningún pago."
                                        : selectedPaymentType === "deposit" && canHaveDeposit && !requiresFullPaymentNow
                                        ? `El cliente deberá abonar ${formatAmount(selectedDepositAmount)}`
                                        : `El cliente pagará el total del servicio.`
                                    }
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 2 && selectedProcessType === "pago" && (
                        <div className="space-y-4">
                            {/* OPCIONES DE PAGO */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <DollarSign className="w-4 h-4 text-gray-700" />
                                    <h3 className="text-sm font-medium text-gray-900">Opciones de pago</h3>
                                </div>
                                
                                <div className="space-y-2">
                                    {canHaveDeposit && !requiresFullPaymentNow && (
                                        <button
                                            onClick={() => setSelectedPaymentType("deposit")}
                                            className={`w-full p-3 rounded border text-left transition-colors ${
                                                selectedPaymentType === "deposit"
                                                    ? 'border-gray-900 bg-gray-50' 
                                                    : 'border-gray-300 hover:border-gray-400'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between">
                                            <div>
                                                <div className="text-sm font-medium text-gray-900">Abono</div>
                                                <div className="text-xs text-gray-600 mt-0.5">
                                                        {formatAmount(selectedDepositAmount)}
                                                </div>
                                            </div>
                                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                                selectedPaymentType === "deposit" 
                                                    ? 'border-gray-900 bg-gray-900' 
                                                        : 'border-gray-400'
                                                }`}>
                                                    {selectedPaymentType === "deposit" && (
                                                        <div className="w-2 h-2 rounded-full bg-white"></div>
                                                    )}
                                                </div>
                                            </div>
                                        </button>
                                    )}

                                    <button
                                        onClick={() => setSelectedPaymentType("full")}
                                        className={`w-full p-3 rounded border text-left transition-colors ${
                                            selectedPaymentType === "full"
                                                ? 'border-gray-900 bg-gray-50' 
                                                : 'border-gray-300 hover:border-gray-400'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <div className="text-sm font-medium text-gray-900">Pago completo</div>
                                                <div className="text-xs text-gray-600 mt-0.5">
                                                    {formatAmount(citaData.monto_total)}
                                                </div>
                                            </div>
                                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                                selectedPaymentType === "full" 
                                                    ? 'border-gray-900 bg-gray-900' 
                                                    : 'border-gray-400'
                                            }`}>
                                                {selectedPaymentType === "full" && (
                                                    <div className="w-2 h-2 rounded-full bg-white"></div>
                                                )}
                                            </div>
                                        </div>
                                    </button>
                                </div>
                            </div>

                            {selectedPaymentType === "deposit" && canHaveDeposit && !requiresFullPaymentNow && (
                                <div className="p-3 border border-gray-300 rounded bg-gray-50">
                                    <label className="block text-xs font-medium text-gray-700 mb-1">
                                        Monto del abono
                                    </label>
                                    <input
                                        type="number"
                                        value={depositAmountInput}
                                        onChange={(event) => {
                                            const rawValue = event.target.value;
                                            if (rawValue === "") {
                                                setDepositAmountInput("");
                                                setError(null);
                                                return;
                                            }

                                            const numericValue = Number(rawValue.replace(",", "."));
                                            if (!Number.isFinite(numericValue) || numericValue < 0) return;

                                            const clampedValue = Math.min(numericValue, citaData.monto_total);
                                            setDepositAmountInput(clampedValue.toString());
                                            setError(null);
                                        }}
                                        onBlur={() => {
                                            if (!hasValidDepositAmount) {
                                                const initialDepositAmount = Math.min(FIXED_DEPOSIT, citaData.monto_total);
                                                setDepositAmountInput(initialDepositAmount.toString());
                                            }
                                        }}
                                        min="1"
                                        max={citaData.monto_total}
                                        step={isCopCurrency ? "1" : "0.01"}
                                        disabled={loading}
                                        className="w-full rounded border border-gray-300 px-2 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none disabled:opacity-50"
                                        placeholder={Math.round(Math.min(FIXED_DEPOSIT, citaData.monto_total)).toString()}
                                    />
                                    <div className="text-[11px] text-gray-600 mt-1">
                                        Maximo permitido: {formatAmount(citaData.monto_total)}
                                    </div>
                                </div>
                            )}

                            {/* MÉTODO DE PAGO */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <CreditCard className="w-4 h-4 text-gray-700" />
                                    <h3 className="text-sm font-medium text-gray-900">Método de pago</h3>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-2">
                                    {/* 🔥 MÉTODOS ORIGINALES COMPLETOS */}
                                    {paymentMethods.map((method) => (
                                        <button
                                            key={method.id}
                                            onClick={() => setSelectedPaymentMethod(method.id)}
                                            className={`p-2.5 rounded border flex flex-col items-center transition-colors ${
                                                selectedPaymentMethod === method.id
                                                    ? 'border-gray-900 bg-gray-50' 
                                                    : 'border-gray-300 hover:border-gray-400'
                                            }`}
                                        >
                                            <div className={`mb-1 ${selectedPaymentMethod === method.id ? 'text-gray-900' : 'text-gray-600'}`}>
                                                {method.icon}
                                            </div>
                                            <div className="text-xs font-medium text-gray-900">{method.name}</div>
                                        </button>
                                    ))}
                                    
                                </div>

                                {selectedPaymentMethod === "giftcard" && (
                                    <div className="mt-3">
                                        <label className="block text-xs font-medium text-gray-700 mb-1">
                                            Codigo Gift Card *
                                        </label>
                                        <input
                                            type="text"
                                            value={giftCardCode}
                                            onChange={(event) => setGiftCardCode(event.target.value)}
                                            placeholder="Ej: RFC-GCP-1234"
                                            className="w-full rounded border border-gray-300 px-2 py-2 text-xs text-gray-900 focus:border-gray-900 focus:outline-none"
                                            disabled={loading}
                                        />
                                    </div>
                                )}
                            </div>

                            {/* RESUMEN FINAL */}
                            <div className="p-3 border border-gray-200 rounded bg-gray-50">
                                <div className="text-xs font-medium text-gray-900 mb-2">Resumen final</div>
                                <div className="space-y-1.5 text-xs text-gray-700">
                                    <div className="flex justify-between">
                                        <span>Cliente:</span>
                                        <span className="font-medium text-gray-900">{citaData.cliente}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Servicio:</span>
                                        <span className="font-medium text-gray-900">{citaData.servicio}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Monto:</span>
                                        <span className="font-medium text-gray-900">
                                            {selectedPaymentType === "deposit" && canHaveDeposit && !requiresFullPaymentNow
                                                ? formatAmount(selectedDepositAmount) + " (Abono)"
                                                : formatAmount(citaData.monto_total)
                                            }
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Método:</span>
                                        <span className="font-medium text-gray-900">
                                            {getPaymentMethodLabel(selectedPaymentMethod)}
                                        </span>
                                    </div>
                                    {selectedPaymentMethod === "giftcard" && giftCardCode.trim() && (
                                        <div className="flex justify-between">
                                            <span>Codigo Gift Card:</span>
                                            <span className="font-medium text-gray-900">{giftCardCode.trim()}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* PASO 2 PARA MODO RESERVA (sin opciones de pago) */}
                    {step === 2 && selectedProcessType === "reserva" && (
                        <div className="space-y-4">
                            {/* MÉTODO DE CONFIRMACIÓN */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <CreditCard className="w-4 h-4 text-gray-700" />
                                    <h3 className="text-sm font-medium text-gray-900">Confirmación</h3>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-2">
                                    {/* Solo opción "Sin pago" para modo reserva */}
                                    <button
                                        onClick={() => setSelectedPaymentMethod("sin_pago")}
                                        className={`p-2.5 rounded border flex flex-col items-center transition-colors ${
                                            selectedPaymentMethod === "sin_pago"
                                                ? 'border-gray-900 bg-gray-50' 
                                                : 'border-gray-300 hover:border-gray-400'
                                        }`}
                                    >
                                        <div className="text-lg mb-1">📅</div>
                                        <div className="text-xs font-medium text-gray-900">Sin pago</div>
                                    </button>
                                </div>
                                
                                <div className="text-xs text-gray-600 mt-2">
                                    La cita se confirmará sin procesar ningún pago. El cliente podrá pagar en el local.
                                </div>
                            </div>

                            {/* RESUMEN FINAL PARA RESERVA */}
                            <div className="p-3 border border-gray-200 rounded bg-gray-50">
                                <div className="text-xs font-medium text-gray-900 mb-2">Resumen final</div>
                                <div className="space-y-1.5 text-xs text-gray-700">
                                    <div className="flex justify-between">
                                        <span>Cliente:</span>
                                        <span className="font-medium text-gray-900">{citaData.cliente}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Servicio:</span>
                                        <span className="font-medium text-gray-900">{citaData.servicio}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Fecha:</span>
                                        <span className="font-medium text-gray-900">{citaData.fecha}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Total:</span>
                                        <span className="font-medium text-gray-900">
                                            {formatAmount(citaData.monto_total)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Estado:</span>
                                        <span className="font-medium text-gray-900">Reserva sin pago</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* FOOTER CON BOTONES */}
                <div className="px-4 py-3 border-t border-gray-300">
                    <div className="flex justify-between gap-3">
                        <button
                            onClick={handleBack}
                            disabled={loading}
                            className="px-3 py-2 text-sm border border-gray-400 rounded text-gray-700 font-medium hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {step === 1 ? "Volver" : "Atrás"}
                        </button>

                        {step === 1 ? (
                            <button
                                onClick={handleNext}
                                disabled={loading}
                                className="px-3 py-2 text-sm bg-gray-900 text-white rounded font-medium hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Continuar
                            </button>
                        ) : (
                            <button
                                onClick={handleConfirm}
                                disabled={loading}
                                className="px-3 py-2 text-sm bg-gray-900 text-white rounded font-medium hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                            >
                                {loading ? (
                                    <>
                                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2"></div>
                                        Procesando...
                                    </>
                                ) : (
                                    selectedProcessType === "reserva" ? "Confirmar" : "Confirmar Pago"
                                )}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
