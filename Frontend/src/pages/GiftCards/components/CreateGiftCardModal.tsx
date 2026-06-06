import { FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CreditCard, Landmark, Loader2, Search, Wallet, X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { DatePicker } from "../../../components/ui/DatePicker";
import { giftcardsService } from "../giftcardsService";
import type { GiftCardClientOption, GiftCardCreatePayload } from "../types";
import { formatMoney, toPositiveNumber } from "./utils";
import { rankClientsByRelevance, toClienteFromPartial, type RankedClient, getLastVisitLabel } from "../../../lib/client-search";

const PRESET_AMOUNTS = [50000, 100000, 150000, 200000, 300000];
const CLIENTS_SEARCH_PAGE_SIZE = 30;
const MODAL_SECTION_CLASS = "space-y-3 border-b border-gray-200 px-5 py-4";
const MODAL_TITLE_CLASS = "text-base font-semibold text-gray-900";
const MODAL_INPUT_CLASS = "h-10 border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus-visible:ring-gray-500";

type AmountMode = "free" | "preset";
type ValidityMode = "annual" | "custom" | "no_expiry";
type PaymentMethod = "efectivo" | "transferencia" | "tarjeta_credito" | "tarjeta_debito";

const PAYMENT_OPTIONS: Array<{ label: string; value: PaymentMethod; icon: ReactNode }> = [
  { label: "Efectivo", value: "efectivo", icon: <Wallet className="h-4 w-4" /> },
  { label: "Transferencia", value: "transferencia", icon: <Landmark className="h-4 w-4" /> },
  { label: "Tarjeta-Crédito", value: "tarjeta_credito", icon: <CreditCard className="h-4 w-4" /> },
  { label: "Tarjeta-Débito", value: "tarjeta_debito", icon: <CreditCard className="h-4 w-4" /> },
];

export interface CreateGiftCardSubmission {
  payload: GiftCardCreatePayload;
  paymentMethod: PaymentMethod;
  beneficiaryEmail?: string;
  beneficiaryPhone?: string;
}

interface CreateGiftCardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  sedeId: string;
  sedeName?: string;
  currency: string;
  onCreate: (submission: CreateGiftCardSubmission) => Promise<void>;
  isSubmitting: boolean;
}

function formatAmountInput(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return Math.round(value).toLocaleString("es-CO");
}

