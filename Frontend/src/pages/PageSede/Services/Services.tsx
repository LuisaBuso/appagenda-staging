"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "../../../components/Layout/Sidebar";
import { PageHeader } from "../../../components/Layout/PageHeader";
import { ServicesList } from "./services-list";
import { ServiceFormModal } from "./service-form-modal";
import { ServiceFilters } from "./service-filters";
import { Button } from "../../../components/ui/button";
import { Plus, Loader, AlertCircle } from "lucide-react";
import { confirmAction } from '../../../components/ui/confirm-dialog';
import { serviciosService, type ServiceWithCurrency } from "./serviciosService";
import { useAuth } from "../../../components/Auth/AuthContext";

export default function ServicesPage() {
  const [services, setServices] = useState<ServiceWithCurrency[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<ServiceWithCurrency | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    search: "",
    categoria: "all",
    activo: "all",
  });

  const { user, isLoading: authLoading } = useAuth();

  // Determinar moneda basada en el país del usuario
  const monedaUsuario = user?.pais 
    ? serviciosService.getMonedaFromPais(user.pais)
    : 'USD';

  // Cargar servicios desde la API con la moneda del usuario
  const loadServices = async () => {
    if (!user?.access_token) {
      setError('No hay token de autenticación disponible');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      
      // Obtener servicios con la moneda del usuario
      const servicesData = await serviciosService.getServicios(
        user.access_token, 
        monedaUsuario
      );
      
      console.log('📥 Servicios recibidos:', {
        moneda: monedaUsuario,
        pais: user.pais,
        cantidad: servicesData.length
      });
      
      setServices(servicesData);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error al cargar los servicios';
      setError(errorMessage);
      console.error('Error cargando servicios:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user) {
      loadServices();
    }
  }, [user, authLoading, monedaUsuario]);

  const handleAddService = () => {
    setSelectedService(null);
    setIsModalOpen(true);
  };

  const handleEditService = (service: ServiceWithCurrency) => {
    setSelectedService(service);
    setIsModalOpen(true);
  };

  const handleSaveService = async (service: ServiceWithCurrency) => {
    if (!user?.access_token) {
      setError('No hay token de autenticación disponible');
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      if (selectedService) {
        // Actualizar servicio existente
        await serviciosService.updateServicio(
          user.access_token,
          selectedService.id,
          {
            nombre: service.nombre,
            duracion_minutos: service.duracion,
            categoria: service.categoria,
            comision_estilista: service.comision_porcentaje,
            activo: service.activo,
            requiere_producto: service.requiere_producto || false
          }
        );
      } else {
        console.warn('Creación de servicios requiere formulario con precios por moneda');
        throw new Error('La creación de servicios requiere definir precios para todas las monedas');
      }

      // Recargar la lista
      await loadServices();
      setIsModalOpen(false);
      setSelectedService(null);

    } catch (err) {
      console.error('Error al guardar servicio:', err);
      setError(err instanceof Error ? err.message : 'Error al guardar el servicio');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteService = async (id: string) => {
    if (!user?.access_token) {
      setError('No hay token de autenticación disponible');
      return;
    }

    const confirmed = await confirmAction({ title: "Confirmar", message: "¿Estás seguro de que quieres eliminar este servicio?", confirmLabel: "Sí, eliminar", variant: "danger" });
    if (!confirmed) {
      return;
    }

    try {
      await serviciosService.deleteServicio(user.access_token, id);
      await loadServices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar el servicio');
      console.error('Error eliminando servicio:', err);
    }
  };

  const filteredServices = services.filter((service) => {
    const matchSearch =
      service.nombre.toLowerCase().includes(filters.search.toLowerCase()) ||
      (service.descripcion && service.descripcion.toLowerCase().includes(filters.search.toLowerCase()));

    const matchCategoria =
      filters.categoria === "all" || service.categoria === filters.categoria;

    const matchActivo =
      filters.activo === "all" ||
      (filters.activo === "active" ? service.activo : !service.activo);

    return matchSearch && matchCategoria && matchActivo;
  });

  // Mostrar carga mientras se verifica la autenticación
  if (authLoading || isLoading) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3">
          <Loader className="h-6 w-6 animate-spin text-blue-600" />
          <span className="text-lg text-gray-600">
            {authLoading ? "Verificando autenticación..." : "Cargando servicios..."}
          </span>
        </div>
      </div>
    );
  }

  // Si no hay usuario autenticado
  if (!user) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="text-red-600 text-lg mb-4">No autenticado</div>
          <div className="text-gray-600">Por favor inicia sesión para acceder a esta página</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-50">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-8">
          {/* Encabezado */}
          <PageHeader
            title="Servicios"
            subtitle={`Precios en ${monedaUsuario} para ${user.pais || "internacional"}${
              monedaUsuario === "USD" && user.pais !== "Ecuador" ? " (internacional)" : ""
            }`}
            actions={
              <Button
                onClick={handleAddService}
                className="bg-gray-900 text-white hover:bg-gray-800"
              >
                <Plus className="mr-2 h-4 w-4" /> Añadir servicio
              </Button>
            }
          />

          {/* Mensaje de error */}
          {error && (
            <div className="mb-6 rounded-lg bg-red-50 p-4">
              <div className="flex items-center">
                <AlertCircle className="mr-3 h-5 w-5 text-red-500" />
                <div className="text-sm text-red-700">
                  {error}
                  <button 
                    onClick={loadServices}
                    className="ml-2 font-medium text-red-800 hover:text-red-900 underline"
                  >
                    Reintentar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Filtros */}
          <ServiceFilters
            filters={filters}
            onFiltersChange={setFilters}
          />

          {/* Lista de servicios */}
          <div className="mt-6">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-gray-600">
                Mostrando {filteredServices.length} de {services.length} servicios
              </p>
              {services.length > 0 && (
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={loadServices}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <Loader className="h-4 w-4 animate-spin mr-1" />
                  ) : null}
                  Actualizar lista
                </Button>
              )}
            </div>
            
            <ServicesList
              services={filteredServices}
              onEdit={handleEditService}
              onDelete={handleDeleteService}
            />
          </div>
        </div>
      </main>

      {/* Modal */}
      <ServiceFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveService}
        service={selectedService}
        isSaving={isSaving}
      />
    </div>
  );
}
