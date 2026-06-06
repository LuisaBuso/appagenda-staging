// src/services/profesionalesService.ts
import { apiClient } from './apiClient';
import { Professional } from '../../../../types/commissions';

export class ProfesionalesService {
  async getProfessionals(activo: boolean = true): Promise<Professional[]> {
    // Obtener sede_id del usuario autenticado
    const userSedeId = localStorage.getItem('beaux-sede_id') || 
                       sessionStorage.getItem('beaux-sede_id');
    const userRole = localStorage.getItem('beaux-role') || 
                     sessionStorage.getItem('beaux-role');
    
    // Solo parámetro activo para el endpoint
    const params: any = { activo };
    
    const response = await apiClient.get<Professional[]>('admin/profesionales/', params);
    
    if (response.error) {
      console.error('Error obteniendo profesionales:', response.error);
      throw new Error(response.error);
    }
    
    let professionals = response.data || [];
    
    // Filtrar por sede si el usuario es admin_sede
    if (userRole === 'admin_sede' && userSedeId) {
      professionals = professionals.filter(prof => prof.sede_id === userSedeId);
    }
    
    return professionals;
  }

  async getProfessionalById(professionalId: string): Promise<Professional | null> {
    const professionals = await this.getProfessionals();
    return professionals.find(p => p.profesional_id === professionalId) || null;
  }
}

export const profesionalesService = new ProfesionalesService();