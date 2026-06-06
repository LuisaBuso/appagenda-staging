"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { Sidebar } from "../../components/Layout/Sidebar";
import { PageHeader } from "../../components/Layout/PageHeader";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Toaster } from "../../components/ui/toaster";
import { Card, CardContent } from "../../components/ui/card";
import { useAuth } from "../../components/Auth/AuthContext";
import { toast } from "../../hooks/use-toast";
import { sedeService } from "../PageSuperAdmin/Sedes/sedeService";
import { giftcardsService } from "./giftcardsService";
import type { Sede } from "../../types/sede";
import type { GiftCard, GiftCardStatus } from "./types";
import { CreateGiftCardModal, type CreateGiftCardSubmission } from "./components/CreateGiftCardModal";
import { GiftCardConfirmationModal } from "./components/GiftCardConfirmationModal";
import { GiftCardsSummaryCards } from "./components/GiftCardsSummaryCards";
import { GiftCardsTable } from "./components/GiftCardsTable";
import { resolveGiftCardSedeName } from "./components/utils";

const PAGE_SIZE = 15;
const SUPER_ADMIN_ROLES = new Set(["super_admin", "superadmin"]);

type StatusFilter = "all" | "activa" | "usada" | "cancelada" | "parcialmente_usada";

const STATUS_OPTIONS: Array<{ label: string; value: StatusFilter }> = [
  { label: "Todos", value: "all" },
  { label: "Activa", value: "activa" },
  { label: "Parcialmente usada", value: "parcialmente_usada" },
  { label: "Usada", value: "usada" },
  { label: "Cancelada", value: "cancelada" },
];

const FILTER_LABEL_CLASS = "mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600";
const FILTER_CONTROL_CLASS =
  "h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-1 focus:ring-gray-500";
const INPUT_CONTROL_CLASS =
  "h-10 border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus-visible:ring-gray-500";

