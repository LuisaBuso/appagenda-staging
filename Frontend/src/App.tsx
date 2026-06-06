import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import BeauxLogin from "./pages/LoginPage/LoginPage";
import { AuthProvider, useAuth } from "./components/Auth/AuthContext";
import {
  APP_MODULES,
  APP_ROLES,
  canAccess,
  getDefaultRouteForRole,
  resolveAppRole,
  type AppModule,
} from "./lib/access-control";
import { Toaster } from "./components/ui/sonner";
import { ConfirmDialogProvider } from "./components/ui/confirm-dialog";
import "./index.css";

/* --- Super Admin Pages --- */
import SuperDashboard from "./pages/PageSuperAdmin/Dashboard/Dashboard";
import SuperPerformance from "./pages/PageSuperAdmin/Perfomance/Perfomance";
import SuperAppointment from "./pages/PageSuperAdmin/Appoinment/Appointment";
import { ProductsList as SuperProducts } from "./pages/PageSuperAdmin/Products/Products";
import SuperSede from "./pages/PageSuperAdmin/Sedes/Sede";
import SuperServices from './pages/PageSuperAdmin/Services/Services';
import SuperComisiones from "./pages/PageSuperAdmin/Comisiones/Comisiones";
import SuperStylist from "./pages/PageSuperAdmin/Styslit/Sytlist";
import SuperClients from "./pages/PageSuperAdmin/Clients/Clients";
import SuperSystemUsers from "./pages/PageSuperAdmin/SystemUsers/SystemUsers";
import SuperPay from "./pages/PageSuperAdmin/Appoinment/PaymentMethods/PaymentMethods"
import SuperInvoices from "./pages/PageSuperAdmin/Sales-invoiced/Sales-invoiced"
import SuperBilling from "./pages/PageSuperAdmin/Billing/Billing"
import GiftCardsPage from "./pages/GiftCards/GiftCardsPage";

/* --- Sede Pages --- */
import SedeDashboard from "./pages/PageSede/Dashboard/Dashboard";
import SedePerformance from "./pages/PageSede/Perfomance/Perfomance";
import SedeAppointment from "./pages/PageSede/Appoinment/Appointment";
import { ProductsList } from "./pages/PageSede/Products/Products";
import SedeClients from "./pages/PageSede/Clients/Clients";
import SedeBilling from "./pages/PageSede/Billing/Billing";
import SedeServices from './pages/PageSede/Services/Services';
import SedeStylists from './pages/PageSede/Styslit/Sytlist';
import SedeCommissions from './pages/PageSede/Comisiones/Comisiones'; // Módulo de comisiones para admin_sede
import SedeInvoices from "./pages/PageSede/Sales-invoiced/Sales-invoiced"
// import CierreCajaPage from "./pages/PageSede/CierreCaja/CierreCaja"

/* --- Stylist Pages --- */
import StylistAppointment from "./pages/PageStylist/Appoinment/Appointment";
import StylistCommissions from "./pages/PageStylist/Comisiones/Comisiones";
import StylistReportsPage from "./pages/PageStylist/Reports/Reports";
import StylistProfilePage from "./pages/PageStylist/Profile/Profile";

/** 🔒 RUTA PRIVADA: Verifica usuario y rol */
const PrivateRoute = ({
  children,
  requiredAccess,
  allowedCurrencies,
}: {
  children: JSX.Element;
  requiredAccess: AppModule | string;
  allowedCurrencies?: string[];
}) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-lg">Cargando...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (!canAccess(requiredAccess, user.role)) {
    return <Navigate to={getDefaultRouteForRole(user.role)} replace />;
  }

  if (allowedCurrencies && allowedCurrencies.length > 0) {
    const userCurrency = String(
      user.moneda || sessionStorage.getItem("beaux-moneda") || ""
    ).toUpperCase();

    if (!allowedCurrencies.map((currency) => currency.toUpperCase()).includes(userCurrency)) {
      return <Navigate to="/unauthorized" replace />;
    }
  }

  return children;
};

const AgendaRoute = () => {
  const { user } = useAuth();
  const role = resolveAppRole(user?.role);

  if (role === APP_ROLES.SUPER_ADMIN || role === APP_ROLES.CALL_CENTER) {
    return <SuperAppointment />;
  }

  if (role === APP_ROLES.ADMIN_SEDE || role === APP_ROLES.RECEPCIONISTA) {
    return <SedeAppointment />;
  }

  if (role === APP_ROLES.ESTILISTA) {
    return <StylistAppointment />;
  }

  return <Navigate to="/unauthorized" replace />;
};

