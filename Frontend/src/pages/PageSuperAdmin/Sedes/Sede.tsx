import { useState, useEffect } from "react";
import { Plus, Loader, AlertCircle } from "lucide-react";
import { SedesList } from "./sedes-list";
import { SedeFormModal } from "./sede-form-modal";
import type { Sede } from "../../../types/sede";
import { sedeService } from "./sedeService";
import { useAuth } from "../../../components/Auth/AuthContext";
import { Sidebar } from "../../../components/Layout/Sidebar";
import { PageHeader } from "../../../components/Layout/PageHeader";
import { Button } from "../../../components/ui/button";
import { Card, CardContent } from "../../../components/ui/card";

export default function SedesPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSede, setSelectedSede] = useState<Sede | null>(null);
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user, isLoading: authLoading } = useAuth();

  const loadSedes = async () => {
    if (!user?.access_token) {
      setError('No hay token de autenticación disponible');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      
      const sedesData = await sedeService.getSedes(user.access_token);
      setSedes(sedesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar las sedes');
      console.error('Error loading sedes:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user) {
      loadSedes();
    }
  }, [user, authLoading]);

  const handleAddSede = () => {
    setSelectedSede(null);
    setIsModalOpen(true);
  };

  const handleEditSede = (sede: Sede) => {
    setSelectedSede(sede);
    setIsModalOpen(true);
  };

  const handleSaveSede = async (sedeData: Sede) => {
    if (!user?.access_token) {
      setError('No hay token de autenticación disponible');
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      if (selectedSede) {
        const response = await sedeService.updateSede(
          user.access_token, 
          selectedSede.sede_id,
          {
            nombre: sedeData.nombre,
            direccion: sedeData.direccion,
            informacion_adicional: sedeData.informacion_adicional,
            zona_horaria: sedeData.zona_horaria,
            pais: sedeData.pais ?? selectedSede.pais,
            moneda: sedeData.moneda ?? selectedSede.moneda,
            telefono: sedeData.telefono,
            email: sedeData.email,
            activa: sedeData.activa
          }
        );

        setSedes(sedes.map((s) => (s.sede_id === response.sede_id ? response : s)));
      } else {
        const response = await sedeService.createSede(user.access_token, {
          nombre: sedeData.nombre,
          direccion: sedeData.direccion,
          informacion_adicional: sedeData.informacion_adicional,
          zona_horaria: sedeData.zona_horaria,
          pais: sedeData.pais,
          moneda: sedeData.moneda,
          telefono: sedeData.telefono,
          email: sedeData.email
        });

        setSedes([...sedes, response]);
      }

      setIsModalOpen(false);
      setSelectedSede(null);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar la sede');
      console.error('Error saving sede:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSede = async (sedeId: string) => {
    if (!user?.access_token) {
      setError('No hay token de autenticación disponible');
      return;
    }

    try {
      const sedeToDelete = sedes.find(s => s._id === sedeId);
      if (!sedeToDelete) {
        throw new Error('Sede no encontrada');
      }

      await sedeService.deleteSede(user.access_token, sedeToDelete.sede_id);
      setSedes(sedes.filter((s) => s._id !== sedeId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar la sede');
      console.error('Error deleting sede:', err);
    }
  };

  const handleRetry = () => {
    loadSedes();
  };

  if (authLoading) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center">
        <Loader className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mb-2 text-lg font-semibold text-gray-900">No autenticado</div>
          <div className="text-sm text-gray-600">Inicia sesión para continuar</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="w-full p-4 md:p-8 pt-6 lg:pt-8">
          {isLoading ? (
            <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
              <Loader className="h-5 w-5 animate-spin" />
            </div>
          ) : error ? (
            <Card className="mx-auto max-w-xl border-gray-300 shadow-sm">
              <CardContent className="flex flex-col items-center justify-center py-14 text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
                  <AlertCircle className="h-6 w-6" />
                </div>
                <h2 className="text-lg font-semibold text-gray-900">Error al cargar sedes</h2>
                <p className="mt-2 max-w-md text-sm text-gray-600">{error}</p>
                <Button
                  onClick={handleRetry}
                  variant="outline"
                  className="mt-6 border-gray-300 text-gray-800 hover:bg-gray-100"
                >
                  Reintentar
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <PageHeader
                title="Sedes"
                subtitle={`${sedes.length} sedes en total`}
                actions={
                  <Button
                    onClick={handleAddSede}
                    className="bg-black text-white hover:bg-gray-800"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Añadir sede
                  </Button>
                }
              />

              <SedesList 
                sedes={sedes} 
                onEdit={handleEditSede} 
                onDelete={handleDeleteSede} 
              />

              <SedeFormModal
                isOpen={isModalOpen}
                onClose={() => {
                  setIsModalOpen(false);
                  setSelectedSede(null);
                }}
                onSave={handleSaveSede}
                sede={selectedSede}
                isSaving={isSaving}
              />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
