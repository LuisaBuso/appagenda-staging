"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2, Pencil, Search, X } from "lucide-react";
import { useAuth } from "../../../components/Auth/AuthContext";
import {
  createDirectSale,
  deleteDirectSaleProduct,
  type DirectSaleSellerOption,
  fetchAllDirectSaleSellers,
  fetchInventoryProductDetail,
  fetchInventoryProducts,
  type InventoryProduct,
  type PaymentMethod,
  registerDirectSalePayment,
  verifyDirectSaleInBillingReport,
} from "./directSalesApi";
import { handleFacturarRequest } from "./facturarApi";
import { CASH_PAYMENT_METHOD_OPTIONS } from "../CierreCaja/constants";
import { ClientSearch } from "../Appoinment/Clients/ClientSearch";
import type { Cliente } from "../../../components/Quotes/clientsService";

interface DirectSaleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaleCompleted?: (saleId: string) => void;
}

interface CartItem {
  productId: string;
  inventoryId: string;
  name: string;
  ref: string;
  category: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  sellerId: string;
  stockAvailable: number;
}

const UI_PAYMENT_METHODS = CASH_PAYMENT_METHOD_OPTIONS;

const roundMoney = (v: number) => Math.round(v * 100) / 100;

const getInitials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

export function DirectSaleModal({
  isOpen,
  onClose,
  onSaleCompleted,
}: DirectSaleModalProps) {
  const { user } = useAuth();

  const token =
    user?.access_token ||
    sessionStorage.getItem("access_token") ||
    localStorage.getItem("access_token") ||
    "";
  const sedeId =
    user?.sede_id ||
    sessionStorage.getItem("beaux-sede_id") ||
    localStorage.getItem("beaux-sede_id") ||
    "";
  const currency = String(
    user?.moneda || sessionStorage.getItem("beaux-moneda") || "USD"
  ).toUpperCase();

  // ── Products ────────────────────────────────────────────────────────────
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // ── Cart ────────────────────────────────────────────────────────────────
  const [cartByProductId, setCartByProductId] = useState<
    Record<string, CartItem>
  >({});
  const [validatingProductId, setValidatingProductId] = useState<string | null>(
    null
  );
  const [removingProductId, setRemovingProductId] = useState<string | null>(
    null
  );

  // ── Sellers ─────────────────────────────────────────────────────────────
  const [allSellers, setAllSellers] = useState<DirectSaleSellerOption[]>([]);
  const [openSellerDropdownId, setOpenSellerDropdownId] = useState<
    string | null
  >(null);

  // ── Client ──────────────────────────────────────────────────────────────
  const [clienteSeleccionado, setClienteSeleccionado] = useState<Cliente | null>(null);

  // ── Payment ─────────────────────────────────────────────────────────────
  const [selectedPaymentMethods, setSelectedPaymentMethods] = useState<
    Set<string>
  >(new Set());
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, number>>(
    {}
  );
  const [showDeliveryInput, setShowDeliveryInput] = useState(false);
  const [deliveryCostInput, setDeliveryCostInput] = useState("0");

  // ── Sale state ──────────────────────────────────────────────────────────
  const [saleId, setSaleId] = useState<string | null>(null);
  const [saleComplete, setSaleComplete] = useState(false);
  const [isCreatingSale, setIsCreatingSale] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [isVerifyingReport, setIsVerifyingReport] = useState(false);

  // ── Price editing ────────────────────────────────────────────────────────
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editingPriceValue, setEditingPriceValue] = useState("");

  // ── Errors ──────────────────────────────────────────────────────────────
  const [actionError, setActionError] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── Derived values ──────────────────────────────────────────────────────
  const cartItems = useMemo(
    () => Object.values(cartByProductId),
    [cartByProductId]
  );

  const cartTotal = useMemo(
    () =>
      roundMoney(
        cartItems.reduce((sum, item) => {
          const effectivePrice =
            item.unitPrice * (1 - item.discountPct / 100);
          return sum + effectivePrice * item.quantity;
        }, 0)
      ),
    [cartItems]
  );

  const deliveryCost = useMemo(() => {
    const p = Number.parseFloat(deliveryCostInput);
    return Number.isFinite(p) && p > 0 ? roundMoney(p) : 0;
  }, [deliveryCostInput]);

  const finalTotal = useMemo(
    () => roundMoney(cartTotal + deliveryCost),
    [cartTotal, deliveryCost]
  );

  const paymentBreakdownTotal = useMemo(
    () =>
      roundMoney(
        [...selectedPaymentMethods].reduce(
          (sum, m) => sum + (paymentAmounts[m] || 0),
          0
        )
      ),
    [selectedPaymentMethods, paymentAmounts]
  );

  const isBalanced =
    paymentBreakdownTotal > 0 &&
    Math.abs(paymentBreakdownTotal - finalTotal) < 0.01;
  const pendingAmount = Math.max(0, roundMoney(finalTotal - paymentBreakdownTotal));

  const filteredProducts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.ref.toLowerCase().includes(q)
    );
  }, [products, searchTerm]);

  const hasItems = cartItems.length > 0;
  const isBusy =
    isLoadingProducts ||
    isCreatingSale ||
    isProcessingPayment ||
    isVerifyingReport;

  const canConfirm =
    !isBusy &&
    cartItems.length > 0 &&
    selectedPaymentMethods.size > 0 &&
    isBalanced &&
    !saleComplete;

  // ── Reset ────────────────────────────────────────────────────────────────
  const resetState = () => {
    setProducts([]);
    setProductsError(null);
    setSearchTerm("");
    setCartByProductId({});
    setValidatingProductId(null);
    setRemovingProductId(null);
    setAllSellers([]);
    setOpenSellerDropdownId(null);
    setClienteSeleccionado(null);
    setSelectedPaymentMethods(new Set());
    setPaymentAmounts({});
    setShowDeliveryInput(false);
    setDeliveryCostInput("0");
    setSaleId(null);
    setSaleComplete(false);
    setIsCreatingSale(false);
    setIsProcessingPayment(false);
    setIsVerifyingReport(false);
    setActionError(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  // ── Load products & sellers ──────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      resetState();
      return;
    }
    if (!token) return;

    const load = async () => {
      setIsLoadingProducts(true);
      setProductsError(null);
      try {
        const [prods, sellers] = await Promise.all([
          fetchInventoryProducts(token, currency),
          fetchAllDirectSaleSellers(token, sedeId).catch(() => [] as DirectSaleSellerOption[]),
        ]);
        setProducts(prods.filter((p) => p.active));
        setAllSellers(sellers);
      } catch (err) {
        setProductsError(
          err instanceof Error
            ? err.message
            : "No se pudieron cargar los productos."
        );
      } finally {
        setIsLoadingProducts(false);
      }
    };

    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // F2 → focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F2" && isOpen) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen]);

  // Close seller dropdown on outside click
  useEffect(() => {
    if (!openSellerDropdownId) return;
    const handler = () => setOpenSellerDropdownId(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [openSellerDropdownId]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const formatCurrency = (v: number) => {
    try {
      return new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(v);
    } catch {
      return (
        "$" +
        Math.round(v ?? 0).toLocaleString("es-CO", { maximumFractionDigits: 0 })
      );
    }
  };

  const getDefaultSellerId = () => allSellers[0]?.id ?? "";

  const togglePaymentMethod = (method: string) => {
    setSelectedPaymentMethods((prev) => {
      const next = new Set(prev);
      if (next.has(method)) {
        next.delete(method);
        setPaymentAmounts((a) => {
          const n = { ...a };
          delete n[method];
          return n;
        });
      } else {
        next.add(method);
        const currentTotal = [...prev].reduce(
          (sum, m) => sum + (paymentAmounts[m] || 0),
          0
        );
        const remaining = roundMoney(finalTotal - currentTotal);
        if (remaining > 0) {
          setPaymentAmounts((a) => ({ ...a, [method]: remaining }));
        }
      }
      return next;
    });
  };

  const removePaymentMethod = (method: string) => {
    setSelectedPaymentMethods((prev) => {
      const next = new Set(prev);
      next.delete(method);
      return next;
    });
    setPaymentAmounts((prev) => {
      const next = { ...prev };
      delete next[method];
      return next;
    });
  };

  // ── Cart actions ─────────────────────────────────────────────────────────
  const addProductToCart = async (product: InventoryProduct) => {
    if (saleId) {
      setActionError("La venta ya fue creada. Completa el pago.");
      return;
    }
    if (!token) {
      setActionError("Sin token de autenticación.");
      return;
    }

    setValidatingProductId(product.productId);
    setActionError(null);

    try {
      const detail = await fetchInventoryProductDetail({
        token,
        inventoryId: product.inventoryId,
        fallbackInventoryId: product.productId,
        currency,
      });

      const existing = cartByProductId[product.productId];
      const nextQty = (existing?.quantity ?? 0) + 1;

      if (nextQty > detail.stockAvailable) {
        setActionError(
          `Stock insuficiente para "${detail.name}". Disponible: ${detail.stockAvailable}.`
        );
        return;
      }

      setCartByProductId((prev) => ({
        ...prev,
        [product.productId]: {
          productId: product.productId,
          inventoryId: product.inventoryId,
          name: detail.name,
          ref: detail.ref || product.ref,
          category: product.category,
          quantity: nextQty,
          unitPrice: detail.unitPrice,
          discountPct: existing?.discountPct ?? 0,
          sellerId: existing?.sellerId ?? getDefaultSellerId(),
          stockAvailable: detail.stockAvailable,
        },
      }));

      if (hasItems) setSearchTerm("");
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "No se pudo validar el stock."
      );
    } finally {
      setValidatingProductId(null);
    }
  };

  const updateQuantity = (productId: string, delta: number) => {
    if (saleId) return;
    const item = cartByProductId[productId];
    if (!item) return;
    const next = item.quantity + delta;
    if (next <= 0) {
      setCartByProductId((prev) => {
        const n = { ...prev };
        delete n[productId];
        return n;
      });
      return;
    }
    if (next > item.stockAvailable) {
      setActionError(`Stock máximo disponible: ${item.stockAvailable}.`);
      return;
    }
    setCartByProductId((prev) => ({
      ...prev,
      [productId]: { ...item, quantity: next },
    }));
  };

  const updateDiscount = (productId: string, value: string) => {
    if (saleId) return;
    const item = cartByProductId[productId];
    if (!item) return;
    const parsed = Math.min(100, Math.max(0, Number.parseFloat(value) || 0));
    setCartByProductId((prev) => ({
      ...prev,
      [productId]: { ...item, discountPct: parsed },
    }));
  };

  const updateUnitPrice = (productId: string, rawValue: string) => {
    if (saleId) return;
    const item = cartByProductId[productId];
    if (!item) return;
    const parsed = Math.max(0, parseFloat(rawValue.replace(/\./g, "").replace(",", ".")) || 0);
    setCartByProductId((prev) => ({
      ...prev,
      [productId]: { ...item, unitPrice: parsed },
    }));
  };

  const updateSeller = (productId: string, sellerId: string) => {
    const item = cartByProductId[productId];
    if (!item) return;
    setCartByProductId((prev) => ({
      ...prev,
      [productId]: { ...item, sellerId },
    }));
  };

  const removeProduct = async (productId: string) => {
    const item = cartByProductId[productId];
    if (!item) return;
    setRemovingProductId(productId);
    try {
      if (saleId && token) {
        await deleteDirectSaleProduct(token, saleId, productId);
      }
      setCartByProductId((prev) => {
        const n = { ...prev };
        delete n[productId];
        return n;
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "No se pudo eliminar el producto."
      );
    } finally {
      setRemovingProductId(null);
    }
  };

  // ── Sale creation ────────────────────────────────────────────────────────
  const toLineItems = () =>
    cartItems.map((item) => ({
      productId: item.productId,
      inventoryId: item.inventoryId,
      name: item.name,
      quantity: item.quantity,
      unitPrice: roundMoney(item.unitPrice * (1 - item.discountPct / 100)),
    }));

  const getPrimarySeller = () => {
    const id = cartItems[0]?.sellerId;
    return allSellers.find((s) => s.id === id) ?? null;
  };

  const createSaleIfNeeded = async (
    firstMethod: PaymentMethod
  ): Promise<string> => {
    if (saleId) return saleId;
    if (!token) throw new Error("Sin token de autenticación.");
    if (!sedeId) throw new Error("Sin sede activa.");
    if (cartItems.length === 0) throw new Error("Agrega al menos un producto.");

    setIsCreatingSale(true);
    const seller = getPrimarySeller();

    const created = await createDirectSale({
      token,
      sedeId,
      total: finalTotal,
      deliveryCost,
      paymentMethod: firstMethod,
      items: toLineItems(),
      seller: seller
        ? {
            id: seller.id,
            nombre: seller.nombre,
            tipo: seller.tipo,
            profesionalId: seller.profesionalId,
            email: seller.email,
            rol: seller.rol,
            sedeId: seller.sedeId,
          }
        : undefined,
      ...(clienteSeleccionado && {
        client: {
          id: clienteSeleccionado.cliente_id,
          nombre: clienteSeleccionado.nombre,
          email: clienteSeleccionado.correo,
          telefono: clienteSeleccionado.telefono,
        },
      }),
    });

    setSaleId(created.saleId);
    setIsCreatingSale(false);
    return created.saleId;
  };

  const handleConfirm = async () => {
    if (cartItems.length === 0) {
      setActionError("Agrega al menos un producto.");
      return;
    }
    if (selectedPaymentMethods.size === 0) {
      setActionError("Selecciona un método de pago.");
      return;
    }
    if (!isBalanced) {
      setActionError("El total cobrado no coincide con el total de la venta.");
      return;
    }

    const plannedPayments = [...selectedPaymentMethods]
      .map((m) => ({
        method: m as PaymentMethod,
        amount: roundMoney(paymentAmounts[m] || 0),
      }))
      .filter((p) => p.amount > 0);

    if (plannedPayments.length === 0) {
      setActionError("Ingresa los montos de pago.");
      return;
    }

    setIsProcessingPayment(true);
    setActionError(null);

    try {
      const targetSaleId = await createSaleIfNeeded(plannedPayments[0].method);

      for (const payment of plannedPayments) {
        await registerDirectSalePayment({
          token,
          saleId: targetSaleId,
          amount: payment.amount,
          paymentMethod: payment.method,
        });
      }

      if (sedeId) {
        setIsVerifyingReport(true);
        await verifyDirectSaleInBillingReport({
          token,
          sedeId,
          saleId: targetSaleId,
        }).catch(() => {});
        setIsVerifyingReport(false);
      }

      await handleFacturarRequest({
        id: targetSaleId,
        tipo: "venta",
        token,
        productos: cartItems.map((i) => ({
          producto_id: i.productId,
          nombre: i.name,
          precio: roundMoney(i.unitPrice * (1 - i.discountPct / 100)),
          cantidad: i.quantity,
          categoria: i.category || "",
        })),
        total_productos: roundMoney(cartTotal),
        total_final: finalTotal,
      }).catch(() => {});

      setSaleComplete(true);
      onSaleCompleted?.(targetSaleId);

      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Error al registrar el pago."
      );
    } finally {
      setIsCreatingSale(false);
      setIsProcessingPayment(false);
      setIsVerifyingReport(false);
    }
  };

  const handleImprimir = async () => {
    if (cartItems.length === 0) return;
    try {
      const firstMethod =
        ([...selectedPaymentMethods][0] as PaymentMethod) ?? "efectivo";
      const targetSaleId = await createSaleIfNeeded(firstMethod);
      await handleFacturarRequest({
        id: targetSaleId,
        tipo: "venta",
        token,
        productos: cartItems.map((i) => ({
          producto_id: i.productId,
          nombre: i.name,
          precio: roundMoney(i.unitPrice * (1 - i.discountPct / 100)),
          cantidad: i.quantity,
          categoria: i.category || "",
        })),
        total_productos: roundMoney(cartTotal),
        total_final: finalTotal,
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Error al imprimir."
      );
    }
  };

  if (!isOpen) return null;

  const showSearchDropdown = hasItems && searchTerm.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex flex-col w-full max-w-[1060px] max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-gray-900">Venta directa</h2>
            <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest bg-gray-100 text-gray-500 rounded">
              Facturación rápida
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">Sin cita · Productos</span>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row flex-1 min-h-0">

          {/* Left panel */}
          <div className="flex flex-1 flex-col min-h-0 min-w-0">

            {/* Search bar */}
            <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Buscar producto por nombre, referencia o categoría..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-14 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400 bg-gray-50 placeholder:text-gray-400"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 bg-white border border-gray-200 px-1.5 py-0.5 rounded font-mono select-none">
                  F2
                </span>

                {/* Search dropdown (when cart has items) */}
                {showSearchDropdown && (
                  <div className="absolute top-full left-0 right-0 z-30 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-72 overflow-y-auto">
                    {filteredProducts.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-gray-400">
                        Sin resultados
                      </p>
                    ) : (
                      filteredProducts.map((product) => {
                        const isValidating =
                          validatingProductId === product.productId;
                        return (
                          <button
                            key={product.productId}
                            onClick={() => void addProductToCart(product)}
                            disabled={isBusy || isValidating}
                            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0 text-left disabled:opacity-50"
                          >
                            <div>
                              <span className="text-sm font-medium text-gray-900">
                                {product.name}
                              </span>
                              {product.ref && (
                                <span className="ml-2 text-xs text-gray-400">
                                  {product.ref}
                                </span>
                              )}
                              <span className="ml-2 text-xs text-gray-400">
                                · {product.category}
                              </span>
                            </div>
                            <div className="text-right flex-shrink-0 ml-4">
                              <span className="text-sm font-bold text-gray-900">
                                {formatCurrency(product.unitPrice)}
                              </span>
                              <span className="ml-2 text-xs text-gray-400">
                                Stock: {product.stockAvailable}
                              </span>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Main content area */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {!hasItems ? (
                /* ── Product catalog table ── */
                isLoadingProducts ? (
                  <div className="flex items-center justify-center h-40 text-sm text-gray-400">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Cargando productos...
                  </div>
                ) : productsError ? (
                  <div className="p-5 text-sm text-red-500">{productsError}</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 px-5 py-3">
                          Producto
                        </th>
                        <th className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 px-3 py-3 w-24">
                          Ref
                        </th>
                        <th className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 px-3 py-3 w-32">
                          Categoría
                        </th>
                        <th className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 px-3 py-3 w-20">
                          Stock
                        </th>
                        <th className="text-right text-[10px] font-bold uppercase tracking-widest text-gray-400 px-5 py-3 w-28">
                          Precio
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProducts.map((product) => {
                        const isValidating =
                          validatingProductId === product.productId;
                        return (
                          <tr
                            key={product.productId}
                            onClick={() =>
                              !isBusy &&
                              !isValidating &&
                              void addProductToCart(product)
                            }
                            className={`border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors ${
                              isValidating ? "opacity-50 pointer-events-none" : ""
                            }`}
                          >
                            <td className="px-5 py-3 font-medium text-gray-900">
                              {product.name}
                            </td>
                            <td className="px-3 py-3 text-gray-400 text-xs">
                              {product.ref || "—"}
                            </td>
                            <td className="px-3 py-3 text-gray-500">
                              {product.category}
                            </td>
                            <td className="px-3 py-3 text-gray-500">
                              {product.stockAvailable}
                            </td>
                            <td className="px-5 py-3 text-right font-bold text-gray-900">
                              {formatCurrency(product.unitPrice)}
                            </td>
                          </tr>
                        );
                      })}
                      {filteredProducts.length === 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-5 py-12 text-center text-sm text-gray-400"
                          >
                            No hay productos disponibles
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )
              ) : (
                /* ── Cart items table ── */
                <div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 px-4 py-3">
                          Estilista / Producto
                        </th>
                        <th className="text-center text-[10px] font-bold uppercase tracking-widest text-gray-400 px-2 py-3 w-28">
                          Cant.
                        </th>
                        <th className="text-center text-[10px] font-bold uppercase tracking-widest text-gray-400 px-2 py-3 w-24">
                          Dcto %
                        </th>
                        <th className="text-center text-[10px] font-bold uppercase tracking-widest text-gray-400 px-2 py-3 w-44">
                          Vendedor
                        </th>
                        <th className="text-right text-[10px] font-bold uppercase tracking-widest text-gray-400 px-4 py-3 w-28">
                          Subtotal
                        </th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {cartItems.map((item) => {
                        const isRemoving = removingProductId === item.productId;
                        const seller = allSellers.find(
                          (s) => s.id === item.sellerId
                        );
                        const sellerName = seller?.nombre ?? "";
                        const avatarInitials = sellerName
                          ? getInitials(sellerName)
                          : getInitials(item.name);
                        const subtotal = roundMoney(
                          item.unitPrice *
                            (1 - item.discountPct / 100) *
                            item.quantity
                        );
                        const isDropOpen =
                          openSellerDropdownId === item.productId;

                        return (
                          <tr
                            key={item.productId}
                            className="border-b border-gray-50"
                          >
                            {/* Product info */}
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-full bg-gray-900 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                                  {avatarInitials}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-semibold text-gray-900 truncate">
                                    {item.name}
                                  </div>
                                  <div className="text-xs text-gray-400 mt-0.5">
                                    {item.ref && (
                                      <span>{item.ref} · </span>
                                    )}
                                    <span>{formatCurrency(item.unitPrice)}</span>
                                  </div>
                                </div>
                              </div>
                            </td>

                            {/* Quantity */}
                            <td className="px-2 py-3">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() =>
                                    updateQuantity(item.productId, -1)
                                  }
                                  disabled={isBusy || !!saleId}
                                  className="w-7 h-7 flex items-center justify-center border border-gray-200 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-40 text-sm font-medium"
                                >
                                  −
                                </button>
                                <span className="w-6 text-center font-semibold text-gray-900 text-sm">
                                  {item.quantity}
                                </span>
                                <button
                                  onClick={() =>
                                    updateQuantity(item.productId, 1)
                                  }
                                  disabled={isBusy || !!saleId}
                                  className="w-7 h-7 flex items-center justify-center border border-gray-200 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-40 text-sm font-medium"
                                >
                                  +
                                </button>
                              </div>
                            </td>

                            {/* Discount */}
                            <td className="px-2 py-3">
                              <div className="flex items-center justify-center gap-1">
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={
                                    item.discountPct !== 0
                                      ? item.discountPct
                                      : ""
                                  }
                                  placeholder="0"
                                  onChange={(e) =>
                                    updateDiscount(
                                      item.productId,
                                      e.target.value
                                    )
                                  }
                                  disabled={!!saleId || isBusy}
                                  className="w-12 h-8 text-center border border-gray-200 rounded text-sm focus:outline-none focus:border-gray-400 disabled:opacity-40"
                                />
                                <span className="text-gray-400 text-xs">%</span>
                              </div>
                            </td>

                            {/* Seller dropdown */}
                            <td className="px-2 py-3">
                              <div className="relative">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenSellerDropdownId(
                                      isDropOpen ? null : item.productId
                                    );
                                  }}
                                  disabled={!!saleId || isBusy}
                                  className="flex items-center justify-between gap-1 w-full h-8 px-3 border border-gray-200 rounded text-sm bg-white hover:bg-gray-50 disabled:opacity-40 transition-colors"
                                >
                                  <span className="truncate text-gray-700">
                                    {sellerName || "Seleccionar"}
                                  </span>
                                  <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                                </button>

                                {isDropOpen && (
                                  <div className="absolute top-full left-0 z-40 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                                    {allSellers.map((s) => (
                                      <button
                                        key={s.id}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          updateSeller(item.productId, s.id);
                                          setOpenSellerDropdownId(null);
                                        }}
                                        className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${
                                          s.id === item.sellerId
                                            ? "bg-blue-50 text-blue-700 font-medium"
                                            : "text-gray-700"
                                        }`}
                                      >
                                        {s.nombre}
                                      </button>
                                    ))}
                                    {allSellers.length === 0 && (
                                      <p className="px-3 py-2 text-xs text-gray-400">
                                        Sin vendedores
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>

                            {/* Subtotal */}
                            <td className="px-4 py-3 text-right font-bold text-gray-900">
                              {editingPriceId === item.productId ? (
                                <input
                                  autoFocus
                                  type="text"
                                  inputMode="numeric"
                                  value={editingPriceValue}
                                  onChange={(e) => setEditingPriceValue(e.target.value)}
                                  onBlur={() => {
                                    updateUnitPrice(item.productId, editingPriceValue);
                                    setEditingPriceId(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      updateUnitPrice(item.productId, editingPriceValue);
                                      setEditingPriceId(null);
                                    }
                                    if (e.key === "Escape") setEditingPriceId(null);
                                  }}
                                  className="w-24 text-right border-b border-gray-400 bg-transparent focus:outline-none font-bold text-gray-900 text-sm"
                                />
                              ) : (
                                <div className="inline-flex items-center justify-end gap-1 group">
                                  <span>{formatCurrency(subtotal)}</span>
                                  {!saleId && !isBusy && (
                                    <button
                                      onClick={() => {
                                        setEditingPriceId(item.productId);
                                        setEditingPriceValue(String(item.unitPrice));
                                      }}
                                      title="Editar precio"
                                      className="opacity-30 group-hover:opacity-80 transition-opacity text-gray-500 hover:text-gray-800"
                                    >
                                      <Pencil className="h-2.5 w-2.5" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>

                            {/* Remove */}
                            <td className="pr-3">
                              <button
                                onClick={() => void removeProduct(item.productId)}
                                disabled={isBusy || isRemoving}
                                className="text-gray-300 hover:text-gray-500 disabled:opacity-40 p-1 transition-colors"
                              >
                                {isRemoving ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <X className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* Cart footer */}
                  <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                    <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">
                      {cartItems.length} producto
                      {cartItems.length !== 1 ? "s" : ""}
                    </span>
                    <span className="font-bold text-gray-900">
                      {formatCurrency(cartTotal)}
                    </span>
                  </div>

                  {/* Action error */}
                  {actionError && (
                    <div className="mx-4 mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                      {actionError}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Right panel ───────────────────────────────────────────────── */}
          <div className="w-full sm:w-[340px] flex-shrink-0 border-t sm:border-t-0 sm:border-l border-gray-100 flex flex-col overflow-y-auto max-h-[40vh] sm:max-h-none">

            {/* Client */}
            <div className="px-5 py-4 border-b border-gray-100">
              <ClientSearch
                sedeId={sedeId}
                selectedClient={clienteSeleccionado}
                onClientSelect={setClienteSeleccionado}
                onClientClear={() => setClienteSeleccionado(null)}
                required={false}
              />
            </div>

            {/* Summary */}
            <div className="px-5 py-4 border-b border-gray-100">
              <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">
                Resumen
              </label>
              <div className="space-y-2.5">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Subtotal</span>
                  <span className="font-medium text-gray-900">
                    {formatCurrency(cartTotal)}
                  </span>
                </div>
                <div className="flex justify-between text-sm items-center">
                  <span className="text-gray-500">Envío</span>
                  {showDeliveryInput ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-400">$</span>
                      <input
                        type="number"
                        min={0}
                        value={deliveryCostInput}
                        onChange={(e) => setDeliveryCostInput(e.target.value)}
                        className="w-20 h-7 text-right border border-gray-200 rounded text-sm px-2 focus:outline-none focus:border-gray-400"
                      />
                    </div>
                  ) : deliveryCost > 0 ? (
                    <button
                      onClick={() => setShowDeliveryInput(true)}
                      className="font-medium text-gray-900 text-sm hover:underline"
                    >
                      {formatCurrency(deliveryCost)}
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowDeliveryInput(true)}
                      className="text-gray-400 text-xs hover:text-gray-600 transition-colors"
                    >
                      + Agregar
                    </button>
                  )}
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                  <span className="font-bold text-gray-900 text-base">
                    Total
                  </span>
                  <span className="font-bold text-gray-900 text-xl">
                    {formatCurrency(finalTotal)}
                  </span>
                </div>
              </div>
            </div>

            {/* Payment methods */}
            <div className="px-5 py-4 flex-1">
              <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">
                Métodos de pago
              </label>

              {/* Toggle pills */}
              <div className="flex flex-wrap gap-2 mb-4">
                {UI_PAYMENT_METHODS.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => togglePaymentMethod(m.value)}
                    disabled={isBusy || saleComplete}
                    className={`px-3.5 py-1.5 text-sm rounded-lg border transition-colors font-medium ${
                      selectedPaymentMethods.has(m.value)
                        ? "bg-gray-900 text-white border-gray-900"
                        : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Amount inputs */}
              {selectedPaymentMethods.size > 0 && (
                <div className="space-y-2">
                  {[...selectedPaymentMethods].map((method) => {
                    const label =
                      UI_PAYMENT_METHODS.find((m) => m.value === method)
                        ?.label ?? method;
                    return (
                      <div key={method} className="flex items-center gap-2">
                        <span className="text-sm text-gray-600 w-28 truncate flex-shrink-0">
                          {label}
                        </span>
                        <span className="text-sm text-gray-400 flex-shrink-0">
                          $
                        </span>
                        <input
                          type="number"
                          min={0}
                          value={paymentAmounts[method] ?? ""}
                          onChange={(e) => {
                            const v = Number.parseFloat(e.target.value);
                            setPaymentAmounts((prev) => ({
                              ...prev,
                              [method]: Number.isFinite(v)
                                ? Math.max(0, v)
                                : 0,
                            }));
                          }}
                          disabled={isBusy || saleComplete}
                          placeholder="0"
                          className="flex-1 h-8 text-right border border-gray-200 rounded px-2 text-sm focus:outline-none focus:border-gray-400"
                        />
                        <button
                          onClick={() => removePaymentMethod(method)}
                          disabled={isBusy || saleComplete}
                          className="text-gray-300 hover:text-gray-500 flex-shrink-0 transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}

                  {/* Balance indicator */}
                  {isBalanced && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 font-medium mt-1">
                      ✓ Cuadrado
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Bottom action area */}
            <div className="px-5 pb-5 flex-shrink-0">
              {/* Cobrado / Pendiente */}
              {selectedPaymentMethods.size > 0 && (
                <div className="flex justify-between text-xs text-gray-500 mb-3">
                  <span>
                    Cobrado:{" "}
                    <span className="font-semibold text-gray-700">
                      {formatCurrency(paymentBreakdownTotal)}
                    </span>
                  </span>
                  <span>
                    Pendiente:{" "}
                    <span
                      className={`font-semibold ${
                        pendingAmount > 0 ? "text-red-500" : "text-gray-700"
                      }`}
                    >
                      {formatCurrency(pendingAmount)}
                    </span>
                  </span>
                </div>
              )}

              {/* Action error (right panel fallback) */}
              {actionError && !hasItems && (
                <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {actionError}
                </div>
              )}

              {/* Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => void handleConfirm()}
                  disabled={!canConfirm}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
                    saleComplete
                      ? "bg-gray-900 text-white cursor-default"
                      : canConfirm
                        ? "bg-gray-900 text-white hover:bg-gray-800"
                        : "bg-gray-200 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  {isProcessingPayment || isCreatingSale ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Procesando...
                    </>
                  ) : saleComplete ? (
                    "✓ Venta registrada"
                  ) : (
                    "Confirmar venta"
                  )}
                </button>
                <button
                  onClick={() => void handleImprimir()}
                  disabled={isBusy || cartItems.length === 0}
                  className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40"
                >
                  Imprimir
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
