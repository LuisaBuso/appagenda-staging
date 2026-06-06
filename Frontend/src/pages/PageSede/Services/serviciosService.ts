import { API_BASE_URL } from "../../../types/config";
import { Service } from "../../../types/service";

export interface CreateServiceData {
  nombre: string;
  duracion_minutos: number;
  precios: {
    USD: number;
    COP: number;
    MXN?: number;
  };
  comision_estilista?: number | null;
  categoria?: string;
  requiere_producto?: boolean;
  activo?: boolean;
}

export interface UpdateServiceData {
  nombre?: string;
  duracion_minutos?: number;
  precios?: {
    USD: number;
    COP: number;
    MXN?: number;
  };
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
  precios: {
    USD: number;
    COP: number;
    MXN?: number;
  };
  comision_estilista?: number | null;
  categoria?: string;
  requiere_producto: boolean;
  activo: boolean;
  creado_por?: string;
  created_at?: string;
  updated_at?: string;
}

// 🔥 ACTUALIZADO: Extender el tipo Service para incluir campos adicionales
export interface ServiceWithCurrency extends Service {
  precio_local?: number;
  moneda_local?: string;
  precios_completos?: {
    USD: number;
    COP: number;
    MXN?: number;
  };
  servicio_id?: string;
  requiere_producto?: boolean;
}

export const serviciosService = {
  async getServicios(token: string, moneda?: string): Promise<ServiceWithCurrency[]> {
    const url = moneda 
      ? `${API_BASE_URL}admin/servicios/?moneda=${moneda}`
      : `${API_BASE_URL}admin/servicios/`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Error al obtener servicios: ${response.statusText}`);
    }

    const data: any[] = await response.json();
    
    console.log('📥 Datos recibidos del backend:', data);
    
    return data.map(servicio => {
      let precioAMostrar = servicio.precio;
      let precioLocal = servicio.precio_local;
      let monedaLocal = servicio.moneda_local || moneda || 'USD';
      
      if (servicio.precio_local !== undefined) {
        precioAMostrar = servicio.precio_local;
      } 
      else if (servicio.precios) {
        if (moneda === 'COP' && servicio.precios.COP) {
          precioAMostrar = servicio.precios.COP;
          monedaLocal = 'COP';
        } else if (moneda === 'MXN' && servicio.precios.MXN) {
          precioAMostrar = servicio.precios.MXN;
          monedaLocal = 'MXN';
        } else {
          precioAMostrar = servicio.precios.USD;
          monedaLocal = 'USD';
        }
      }

      const servicioConMoneda: ServiceWithCurrency = {
        id: servicio.servicio_id || servicio._id,
        nombre: servicio.nombre,
        descripcion: servicio.categoria || 'Sin descripción',
        precio: precioAMostrar,
        precio_local: precioLocal || precioAMostrar,
        moneda_local: monedaLocal,
        duracion: servicio.duracion_minutos,
        categoria: servicio.categoria || 'General',
        activo: servicio.activo,
        comision_porcentaje: servicio.comision_estilista || 0,
        imagen: this.getDefaultImage(servicio.categoria),
        servicio_id: servicio.servicio_id || servicio._id,
        requiere_producto: servicio.requiere_producto,
        precios_completos: servicio.precios // 🔥 Asegurar que existe
      };

      return servicioConMoneda;
    });
  },

  async createServicio(token: string, servicio: CreateServiceData): Promise<ServiceResponse> {
    const requestData = {
      nombre: servicio.nombre.trim(),
      duracion_minutos: servicio.duracion_minutos,
      precios: servicio.precios,
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
      categoria: servicio.categoria?.trim(),
      requiere_producto: servicio.requiere_producto,
      activo: servicio.activo
    };

    if (servicio.precios) {
      requestData.precios = servicio.precios;
    }

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
      'Pedicura': '/pedicure.png',
      'Formacion Presencial': '/training.png'
    };
    
    return imageMap[categoria || 'General'] || '/pair-of-scissors.png';
  },

  getMonedaFromPais(pais?: string): string {
    if (!pais) return 'USD';
    
    const countryCurrencyMap: Record<string, string> = {
      'Colombia': 'COP',
      'México': 'MXN',
      'Mexico': 'MXN',
      'Ecuador': 'USD',
      'Perú': 'USD',
      'Chile': 'USD',
      'Argentina': 'USD',
      'Estados Unidos': 'USD',
      'United States': 'USD',
      'USA': 'USD',
    };
    
    return countryCurrencyMap[pais] || 'USD';
  }
};