export default function GiftCardsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const role = user?.role || sessionStorage.getItem("beaux-role") || "";
  const token = user?.access_token || sessionStorage.getItem("access_token") || "";

  const isSuperAdmin = SUPER_ADMIN_ROLES.has(role);

  const [sedes, setSedes] = useState<Sede[]>([]);
  const [isLoadingSedes, setIsLoadingSedes] = useState(false);
  const [selectedSedeId, setSelectedSedeId] = useState("");

  const [giftCards, setGiftCards] = useState<GiftCard[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [isCreatingGiftCard, setIsCreatingGiftCard] = useState(false);
  const [latestCreatedGiftCard, setLatestCreatedGiftCard] = useState<GiftCard | null>(null);
  const [latestCreatedEmail, setLatestCreatedEmail] = useState<string | undefined>(undefined);

  const latestRequestIdRef = useRef(0);

  const selectedSedeName = useMemo(() => {
    if (!selectedSedeId) return "—";
    const found = sedes.find((sede) => sede.sede_id === selectedSedeId);
    if (found?.nombre?.trim()) return found.nombre.trim();

    const localName = String(user?.nombre_local || sessionStorage.getItem("beaux-nombre_local") || "").trim();
    return localName || "—";
  }, [sedes, selectedSedeId, user?.nombre_local]);

  const sedeNamesById = useMemo(() => {
    const map: Record<string, string> = {};

    for (const sede of sedes) {
      const sedeId = String(sede.sede_id || "").trim();
      const sedeNombre = String(sede.nombre || "").trim();
      if (!sedeId || !sedeNombre) continue;
      map[sedeId] = sedeNombre;
    }

    const normalizedSelectedSedeId = String(selectedSedeId || "").trim();
    if (normalizedSelectedSedeId && selectedSedeName !== "—" && !map[normalizedSelectedSedeId]) {
      map[normalizedSelectedSedeId] = selectedSedeName;
    }

    return map;
  }, [sedes, selectedSedeId, selectedSedeName]);

  const displayCurrency = useMemo(() => {
    const fromCards = giftCards.find((item) => item.moneda)?.moneda;
    const fromSession = sessionStorage.getItem("beaux-moneda");
    return String(fromCards || fromSession || user?.moneda || "COP").toUpperCase();
  }, [giftCards, user?.moneda]);

  const filteredGiftCards = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return giftCards;

    return giftCards.filter((giftCard) => {
      const resolvedSedeName = resolveGiftCardSedeName({
        sedeId: giftCard.sede_id,
        sedeNombre: giftCard.sede_nombre,
        sedeNamesById,
        fallbackSedeName: selectedSedeName,
      });

      const searchable = [
        giftCard.codigo,
        giftCard.comprador_nombre,
        giftCard.beneficiario_nombre,
        resolvedSedeName,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");

      return searchable.includes(term);
    });
  }, [giftCards, searchTerm, sedeNamesById, selectedSedeName]);

  const summaryMetrics = useMemo(() => {
    const activeStatuses = new Set<GiftCardStatus>(["activa", "parcialmente_usada", "vencida"]);

    const activeCount = filteredGiftCards.filter((giftCard) => activeStatuses.has(giftCard.estado)).length;
    const totalIssued = filteredGiftCards.reduce((total, giftCard) => total + Number(giftCard.valor || 0), 0);
    const pendingBalance = filteredGiftCards.reduce(
      (total, giftCard) => total + Number(giftCard.saldo_disponible || 0) + Number(giftCard.saldo_reservado || 0),
      0
    );

    return { activeCount, totalIssued, pendingBalance };
  }, [filteredGiftCards]);

  const loadGiftCards = useCallback(
    async (page: number, options?: { preserveInitial?: boolean }) => {
      if (!token || !selectedSedeId) return;

      const requestId = ++latestRequestIdRef.current;
      const preserveInitial = options?.preserveInitial ?? false;

      try {
        if (!preserveInitial) {
          setIsInitialLoading(page === 1);
        }
        setIsFetching(true);
        setError(null);

        const response = await giftcardsService.getGiftCardsBySede(token, selectedSedeId, {
          estado: statusFilter === "all" ? undefined : statusFilter,
          page,
          limit: PAGE_SIZE,
        });

        if (requestId !== latestRequestIdRef.current) return;

        setGiftCards(Array.isArray(response.giftcards) ? response.giftcards : []);
        setCurrentPage(response.pagination?.page ?? page);
        setTotalPages(response.pagination?.total_pages ?? 0);
      } catch (fetchError) {
        if (requestId !== latestRequestIdRef.current) return;

        setGiftCards([]);
        setTotalPages(0);
        setError(fetchError instanceof Error ? fetchError.message : "No se pudieron cargar las Gift Cards");
      } finally {
        if (requestId !== latestRequestIdRef.current) return;

        setIsInitialLoading(false);
        setIsFetching(false);
      }
    },
    [selectedSedeId, statusFilter, token]
  );

  useEffect(() => {
    if (!searchInput.trim()) {
      setSearchTerm("");
      return;
    }

    const timeout = setTimeout(() => {
      setSearchTerm(searchInput.trim());
    }, 350);

    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    if (authLoading || !token) return;

    if (!isSuperAdmin) {
      const userSedeId = user?.sede_id || sessionStorage.getItem("beaux-sede_id") || "";
      setSelectedSedeId(userSedeId);
      return;
    }

    let isMounted = true;

    const fetchSedes = async () => {
      try {
        setIsLoadingSedes(true);
        const list = await sedeService.getSedes(token);

        if (!isMounted) return;

        setSedes(list);

        const storedSedeId = sessionStorage.getItem("beaux-sede_id") || "";
        const selected = list.find((sede) => sede.sede_id === storedSedeId)?.sede_id || list[0]?.sede_id || "";
        setSelectedSedeId(selected);
      } catch (sedesError) {
        if (!isMounted) return;

        setError(sedesError instanceof Error ? sedesError.message : "No se pudieron cargar las sedes");
      } finally {
        if (isMounted) {
          setIsLoadingSedes(false);
        }
      }
    };

    fetchSedes();

    return () => {
      isMounted = false;
    };
  }, [authLoading, isSuperAdmin, token, user?.sede_id]);

  useEffect(() => {
    if (!token || !selectedSedeId) return;
    loadGiftCards(1);
  }, [loadGiftCards, selectedSedeId, token]);

  const handleCreateGiftCard = async (submission: CreateGiftCardSubmission) => {
    if (!token) {
      throw new Error("Sesión no disponible. Inicia sesión nuevamente.");
    }

    setIsCreatingGiftCard(true);

    try {
      const created = await giftcardsService.createGiftCard(token, submission.payload);
      const refreshed = await giftcardsService
        .refreshGiftCardAfterCreate(token, created.giftcard.codigo)
        .catch(() => created.giftcard);

      setLatestCreatedGiftCard(refreshed);
      setLatestCreatedEmail(submission.beneficiaryEmail);
      setCreateModalOpen(false);
      setConfirmModalOpen(true);

      toast({
        title: "Gift Card creada",
        description: `Código ${refreshed.codigo} generado correctamente.`,
      });

      await loadGiftCards(1, { preserveInitial: true });
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : "No se pudo crear la Gift Card";
      toast({
        title: "Error creando Gift Card",
        description: message,
      });
      throw new Error(message);
    } finally {
      setIsCreatingGiftCard(false);
    }
  };

  const goToPage = (page: number) => {
    if (page < 1 || (totalPages > 0 && page > totalPages) || page === currentPage) return;
    loadGiftCards(page, { preserveInitial: true });
  };

  const paginationItems = useMemo(() => {
    if (totalPages <= 1) return [] as Array<number | "dots-left" | "dots-right">;

    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1) as Array<
        number | "dots-left" | "dots-right"
      >;
    }

    const pages = new Set<number>([1, currentPage - 1, currentPage, currentPage + 1, totalPages]);
    const sorted = Array.from(pages).filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);

    const result: Array<number | "dots-left" | "dots-right"> = [];
    for (let index = 0; index < sorted.length; index += 1) {
      const value = sorted[index];
      const previous = sorted[index - 1];
      if (previous && value - previous > 1) {
        result.push(previous === 1 ? "dots-left" : "dots-right");
      }
      result.push(value);
    }

    return result;
  }, [currentPage, totalPages]);

  if (authLoading) {
    return (
      <div className="flex flex-col h-screen items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3 text-gray-600">
          <Loader2 className="h-5 w-5 animate-spin" />
          Cargando sesión...
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col h-screen bg-gray-50">
        <Sidebar />

        <main className="flex-1 overflow-auto">
          <div className="w-full space-y-6 p-4 md:p-8">
            <PageHeader
              title="Gift Cards"
              subtitle="Gestión de tarjetas de regalo emitidas y saldo disponible"
              actions={
                <Button
                  className="bg-black text-white hover:bg-gray-800"
                  onClick={() => setCreateModalOpen(true)}
                  disabled={!selectedSedeId}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Nuevo
                </Button>
              }
            />

            <GiftCardsSummaryCards
              activeCount={summaryMetrics.activeCount}
              totalIssued={summaryMetrics.totalIssued}
              pendingBalance={summaryMetrics.pendingBalance}
              currency={displayCurrency}
              isRefreshing={isFetching}
            />

            <section className="rounded-xl border border-gray-300 bg-white px-5 py-4 shadow-sm">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                {isSuperAdmin ? (
                  <div className="lg:col-span-3">
                    <label className={FILTER_LABEL_CLASS}>Sede</label>
                    <select
                      value={selectedSedeId}
                      onChange={(event) => setSelectedSedeId(event.target.value)}
                      className={FILTER_CONTROL_CLASS}
                      disabled={isLoadingSedes}
                    >
                      <option value="">Selecciona una sede</option>
                      {sedes.map((sede) => (
                        <option key={sede._id} value={sede.sede_id}>
                          {sede.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="lg:col-span-3">
                    <label className={FILTER_LABEL_CLASS}>Sede</label>
                    <Input
                      value={selectedSedeName}
                      readOnly
                      className={`${INPUT_CONTROL_CLASS} bg-gray-50`}
                    />
                  </div>
                )}

                <div className="lg:col-span-3">
                  <label className={FILTER_LABEL_CLASS}>Estado</label>
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                    className={FILTER_CONTROL_CLASS}
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="lg:col-span-6">
                  <label className={FILTER_LABEL_CLASS}>Buscar</label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <Input
                        value={searchInput}
                        onChange={(event) => setSearchInput(event.target.value)}
                        placeholder="Buscar..."
                        className={`${INPUT_CONTROL_CLASS} pl-9`}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 border-gray-300 text-gray-700 hover:bg-gray-100"
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      Filtrar
                    </Button>
                  </div>
                </div>
              </div>
            </section>

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <div>{error}</div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 border-red-300 text-red-700 hover:bg-red-100"
                  onClick={() => loadGiftCards(currentPage || 1, { preserveInitial: true })}
                >
                  Reintentar
                </Button>
              </div>
            ) : null}

            {isInitialLoading && giftCards.length === 0 ? (
              <Card className="border-gray-300 shadow-sm">
                <CardContent className="flex items-center justify-center py-16 text-gray-600">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Cargando Gift Cards...
                </CardContent>
              </Card>
            ) : (
              <GiftCardsTable
                giftCards={filteredGiftCards}
                currency={displayCurrency}
                isFetching={isFetching}
                sedeNamesById={sedeNamesById}
                fallbackSedeName={selectedSedeName}
              />
            )}

            {totalPages > 1 ? (
              <div className="flex flex-col gap-2 rounded-xl border border-gray-300 bg-white px-5 py-4 text-sm shadow-sm sm:flex-row sm:items-center sm:justify-end">
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => goToPage(currentPage - 1)}
                    disabled={currentPage === 1 || isFetching}
                    className="h-8 border-gray-300 px-2 text-gray-700 hover:bg-gray-100"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>

                  {paginationItems.map((item, index) =>
                    typeof item === "number" ? (
                      <button
                        key={`${item}-${index}`}
                        type="button"
                        onClick={() => goToPage(item)}
                        disabled={isFetching}
                        className={`h-8 min-w-8 rounded-md border px-2 text-xs font-medium transition-colors ${
                          item === currentPage
                            ? "border-black bg-black text-white"
                            : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                        }`}
                      >
                        {item}
                      </button>
                    ) : (
                      <span key={`${item}-${index}`} className="px-1 text-xs text-gray-500">
                        ...
                      </span>
                    )
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => goToPage(currentPage + 1)}
                    disabled={currentPage >= totalPages || isFetching}
                    className="h-8 border-gray-300 px-2 text-gray-700 hover:bg-gray-100"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>

                  <button
                    type="button"
                    onClick={() => goToPage(currentPage + 1)}
                    disabled={currentPage >= totalPages || isFetching}
                    className="ml-2 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:cursor-not-allowed disabled:text-gray-400"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </main>
      </div>

      <CreateGiftCardModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        token={token}
        sedeId={selectedSedeId}
        sedeName={selectedSedeName}
        currency={displayCurrency}
        onCreate={handleCreateGiftCard}
        isSubmitting={isCreatingGiftCard}
      />

      <GiftCardConfirmationModal
        open={confirmModalOpen}
        onOpenChange={setConfirmModalOpen}
        giftCard={latestCreatedGiftCard}
        fallbackCurrency={displayCurrency}
        beneficiaryEmail={latestCreatedEmail}
        sedeNamesById={sedeNamesById}
        fallbackSedeName={selectedSedeName}
      />

      <Toaster />
    </>
  );
}
