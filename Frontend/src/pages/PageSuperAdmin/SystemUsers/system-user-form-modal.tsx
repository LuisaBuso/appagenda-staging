"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Loader, X } from "lucide-react";
import { useAuth } from "../../../components/Auth/AuthContext";
import { sedeService, type Sede } from "../Sedes/sedeService";
import { serviciosService } from "../Services/serviciosService";
import type { CreateSystemUserPayload, SystemUser, SystemUserRole } from "../../../types/system-user";
import { formatSedeNombre } from "../../../lib/sede";
import type { Service } from "../../../types/service";

interface SystemUserFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: CreateSystemUserPayload) => Promise<void>;
  mode?: "create" | "edit";
  initialUser?: SystemUser | null;
  isSaving?: boolean;
}

const ROLE_OPTIONS: Array<{ label: string; value: SystemUserRole }> = [
  { label: "super_admin", value: "super_admin" },
  { label: "admin_sede", value: "admin_sede" },
  { label: "recepcionista", value: "recepcionista" },
  { label: "estilista", value: "estilista" },
  { label: "call_center", value: "call_center" },
];

const normalizeRole = (role: string) => role.trim().toLowerCase().replace(/[\s-]+/g, "_");

const toSystemUserRole = (role: string): SystemUserRole => {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "super_admin" || normalizedRole === "superadmin") return "super_admin";
  if (normalizedRole === "adminsede" || normalizedRole === "admin") return "admin_sede";
  if (normalizedRole === "callcenter" || normalizedRole === "soporte") return "call_center";
  if (normalizedRole === "recepcionoista") return "recepcionista";
  if (normalizedRole === "stylist" || normalizedRole === "profesional") return "estilista";
  if (normalizedRole === "admin_sede") return "admin_sede";
  if (normalizedRole === "recepcionista") return "recepcionista";
  if (normalizedRole === "call_center") return "call_center";
  if (normalizedRole === "estilista") return "estilista";
  return "admin_sede";
};