function mergeClientOptions(
  current: GiftCardClientOption[],
  incoming: GiftCardClientOption[]
): GiftCardClientOption[] {
  const byId = new Map<string, GiftCardClientOption>();

  for (const client of current) {
    byId.set(client.id, client);
  }

  for (const client of incoming) {
    const existing = byId.get(client.id);
    byId.set(client.id, {
      id: client.id,
      nombre: client.nombre || existing?.nombre || "",
      email: client.email || existing?.email,
      telefono: client.telefono || existing?.telefono,
    });
  }

  return Array.from(byId.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function getDateInputFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getTodayDateInput(): string {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function calculateDaysBetweenToday(endDate: string): number {
  const today = new Date(getTodayDateInput());
  const target = new Date(endDate);
  if (Number.isNaN(target.getTime())) return 0;

  const milliseconds = target.getTime() - today.getTime();
  return Math.ceil(milliseconds / (1000 * 60 * 60 * 24));
}

export function CreateGiftCardModal({
  open,
  onOpenChange,
  token,
  sedeId,
  sedeName,
  currency,
  onCreate,
  isSubmitting,
}: CreateGiftCardModalProps) {
  const [knownClients, setKnownClients] = useState<GiftCardClientOption[]>([]);
  const [buyerOptions, setBuyerOptions] = useState<GiftCardClientOption[]>([]);
  const [rankedSuggestions, setRankedSuggestions] = useState<RankedClient[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(false);
  const [clientsError, setClientsError] = useState<string | null>(null);

  const [amountMode, setAmountMode] = useState<AmountMode>("free");
  const [presetAmount, setPresetAmount] = useState<number>(150000);
  const [freeAmountInput, setFreeAmountInput] = useState<string>("150000");

  const [buyerSearch, setBuyerSearch] = useState("");
  const [selectedBuyerId, setSelectedBuyerId] = useState("");

  const [isForAnotherPerson, setIsForAnotherPerson] = useState(false);
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [beneficiaryPhone, setBeneficiaryPhone] = useState("");
  const [beneficiaryEmail, setBeneficiaryEmail] = useState("");
  const [optionalMessage, setOptionalMessage] = useState("");
  const [validityMode, setValidityMode] = useState<ValidityMode>("annual");
  const [customExpiryDate, setCustomExpiryDate] = useState(getDateInputFromToday(365));

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("efectivo");
  const [formError, setFormError] = useState<string | null>(null);
  const latestBuyerSearchRequestRef = useRef(0);

  const selectedBuyer = useMemo(
    () => knownClients.find((client) => client.id === selectedBuyerId) ?? null,
    [knownClients, selectedBuyerId]
  );
  const hasBuyerQuery = buyerSearch.trim().length > 0;
  const [isBuyerFocused, setIsBuyerFocused] = useState(false);

  const totalAmount = amountMode === "preset" ? presetAmount : toPositiveNumber(freeAmountInput);

  useEffect(() => {
    if (!open || !token) return;

    let cancelled = false;
    const requestId = ++latestBuyerSearchRequestRef.current;
    const query = buyerSearch.trim();

    if (!query) {
      setBuyerOptions([]);
      setClientsError(null);
      setIsLoadingClients(false);
      return () => {
        cancelled = true;
      };
    }

    const loadClients = async () => {
      try {
        setIsLoadingClients(true);
        setClientsError(null);

        const result = await giftcardsService.searchClientsForSelector(token, query, {
          limit: CLIENTS_SEARCH_PAGE_SIZE,
          page: 1,
        });

        if (cancelled || requestId !== latestBuyerSearchRequestRef.current) return;

        const merged = mergeClientOptions(mergeClientOptions([], knownClients), result.clients);
        setKnownClients(merged);

        const ranked = rankClientsByRelevance(
          merged.map(toClienteFromPartial),
          query,
          10
        );

        setRankedSuggestions(ranked);
        setBuyerOptions(result.clients);
      } catch (error) {
        if (cancelled || requestId !== latestBuyerSearchRequestRef.current) return;
        setBuyerOptions([]);
        setRankedSuggestions([]);
        setClientsError(error instanceof Error ? error.message : "No se pudieron cargar clientes");
      } finally {
        if (!cancelled && requestId === latestBuyerSearchRequestRef.current) {
          setIsLoadingClients(false);
        }
      }
    };

    const debounceMs = query ? 250 : 0;
    const timeout = setTimeout(() => {
      void loadClients();
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [open, token, buyerSearch]);

  useEffect(() => {
    if (!open) {
      setFormError(null);
      setAmountMode("free");
      setPresetAmount(150000);
      setFreeAmountInput("150000");
      setBuyerSearch("");
      setSelectedBuyerId("");
      setIsForAnotherPerson(false);
      setBeneficiaryName("");
      setBeneficiaryPhone("");
      setBeneficiaryEmail("");
      setOptionalMessage("");
      setValidityMode("annual");
      setCustomExpiryDate(getDateInputFromToday(365));
      setPaymentMethod("efectivo");
      return;
    }

    if (!isForAnotherPerson && selectedBuyer) {
      setBeneficiaryName(selectedBuyer.nombre || "");
      setBeneficiaryPhone(selectedBuyer.telefono || "");
      setBeneficiaryEmail(selectedBuyer.email || "");
    }
  }, [open, isForAnotherPerson, selectedBuyer]);

  const submitCreateGiftCard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    if (!sedeId) {
      setFormError("No se encontró la sede para crear la Gift Card.");
      return;
    }

    if (!totalAmount || totalAmount <= 0) {
      setFormError("El valor de la Gift Card debe ser mayor a 0.");
      return;
    }

    if (!selectedBuyer) {
      setFormError("Debes seleccionar el cliente comprador.");
      return;
    }

    const finalBeneficiaryName = isForAnotherPerson ? beneficiaryName.trim() : selectedBuyer.nombre;
    const finalBeneficiaryPhone = isForAnotherPerson
      ? beneficiaryPhone.trim()
      : String(selectedBuyer.telefono || "").trim();
    const finalBeneficiaryEmail = isForAnotherPerson
      ? beneficiaryEmail.trim()
      : String(selectedBuyer.email || "").trim();

    if (!finalBeneficiaryName) {
      setFormError("Debes ingresar el nombre del beneficiario.");
      return;
    }

    const customDays = validityMode === "custom" ? calculateDaysBetweenToday(customExpiryDate) : null;
    if (validityMode === "custom" && (!customDays || customDays <= 0)) {
      setFormError("La vigencia personalizada debe ser una fecha posterior a hoy.");
      return;
    }

    const diasVigencia: number | null =
      validityMode === "annual" ? 365 : validityMode === "custom" ? customDays : null;

    const notesParts: string[] = [];
    if (optionalMessage.trim()) {
      notesParts.push(`Mensaje: ${optionalMessage.trim()}`);
    }
    notesParts.push(`Metodo de pago: ${paymentMethod}`);
    if (finalBeneficiaryPhone) {
      notesParts.push(`Telefono beneficiario: ${finalBeneficiaryPhone}`);
    }
    if (finalBeneficiaryEmail) {
      notesParts.push(`Email beneficiario: ${finalBeneficiaryEmail}`);
    }

    const payload: GiftCardCreatePayload = {
      sede_id: sedeId,
      valor: totalAmount,
      moneda: currency,
      dias_vigencia: diasVigencia,
      comprador_cliente_id: selectedBuyer.id,
      comprador_nombre: selectedBuyer.nombre,
      beneficiario_cliente_id: isForAnotherPerson ? undefined : selectedBuyer.id,
      beneficiario_nombre: finalBeneficiaryName,
      metodo_pago: paymentMethod,
      notas: notesParts.join(" | "),
    };

    try {
      await onCreate({
        payload,
        paymentMethod,
        beneficiaryEmail: finalBeneficiaryEmail || undefined,
        beneficiaryPhone: finalBeneficiaryPhone || undefined,
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "No se pudo crear la Gift Card.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[92vh] max-w-[900px] overflow-hidden rounded-xl border border-gray-300 bg-white p-0 shadow-xl"
      >
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
          <DialogHeader className="text-left">
            <DialogTitle className="text-2xl font-bold text-gray-900">Crear Gift Card</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-gray-600">
              Emite una tarjeta regalo y asigna su beneficiario.
            </DialogDescription>
          </DialogHeader>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0 text-gray-600 hover:bg-gray-100"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Cerrar</span>
          </Button>
        </div>

        <form onSubmit={submitCreateGiftCard} className="space-y-0">
          <div className="max-h-[calc(92vh-150px)] overflow-y-auto">
          <section className={MODAL_SECTION_CLASS}>
            <h3 className={MODAL_TITLE_CLASS}>Valor de la Gift Card</h3>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                $
              </span>
              <Input
                inputMode="numeric"
                value={
                  amountMode === "preset"
                    ? formatAmountInput(presetAmount)
                    : freeAmountInput.replace(/[^\d]/g, "")
                }
                onChange={(event) => {
                  if (amountMode !== "free") return;
                  setFreeAmountInput(event.target.value.replace(/[^\d]/g, ""));
                }}
                className={`${MODAL_INPUT_CLASS} pl-8 text-base`}
                placeholder="150000"
                readOnly={amountMode === "preset"}
              />
            </div>

            <div className="flex flex-wrap gap-5">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="amount-mode"
                  value="free"
                  checked={amountMode === "free"}
                  onChange={() => setAmountMode("free")}
                  className="h-4 w-4 accent-black"
                />
                Monto libre
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="amount-mode"
                  value="preset"
                  checked={amountMode === "preset"}
                  onChange={() => setAmountMode("preset")}
                  className="h-4 w-4 accent-black"
                />
                Monto predefinido
              </label>
            </div>

            {amountMode === "preset" ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {PRESET_AMOUNTS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPresetAmount(value)}
                    className={`rounded-md border px-3 py-2 text-xs font-medium ${
                      presetAmount === value
                        ? "border-black bg-black text-white hover:bg-gray-800"
                        : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    {formatMoney(value, currency)}
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <section className={MODAL_SECTION_CLASS}>
            <h3 className={MODAL_TITLE_CLASS}>Comprador</h3>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={buyerSearch}
                onChange={(event) => setBuyerSearch(event.target.value)}
                onFocus={() => setIsBuyerFocused(true)}
                onBlur={() => setTimeout(() => setIsBuyerFocused(false), 120)}
                placeholder="Buscar cliente"
                className={`${MODAL_INPUT_CLASS} pl-9`}
              />
            </div>

            {selectedBuyer ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{selectedBuyer.nombre}</p>
                    <p className="truncate text-xs text-gray-500">
                      {selectedBuyer.email || selectedBuyer.telefono || "Sin datos de contacto"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedBuyerId("")}
                    className="text-xs font-medium text-gray-600 hover:text-gray-900"
                  >
                    Quitar
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-500">Selecciona un cliente comprador de la lista.</p>
            )}

            {hasBuyerQuery && isBuyerFocused && (
              <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                <div className="max-h-64 overflow-y-auto">
                  {isLoadingClients && (
                    <div className="flex items-center gap-2 px-3 py-3 text-xs text-gray-500">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Cargando clientes...
                    </div>
                  )}

                  {!isLoadingClients && rankedSuggestions.length === 0 && (
                    <p className="px-3 py-3 text-xs text-gray-500">
                      No hay resultados para la búsqueda actual.
                    </p>
                  )}

                  {rankedSuggestions.map((result) => {
                    const client = result.cliente;
                    const option = buyerOptions.find((c) => c.id === client.id) || {
                      id: client.id,
                      nombre: client.nombre,
                      email: client.email,
                      telefono: client.telefono,
                      cedula: client.cedula,
                    };
                    const isSelected = option.id === selectedBuyerId;
                    const displayCedula = (option as any).cedula ?? client.cedula;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setSelectedBuyerId(option.id)}
                        className={`flex w-full items-start justify-between gap-2 border-b border-gray-100 px-3 py-2 text-left last:border-b-0 ${
                          isSelected ? "bg-gray-100" : "hover:bg-gray-50"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-gray-900">{option.nombre}</p>
                          <p className="truncate text-xs text-gray-700">
                            {option.telefono || "—"} • {displayCedula || "—"}
                          </p>
                          {option.email ? (
                            <p className="truncate text-[11px] text-gray-600">{option.email}</p>
                          ) : null}
                          <p className="text-[11px] text-gray-500">{getLastVisitLabel(client)}</p>
                        </div>
                        {isSelected ? (
                          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-700">
                            Seleccionado
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {!hasBuyerQuery && (
              <p className="text-xs text-gray-500">Escribe el nombre del cliente para buscar.</p>
            )}

            {hasBuyerQuery && isLoadingClients ? (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Cargando clientes...
              </div>
            ) : null}
            {hasBuyerQuery && clientsError ? <p className="text-xs text-amber-700">{clientsError}</p> : null}
          </section>

          <section className={MODAL_SECTION_CLASS}>
            <h3 className={MODAL_TITLE_CLASS}>Beneficiario</h3>

            <div className="flex flex-wrap gap-5">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="beneficiary-mode"
                  checked={isForAnotherPerson}
                  onChange={() => setIsForAnotherPerson(true)}
                  className="h-4 w-4 accent-black"
                />
                Es para otra persona
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="beneficiary-mode"
                  checked={!isForAnotherPerson}
                  onChange={() => setIsForAnotherPerson(false)}
                  className="h-4 w-4 accent-black"
                />
                Es para el comprador
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input
                value={beneficiaryName}
                onChange={(event) => setBeneficiaryName(event.target.value)}
                placeholder="Nombre beneficiario"
                disabled={!isForAnotherPerson}
                className={MODAL_INPUT_CLASS}
              />
              <Input
                value={beneficiaryPhone}
                onChange={(event) => setBeneficiaryPhone(event.target.value)}
                placeholder="Teléfono"
                disabled={!isForAnotherPerson}
                className={MODAL_INPUT_CLASS}
              />
              <Input
                value={beneficiaryEmail}
                onChange={(event) => setBeneficiaryEmail(event.target.value)}
                placeholder="Email"
                disabled={!isForAnotherPerson}
                className={MODAL_INPUT_CLASS}
              />
              <Input
                value={optionalMessage}
                onChange={(event) => setOptionalMessage(event.target.value)}
                placeholder="Mensaje (opcional)"
                className={MODAL_INPUT_CLASS}
              />
            </div>
          </section>

          <section className="grid grid-cols-1 gap-5 border-b border-gray-200 px-5 py-4 md:grid-cols-2">
            <div className="space-y-3">
              <h3 className={MODAL_TITLE_CLASS}>Vigencia</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setValidityMode("annual")}
                  className={`rounded-md border px-3 py-2 text-sm font-medium ${
                    validityMode === "annual"
                      ? "border-black bg-black text-white hover:bg-gray-800"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  12 meses
                </button>
                <button
                  type="button"
                  onClick={() => setValidityMode("custom")}
                  className={`rounded-md border px-3 py-2 text-sm font-medium ${
                    validityMode === "custom"
                      ? "border-black bg-black text-white hover:bg-gray-800"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  Personalizada
                </button>
                <button
                  type="button"
                  onClick={() => setValidityMode("no_expiry")}
                  className={`rounded-md border px-3 py-2 text-sm font-medium ${
                    validityMode === "no_expiry"
                      ? "border-black bg-black text-white hover:bg-gray-800"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  No tiene vencimiento
                </button>
              </div>

              {validityMode === "custom" ? (
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">Fecha de vencimiento</label>
                  <DatePicker
                    value={customExpiryDate}
                    min={getTodayDateInput()}
                    onChange={(v) => setCustomExpiryDate(v)}
                  />
                </div>
              ) : validityMode === "annual" ? (
                <p className="text-xs text-gray-500">Vencimiento automático a 12 meses desde emisión.</p>
              ) : (
                <p className="text-xs text-gray-500">Esta Gift Card no tendrá fecha de vencimiento.</p>
              )}
            </div>

            <div className="space-y-3">
              <h3 className={MODAL_TITLE_CLASS}>Nombre Sede</h3>
              <Input value={sedeName?.trim() || "—"} readOnly className={`${MODAL_INPUT_CLASS} bg-gray-50`} />
              <p className="text-xs text-gray-500">Total a emitir: {formatMoney(totalAmount, currency)}</p>
            </div>
          </section>

          <section className="space-y-3 px-5 py-4">
            <h3 className={MODAL_TITLE_CLASS}>Método de pago</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {PAYMENT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPaymentMethod(option.value)}
                  className={`flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium ${
                    paymentMethod === option.value
                      ? "border-black bg-black text-white hover:bg-gray-800"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {option.icon}
                  {option.label}
                  {paymentMethod === option.value ? <CheckCircle2 className="h-4 w-4" /> : null}
                </button>
              ))}
            </div>
          </section>
          </div>

          {formError ? (
            <div className="mx-5 mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </div>
          ) : null}

          <DialogFooter className="border-t border-gray-200 bg-white px-5 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-gray-300 text-gray-700 hover:bg-gray-100"
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting} className="bg-black text-white hover:bg-gray-800">
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creando...
                </>
              ) : (
                "Crear Gift Card"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
