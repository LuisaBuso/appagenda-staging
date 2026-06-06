import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { API_BASE_URL } from "../../types/config";
import {
  clearSedeContext,
  getActiveSedeIdFromStorage,
  getPrimarySedeIdFromStorage,
  getSedesPermitidasFromStorage,
  parseSedesPermitidas,
  persistSedeContext,
  resolveActiveSedeId,
} from "../../lib/sede-context";

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  token: string;
  access_token: string;
  pais?: string;
  sede_id?: string;
  sede_id_principal?: string;
  sedes_permitidas?: string[];
  nombre_local?: string;
  moneda?: string;
  zona_horaria?: string;
  telefono?: string;
  direccion?: string;
  informacion_adicional?: string;
  activa?: boolean;
  reglas_comision?: {
    tipo: string;
  };
};

type LocalData = {
  _id: string;
  nombre: string;
  direccion: string;
  informacion_adicional: string;
  zona_horaria: string;
  telefono: string;
  email: string;
  sede_id: string;
  fecha_creacion: string;
  creado_por: string;
  activa: boolean;
  moneda: string;
  reglas_comision: {
    tipo: string;
  };
  pais: string;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  activeSedeId: string | null;
  login: (email: string, password: string, remember?: boolean) => Promise<boolean>;
  setActiveSedeId: (sedeId: string | null) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const normalizeSedeId = (value: string | null | undefined): string | null => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
};

const resolveRole = (loginData: any): string => {
  const rawRole =
    loginData?.rol ||
    loginData?.role ||
    loginData?.user_type ||
    loginData?.userRole ||
    loginData?.user?.rol ||
    loginData?.user?.role ||
    loginData?.user?.user_type ||
    "user";
  return String(rawRole);
};

const resolveLoginSedesPermitidas = (loginData: any): string[] => {
  return parseSedesPermitidas(loginData?.sedes_permitidas ?? loginData?.user?.sedes_permitidas ?? []);
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

const fetchLocalBySedeId = async (sedeId: string, token: string): Promise<LocalData | null> => {
  try {
    const response = await fetch(`${API_BASE_URL}admin/locales/${sedeId}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Error obteniendo locales: ${response.status}`);
    }

    const local: LocalData = await response.json();
    return local || null;
  } catch (error) {
    console.error("Error obteniendo información del local:", error);
    return null;
  }
};