export function SystemUserFormModal({
  isOpen,
  onClose,
  onSave,
  mode = "create",
  initialUser = null,
  isSaving = false,
}: SystemUserFormModalProps) {
  const { user } = useAuth();
  const isEditMode = mode === "edit";

  const [formData, setFormData] = useState({
    nombre: "",
    email: "",
    role: "admin_sede" as SystemUserRole,
    sede_id: "",
    sedes_permitidas: [] as string[],
    especialidades: [] as string[],
    password: "",
    confirm_password: "",
    activo: true,
    comision_productos: "",
  });

  const [sedes, setSedes] = useState<Sede[]>([]);
  const [servicios, setServicios] = useState<Service[]>([]);
  const [isLoadingSedes, setIsLoadingSedes] = useState(false);
  const [isLoadingServicios, setIsLoadingServicios] = useState(false);
  const [isSedeDropdownOpen, setIsSedeDropdownOpen] = useState(false);
  const [isSedesPermitidasDropdownOpen, setIsSedesPermitidasDropdownOpen] = useState(false);
  const [isServiciosDropdownOpen, setIsServiciosDropdownOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiresPrimarySede = formData.role !== "super_admin";
  const canConfigureSedesPermitidas =
    formData.role === "admin_sede" || formData.role === "estilista";
  const formatPercentageInput = (value: string) => {
    const normalized = value.replace(/,/g, ".").replace(/[^0-9.]/g, "");
    const [integerPart, decimalPart] = normalized.split(".");
    const safeInteger = integerPart || "";
    const safeDecimal = decimalPart ? decimalPart.slice(0, 2) : "";
    return safeDecimal ? `${safeInteger}.${safeDecimal}` : safeInteger;
  };

  const canSubmit = useMemo(() => {
    const nombre = formData.nombre.trim();
    const email = formData.email.trim();
    const password = formData.password.trim();
    const confirmPassword = formData.confirm_password.trim();
    const hasRequiredPassword = isEditMode ? true : Boolean(password);
    const hasSede = !requiresPrimarySede || Boolean(formData.sede_id.trim());
    const passwordLengthValid = !password || password.length >= 8;
    const passwordsMatch = isEditMode
      ? !password || password === confirmPassword
      : Boolean(password) && password === confirmPassword;

    return Boolean(
      nombre &&
        email &&
        formData.role &&
        hasSede &&
        hasRequiredPassword &&
        passwordLengthValid &&
        passwordsMatch
    );
  }, [formData, isEditMode, requiresPrimarySede]);

  useEffect(() => {
    if (!isOpen) return;

    if (isEditMode && initialUser) {
      const primarySedeId = initialUser.sede_id?.trim() || "";
      const initialSedesPermitidas = Array.from(
        new Set(
          [
            ...(Array.isArray(initialUser.sedes_permitidas)
              ? initialUser.sedes_permitidas.map((sedeId) => String(sedeId ?? "").trim())
              : []),
            primarySedeId,
          ].filter(Boolean)
        )
      );

      setFormData({
        nombre: initialUser.nombre || "",
        email: initialUser.email || "",
        role: toSystemUserRole(initialUser.role),
        sede_id: primarySedeId,
        sedes_permitidas: initialSedesPermitidas,
        especialidades: Array.isArray(initialUser.especialidades)
          ? initialUser.especialidades.map((esp) => esp.trim()).filter(Boolean)
          : [],
        password: "",
        confirm_password: "",
        activo: Boolean(initialUser.activo),
        comision_productos:
          typeof initialUser.comision_productos === "number"
            ? String(initialUser.comision_productos)
            : "",
      });
    } else {
      setFormData({
        nombre: "",
        email: "",
        role: "admin_sede",
        sede_id: "",
        sedes_permitidas: [],
        especialidades: [],
        password: "",
        confirm_password: "",
        activo: true,
        comision_productos: "",
      });
    }
    setError(null);
  }, [isOpen, isEditMode, initialUser]);

  useEffect(() => {
    const loadData = async () => {
      if (!user?.access_token || !isOpen) return;
      try {
        setIsLoadingSedes(true);
        setIsLoadingServicios(true);

        const [sedesData, serviciosData] = await Promise.all([
          sedeService.getSedes(user.access_token),
          serviciosService.getServicios(user.access_token),
        ]);

        setSedes(sedesData);
        setServicios(serviciosData);
      } catch (err) {
        console.error("Error cargando datos para formulario de usuario del sistema:", err);
      } finally {
        setIsLoadingSedes(false);
        setIsLoadingServicios(false);
      }
    };

    loadData();
  }, [isOpen, user?.access_token]);

  useEffect(() => {
    const handleClickOutside = () => {
      setIsSedeDropdownOpen(false);
      setIsSedesPermitidasDropdownOpen(false);
      setIsServiciosDropdownOpen(false);
    };

    if (isOpen) {
      document.addEventListener("click", handleClickOutside);
    }

    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    if (canConfigureSedesPermitidas) {
      return;
    }

    setFormData((prev) => {
      if (prev.sedes_permitidas.length === 0) return prev;
      return {
        ...prev,
        sedes_permitidas: [],
      };
    });
    setIsSedesPermitidasDropdownOpen(false);
  }, [canConfigureSedesPermitidas]);

  useEffect(() => {
    if (!canConfigureSedesPermitidas) return;
    const sedePrincipal = formData.sede_id.trim();
    if (!sedePrincipal) return;
    if (formData.sedes_permitidas.includes(sedePrincipal)) return;

    setFormData((prev) => ({
      ...prev,
      sedes_permitidas: [...prev.sedes_permitidas, sedePrincipal],
    }));
  }, [canConfigureSedesPermitidas, formData.sede_id, formData.sedes_permitidas]);

  if (!isOpen) return null;

  const stopPropagation = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleSelectSede = (sede: Sede) => {
    setFormData((prev) => {
      const nextSedesPermitidas = canConfigureSedesPermitidas
        ? Array.from(new Set([...prev.sedes_permitidas, sede.sede_id]))
        : prev.sedes_permitidas;

      return {
        ...prev,
        sede_id: sede.sede_id,
        sedes_permitidas: nextSedesPermitidas,
      };
    });
    setIsSedeDropdownOpen(false);
  };

  const getSedeNombre = () => {
    const sedeSeleccionada = sedes.find((s) => s.sede_id === formData.sede_id);
    return sedeSeleccionada ? formatSedeNombre(sedeSeleccionada.nombre, "Seleccionar sede") : "Seleccionar sede";
  };

  const handleToggleServicio = (servicioId: string) => {
    if (!servicioId) return;

    setFormData((prev) => ({
      ...prev,
      especialidades: prev.especialidades.includes(servicioId)
        ? prev.especialidades.filter((id) => id !== servicioId)
        : [...prev.especialidades, servicioId],
    }));
  };

  const handleToggleSedePermitida = (sedeId: string) => {
    const normalizedSedeId = sedeId.trim();
    if (!normalizedSedeId) return;

    setFormData((prev) => {
      const isSelected = prev.sedes_permitidas.includes(normalizedSedeId);
      if (isSelected && normalizedSedeId === prev.sede_id) {
        return prev;
      }

      return {
        ...prev,
        sedes_permitidas: isSelected
          ? prev.sedes_permitidas.filter((id) => id !== normalizedSedeId)
          : [...prev.sedes_permitidas, normalizedSedeId],
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setError(null);

    const nombre = formData.nombre.trim();
    const email = formData.email.trim();
    const password = formData.password.trim();
    const confirmPassword = formData.confirm_password.trim();
    const sedeId = formData.sede_id.trim();

    if (!nombre) {
      setError("Por favor ingresa un nombre.");
      return;
    }

    if (!email) {
      setError("Por favor ingresa un email.");
      return;
    }

    if (requiresPrimarySede && !sedeId) {
      setError("Por favor selecciona una sede principal.");
      return;
    }

    if (!isEditMode && !password) {
      setError("Por favor ingresa una contraseña.");
      return;
    }

    if (password && password.length < 8) {
      setError("La contraseña debe tener mínimo 8 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    const rawProductCommission = formData.comision_productos.trim();
    let comisionProductos: number | null = null;
    if (rawProductCommission) {
      const parsed = Number(rawProductCommission);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        setError("La comisión por productos debe estar entre 0 y 100.");
        return;
      }
      comisionProductos = Math.round(parsed * 100) / 100;
    }

    const especialidadesValidas = (formData.especialidades || [])
      .map((esp) => esp.trim())
      .filter((esp) => Boolean(esp));
    const sedesPermitidasValidas = Array.from(
      new Set(
        (formData.sedes_permitidas || [])
          .map((sedePermitida) => sedePermitida.trim())
          .filter(Boolean)
      )
    );

    if (canConfigureSedesPermitidas && sedeId && !sedesPermitidasValidas.includes(sedeId)) {
      sedesPermitidasValidas.push(sedeId);
    }

    const payload: CreateSystemUserPayload = {
      nombre,
      email,
      role: formData.role,
      sede_id: requiresPrimarySede ? sedeId : undefined,
      sedes_permitidas: canConfigureSedesPermitidas ? sedesPermitidasValidas : undefined,
      especialidades: especialidadesValidas,
      password: password || undefined,
      activo: formData.activo,
      comision_productos: comisionProductos,
    };

    try {
      await onSave(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el usuario del sistema.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4">
      <div className="flex min-h-full items-start justify-center">
        <div
          className="bg-white rounded-lg w-full max-w-md p-6 max-h-[calc(100vh-2rem)] overflow-y-auto"
          onClick={stopPropagation}
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold">
              {isEditMode ? "Editar usuario del sistema" : "Añadir usuario del sistema"}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
              disabled={isSaving}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Nombre *</label>
              <input
                type="text"
                value={formData.nombre}
                onChange={(e) => setFormData((prev) => ({ ...prev, nombre: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-[oklch(0.65_0.25_280)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.65_0.25_280)]/20"
                required
                disabled={isSaving}
                placeholder="Ingresa el nombre completo"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Email *</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-[oklch(0.65_0.25_280)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.65_0.25_280)]/20"
                required
                disabled={isSaving}
                placeholder="ejemplo@correo.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Rol *</label>
              <select
                value={formData.role}
                onChange={(e) => setFormData((prev) => ({ ...prev, role: e.target.value as SystemUserRole }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-[oklch(0.65_0.25_280)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.65_0.25_280)]/20"
                required
                disabled={isSaving}
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Comisión por productos (%)</label>
              <input
                type="text"
                inputMode="decimal"
                value={formData.comision_productos}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    comision_productos: formatPercentageInput(e.target.value),
                  }))
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-[oklch(0.65_0.25_280)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.65_0.25_280)]/20"
                placeholder="Ej: 12.5 (opcional)"
                disabled={isSaving}
              />
              <p className="text-xs text-gray-500 mt-1">Opcional. Valor entre 0 y 100. Dejar vacío para usar las reglas de producto por defecto.</p>
            </div>

            {requiresPrimarySede && (
              <div className="relative">
                <label className="block text-sm font-medium mb-2">Sede principal *</label>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsSedeDropdownOpen(!isSedeDropdownOpen);
                    setIsSedesPermitidasDropdownOpen(false);
                    setIsServiciosDropdownOpen(false);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-[oklch(0.65_0.25_280)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.65_0.25_280)]/20 text-left flex justify-between items-center"
                  disabled={isSaving || isLoadingSedes}
                >
                  <span className={formData.sede_id ? "text-gray-900" : "text-gray-500"}>
                    {isLoadingSedes ? "Cargando sedes..." : getSedeNombre()}
                  </span>
                  {isLoadingSedes ? (
                    <Loader className="h-4 w-4 animate-spin text-gray-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-gray-400" />
                  )}
                </button>

                {isSedeDropdownOpen && !isLoadingSedes && (
                  <div
                    className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                    onClick={stopPropagation}
                  >
                    {sedes.map((sede) => (
                      <button
                        key={sede.sede_id}
                        type="button"
                        onClick={() => handleSelectSede(sede)}
                        className={`w-full text-left px-3 py-2 hover:bg-gray-100 ${
                          formData.sede_id === sede.sede_id ? "bg-blue-50 text-blue-600" : ""
                        }`}
                      >
                        <div className="font-medium">{formatSedeNombre(sede.nombre)}</div>
                        <div className="text-sm text-gray-500 truncate">{sede.direccion}</div>
                      </button>
                    ))}
                    {sedes.length === 0 && (
                      <div className="px-3 py-2 text-sm text-gray-500 text-center">No hay sedes disponibles</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {canConfigureSedesPermitidas && (
              <div className="relative">
                <label className="block text-sm font-medium mb-2">Sedes permitidas</label>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsSedesPermitidasDropdownOpen(!isSedesPermitidasDropdownOpen);
                    setIsSedeDropdownOpen(false);
                    setIsServiciosDropdownOpen(false);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-[oklch(0.65_0.25_280)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.65_0.25_280)]/20 text-left flex justify-between items-center"
                  disabled={isSaving || isLoadingSedes}
                >
                  <span className={formData.sedes_permitidas.length > 0 ? "text-gray-900" : "text-gray-500"}>
                    {isLoadingSedes
                      ? "Cargando sedes..."
                      : formData.sedes_permitidas.length === 0
                      ? "Seleccionar sedes permitidas"
                      : `${formData.sedes_permitidas.length} sede(s) seleccionada(s)`}
                  </span>
                  {isLoadingSedes ? (
                    <Loader className="h-4 w-4 animate-spin text-gray-400" />
                  ) : isSedesPermitidasDropdownOpen ? (
                    <ChevronUp className="h-4 w-4 text-gray-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-gray-400" />
                  )}
                </button>

                {isSedesPermitidasDropdownOpen && !isLoadingSedes && (
                  <div
                    className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                    onClick={stopPropagation}
                  >
                    {sedes.map((sede) => (
                      <label
                        key={`permitida-${sede.sede_id}`}
                        className="flex items-start gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                      >
                        <input
                          type="checkbox"
                          checked={formData.sedes_permitidas.includes(sede.sede_id)}
                          onChange={() => handleToggleSedePermitida(sede.sede_id)}
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-[oklch(0.65_0.25_280)] focus:ring-[oklch(0.65_0.25_280)]"
                          disabled={isSaving}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900">{formatSedeNombre(sede.nombre)}</p>
                          <p className="text-xs text-gray-500">{sede.sede_id}</p>
                        </div>
                      </label>
                    ))}
                    {sedes.length === 0 && (
                      <div className="px-3 py-2 text-sm text-gray-500 text-center">No hay sedes disponibles</div>
                    )}
                  </div>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  La sede principal se incluye automáticamente en permitidas.
                </p>
              </div>
            )}

            {!requiresPrimarySede && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                Para `super_admin` la sede principal no es obligatoria en el contrato actual.
              </div>
            )}

            <div className="relative">
              <label className="block text-sm font-medium mb-2">Especialidades (Servicios)</label>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsServiciosDropdownOpen(!isServiciosDropdownOpen);
                  setIsSedeDropdownOpen(false);
                  setIsSedesPermitidasDropdownOpen(false);
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-[oklch(0.65_0.25_280)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.65_0.25_280)]/20 text-left flex justify-between items-center"
                disabled={isSaving || isLoadingServicios}
              >
                <span className={formData.especialidades.length > 0 ? "text-gray-900" : "text-gray-500"}>
                  {isLoadingServicios
                    ? "Cargando servicios..."
                    : formData.especialidades.length === 0
                    ? "Seleccionar servicios"
                    : `${formData.especialidades.length} servicio(s) seleccionado(s)`}
                </span>
                {isLoadingServicios ? (
                  <Loader className="h-4 w-4 animate-spin text-gray-400" />
                ) : isServiciosDropdownOpen ? (
                  <ChevronUp className="h-4 w-4 text-gray-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-gray-400" />
                )}
              </button>

              {isServiciosDropdownOpen && !isLoadingServicios && (
                <div
                  className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                  onClick={stopPropagation}
                >
                  {servicios.map((servicio) => {
                    const servicioId = servicio.servicio_id || servicio.id;
                    if (!servicioId) return null;

                    return (
                      <label
                        key={servicioId}
                        className="flex items-start gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                      >
                        <input
                          type="checkbox"
                          checked={formData.especialidades.includes(servicioId)}
                          onChange={() => handleToggleServicio(servicioId)}
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-[oklch(0.65_0.25_280)] focus:ring-[oklch(0.65_0.25_280)]"
                          disabled={isSaving}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900">{servicio.nombre}</p>
                          <p className="text-xs text-gray-500">ID: {servicioId}</p>
                        </div>
                      </label>
                    );
                  })}
                  {servicios.length === 0 && (
                    <div className="px-3 py-2 text-sm text-gray-500 text-center">No hay servicios disponibles</div>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                {isEditMode ? "Contraseña (opcional)" : "Contraseña *"}
              </label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-[oklch(0.65_0.25_280)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.65_0.25_280)]/20"
                required={!isEditMode}
                placeholder={
                  isEditMode
                    ? "Dejar vacío para conservar la contraseña actual"
                    : "Ingresa una contraseña segura"
                }
                disabled={isSaving}
                minLength={8}
              />
              <p className="text-xs text-gray-500 mt-1">
                {isEditMode ? "Solo si deseas cambiarla (mínimo 8 caracteres)." : "Mínimo 8 caracteres"}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                {isEditMode ? "Confirmar nueva contraseña" : "Confirmar contraseña *"}
              </label>
              <input
                type="password"
                value={formData.confirm_password}
                onChange={(e) => setFormData((prev) => ({ ...prev, confirm_password: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-[oklch(0.65_0.25_280)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.65_0.25_280)]/20"
                required={!isEditMode || Boolean(formData.password.trim())}
                placeholder="Repite la contraseña"
                disabled={isSaving}
                minLength={8}
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="activo-system-user"
                checked={formData.activo}
                onChange={(e) => setFormData((prev) => ({ ...prev, activo: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300 text-[oklch(0.65_0.25_280)] focus:ring-[oklch(0.65_0.25_280)]"
                disabled={isSaving}
              />
              <label htmlFor="activo-system-user" className="text-sm font-medium text-gray-700">
                Usuario activo
              </label>
            </div>

            {error && (
              <div className="rounded-md bg-red-50 p-3 border border-red-200 text-xs text-red-700">{error}</div>
            )}

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                disabled={isSaving}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-black text-white rounded-lg hover:bg-neutral-900 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                disabled={!canSubmit || isSaving}
              >
                {isSaving ? (
                  <>
                    <Loader className="h-4 w-4 animate-spin" />
                    Guardando...
                  </>
                ) : isEditMode ? (
                  "Guardar cambios"
                ) : (
                  "Crear usuario"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
