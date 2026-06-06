"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader, Pencil, Plus, Search, ShieldCheck, Trash2, UserCog } from "lucide-react";
import { confirmAction } from '../../../components/ui/confirm-dialog';
import { Sidebar } from "../../../components/Layout/Sidebar";
import { useAuth } from "../../../components/Auth/AuthContext";
import type { CreateSystemUserPayload, SystemUser } from "../../../types/system-user";
import { systemUsersService } from "./systemUsersService";
import { SystemUserFormModal } from "./system-user-form-modal";
import { formatSedeNombre } from "../../../lib/sede";
import { sedeService } from "../Sedes/sedeService";

const roleBadgeClasses: Record<string, string> = {
  super_admin: "bg-gray-900 text-white",
  admin_sede: "bg-blue-50 text-blue-700",
  recepcionista: "bg-amber-50 text-amber-700",
  call_center: "bg-emerald-50 text-emerald-700",
  estilista: "bg-fuchsia-50 text-fuchsia-700",
};

const roleLabels: Record<string, string> = {
  super_admin: "super_admin",
  admin_sede: "admin_sede",
  recepcionista: "recepcionista",
  call_center: "call_center",
  estilista: "estilista",
};

const normalizeRoleKey = (role: string) => role.trim().toLowerCase().replace(/[\s-]+/g, "_");