const persistLocalInfoToSession = (localInfo: LocalData) => {
  sessionStorage.setItem("beaux-sede_id", localInfo.sede_id);
  sessionStorage.setItem("beaux-pais", localInfo.pais);
  sessionStorage.setItem("beaux-nombre_local", localInfo.nombre);
  sessionStorage.setItem("beaux-moneda", localInfo.moneda);
  sessionStorage.setItem("beaux-zona_horaria", localInfo.zona_horaria);
  sessionStorage.setItem("beaux-telefono", localInfo.telefono);
  sessionStorage.setItem("beaux-direccion", localInfo.direccion);
  sessionStorage.setItem("beaux-activa", String(localInfo.activa));

  if (localInfo.reglas_comision) {
    sessionStorage.setItem("beaux-reglas_comision", JSON.stringify(localInfo.reglas_comision));
  } else {
    sessionStorage.removeItem("beaux-reglas_comision");
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeSedeId, setActiveSedeIdState] = useState<string | null>(null);
  const hydratedSedeIdRef = useRef<string | null>(null);

  const clearAuthStorage = useCallback(() => {
    hydratedSedeIdRef.current = null;
    const keys = [
      "beaux-id",
      "beaux-name",
      "beaux-email",
      "beaux-role",
      "access_token",
      "beaux-pais",
      "beaux-sede_id",
      "beaux-sede_id_principal",
      "beaux-sedes_permitidas",
      "beaux-active-sede_id",
      "beaux-selected-sede_id",
      "beaux-nombre_local",
      "beaux-moneda",
      "beaux-zona_horaria",
      "beaux-telefono",
      "beaux-direccion",
      "beaux-activa",
      "beaux-reglas_comision",
    ];

    keys.forEach((key) => {
      sessionStorage.removeItem(key);
      localStorage.removeItem(key);
    });

    clearSedeContext();
  }, []);

  const validateToken = useCallback(async (token: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}auth/validate_token`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      return response.ok;
    } catch (error) {
      console.error("Error validando token:", error);
      return false;
    }
  }, []);

  const saveUserToStorage = useCallback((userData: User, _remember: boolean) => {
    const sedesPermitidas = parseSedesPermitidas(userData.sedes_permitidas || []);
    const primarySedeId = normalizeSedeId(userData.sede_id_principal ?? userData.sede_id);
    const resolvedActiveSedeId = resolveActiveSedeId({
      role: userData.role,
      preferredSedeId: userData.sede_id,
      primarySedeId,
      sedesPermitidas,
    });

    sessionStorage.setItem("beaux-id", userData.id);
    sessionStorage.setItem("beaux-name", userData.name);
    sessionStorage.setItem("beaux-email", userData.email);
    sessionStorage.setItem("beaux-role", userData.role);
    sessionStorage.setItem("access_token", userData.token);

    persistSedeContext({
      activeSedeId: resolvedActiveSedeId,
      primarySedeId,
      sedesPermitidas,
    });

    const additionalFields = {
      "beaux-pais": userData.pais,
      "beaux-sede_id": resolvedActiveSedeId ?? undefined,
      "beaux-sede_id_principal": primarySedeId ?? undefined,
      "beaux-sedes_permitidas":
        sedesPermitidas.length > 0 ? JSON.stringify(sedesPermitidas) : undefined,
      "beaux-nombre_local": userData.nombre_local,
      "beaux-moneda": userData.moneda,
      "beaux-zona_horaria": userData.zona_horaria,
      "beaux-telefono": userData.telefono,
      "beaux-direccion": userData.direccion,
      "beaux-activa": userData.activa?.toString(),
      "beaux-reglas_comision": userData.reglas_comision
        ? JSON.stringify(userData.reglas_comision)
        : undefined,
    };

    Object.entries(additionalFields).forEach(([key, value]) => {
      if (value !== undefined) {
        sessionStorage.setItem(key, value);
      }
    });
  }, []);

  const setActiveSedeId = useCallback((requestedSedeId: string | null) => {
    setUser((currentUser) => {
      if (!currentUser) {
        setActiveSedeIdState(null);
        return currentUser;
      }

      const primarySedeId = currentUser.sede_id_principal ?? currentUser.sede_id ?? null;
      const sedesPermitidas = parseSedesPermitidas(currentUser.sedes_permitidas || []);
      const resolvedSedeId = resolveActiveSedeId({
        role: currentUser.role,
        preferredSedeId: requestedSedeId,
        primarySedeId,
        sedesPermitidas,
      });

      persistSedeContext({
        activeSedeId: resolvedSedeId,
        primarySedeId,
        sedesPermitidas,
      });
      setActiveSedeIdState(resolvedSedeId);

      return {
        ...currentUser,
        sede_id: resolvedSedeId ?? undefined,
        sede_id_principal: normalizeSedeId(primarySedeId) ?? undefined,
        sedes_permitidas: sedesPermitidas,
      };
    });
  }, []);

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const storedEmail =
          sessionStorage.getItem("beaux-email") || localStorage.getItem("beaux-email");
        const storedToken =
          sessionStorage.getItem("access_token") || localStorage.getItem("access_token");

        if (storedEmail && storedToken) {
          const isValid = await validateToken(storedToken);

          if (isValid) {
            const role =
              sessionStorage.getItem("beaux-role") ||
              localStorage.getItem("beaux-role") ||
              "user";
            const sedesPermitidas = getSedesPermitidasFromStorage();
            const primarySedeId = normalizeSedeId(getPrimarySedeIdFromStorage());
            const resolvedActiveSedeId = resolveActiveSedeId({
              role,
              preferredSedeId: getActiveSedeIdFromStorage(),
              primarySedeId,
              sedesPermitidas,
            });

            const userData: User = {
              id:
                sessionStorage.getItem("beaux-id") ||
                localStorage.getItem("beaux-id") ||
                "",
              name:
                sessionStorage.getItem("beaux-name") ||
                localStorage.getItem("beaux-name") ||
                "",
              email: storedEmail,
              role,
              token: storedToken,
              access_token: storedToken,
              sede_id: resolvedActiveSedeId ?? undefined,
              sede_id_principal: primarySedeId ?? undefined,
              sedes_permitidas: sedesPermitidas,
              pais:
                sessionStorage.getItem("beaux-pais") ||
                localStorage.getItem("beaux-pais") ||
                undefined,
              nombre_local:
                sessionStorage.getItem("beaux-nombre_local") ||
                localStorage.getItem("beaux-nombre_local") ||
                undefined,
              moneda:
                sessionStorage.getItem("beaux-moneda") ||
                localStorage.getItem("beaux-moneda") ||
                undefined,
              zona_horaria:
                sessionStorage.getItem("beaux-zona_horaria") ||
                localStorage.getItem("beaux-zona_horaria") ||
                undefined,
              telefono:
                sessionStorage.getItem("beaux-telefono") ||
                localStorage.getItem("beaux-telefono") ||
                undefined,
              direccion:
                sessionStorage.getItem("beaux-direccion") ||
                localStorage.getItem("beaux-direccion") ||
                undefined,
              activa:
                (sessionStorage.getItem("beaux-activa") ||
                  localStorage.getItem("beaux-activa")) === "true",
              reglas_comision: (() => {
                const rawValue =
                  sessionStorage.getItem("beaux-reglas_comision") ||
                  localStorage.getItem("beaux-reglas_comision");
                if (!rawValue) return undefined;
                try {
                  return JSON.parse(rawValue);
                } catch {
                  return undefined;
                }
              })(),
            };

            setUser(userData);
            setActiveSedeIdState(resolvedActiveSedeId);

            persistSedeContext({
              activeSedeId: resolvedActiveSedeId,
              primarySedeId,
              sedesPermitidas,
            });
          } else {
            console.warn("Token inválido, limpiando sesión");
            clearAuthStorage();
          }
        } else {
          clearAuthStorage();
        }
      } catch (error) {
        console.error("Error inicializando auth:", error);
        clearAuthStorage();
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();
  }, [clearAuthStorage, validateToken]);

  useEffect(() => {
    const normalizedActiveSedeId = normalizeSedeId(activeSedeId);
    const token = user?.access_token || user?.token;

    if (!normalizedActiveSedeId || !token) return;
    if (hydratedSedeIdRef.current === normalizedActiveSedeId) return;

    let cancelled = false;

    const syncActiveSedeInfo = async () => {
      const localInfo = await fetchLocalBySedeId(normalizedActiveSedeId, token);
      if (!localInfo || cancelled) return;

      hydratedSedeIdRef.current = normalizedActiveSedeId;
      persistLocalInfoToSession(localInfo);

      setUser((currentUser) => {
        if (!currentUser) return currentUser;

        return {
          ...currentUser,
          sede_id: localInfo.sede_id,
          nombre_local: localInfo.nombre,
          moneda: localInfo.moneda,
          pais: localInfo.pais,
          zona_horaria: localInfo.zona_horaria,
          telefono: localInfo.telefono,
          direccion: localInfo.direccion,
          activa: localInfo.activa,
          reglas_comision: localInfo.reglas_comision,
        };
      });
    };

    syncActiveSedeInfo();

    return () => {
      cancelled = true;
    };
  }, [activeSedeId, user?.access_token, user?.token]);

  const login = useCallback(
    async (email: string, password: string, remember: boolean = true): Promise<boolean> => {
      setIsLoading(true);
      try {
        const loginResponse = await fetch(`${API_BASE_URL}auth/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            username: email,
            password,
          }),
        });

        if (!loginResponse.ok) {
          throw new Error("Credenciales incorrectas");
        }

        const loginData = await loginResponse.json();
        const role = resolveRole(loginData);
        const sedesPermitidas = resolveLoginSedesPermitidas(loginData);
        const primarySedeId = normalizeSedeId(loginData.sede_id);
        const resolvedActiveSedeId = resolveActiveSedeId({
          role,
          preferredSedeId: getActiveSedeIdFromStorage(),
          primarySedeId,
          sedesPermitidas,
        });

        const userData: User = {
          id: loginData.email || email,
          name: loginData.nombre || loginData.name || email.split("@")[0],
          email: loginData.email || email,
          role,
          token: loginData.access_token,
          access_token: loginData.access_token,
          sede_id: resolvedActiveSedeId ?? undefined,
          sede_id_principal: primarySedeId ?? undefined,
          sedes_permitidas: sedesPermitidas,
        };

        const sedeForLocalInfo = resolvedActiveSedeId || primarySedeId;
        if (loginData.access_token && sedeForLocalInfo) {
          const localInfo = await fetchLocalBySedeId(sedeForLocalInfo, loginData.access_token);

          if (localInfo) {
            hydratedSedeIdRef.current = normalizeSedeId(localInfo.sede_id);
            userData.pais = localInfo.pais;
            userData.sede_id = localInfo.sede_id;
            userData.nombre_local = localInfo.nombre;
            userData.moneda = localInfo.moneda;
            userData.zona_horaria = localInfo.zona_horaria;
            userData.telefono = localInfo.telefono;
            userData.direccion = localInfo.direccion;
            userData.activa = localInfo.activa;
            userData.reglas_comision = localInfo.reglas_comision;
          } else {
            console.warn("No se encontró información de sede para sede_id:", sedeForLocalInfo);
          }
        }

        setUser(userData);
        setActiveSedeIdState(normalizeSedeId(userData.sede_id));

        clearAuthStorage();
        saveUserToStorage(userData, remember);

        return true;
      } catch (error) {
        console.error("Error en login:", error);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [clearAuthStorage, saveUserToStorage]
  );

  const logout = useCallback(async () => {
    // Mejor esfuerzo: si existe endpoint de logout, llamarlo sin bloquear el flujo
    const token =
      sessionStorage.getItem("access_token") ||
      localStorage.getItem("access_token") ||
      user?.access_token ||
      user?.token;

    if (token) {
      try {
        await fetch(`${API_BASE_URL}auth/logout`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      } catch (error) {
        console.warn("Logout backend falló, se continúa limpiando frontend:", error);
      }
    }

    setUser(null);
    setActiveSedeIdState(null);
    clearAuthStorage();
  }, [clearAuthStorage, user?.access_token, user?.token]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        activeSedeId,
        login,
        setActiveSedeId,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
