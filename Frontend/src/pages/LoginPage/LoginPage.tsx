import React, { useState } from "react";
import { Eye, EyeOff, Mail, Lock, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../components/Auth/AuthContext";
import { getDefaultRouteForRole } from "../../lib/access-control";

// Importar el logo desde assets
import RFLogo from "../../assets/RF PNG.png";

const BeauxLogin: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const success = await login(email, password, rememberMe);

      if (success) {
        const storedRole =
          localStorage.getItem("beaux-role") ||
          sessionStorage.getItem("beaux-role");

        navigate(getDefaultRouteForRole(storedRole));
      } else {
        setError("Credenciales incorrectas o servidor no disponible.");
      }
    } catch (err) {
      console.error(err);
      setError("Error al iniciar sesión. Intenta nuevamente.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          {/* Logo con imagen */}
          <div className="inline-flex items-center justify-center mb-4">
            <img 
              src={RFLogo} 
              alt="RF Logo" 
              className="w-20 h-auto object-contain"
              onError={(e) => {
                // Fallback si la imagen no carga
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                // Mostrar texto como respaldo
                const parent = target.parentElement;
                if (parent) {
                  parent.innerHTML = `
                    <div class="w-16 h-16 bg-black rounded-2xl flex items-center justify-center shadow-lg">
                      <span class="text-white text-2xl font-bold">RF</span>
                    </div>
                  `;
                }
              }}
            />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">RF Salon Agent</h1>
          <p className="text-gray-700">Bienvenido de vuelta</p>
        </div>

        <div className="bg-white rounded-3xl shadow-xl p-8 border border-gray-300">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Email */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-900">
                Correo electrónico
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-3.5 h-5 w-5 text-gray-700" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-gray-500 focus:border-gray-500 transition-colors"
                  placeholder="tu@email.com"
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-900">
                Contraseña
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-3.5 h-5 w-5 text-gray-700" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-gray-500 focus:border-gray-500 transition-colors"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3.5 text-gray-700 hover:text-gray-900"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {/* Remember Me */}
            <div className="flex items-center justify-between">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 text-gray-900 border-gray-400 rounded focus:ring-gray-500"
                />
                <span className="ml-2 text-sm text-gray-800">Recordarme</span>
              </label>
              <button
                type="button"
                className="text-sm text-gray-800 hover:text-black font-medium"
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="p-3 text-sm text-gray-900 bg-gray-100 border border-gray-300 rounded-lg">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-black text-white py-3 rounded-xl font-medium hover:bg-gray-800 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? "Iniciando sesión..." : "Iniciar sesión"}
              {!isLoading && <ArrowRight className="h-5 w-5" />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default BeauxLogin;
