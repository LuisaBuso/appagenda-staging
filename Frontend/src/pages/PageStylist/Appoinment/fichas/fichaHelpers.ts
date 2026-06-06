import type { Cita } from "../../../../types/fichas";

export type FichaEstilistaData = {
  nombre: string;
  email: string;
  id: string;
  role: string;
};

const formatNombreEstilista = (value: string): string => {
  if (!value) return "Estilista";
  if (!value.includes("@")) return value;

  const namePart = value.split("@")[0];
  return namePart
    .replace(/[._]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
};

export const getFichaAuthToken = (): string => {
  return localStorage.getItem("access_token") || sessionStorage.getItem("access_token") || "";
};

export const getEstilistaDataFromCita = (cita: Cita): FichaEstilistaData => {
  try {
    const estilistaNombre = sessionStorage.getItem("beaux-name") || "Estilista";
    const estilistaEmail = sessionStorage.getItem("beaux-email") || "";
    const estilistaRole = sessionStorage.getItem("beaux-role") || "estilista";
    const profesionalIdStorage =
      localStorage.getItem("beaux-profesional_id") || sessionStorage.getItem("beaux-profesional_id") || "";

    const profesionalId = String(
      cita.estilista_id || cita.profesional_id || profesionalIdStorage || ""
    ).trim();

    return {
      nombre: formatNombreEstilista(estilistaNombre),
      email: estilistaEmail,
      id: profesionalId,
      role: estilistaRole
    };
  } catch (error) {
    console.error("Error obteniendo datos del estilista:", error);
    return {
      nombre: "Estilista",
      email: "",
      id: String(cita.estilista_id || cita.profesional_id || "").trim(),
      role: "estilista"
    };
  }
};
