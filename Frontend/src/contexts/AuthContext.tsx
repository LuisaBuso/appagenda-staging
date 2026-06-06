import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import { API_BASE_URL } from "../types/config"

type User = {
  id: string
  name: string
  email: string
  role: string
  token: string
}

type AuthContextType = {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string, remember?: boolean) => Promise<boolean>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Limpiar storage
  const clearAuthStorage = useCallback(() => {
    const keys = ["rizotipo-id", "rizotipo-name", "rizotipo-email", "rizotipo-role", "access_token"]
    keys.forEach((k) => {
      localStorage.removeItem(k)
      sessionStorage.removeItem(k)
    })
  }, [])

  // Inicializar autenticación
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const storedEmail = localStorage.getItem("rizotipo-email") || sessionStorage.getItem("rizotipo-email")
        const storedToken = localStorage.getItem("access_token") || sessionStorage.getItem("access_token")

        if (storedEmail && storedToken) {
          const userData: User = {
            id: localStorage.getItem("rizotipo-id") || sessionStorage.getItem("rizotipo-id") || "",
            name: localStorage.getItem("rizotipo-name") || sessionStorage.getItem("rizotipo-name") || "",
            email: storedEmail,
            role: localStorage.getItem("rizotipo-role") || sessionStorage.getItem("rizotipo-role") || "user",
            token: storedToken,
          }
          setUser(userData)
        } else {
          clearAuthStorage()
        }
      } catch (error) {
        console.error("Error inicializando auth:", error)
        clearAuthStorage()
      } finally {
        setIsLoading(false)
      }
    }

    initializeAuth()
  }, [clearAuthStorage])

  // Login contra FastAPI
  const login = useCallback(
    async (email: string, password: string, remember: boolean = true): Promise<boolean> => {
      setIsLoading(true)
      try {
        const response = await fetch(`${API_BASE_URL}/auth/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            username: email,
            password: password,
          }),
        })

        if (!response.ok) {
          throw new Error("Credenciales incorrectas")
        }

        const data = await response.json()
        // data = { access_token, email, name }

        const userData: User = {
          id: data.email, // si tu backend devuelve un _id cámbialo aquí
          name: data.name,
          email: data.email,
          role: "user", // si backend devuelve roles, cámbialo
          token: data.access_token,
        }

        setUser(userData)
        clearAuthStorage()

        const storage = remember ? localStorage : sessionStorage
        storage.setItem("rizotipo-id", userData.id)
        storage.setItem("rizotipo-name", userData.name)
        storage.setItem("rizotipo-email", userData.email)
        storage.setItem("rizotipo-role", userData.role)
        storage.setItem("access_token", userData.token)

        return true
      } catch (error) {
        console.error("Error en login:", error)
        return false
      } finally {
        setIsLoading(false)
      }
    },
    [clearAuthStorage]
  )

  // Logout
  const logout = useCallback(() => {
    setUser(null)
    clearAuthStorage()
  }, [clearAuthStorage])

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
