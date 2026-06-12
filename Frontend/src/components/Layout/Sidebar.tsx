import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "../../lib/utils";
import {
  LayoutDashboard,
  Users,
  Package,
  CreditCard,
  Gift,
  Wallet,
  Home,
  Menu,
  X,
  LogOut,
  ChevronDown,
} from "lucide-react";
import { useAuth } from "../Auth/AuthContext";
import { APP_MODULES, AGENDA_PATHS, canAccess, type AppModule } from "../../lib/access-control";
import { formatSedeNombre } from "../../lib/sede";
import { getSedeById, getSedes, type Sede as BranchSede } from "../Branch/sedesApi";
import { SedeDropdown } from "../ui/SedeDropdown";

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  module: AppModule;
  currencies?: string[];
}

type SedeOption = {
  sede_id: string;
  nombre: string;
};

const normalizeRole = (value: string | null | undefined): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const normalizeSedeId = (value: string | null | undefined): string => String(value ?? "").trim();

const MULTI_SEDE_ROLES = new Set([
  "super_admin",
  "superadmin",
  "admin_sede",
  "recepcionista",
  "call_center",
  "estilista",
]);

// Catálogo de rutas por rol (cada entrada valida acceso vía APP_MODULES y canAccess).
// Orden: Dashboard → Agenda → Productos → Clientes → Sedes → Estilistas → Usuarios Sistema → Ventas Facturadas → Cierre de Caja → Gift Cards → Servicios
const navItems: NavItem[] = [
  { title: "Dashboard", href: "/superadmin/dashboard", icon: LayoutDashboard, module: APP_MODULES.SUPER_DASHBOARD },
  { title: "Dashboard", href: "/sede/dashboard", icon: LayoutDashboard, module: APP_MODULES.SEDE_DASHBOARD },

  { title: "Agenda", href: "/agenda", icon: Users, module: APP_MODULES.AGENDA_HOME },

  { title: "Productos", href: "/superadmin/products", icon: Package, module: APP_MODULES.SUPER_PRODUCTS },
  { title: "Productos", href: "/sede/products", icon: Package, module: APP_MODULES.SEDE_PRODUCTS },

  { title: "Clientes", href: "/superadmin/clients", icon: Users, module: APP_MODULES.SUPER_CLIENTS },
  { title: "Clientes", href: "/sede/clients", icon: Users, module: APP_MODULES.SEDE_CLIENTS },

  { title: "Sedes", href: "/superadmin/sedes", icon: Home, module: APP_MODULES.SUPER_SEDES },

  { title: "Estilistas", href: "/superadmin/stylists", icon: Users, module: APP_MODULES.SUPER_STYLISTS },
  { title: "Estilistas", href: "/sede/stylists", icon: Users, module: APP_MODULES.SEDE_STYLISTS },

  { title: "Usuarios Sistema", href: "/superadmin/system-users", icon: Users, module: APP_MODULES.SUPER_SYSTEM_USERS },

  { title: "Facturación", href: "/superadmin/billing", icon: CreditCard, module: APP_MODULES.SUPER_BILLING },
  { title: "Facturación", href: "/sede/billing", icon: CreditCard, module: APP_MODULES.SEDE_BILLING },

  { title: "Finanzas", href: "/superadmin/finanzas", icon: Wallet, module: APP_MODULES.SUPER_FINANZAS },
  { title: "Finanzas", href: "/sede/finanzas", icon: Wallet, module: APP_MODULES.SEDE_FINANZAS },

  { title: "Gift Cards", href: "/superadmin/gift-cards", icon: Gift, module: APP_MODULES.SUPER_GIFT_CARDS },
  { title: "Gift Cards", href: "/sede/gift-cards", icon: Gift, module: APP_MODULES.SEDE_GIFT_CARDS },

  { title: "Servicios", href: "/superadmin/services", icon: Package, module: APP_MODULES.SUPER_SERVICES },
];

