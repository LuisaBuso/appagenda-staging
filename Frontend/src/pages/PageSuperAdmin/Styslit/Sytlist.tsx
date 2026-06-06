"use client";

import { StylistsTeamWorkspace } from "../../../features/stylists-team/StylistsTeamWorkspace";
import { estilistaService } from "./estilistaService";
import { serviciosService } from "../Services/serviciosService";
import { EstilistaFormModal } from "./estilista-form-modal";

export default function EstilistasPage() {
  return (
    <StylistsTeamWorkspace
      stylistApi={estilistaService}
      legacyCreateModal={EstilistaFormModal}
      servicesApi={{
        getServicios: (token: string) => serviciosService.getServicios(token),
      }}
    />
  );
}