export default function SystemUsersPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [sedeNamesById, setSedeNamesById] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingUser, setEditingUser] = useState<SystemUser | null>(null);

  const isSuperAdmin = useMemo(
    () => {
      const role = normalizeRoleKey(user?.role || "");
      return role === "super_admin" || role === "superadmin";
    },
    [user?.role]
  );

  const selectedUser = useMemo(
    () => users.find((systemUser) => systemUser._id === selectedUserId) || null,
    [users, selectedUserId]
  );

  const getSedeDisplayName = (systemUser: Pick<SystemUser, "sede_id" | "sede_nombre">) => {
    const sedeNombreRaw = systemUser.sede_nombre?.trim();
    if (sedeNombreRaw) {
      return formatSedeNombre(sedeNombreRaw, sedeNombreRaw);
    }

    const sedeId = systemUser.sede_id?.trim();
    if (!sedeId) {
      return "Sin sede asignada";
    }

    return sedeNamesById[sedeId] || "Sede no disponible";
  };

  const getAllowedSedesDisplayName = (
    systemUser: Pick<SystemUser, "sede_id" | "sede_nombre" | "sedes_permitidas">
  ) => {
    const sedesPermitidas = Array.from(
      new Set(
        (systemUser.sedes_permitidas || [])
          .map((sedeId) => String(sedeId ?? "").trim())
          .filter(Boolean)
      )
    );

    if (sedesPermitidas.length === 0) {
      const primarySede = getSedeDisplayName(systemUser);
      return primarySede !== "Sin sede asignada" ? primarySede : "Sin sedes asignadas";
    }

    const nombres = Array.from(
      new Set(
        sedesPermitidas.map((sedeId) => {
          if (sedeId === systemUser.sede_id?.trim()) {
            const sedePrincipal = getSedeDisplayName(systemUser);
            if (sedePrincipal && sedePrincipal !== "Sede no disponible") {
              return sedePrincipal;
            }
          }

          const sedeNombre = sedeNamesById[sedeId];
          return sedeNombre ? formatSedeNombre(sedeNombre, sedeNombre) : "Sede no disponible";
        })
      )
    );

    return nombres.join(", ");
  };

  const formatProductCommission = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "No configurada";
    return `${value}%`;
  };

  const filteredUsers = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return users;

    return users.filter((systemUser) => {
      const roleKey = normalizeRoleKey(systemUser.role);
      const roleLabel = (roleLabels[roleKey] || systemUser.role).toLowerCase();
      const sedeNombre = getSedeDisplayName(systemUser).toLowerCase();

      return (
        systemUser.nombre.toLowerCase().includes(query) ||
        systemUser.email.toLowerCase().includes(query) ||
        roleLabel.includes(query) ||
        sedeNombre.includes(query)
      );
    });
  }, [searchTerm, users, sedeNamesById]);

  const loadSystemUsers = async () => {
    if (!user?.access_token) {
      setError("No hay token de autenticación disponible");
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      setSuccessMessage(null);
      const data = await systemUsersService.getSystemUsers(user.access_token);
      setUsers(data);
      setSelectedUserId((currentSelectedUserId) => {
        if (data.length === 0) return "";
        if (currentSelectedUserId && data.some((systemUser) => systemUser._id === currentSelectedUserId)) {
          return currentSelectedUserId;
        }
        return data[0]._id;
      });
    } catch (err) {
      console.error("Error cargando usuarios del sistema:", err);
      setError(err instanceof Error ? err.message : "Error al cargar usuarios del sistema");
    } finally {
      setIsLoading(false);
    }
  };

  const loadSedeNames = async () => {
    if (!user?.access_token) return;
    try {
      const sedes = await sedeService.getSedes(user.access_token);
      const nextSedeNamesById = sedes.reduce<Record<string, string>>((acc, sede) => {
        const sedeId = sede.sede_id?.trim();
        if (!sedeId) return acc;

        const sedeNombre = formatSedeNombre(sede.nombre, sede.nombre);
        acc[sedeId] = sedeNombre || sede.nombre || "Sede";
        return acc;
      }, {});
      setSedeNamesById(nextSedeNamesById);
    } catch (err) {
      console.error("Error cargando nombres de sedes para usuarios del sistema:", err);
    }
  };

  useEffect(() => {
    if (!authLoading && user) {
      loadSystemUsers();
      loadSedeNames();
    }
  }, [authLoading, user?.access_token]);

  const handleCreateSystemUser = async (payload: CreateSystemUserPayload) => {
    if (!user?.access_token) {
      throw new Error("No hay token de autenticación disponible");
    }
    if (!isSuperAdmin) {
      throw new Error("No autorizado para crear usuarios del sistema");
    }

    setIsSaving(true);
    try {
      const result = await systemUsersService.createSystemUser(user.access_token, payload);
      await loadSystemUsers();
      if (result.warning) {
        setError(null);
        setSuccessMessage(`Usuario creado correctamente. Nota: ${result.warning}`);
      } else {
        setError(null);
        setSuccessMessage("Usuario creado correctamente.");
      }
      closeModal();
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateSystemUser = async (payload: CreateSystemUserPayload) => {
    if (!user?.access_token) {
      throw new Error("No hay token de autenticación disponible");
    }
    if (!isSuperAdmin) {
      throw new Error("No autorizado para editar usuarios del sistema");
    }
    if (!editingUser?._id) {
      throw new Error("No se encontró el usuario a editar");
    }

    setIsSaving(true);
    try {
      const result = await systemUsersService.updateSystemUser(user.access_token, editingUser._id, payload);
      await loadSystemUsers();
      if (result.warning) {
        setError(null);
        setSuccessMessage(`Usuario actualizado correctamente. Nota: ${result.warning}`);
      } else {
        setError(null);
        setSuccessMessage("Usuario actualizado correctamente.");
      }
      closeModal();
    } finally {
      setIsSaving(false);
    }
  };

  const openCreateModal = () => {
    setModalMode("create");
    setEditingUser(null);
    setIsModalOpen(true);
  };

  const openEditModal = () => {
    if (!selectedUser) return;
    setModalMode("edit");
    setEditingUser(selectedUser);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingUser(null);
    setModalMode("create");
  };

  const handleDeleteSystemUser = async () => {
    if (!selectedUser || !user?.access_token) return;
    if (!isSuperAdmin) {
      setError("No autorizado para eliminar usuarios del sistema");
      return;
    }

    const isSelfUser = selectedUser.email.trim().toLowerCase() === user.email.trim().toLowerCase();
    if (isSelfUser) {
      setError("No puedes eliminar tu propio usuario.");
      return;
    }

    const confirmed = await confirmAction({ title: "Confirmar", message: `Vas a eliminar el usuario "${selectedUser.nombre}" (${selectedUser.email}). Esta accion no se puede deshacer.`, confirmLabel: "Sí, eliminar", variant: "danger" });
    if (!confirmed) return;

    setError(null);
    setSuccessMessage(null);
    setIsDeleting(true);
    try {
      const result = await systemUsersService.deleteSystemUser(user.access_token, selectedUser._id);
      await loadSystemUsers();

      if (result.softDeleted) {
        setError("El backend no soporta borrado fisico; el usuario fue desactivado.");
      } else {
        setSuccessMessage("Usuario eliminado correctamente.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el usuario del sistema.");
    } finally {
      setIsDeleting(false);
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <Loader className="h-8 w-8 animate-spin text-gray-900" />
          <span className="text-sm text-gray-600">
            {authLoading ? "Verificando autenticación..." : "Cargando usuarios del sistema..."}
          </span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center bg-white">
        <div className="text-center">
          <div className="text-sm text-gray-600 mb-2">No autenticado</div>
          <div className="text-xs text-gray-500">Inicia sesión para acceder</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      <Sidebar />

      <div className="flex flex-1 overflow-hidden">
        <div className="w-96 border-r border-gray-100 bg-white overflow-y-auto">
          <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-5 w-5 text-gray-900" />
                <h1 className="text-lg font-semibold text-gray-900">Usuarios Sistema</h1>
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                  {searchTerm ? `${filteredUsers.length}/${users.length}` : users.length}
                </span>
              </div>

              {isSuperAdmin && (
                <button
                  onClick={openCreateModal}
                  className="h-8 px-3 text-xs bg-gray-900 text-white rounded hover:bg-gray-800 flex items-center gap-1"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Nuevo usuario
                </button>
              )}
            </div>

            <div className="mt-3 relative">
              <Search className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por nombre, email o sede..."
                className="w-full h-9 pl-8 pr-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-200 focus:border-gray-300"
              />
            </div>
          </div>

          {!isSuperAdmin && (
            <div className="mx-6 mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
              Solo superadmin puede gestionar usuarios del sistema.
            </div>
          )}

          {successMessage && (
            <div className="mx-6 mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded">
              <div className="text-xs text-emerald-700">{successMessage}</div>
            </div>
          )}

          {error && (
            <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded">
              <div className="text-xs text-red-700">{error}</div>
              <button
                onClick={loadSystemUsers}
                className="mt-2 text-xs text-red-700 hover:text-red-900 underline"
              >
                Reintentar
              </button>
            </div>
          )}

          <div className="p-2">
            {filteredUsers.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-gray-500">
                No se encontraron usuarios con ese criterio.
              </div>
            )}

            {filteredUsers.map((systemUser) => {
              const roleKey = normalizeRoleKey(systemUser.role);
              const badgeClass = roleBadgeClasses[roleKey] || "bg-gray-100 text-gray-700";
              const isSelected = selectedUserId === systemUser._id;

              return (
                <button
                  key={systemUser._id}
                  onClick={() => setSelectedUserId(systemUser._id)}
                  className={`w-full text-left p-3 rounded-lg border mb-2 transition-colors ${
                    isSelected
                      ? "border-gray-900 bg-gray-50"
                      : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{systemUser.nombre}</div>
                      <div className="text-xs text-gray-600 truncate">{systemUser.email}</div>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${badgeClass}`}>
                      {roleLabels[roleKey] || systemUser.role}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500">
                    <span>{systemUser.activo ? "Activo" : "Inactivo"}</span>
                    <span>{getSedeDisplayName(systemUser)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-gray-50">
          {selectedUser ? (
            <div className="max-w-3xl mx-auto p-6">
              <div className="bg-white border border-gray-100 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                    <UserCog className="h-5 w-5 text-gray-700" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">{selectedUser.nombre}</h2>
                    <p className="text-sm text-gray-600">{selectedUser.email}</p>
                  </div>
                  {isSuperAdmin && (
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        onClick={openEditModal}
                        className="inline-flex items-center gap-1 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        disabled={isDeleting}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={handleDeleteSystemUser}
                        className="inline-flex items-center gap-1 rounded border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                        disabled={isDeleting}
                      >
                        {isDeleting ? (
                          <>
                            <Loader className="h-3.5 w-3.5 animate-spin" />
                            Eliminando...
                          </>
                        ) : (
                          <>
                            <Trash2 className="h-3.5 w-3.5" />
                            Eliminar
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500 mb-1">Rol</p>
                    <p className="text-gray-900 font-medium">
                      {roleLabels[normalizeRoleKey(selectedUser.role)] || selectedUser.role}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500 mb-1">Estado</p>
                    <p className="text-gray-900 font-medium">
                      {selectedUser.activo ? "Activo" : "Inactivo"}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500 mb-1">Sede</p>
                    <p className="text-gray-900 font-medium">
                      {getSedeDisplayName(selectedUser)}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500 mb-1">Sedes permitidas</p>
                    <p className="text-gray-900 font-medium">
                      {getAllowedSedesDisplayName(selectedUser)}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500 mb-1">Tipo de usuario</p>
                    <p className="text-gray-900 font-medium">{selectedUser.user_type || "system"}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 mb-1">Comisión productos</p>
                    <p className="text-gray-900 font-medium">
                      {formatProductCommission(selectedUser.comision_productos)}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500 mb-1">Especialidades</p>
                    <p className="text-gray-900 font-medium">
                      {selectedUser.especialidades?.length
                        ? `${selectedUser.especialidades.length} servicio(s)`
                        : "Sin especialidades"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-8">
              <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center mb-6">
                <UserCog className="h-12 w-12 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                {users.length === 0 ? "No hay usuarios del sistema" : "Selecciona un usuario"}
              </h3>
              <p className="text-sm text-gray-600 text-center max-w-sm">
                {users.length === 0
                  ? "Crea el primer usuario administrativo desde el boton Nuevo."
                  : "Selecciona un usuario del listado para ver sus datos."}
              </p>
            </div>
          )}
        </div>
      </div>

      <SystemUserFormModal
        isOpen={isModalOpen}
        onClose={closeModal}
        onSave={modalMode === "edit" ? handleUpdateSystemUser : handleCreateSystemUser}
        mode={modalMode}
        initialUser={editingUser}
        isSaving={isSaving}
      />
    </div>
  );
}