export function Sidebar() {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { user, activeSedeId, setActiveSedeId, logout } = useAuth();
  const [sedeOptions, setSedeOptions] = useState<SedeOption[]>([]);
  const [loadingSedeOptions, setLoadingSedeOptions] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const getStoredRole = (): string | null => {
    return (
      localStorage.getItem("beaux-role") ||
      sessionStorage.getItem("beaux-role") ||
      localStorage.getItem("beaux-rol") ||
      sessionStorage.getItem("beaux-rol") ||
      (user ? user.role : null)
    );
  };

  const getStoredCurrency = (): string => {
    return String(
      sessionStorage.getItem("beaux-moneda") ||
        localStorage.getItem("beaux-moneda") ||
        user?.moneda ||
        ""
    ).toUpperCase();
  };

  const allowedSedeIds = useMemo(() => {
    const values = new Set<string>();
    const addSedeId = (candidate: string | null | undefined) => {
      const normalized = normalizeSedeId(candidate);
      if (normalized) values.add(normalized);
    };

    addSedeId(user?.sede_id_principal);
    addSedeId(user?.sede_id);
    addSedeId(activeSedeId);

    if (Array.isArray(user?.sedes_permitidas)) {
      user.sedes_permitidas.forEach((sedeId) => addSedeId(sedeId));
    }

    return Array.from(values);
  }, [activeSedeId, user?.sede_id, user?.sede_id_principal, user?.sedes_permitidas]);

  const isSuperAdmin = useMemo(() => {
    const role = normalizeRole(getStoredRole() || "");
    return role === "super_admin" || role === "superadmin";
  }, [user?.role]);

  const supportsMultiSedeSelector = useMemo(() => {
    const role = normalizeRole(getStoredRole() || "");
    return MULTI_SEDE_ROLES.has(role);
  }, [user?.role]);

  const selectedSedeId = useMemo(() => {
    const active = normalizeSedeId(activeSedeId);
    if (active) return active;

    const current = normalizeSedeId(user?.sede_id);
    if (current) return current;

    const primary = normalizeSedeId(user?.sede_id_principal);
    if (primary) return primary;

    return sedeOptions[0]?.sede_id || "";
  }, [activeSedeId, user?.sede_id, user?.sede_id_principal, sedeOptions]);

  const shouldShowSedeSelector =
    !isSuperAdmin && supportsMultiSedeSelector && sedeOptions.length > 1;

  useEffect(() => {
    const fallbackOptions = allowedSedeIds.map((sedeId) => ({ sede_id: sedeId, nombre: sedeId }));

    if (isSuperAdmin) {
      setSedeOptions([]);
      setLoadingSedeOptions(false);
      return;
    }

    if (!user?.access_token) {
      setSedeOptions(fallbackOptions);
      return;
    }

    let isMounted = true;

    const loadSedeOptions = async () => {
      try {
        setLoadingSedeOptions(true);
        const sedes = await getSedes(user.access_token);
        const normalizedSedes = (Array.isArray(sedes) ? sedes : [])
          .map((sede: BranchSede) => {
            const sedeId = normalizeSedeId(sede.sede_id ?? sede.unique_id ?? sede._id);
            if (!sedeId) return null;
            return {
              sede_id: sedeId,
              nombre: formatSedeNombre(sede.nombre, sedeId),
            };
          })
          .filter((sede): sede is SedeOption => Boolean(sede));

        const allowedSet = new Set(allowedSedeIds.map((sedeId) => sedeId.toUpperCase()));
        const scopedSedes = normalizedSedes.filter((sede) =>
          allowedSet.has(sede.sede_id.toUpperCase())
        );

        const mergedById = new Map<string, SedeOption>();
        scopedSedes.forEach((sede) => {
          mergedById.set(sede.sede_id.toUpperCase(), sede);
        });

        const missingAllowedSedeIds = allowedSedeIds.filter((sedeId) => {
          return !mergedById.has(sedeId.toUpperCase());
        });

        if (missingAllowedSedeIds.length > 0) {
          const missingSedeResponses = await Promise.allSettled(
            missingAllowedSedeIds.map((sedeId) => getSedeById(user.access_token, sedeId))
          );

          missingSedeResponses.forEach((response, index) => {
            const sedeId = missingAllowedSedeIds[index];
            if (response.status !== "fulfilled" || !response.value) {
              return;
            }

            const resolvedSedeId = normalizeSedeId(
              response.value.sede_id ?? response.value.unique_id ?? response.value._id ?? sedeId
            );
            if (!resolvedSedeId) return;

            mergedById.set(resolvedSedeId.toUpperCase(), {
              sede_id: resolvedSedeId,
              nombre: formatSedeNombre(response.value.nombre, resolvedSedeId),
            });
          });
        }

        allowedSedeIds.forEach((sedeId) => {
          if (mergedById.has(sedeId.toUpperCase())) return;
          mergedById.set(sedeId.toUpperCase(), { sede_id: sedeId, nombre: sedeId });
        });

        const nextOptions = Array.from(mergedById.values());
        if (isMounted) {
          setSedeOptions(nextOptions.length > 0 ? nextOptions : fallbackOptions);
        }
      } catch (error) {
        console.error("Error cargando sedes en header:", error);
        if (isMounted) {
          setSedeOptions(fallbackOptions);
        }
      } finally {
        if (isMounted) {
          setLoadingSedeOptions(false);
        }
      }
    };

    loadSedeOptions();

    return () => {
      isMounted = false;
    };
  }, [allowedSedeIds, isSuperAdmin, user?.access_token]);

  useEffect(() => {
    if (isSuperAdmin) return;
    if (!selectedSedeId) return;
    if (normalizeSedeId(activeSedeId) === selectedSedeId) return;
    setActiveSedeId(selectedSedeId);
  }, [activeSedeId, isSuperAdmin, selectedSedeId, setActiveSedeId]);

  const handleSedeChange = (sedeId: string) => {
    const normalized = normalizeSedeId(sedeId);
    if (!normalized) return;
    setActiveSedeId(normalized);
  };

  const handleNavigation = (item: NavItem) => {
    navigate(item.href);
    setIsMobileOpen(false);
  };

  const handleLogout = async () => {
    await logout?.();
    navigate("/", { replace: true });
  };

  const visibleItems = navItems.filter((item) => {
    const role = getStoredRole() || "";
    const currency = getStoredCurrency();
    const roleAllowed = canAccess(item.module, role);
    const currencyAllowed = item.currencies ? item.currencies.includes(currency) : true;
    return roleAllowed && currencyAllowed;
  });

  return (
    <>
      {/* Top navigation header */}
      <header className="h-16 bg-white border-b border-gray-200 flex items-center px-4 gap-3 shrink-0 w-full">
        {/* Logo */}
        <h1 className="text-gray-900 font-bold text-base whitespace-nowrap shrink-0">
          RF Salon Agent
        </h1>

        <div className="h-5 w-px bg-gray-200 shrink-0 hidden md:block" />

        {/* Nav items — horizontal, scrollable */}
        <nav className="hidden md:flex items-center gap-0.5 flex-1 overflow-x-auto scrollbar-hide">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              location.pathname === item.href ||
              (item.module === APP_MODULES.AGENDA_HOME &&
                AGENDA_PATHS.includes(location.pathname as (typeof AGENDA_PATHS)[number]));

            const isProductsItem =
              item.module === APP_MODULES.SUPER_PRODUCTS ||
              item.module === APP_MODULES.SEDE_PRODUCTS;

            const isFinanzasItem =
              item.module === APP_MODULES.SUPER_FINANZAS ||
              item.module === APP_MODULES.SEDE_FINANZAS;

            if (isFinanzasItem) {
              const FINANZAS_SUBITEMS = [
                { label: "Estado Financiero", tab: "estado-financiero" },
                { label: "Cierre de Caja", tab: "cierre-caja" },
              ];
              return (
                <div key={item.href} className="relative shrink-0 group">
                  <button
                    onClick={() => navigate(`${item.href}?tab=estado-financiero`)}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors",
                      isActive
                        ? "bg-gray-900 text-white"
                        : "text-gray-700 hover:bg-gray-100"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.title}
                    <ChevronDown className="h-3 w-3 opacity-50" />
                  </button>

                  <div className="absolute left-0 top-full z-50 hidden group-hover:block pt-1">
                    <div className="w-52 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                      {FINANZAS_SUBITEMS.map((sub) => (
                        <button
                          key={sub.tab}
                          onClick={() => {
                            navigate(`${item.href}?tab=${sub.tab}`);
                            setIsMobileOpen(false);
                          }}
                          className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          {sub.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            }

            if (isProductsItem) {
              const PRODUCTOS_SUBITEMS = [
                { label: "Productos", tab: "lista" },
                { label: "Dashboard de productos", tab: "dashboard" },
                { label: "Movimientos", tab: "movimientos" },
                { label: "Kardex", tab: "kardex" },
              ];
              return (
                <div key={item.href} className="relative shrink-0 group">
                  <button
                    onClick={() => navigate(`${item.href}?tab=lista`)}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors",
                      isActive
                        ? "bg-gray-900 text-white"
                        : "text-gray-700 hover:bg-gray-100"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.title}
                    <ChevronDown className="h-3 w-3 opacity-50" />
                  </button>

                  {/* Dropdown — shown via CSS group-hover, no JS timer needed */}
                  <div className="absolute left-0 top-full z-50 hidden group-hover:block pt-1">
                    <div className="w-52 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                      {PRODUCTOS_SUBITEMS.map((sub) => (
                        <button
                          key={sub.tab}
                          onClick={() => {
                            navigate(`${item.href}?tab=${sub.tab}`);
                            setIsMobileOpen(false);
                          }}
                          className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          {sub.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <button
                key={item.href}
                onClick={() => handleNavigation(item)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors shrink-0",
                  isActive
                    ? "bg-gray-900 text-white"
                    : "text-gray-700 hover:bg-gray-100"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.title}
              </button>
            );
          })}
        </nav>

        {/* Spacer on mobile to push controls right */}
        <div className="flex-1 md:hidden" />

        {/* Sede selector */}
        {shouldShowSedeSelector && (
          <div className="hidden md:flex items-center shrink-0">
            <SedeDropdown
              value={selectedSedeId}
              onChange={handleSedeChange}
              options={sedeOptions}
              disabled={loadingSedeOptions}
              size="sm"
              align="right"
            />
          </div>
        )}

        {/* Logout button */}
        <button
          onClick={handleLogout}
          className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900 rounded-md shrink-0 transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Cerrar Sesión
        </button>

        {/* Mobile hamburger button */}
        <button
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="md:hidden p-2 text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
        >
          {isMobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </header>

      {/* Mobile dropdown menu */}
      {isMobileOpen && (
        <div className="md:hidden fixed top-16 left-0 right-0 z-50 bg-white border-b border-gray-200 shadow-lg">
          <nav className="px-4 py-3 flex flex-col gap-1">
            {visibleItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                location.pathname === item.href ||
                (item.module === APP_MODULES.AGENDA_HOME &&
                  AGENDA_PATHS.includes(location.pathname as (typeof AGENDA_PATHS)[number]));

              return (
                <button
                  key={item.href}
                  onClick={() => handleNavigation(item)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg w-full text-left transition-colors",
                    isActive
                      ? "bg-gray-900 text-white"
                      : "text-gray-700 hover:bg-gray-100"
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {item.title}
                </button>
              );
            })}
          </nav>

          {shouldShowSedeSelector && (
            <div className="px-4 pb-3 border-t border-gray-200">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mt-3 mb-2">
                Sede activa
              </p>
              <SedeDropdown
                value={selectedSedeId}
                onChange={handleSedeChange}
                options={sedeOptions}
                disabled={loadingSedeOptions}
                size="md"
                align="left"
                className="w-full [&>button]:w-full [&>button]:justify-between"
              />
            </div>
          )}

          <div className="px-4 pb-3 border-t border-gray-200 mt-1">
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900 rounded-lg w-full transition-colors"
            >
              <LogOut className="h-5 w-5 shrink-0" />
              Cerrar Sesión
            </button>
          </div>
        </div>
      )}
    </>
  );
}
