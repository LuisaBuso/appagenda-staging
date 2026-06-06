import { API_BASE_URL } from "../../../types/config";
import { Service } from "../../../types/service";

export interface CreateServiceData {
  nombre: string;
  duracion_minutos: number;
  precio: number;
  comision_estilista?: number | null;
  categoria?: string;
  requiere_producto?: boolean;
  activo?: boolean;
}

export interface UpdateServiceData {
  nombre?: string;
  duracion_minutos?: number;
  precio?: number;
  comision_estilista?: number | null;
  categoria?: string;
  requiere_producto?: boolean;
  activo?: boolean;
}

export interface ServiceResponse {
  _id: string;
  servicio_id: string;
  nombre: string;
  duracion_minutos: number;
  precio: number;
  comision_estilista?: number | null;
  categoria?: string;
  requiere_producto: boolean;
  activo: boolean;
  creado_por?: string;
  created_at?: string;
  updated_at?: string;
}

export const serviciosService = {
  async getServicios(token: string): Promise<Service[]> {
    const response = await fetch(`${API_BASE_URL}admin/servicios/`, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Error al obtener servicios: ${response.statusText}`);
    }

    const data: ServiceResponse[] = await response.json();
    
    // Transformar la respuesta del backend al formato del frontend
    return data.map(servicio => ({
      id: servicio.servicio_id,
      nombre: servicio.nombre,
      descripcion: servicio.categoria || 'Sin descripción', // Usar categoría como descripción
      precio: servicio.precio,
      duracion: servicio.duracion_minutos,
      categoria: servicio.categoria || 'General',
      activo: servicio.activo,
      comision_porcentaje: servicio.comision_estilista || 0,
      imagen: this.getDefaultImage(servicio.categoria),
      // Campos adicionales para compatibilidad
      servicio_id: servicio.servicio_id,
      requiere_producto: servicio.requiere_producto
    }));
  },

  async createServicio(token: string, servicio: CreateServiceData): Promise<ServiceResponse> {
    const requestData = {
      nombre: servicio.nombre.trim(),
      duracion_minutos: servicio.duracion_minutos,
      precio: servicio.precio,
      comision_estilista: servicio.comision_estilista,
      categoria: servicio.categoria?.trim() || 'General',
      requiere_producto: servicio.requiere_producto || false,
      activo: servicio.activo !== undefined ? servicio.activo : true
    };

    console.log('📤 Creando servicio con datos:', requestData);

    const response = await fetch(`${API_BASE_URL}admin/servicios/`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(requestData)
    });

    if (!response.ok) {
      let errorMessage = `Error ${response.status}: ${response.statusText}`;
      
      try {
        const errorData = await response.json();
        console.error('❌ Error del backend:', errorData);
        
        if (errorData.detail) {
          if (typeof errorData.detail === 'string') {
            errorMessage = errorData.detail;
          } else if (Array.isArray(errorData.detail)) {
            errorMessage = errorData.detail.map((err: any) => {
              const field = err.loc?.[err.loc.length - 1] || 'campo';
              const value = err.input !== undefined ? ` (valor: ${JSON.stringify(err.input)})` : '';
              return `${field}: ${err.msg}${value}`;
            }).join('; ');
          }
        }
      } catch (parseError) {
        console.error('Error parseando respuesta:', parseError);
      }
      
      throw new Error(errorMessage);
    }

    return await response.json();
  },

  async updateServicio(token: string, servicioId: string, servicio: UpdateServiceData): Promise<any> {
    const requestData: any = {
      nombre: servicio.nombre?.trim(),
      duracion_minutos: servicio.duracion_minutos,
      precio: servicio.precio,
      categoria: servicio.categoria?.trim(),
      requiere_producto: servicio.requiere_producto,
      activo: servicio.activo
    };

    // Solo enviar comision si tiene valor
    if (servicio.comision_estilista !== undefined && servicio.comision_estilista !== null) {
      requestData.comision_estilista = servicio.comision_estilista;
    }

    console.log('📤 Actualizando servicio:', requestData);

    const response = await fetch(`${API_BASE_URL}admin/servicios/${servicioId}`, {
      method: 'PUT',
      headers: {
        'accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(requestData)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.detail || `Error al actualizar servicio: ${response.statusText}`);
    }

    return await response.json();
  },

  async deleteServicio(token: string, servicioId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}admin/servicios/${servicioId}`, {
      method: 'DELETE',
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.detail || `Error al eliminar servicio: ${response.statusText}`);
    }
  },

  getDefaultImage(categoria?: string): string {
    const imageMap: { [key: string]: string } = {
      'Cortes': '/pair-of-scissors.png',
      'Coloración': '/diverse-hair-colors.png',
      'Barba': '/beard.jpg',
      'Tratamientos': '/keratin-treatment.jpg',
      'Peinados': '/diverse-hairstyles.png',
      'Manicura': '/manicure.png',
      'Pedicura': '/pedicure.png'
    };
    
    return imageMap[categoria || 'General'] || '/pair-of-scissors.png';
  }
};