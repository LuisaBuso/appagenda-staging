"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "../../../components/Layout/Sidebar";
import { PageHeader } from "../../../components/Layout/PageHeader";
import { ServicesList } from "./services-list";
import { ServiceFormModal } from "./service-form-modal";
import { ServiceFilters } from "./service-filters";
import { Plus, Loader } from "lucide-react";
import { confirmAction } from '../../../components/ui/confirm-dialog';
import type { Service } from "../../../types/service";
import { serviciosService } from "./serviciosService";
import { useAuth } from "../../../components/Auth/AuthContext";

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    search: "",
    categoria: "all",
    activo: "all",
  });

  const { user, isLoading: authLoading } = useAuth();

  const loadServices = async () => {
    if (!user?.access_token) {
      setError('No hay token de autenticación disponible');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const servicesData = await serviciosService.getServicios(user.access_token);
      setServices(servicesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar los servicios');
      console.error('Error loading services:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user) {
      loadServices();
    }
  }, [user, authLoading]);

  const handleAddService = () => {
    setSelectedService(null);
    setIsModalOpen(true);
  };

  const handleEditService = (service: Service) => {
    setSelectedService(service);
    setIsModalOpen(true);
  };

  const handleSaveService = async (service: Service) => {
    if (!user?.access_token) {
      setError('No hay token de autenticación disponible');
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      if (selectedService) {
        await serviciosService.updateServicio(
          user.access_token,
          selectedService.id,
          {
            nombre: service.nombre,
            duracion_minutos: service.duracion,
            precio: service.precio,
            categoria: service.categoria,
            comision_estilista: service.comision_porcentaje,
            activo: service.activo,
            requiere_producto: service.requiere_producto || false
          }
        );
      } else {
        await serviciosService.createServicio(user.access_token, {
          nombre: service.nombre,
          duracion_minutos: service.duracion,
          precio: service.precio,
          categoria: service.categoria,
          comision_estilista: service.comision_porcentaje,
          activo: service.activo,
          requiere_producto: service.requiere_producto || false
        });
      }

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
      console.error('Error deleting service:', err);
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

  if (authLoading || isLoading) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center">
        <Loader className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-2">No autenticado</div>
          <div className="text-sm text-gray-600">Inicia sesión para continuar</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-4 py-8">
          {/* Header */}
          <PageHeader
            title="Servicios"
            subtitle={`${filteredServices.length} de ${services.length} servicios`}
            actions={
              <button
                onClick={handleAddService}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-gray-900 text-sm text-white hover:bg-gray-800"
              >
                <Plus className="w-4 h-4" />
                Añadir servicio
              </button>
            }
          />

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-3 border border-red-300 bg-red-50">
              <div className="text-sm text-red-800">
                {error}
                <button 
                  onClick={loadServices}
                  className="ml-2 font-medium underline"
                >
                  Reintentar
                </button>
              </div>
            </div>
          )}

          {/* Filters */}
          <ServiceFilters
            filters={filters}
            onFiltersChange={setFilters}
          />

          {/* Services Grid */}
          <ServicesList
            services={filteredServices}
            onEdit={handleEditService}
            onDelete={handleDeleteService}
          />
        </div>
      </main>

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