function App() {
  return (
    <Router>
      <AuthProvider>
        <div className="App">
          <Toaster />
          <ConfirmDialogProvider />
          <Routes>
            {/* --- LOGIN --- */}
            <Route path="/" element={<BeauxLogin />} />
            <Route
              path="/agenda"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.AGENDA_HOME}>
                  <AgendaRoute />
                </PrivateRoute>
              }
            />

            {/* --- SUPER ADMIN --- */}
            <Route
              path="/superadmin/dashboard"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SUPER_DASHBOARD}>
                  <SuperDashboard />
                </PrivateRoute>
              }
            />
            <Route
              path="/superadmin/sales-invoices"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SUPER_SALES_INVOICES}>
                  <SuperInvoices />
                </PrivateRoute>
              }
            />
            <Route
              path="/superadmin/paymethods"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SUPER_PAYMETHODS}>
                  <SuperPay />
                </PrivateRoute>
              }
            />
            <Route
              path="/superadmin/performance"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SUPER_PERFORMANCE}>
                  <SuperPerformance />
                </PrivateRoute>
              }
            />
            <Route
              path="/superadmin/appointments"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.AGENDA_GLOBAL}>
                  <SuperAppointment />
                </PrivateRoute>
              }
            />
            <Route
              path="/superadmin/products"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SUPER_PRODUCTS}>
                  <SuperProducts />
                </PrivateRoute>
              }
            />
            <Route
              path="/superadmin/sedes"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SUPER_SEDES}>
                  <SuperSede />
                </PrivateRoute>
              }
            />
            <Route
              path="/superadmin/stylists"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SUPER_STYLISTS}>
                  <SuperStylist />
                </PrivateRoute>
              }
            />
            <Route
              path="/superadmin/services"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SUPER_SERVICES}>
                  <SuperServices />
                </PrivateRoute>
              }
            />
            <Route
              path="/superadmin/commissions"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SUPER_COMMISSIONS}>
                  <SuperComisiones />
                </PrivateRoute>
              }
            />
            <Route
              path="/superadmin/clients"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SUPER_CLIENTS}>
                  <SuperClients />
                </PrivateRoute>
              }
            />
            <Route
              path="/superadmin/system-users"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SUPER_SYSTEM_USERS}>
                  <SuperSystemUsers />
                </PrivateRoute>
              }
            />
            {/* <Route
              path="/superadmin/cierre-caja"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SUPER_CIERRE_CAJA}>
                  <CierreCajaPage />
                </PrivateRoute>
              }
            /> */}
            <Route
              path="/superadmin/gift-cards"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SUPER_GIFT_CARDS}>
                  <GiftCardsPage />
                </PrivateRoute>
              }
            />
            <Route
              path="/superadmin/billing"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SUPER_BILLING}>
                  <SuperBilling />
                </PrivateRoute>
              }
            />


            {/* --- ADMIN SEDE --- */}
            <Route
              path="/sede/dashboard"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SEDE_DASHBOARD}>
                  <SedeDashboard />
                </PrivateRoute>
              }
            />
            <Route
              path="/sede/sales-invoiced"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SEDE_SALES_INVOICED}>
                  <SedeInvoices />
                </PrivateRoute>
              }
            />
            {/* <Route
              path="/sede/cierre-caja"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SEDE_CIERRE_CAJA}>
                  <CierreCajaPage />
                </PrivateRoute>
              }
            /> */}
            {/* Ruta del módulo de Comisiones para admin_sede */}
            <Route
              path="/sede/commissions"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SEDE_COMMISSIONS}>
                  <SedeCommissions />
                </PrivateRoute>
              }
            />
            <Route
              path="/sede/billing"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SEDE_BILLING}>
                  <SedeBilling />
                </PrivateRoute>
              }
            />
            <Route
              path="/sede/gift-cards"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SEDE_GIFT_CARDS}>
                  <GiftCardsPage />
                </PrivateRoute>
              }
            />
            <Route
              path="/sede/performance"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SEDE_PERFORMANCE}>
                  <SedePerformance />
                </PrivateRoute>
              }
            />
            <Route
              path="/sede/appointments"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.AGENDA_SEDE}>
                  <SedeAppointment />
                </PrivateRoute>
              }
            />
            <Route
              path="/sede/products"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SEDE_PRODUCTS}>
                  <ProductsList />
                </PrivateRoute>
              }
            />
            <Route
              path="/sede/clients"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SEDE_CLIENTS}>
                  <SedeClients />
                </PrivateRoute>
              }
            />
            <Route
              path="/sede/services"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SEDE_SERVICES}>
                  <SedeServices />
                </PrivateRoute>
              }
            />
            <Route
              path="/sede/stylists"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.SEDE_STYLISTS}>
                  <SedeStylists />
                </PrivateRoute>
              }
            />

            {/* --- ESTILISTA --- */}
            <Route
              path="/stylist/appointments"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.AGENDA_STYLIST}>
                  <StylistAppointment />
                </PrivateRoute>
              }
            />
            <Route
              path="/stylist/commissions"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.STYLIST_COMMISSIONS}>
                  <StylistCommissions />
                </PrivateRoute>
              }
            />
            <Route
              path="/stylist/reports"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.STYLIST_REPORTS}>
                  <StylistReportsPage />
                </PrivateRoute>
              }
            />
            <Route
              path="/stylist/profile"
              element={
                <PrivateRoute requiredAccess={APP_MODULES.AGENDA_STYLIST}>
                  <StylistProfilePage />
                </PrivateRoute>
              }
            />
            {/* --- SIN PERMISOS --- */}
            <Route
              path="/unauthorized"
              element={
                <div className="flex h-screen items-center justify-center text-lg text-gray-600">
                  No tienes permiso para acceder a esta página.
                </div>
              }
            />

            {/* --- DEFAULT: cualquier ruta redirige --- */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </AuthProvider>
    </Router>
  );
}

export default App;
