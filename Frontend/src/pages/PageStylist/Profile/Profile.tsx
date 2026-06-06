"use client";

import { useMemo } from "react";
import { ArrowLeft, LogOut, Mail, MapPin, Phone, Building2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../components/Auth/AuthContext";
import StylistBottomNav from "../../../components/Layout/StylistBottomNav";

export default function StylistProfilePage() {
  const navigate = useNavigate();
  const { user, logout, activeSedeId, setActiveSedeId } = useAuth();

  const sedesPermitidas: string[] = useMemo(() => {
    if (Array.isArray(user?.sedes_permitidas) && user.sedes_permitidas.length > 0) {
      return user.sedes_permitidas;
    }
    try {
      const raw = sessionStorage.getItem("beaux-sedes_permitidas");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as string[];
      }
    } catch {
      // ignore
    }
    return [];
  }, [user?.sedes_permitidas]);

  const currentSedeId = activeSedeId ?? user?.sede_id ?? "";

  const initials = useMemo(() => {
    const name = user?.name || "";
    const parts = name.trim().split(" ");
    if (parts.length === 0) return "RF";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }, [user?.name]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto w-full max-w-[480px] pb-28">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 text-gray-700"
            aria-label="Volver"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="flex-1 text-center text-base font-semibold text-gray-900">
            RF Salon Agent
          </h1>
          <div className="w-10" />
        </header>

        <main className="space-y-4 px-4 py-4">
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-lg font-semibold text-gray-700">
                {initials}
              </div>
              <div className="flex-1">
                <p className="text-base font-semibold text-gray-900">
                  {user?.name || "Tu perfil"}
                </p>
                <p className="text-sm text-gray-500">
                  {user?.role ? user.role.toString().toLowerCase() : "Estilista"}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3 text-sm text-gray-700">
              {user?.email && (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-gray-500" />
                  <span>{user.email}</span>
                </div>
              )}
              {user?.telefono && (
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-gray-500" />
                  <span>{user.telefono}</span>
                </div>
              )}
              {(user?.nombre_local || user?.sede_id) && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-gray-500" />
                  <span>
                    {user?.nombre_local ? `${user.nombre_local}` : "Sede"}
                  </span>
                </div>
              )}
            </div>
          </section>

          {sedesPermitidas.length >= 2 && (
            <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Building2 className="h-4 w-4 text-gray-500" />
                <h2 className="text-sm font-semibold text-gray-900">Sede activa</h2>
              </div>
              <select
                value={currentSedeId}
                onChange={(e) => setActiveSedeId(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:outline-none focus:ring-0"
              >
                {sedesPermitidas.map((sedeId) => (
                  <option key={sedeId} value={sedeId}>
                    {sedeId === user?.sede_id && user?.nombre_local
                      ? user.nombre_local
                      : sedeId}
                  </option>
                ))}
              </select>
            </section>
          )}

          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900">Preferencias</h2>
            <div className="mt-3 space-y-2 text-sm text-gray-700">
              <div className="flex items-center justify-between">
                <span>Moneda</span>
                <span className="font-semibold text-gray-900">
                  {user?.moneda || "COP"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>País</span>
                <span className="font-semibold text-gray-900">
                  {user?.pais || "No definido"}
                </span>
              </div>
            </div>
          </section>

        </main>

        <div className="px-4 pb-8">
          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate("/", { replace: true });
            }}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-gray-800"
          >
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </button>
        </div>
      </div>

      <StylistBottomNav active="profile" />
    </div>
  );
}
