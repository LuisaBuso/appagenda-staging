// src/components/fichas/FichaDiagnosticoRizotipo.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Cita } from '../../../../types/fichas';
import { Camera, Loader2, X, Save, CheckCircle } from "lucide-react";
import { API_BASE_URL } from '../../../../types/config';
import { getEstilistaDataFromCita, getFichaAuthToken } from './fichaHelpers';
import { handleTextareaAutoResize } from "../../../../lib/textareaAutosize";

interface FichaDiagnosticoRizotipoProps {
  cita: Cita;
  datosIniciales?: any;
  onGuardar?: (datos: any) => void;
  onSubmit: (data: any) => void;
  onCancelar?: () => void;
  fichaId?: string;
  modoEdicion?: boolean;
}

type TechnicalField =
  | "plasticidad"
  | "permeabilidad"
  | "porosidad"
  | "exterior_lipidico"
  | "densidad"
  | "oleosidad"
  | "grosor"
  | "textura";

const TECHNICAL_FIELDS: TechnicalField[] = [
  "plasticidad",
  "permeabilidad",
  "porosidad",
  "exterior_lipidico",
  "densidad",
  "oleosidad",
  "grosor",
  "textura",
];

const TECHNICAL_OPTIONS: Record<TechnicalField, Array<{ value: string; label: string }>> = {
  plasticidad: [
    { value: "ALTA", label: "Alta" },
    { value: "MEDIA", label: "Media" },
    { value: "BAJA", label: "Baja" },
    { value: "MUY BAJA", label: "Muy Baja" },
  ],
  permeabilidad: [
    { value: "ALTA", label: "Alta" },
    { value: "MEDIA", label: "Media" },
    { value: "BAJA", label: "Baja" },
    { value: "OTRA", label: "Otra" },
  ],
  porosidad: [
    { value: "ALTA", label: "Alta" },
    { value: "BAJA", label: "Baja" },
  ],
  exterior_lipidico: [
    { value: "ALTA", label: "Alta" },
    { value: "MEDIA", label: "Media" },
    { value: "BAJA", label: "Baja" },
  ],
  densidad: [
    { value: "EXTRA ALTA", label: "Extra Alta" },
    { value: "ALTA", label: "Alta" },
    { value: "MEDIA", label: "Media" },
    { value: "BAJA", label: "Baja" },
  ],
  oleosidad: [
    { value: "ALTA", label: "Alta" },
    { value: "MEDIA", label: "Media" },
    { value: "BAJA", label: "Baja" },
  ],
  grosor: [
    { value: "GRUESO", label: "Grueso" },
    { value: "MEDIO", label: "Medio" },
    { value: "DELGADO", label: "Delgado" },
  ],
  textura: [
    { value: "Lanoso / Ulótrico", label: "Lanoso / Ulótrico" },
    { value: "Ensotijado / Lisótrico", label: "Ensotijado / Lisótrico" },
    { value: "Laminado / Cinótrico", label: "Laminado / Cinótrico" },
    { value: "Procesado o dañado", label: "Procesado o dañado" },
  ],
};

interface TechnicalMetadata {
  definition: string;
  actions: Record<string, string>;
  defaultAction: string;
}

const TECHNICAL_METADATA: Record<TechnicalField, TechnicalMetadata> = {
  plasticidad: {
    definition: "Capacidad de la fibra capilar para estirarse y volver a su forma sin romperse.",
    actions: {
      ALTA: "Mantener equilibrio entre hidratación y proteína; evitar sobrecarga de queratina.",
      MEDIA: "Alternar hidratación y reconstrucción de forma semanal.",
      BAJA: "Priorizar reconstrucción con proteínas y reducir calor directo.",
      "MUY BAJA": "Aplicar plan intensivo de recuperación y evitar procesos químicos.",
    },
    defaultAction: "Mantener seguimiento profesional para ajustar el tratamiento.",
  },
  permeabilidad: {
    definition: "Capacidad del cabello para absorber y retener humedad.",
    actions: {
      ALTA: "Sellar con productos de pH ácido y mantener rutina anti-frizz.",
      MEDIA: "Sostener rutina balanceada de hidratación y sellado.",
      BAJA: "Mejorar penetración con calor moderado y productos ligeros de alta absorción.",
      OTRA: "Realizar prueba de hebra y personalizar técnica/frecuencia.",
    },
    defaultAction: "Ajustar productos según respuesta real del cabello.",
  },
  porosidad: {
    definition: "Facilidad con la que agua y activos penetran la fibra capilar.",
    actions: {
      ALTA: "Enfocar en sellado de cutícula y productos de larga hidratación.",
      BAJA: "Aplicar productos ligeros y activar absorción con calor controlado.",
    },
    defaultAction: "Controlar respuesta del cabello para ajustar rutina.",
  },
  exterior_lipidico: {
    definition: "Nivel de lípidos naturales que protegen la cutícula.",
    actions: {
      ALTA: "Usar limpieza suave y controlar acumulación de grasa en raíz.",
      MEDIA: "Mantener higiene regular y equilibrio entre limpieza e hidratación.",
      BAJA: "Reponer lípidos con aceites ligeros y cremas nutritivas.",
    },
    defaultAction: "Balancear nutrición y limpieza según evolución.",
  },
  densidad: {
    definition: "Cantidad de cabellos por área del cuero cabelludo.",
    actions: {
      "EXTRA ALTA": "Trabajar por secciones pequeñas para una distribución uniforme de producto.",
      ALTA: "Controlar volumen con técnicas de definición y cortes estratégicos.",
      MEDIA: "Mantener rutina estándar y ajustes según objetivo de estilo.",
      BAJA: "Aportar cuerpo con productos volumizadores ligeros y peinados de soporte.",
    },
    defaultAction: "Adecuar cantidad de producto y técnica de aplicación.",
  },
  oleosidad: {
    definition: "Producción de sebo en cuero cabelludo y raíz.",
    actions: {
      ALTA: "Aumentar frecuencia de lavado con productos seborreguladores.",
      MEDIA: "Mantener frecuencia intermedia y limpieza profunda periódica.",
      BAJA: "Espaciar lavados y reforzar hidratación del cuero cabelludo.",
    },
    defaultAction: "Revisar periodicidad de lavado y tipo de producto.",
  },
  grosor: {
    definition: "Diámetro promedio de cada fibra capilar.",
    actions: {
      GRUESO: "Usar productos de mayor emoliencia y tiempos de absorción más largos.",
      MEDIO: "Mantener rutina equilibrada según respuesta del cabello.",
      DELGADO: "Usar fórmulas ligeras y evitar sobrecargar con aceites pesados.",
    },
    defaultAction: "Ajustar concentración de producto a la fibra.",
  },
  textura: {
    definition: "Patrón de curvatura y estado estructural de la fibra capilar.",
    actions: {
      "Lanoso / Ulótrico": "Priorizar hidratación profunda y definición por secciones.",
      "Ensotijado / Lisótrico": "Definir con crema y gel ligero, minimizando fricción.",
      "Laminado / Cinótrico": "Mantener control de grasa y protección térmica en estilizado.",
      "Procesado o dañado": "Implementar cronograma de recuperación y limitar calor/químicos.",
    },
    defaultAction: "Personalizar técnica de estilizado según patrón de rizo.",
  },
};

const TECHNICAL_QUESTIONS: Array<{ field: TechnicalField; pregunta_id: number; pregunta: string }> = [
  { field: "plasticidad", pregunta_id: 1, pregunta: "Plasticidad" },
  { field: "permeabilidad", pregunta_id: 2, pregunta: "Permeabilidad" },
  { field: "porosidad", pregunta_id: 3, pregunta: "Porosidad" },
  { field: "exterior_lipidico", pregunta_id: 4, pregunta: "Exterior Lipídico" },
  { field: "densidad", pregunta_id: 5, pregunta: "Densidad" },
  { field: "oleosidad", pregunta_id: 6, pregunta: "Oleosidad" },
  { field: "grosor", pregunta_id: 7, pregunta: "Grosor" },
  { field: "textura", pregunta_id: 8, pregunta: "Textura" },
];

const normalizeSelectionValue = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

function CurlPatternSVG({ type }: { type: string }) {
  const patterns: Record<string, React.ReactNode> = {
    "2A": (
      <svg width="120" height="80" viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 40 Q30 30 50 40 Q70 50 90 40 Q110 30 120 40" stroke="#4B5563" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
        <path d="M10 50 Q30 40 50 50 Q70 60 90 50 Q110 40 120 50" stroke="#6B7280" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <text x="60" y="75" textAnchor="middle" fontSize="11" fill="#6B7280">2A – Onda suave</text>
      </svg>
    ),
    "2B": (
      <svg width="120" height="80" viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 35 Q25 20 40 35 Q55 50 70 35 Q85 20 100 35 Q115 50 120 40" stroke="#4B5563" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
        <path d="M10 48 Q25 33 40 48 Q55 63 70 48 Q85 33 100 48 Q115 60 120 52" stroke="#6B7280" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <text x="60" y="75" textAnchor="middle" fontSize="11" fill="#6B7280">2B – Onda en S</text>
      </svg>
    ),
    "2C": (
      <svg width="120" height="80" viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 30 Q20 15 30 30 Q40 50 50 30 Q60 10 70 30 Q80 50 90 30 Q100 15 110 30" stroke="#4B5563" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
        <path d="M10 45 Q20 30 30 45 Q40 60 50 45 Q60 28 70 45 Q80 60 90 45 Q100 30 110 45" stroke="#6B7280" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <text x="60" y="75" textAnchor="middle" fontSize="11" fill="#6B7280">2C – Onda definida</text>
      </svg>
    ),
    "3A": (
      <svg width="120" height="80" viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 10 Q5 25 15 30 Q25 35 15 45 Q5 55 15 60" stroke="#4B5563" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
        <path d="M45 10 Q35 25 45 30 Q55 35 45 45 Q35 55 45 60" stroke="#4B5563" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
        <path d="M75 10 Q65 25 75 30 Q85 35 75 45 Q65 55 75 60" stroke="#6B7280" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <text x="60" y="75" textAnchor="middle" fontSize="11" fill="#6B7280">3A – Rizo amplio</text>
      </svg>
    ),
    "3B": (
      <svg width="120" height="80" viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 8 Q5 16 15 22 Q25 28 15 34 Q5 40 15 46 Q25 52 15 58" stroke="#4B5563" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
        <path d="M45 8 Q35 16 45 22 Q55 28 45 34 Q35 40 45 46 Q55 52 45 58" stroke="#4B5563" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
        <path d="M75 8 Q65 16 75 22 Q85 28 75 34 Q65 40 75 46 Q85 52 75 58" stroke="#6B7280" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <text x="60" y="75" textAnchor="middle" fontSize="11" fill="#6B7280">3B – Espiral</text>
      </svg>
    ),
    "3C": (
      <svg width="120" height="80" viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 5 Q8 10 15 14 Q22 18 15 22 Q8 26 15 30 Q22 34 15 38 Q8 42 15 46 Q22 50 15 54 Q8 58 15 62" stroke="#4B5563" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
        <path d="M45 5 Q38 10 45 14 Q52 18 45 22 Q38 26 45 30 Q52 34 45 38 Q38 42 45 46 Q52 50 45 54 Q38 58 45 62" stroke="#4B5563" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
        <path d="M75 5 Q68 10 75 14 Q82 18 75 22 Q68 26 75 30 Q82 34 75 38 Q68 42 75 46 Q82 50 75 54 Q68 58 75 62" stroke="#6B7280" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <text x="60" y="75" textAnchor="middle" fontSize="11" fill="#6B7280">3C – Rizo cerrado</text>
      </svg>
    ),
    "4A": (
      <svg width="120" height="80" viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 5 Q10 8 15 11 Q20 14 15 17 Q10 20 15 23 Q20 26 15 29 Q10 32 15 35 Q20 38 15 41 Q10 44 15 47 Q20 50 15 53 Q10 56 15 59" stroke="#4B5563" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
        <path d="M40 5 Q35 8 40 11 Q45 14 40 17 Q35 20 40 23 Q45 26 40 29 Q35 32 40 35 Q45 38 40 41 Q35 44 40 47 Q45 50 40 53 Q35 56 40 59" stroke="#4B5563" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
        <path d="M65 5 Q60 8 65 11 Q70 14 65 17 Q60 20 65 23 Q70 26 65 29 Q60 32 65 35 Q70 38 65 41 Q60 44 65 47 Q70 50 65 53 Q60 56 65 59" stroke="#6B7280" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <text x="60" y="75" textAnchor="middle" fontSize="11" fill="#6B7280">4A – S muy cerrado</text>
      </svg>
    ),
    "4B": (
      <svg width="120" height="80" viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 5 L10 12 L18 17 L8 24 L18 29 L8 36 L18 41 L8 48 L18 53 L10 59" stroke="#4B5563" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M40 5 L35 12 L43 17 L33 24 L43 29 L33 36 L43 41 L33 48 L43 53 L35 59" stroke="#4B5563" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M65 5 L60 12 L68 17 L58 24 L68 29 L58 36 L68 41 L58 48 L68 53 L60 59" stroke="#6B7280" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        <text x="60" y="75" textAnchor="middle" fontSize="11" fill="#6B7280">4B – Patrón en Z</text>
      </svg>
    ),
    "4C": (
      <svg width="120" height="80" viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 5 L11 9 L17 12 L9 16 L17 19 L9 23 L17 26 L9 30 L17 33 L9 37 L17 40 L9 44 L17 47 L9 51 L17 54 L11 59" stroke="#4B5563" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M40 5 L36 9 L42 12 L34 16 L42 19 L34 23 L42 26 L34 30 L42 33 L34 37 L42 40 L34 44 L42 47 L34 51 L42 54 L36 59" stroke="#4B5563" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M65 5 L61 9 L67 12 L59 16 L67 19 L59 23 L67 26 L59 30 L67 33 L59 37 L67 40 L59 44 L67 47 L59 51 L67 54 L61 59" stroke="#6B7280" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        <text x="60" y="75" textAnchor="middle" fontSize="11" fill="#6B7280">4C – Muy cerrado</text>
      </svg>
    ),
  };

  return <>{patterns[type] || null}</>;
}

function TransitionSVG({ type }: { type: string }) {
  const colors: Record<string, { stroke: string; label: string }> = {
    ondulados: { stroke: "#7C3AED", label: "Ondulados en transición" },
    rizados: { stroke: "#DB2777", label: "Rizados en transición" },
    afro: { stroke: "#D97706", label: "Afro en transición" },
  };
  const cfg = colors[type] || colors.ondulados;

  return (
    <svg width="140" height="80" viewBox="0 0 140 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Straight portion (processed) */}
      <path d="M10 30 L50 30" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 3"/>
      <path d="M10 42 L50 42" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 3"/>
      {/* Transitioning portion (natural texture returning) */}
      <path d="M50 30 Q60 22 70 30 Q80 38 90 30 Q100 22 110 30 Q120 38 130 30" stroke={cfg.stroke} strokeWidth="2.5" fill="none" strokeLinecap="round"/>
      <path d="M50 42 Q60 34 70 42 Q80 50 90 42 Q100 34 110 42 Q120 50 130 42" stroke={cfg.stroke} strokeWidth="2.5" fill="none" strokeLinecap="round"/>
      {/* Dividing line */}
      <line x1="50" y1="20" x2="50" y2="55" stroke="#D1D5DB" strokeWidth="1" strokeDasharray="3 2"/>
      <text x="30" y="62" textAnchor="middle" fontSize="8" fill="#9CA3AF">Procesado</text>
      <text x="90" y="62" textAnchor="middle" fontSize="8" fill={cfg.stroke}>Natural</text>
      <text x="70" y="75" textAnchor="middle" fontSize="10" fill="#6B7280">{cfg.label}</text>
    </svg>
  );
}

export function FichaDiagnosticoRizotipo({ cita, datosIniciales, onGuardar, onSubmit, onCancelar, fichaId, modoEdicion }: FichaDiagnosticoRizotipoProps) {
  const [formData, setFormData] = useState({
    autorizacion_publicacion: false,
    firma_profesional: false,
    foto_antes: [] as File[],
    foto_despues: [] as File[],
    plasticidad: [] as string[],
    permeabilidad: [] as string[],
    porosidad: [] as string[],
    exterior_lipidico: [] as string[],
    densidad: [] as string[],
    oleosidad: [] as string[],
    grosor: [] as string[],
    textura: [] as string[],
    tipo_textura: "" as string,
    transicion: "" as string,
    largo_cabello: "" as string,
    estado_cabello: [] as string[],
    recomendaciones_personalizadas: "",
    frecuencia_corte: "",
    tecnicas_estilizado: "",
    productos_sugeridos: "",
    observaciones_generales: ""
  });

  const [loading, setLoading] = useState(false);
  const [previewImages, setPreviewImages] = useState<{
    antes: string[];
    despues: string[];
  }>({ antes: [], despues: [] });

  const fileInputRefAntes = useRef<HTMLInputElement>(null);
  const fileInputRefDespues = useRef<HTMLInputElement>(null);

  const normalizeTechnicalFields = (data: any): Record<TechnicalField, string[]> => {
    return TECHNICAL_FIELDS.reduce((acc, field) => {
      acc[field] = normalizeSelectionValue(data?.[field]);
      return acc;
    }, {} as Record<TechnicalField, string[]>);
  };

  // Cargar datos iniciales del localStorage al montar
  useEffect(() => {
    const savedData = localStorage.getItem(`ficha_diagnostico_rizotipo_${cita.cita_id}`);
    if (savedData) {
      const parsedData = JSON.parse(savedData);
      const normalizedTechnical = normalizeTechnicalFields(parsedData);

      // Nota: No podemos guardar Files en localStorage, solo el estado del formulario
      setFormData({
        ...parsedData,
        ...normalizedTechnical,
        foto_antes: [], // Los archivos no se pueden guardar, se limpian
        foto_despues: [] // Los archivos no se pueden guardar, se limpian
      });
    } else if (datosIniciales) {
      const normalizedTechnical = normalizeTechnicalFields(datosIniciales);
      setFormData({
        ...datosIniciales,
        ...normalizedTechnical,
      });
    }
  }, [cita.cita_id, datosIniciales]);

  // Guardar automáticamente en localStorage cuando cambian los datos
  useEffect(() => {
    // No guardamos los archivos en localStorage (son demasiado grandes)
    const dataToSave = {
      ...formData,
      foto_antes: [], // No guardamos archivos
      foto_despues: [] // No guardamos archivos
    };
    localStorage.setItem(`ficha_diagnostico_rizotipo_${cita.cita_id}`, JSON.stringify(dataToSave));
  }, [formData, cita.cita_id]);

  // Limpiar previews cuando el componente se desmonte
  useEffect(() => {
    return () => {
      previewImages.antes.forEach(url => URL.revokeObjectURL(url));
      previewImages.despues.forEach(url => URL.revokeObjectURL(url));
    };
  }, [previewImages]);

  const handleFileSelect = (tipo: 'antes' | 'despues', files: FileList | null) => {
    if (!files) return;

    const newFiles = Array.from(files);
    const currentFiles = tipo === 'antes' ? formData.foto_antes : formData.foto_despues;

    // Limitar a 5 imágenes máximo
    const remainingSlots = 5 - currentFiles.length;
    if (remainingSlots <= 0) {
      toast.warning(`Máximo 5 imágenes permitidas para ${tipo === 'antes' ? 'antes' : 'después'}`);
      return;
    }

    const filesToAdd = newFiles.slice(0, remainingSlots);

    // Actualizar estado de archivos
    setFormData(prev => ({
      ...prev,
      [`foto_${tipo}`]: [...currentFiles, ...filesToAdd]
    }));

    // Crear URLs para preview
    const newPreviews = filesToAdd.map(file => URL.createObjectURL(file));
    setPreviewImages(prev => ({
      ...prev,
      [tipo]: [...prev[tipo], ...newPreviews]
    }));
  };

  const handleRemoveImage = (tipo: 'antes' | 'despues', index: number) => {
    // Revocar URL
    if (previewImages[tipo][index]) {
      URL.revokeObjectURL(previewImages[tipo][index]);
    }

    // Actualizar estado
    const key = tipo === 'antes' ? 'foto_antes' : 'foto_despues';
    setFormData(prev => ({
      ...prev,
      [key]: prev[key].filter((_, i) => i !== index)
    }));

    setPreviewImages(prev => ({
      ...prev,
      [tipo]: prev[tipo].filter((_, i) => i !== index)
    }));
  };

  const openFileSelector = (tipo: 'antes' | 'despues') => {
    if (tipo === 'antes') {
      fileInputRefAntes.current?.click();
    } else {
      fileInputRefDespues.current?.click();
    }
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const toggleTechnicalOption = (field: TechnicalField, optionValue: string) => {
    setFormData((prev) => {
      const currentValues = prev[field];
      const isSelected = currentValues.includes(optionValue);

      return {
        ...prev,
        [field]: isSelected
          ? currentValues.filter((item) => item !== optionValue)
          : [...currentValues, optionValue],
      };
    });
  };

  const formatTechnicalValue = (values: string[]) => values.join(", ");

  const getTechnicalOptionLabel = (field: TechnicalField, value: string) => {
    return TECHNICAL_OPTIONS[field].find((option) => option.value === value)?.label || value;
  };

  const buildTechnicalActionsText = (field: TechnicalField, values: string[]) => {
    const metadata = TECHNICAL_METADATA[field];
    if (!metadata || values.length === 0) return "";

    return values
      .map((value) => {
        const label = getTechnicalOptionLabel(field, value);
        const action = metadata.actions[value] || metadata.defaultAction;
        return `${label}: ${action}`;
      })
      .join(" | ");
  };

  const buildTechnicalDefinitionAndActions = (field: TechnicalField, values: string[]) => {
    const metadata = TECHNICAL_METADATA[field];
    if (!metadata) return "";

    const actionsText = buildTechnicalActionsText(field, values) || metadata.defaultAction;
    return `Definición: ${metadata.definition} Acciones recomendadas: ${actionsText}`;
  };

  const handleSaveDraft = () => {
    if (onGuardar) {
      const draftData = {
        ...formData,
        fecha_guardado: new Date().toISOString(),
        estado: 'borrador'
      };
      onGuardar(draftData);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validaciones
    if (!formData.firma_profesional) {
      toast.warning('Debe incluir su firma como profesional para crear la ficha');
      return;
    }

    // Verificar parámetros técnicos obligatorios
    const parametrosFaltantes = TECHNICAL_FIELDS.filter(
      (param) => formData[param].length === 0
    );

    if (parametrosFaltantes.length > 0) {
      toast.warning(`Debe completar todos los parámetros técnicos. Faltantes: ${parametrosFaltantes.join(', ')}`);
      return;
    }

    if (!formData.tipo_textura) {
      toast.warning('Debe seleccionar el Tipo de Textura');
      return;
    }
    if (!formData.largo_cabello) {
      toast.warning('Debe seleccionar el Largo del Cabello');
      return;
    }
    if (formData.estado_cabello.length === 0) {
      toast.warning('Debe seleccionar al menos una opción en Estado del Cabello');
      return;
    }

    // if (formData.foto_antes.length === 0 || formData.foto_despues.length === 0) {
    //   alert('Debe cargar al menos una foto de ANTES y una foto de DESPUÉS para crear la ficha');
    //   return;
    // }

    setLoading(true);

    try {
      const token = getFichaAuthToken();

      if (!token) {
        throw new Error('No hay token de autenticación');
      }

      const estilistaData = getEstilistaDataFromCita(cita);
      if (!estilistaData.id) {
        throw new Error('No se pudo identificar al profesional de la cita. Recarga la agenda e intenta nuevamente.');
      }
      console.log('📋 Datos del estilista:', estilistaData);

      // 1. Crear FormData
      const formDataToSend = new FormData();

      // 2. Agregar archivos
      formData.foto_antes.forEach((file) => {
        formDataToSend.append('fotos_antes', file);
      });

      formData.foto_despues.forEach((file) => {
        formDataToSend.append('fotos_despues', file);
      });

      const technicalPayload = TECHNICAL_FIELDS.reduce<Record<string, string>>((acc, field) => {
        const selectedValues = formData[field];
        acc[field] = formatTechnicalValue(selectedValues);
        acc[`${field}_seleccion`] = formatTechnicalValue(selectedValues);
        acc[`${field}_acciones`] = buildTechnicalActionsText(field, selectedValues);
        acc[`${field}_detalle`] = buildTechnicalDefinitionAndActions(field, selectedValues);
        return acc;
      }, {});

      const technicalResponses = TECHNICAL_QUESTIONS.map(({ field, pregunta_id, pregunta }) => ({
        pregunta_id,
        pregunta,
        respuesta: formatTechnicalValue(formData[field]),
        observaciones: buildTechnicalDefinitionAndActions(field, formData[field]),
        respondido_por: estilistaData.nombre,
        respondido_por_id: estilistaData.id
      }));

      // 3. Preparar datos según el modelo FichaCreate
      const fichaData = {
        // Campos REQUERIDOS
        cliente_id: cita.cliente.cliente_id,
        servicio_id: cita.servicios?.[0]?.servicio_id || "",
        profesional_id: estilistaData.id, // ← ESTE ES EL ID CORRECTO
        sede_id: cita.sede?.sede_id || 'sede_default',
        tipo_ficha: "DIAGNOSTICO_RIZOTIPO",

        // Información básica
        servicio_nombre: cita.servicios?.map((s: any) => s.nombre).join(', ') || "",
        profesional_nombre: estilistaData.nombre,
        profesional_email: estilistaData.email, // ← Puedes agregar el email también
        fecha_ficha: new Date().toISOString(),
        fecha_reserva: cita.fecha || "",

        // Datos personales
        email: cita.cliente.email || "",
        nombre: cita.cliente.nombre || "",
        apellido: cita.cliente.apellido || "",
        cedula: "",
        telefono: cita.cliente.telefono || "",

        // Información financiera
        precio: cita.precio_total || cita.servicios?.reduce((sum: number, s: any) => sum + (s.precio || 0), 0) || 0,
        estado: "completado",
        estado_pago: "pagado",

        // Contenido de la ficha
        datos_especificos: {
          cita_id: cita.cita_id,
          firma_profesional: formData.firma_profesional,
          fecha_firma: new Date().toISOString(),
          profesional_firmante: estilistaData.nombre,
          profesional_firmante_id: estilistaData.id,
          profesional_firmante_email: estilistaData.email,
          ...technicalPayload,
          // TODO: incluir en payload cuando backend lo soporte
          tipo_textura: formData.tipo_textura || "",
          transicion: formData.transicion || "",
          largo_cabello: formData.largo_cabello || "",
          estado_cabello: formData.estado_cabello || [],
          recomendaciones_personalizadas: formData.recomendaciones_personalizadas || "",
          frecuencia_corte: formData.frecuencia_corte || "",
          tecnicas_estilizado: formData.tecnicas_estilizado || "",
          productos_sugeridos: formData.productos_sugeridos || "",
          observaciones_generales: formData.observaciones_generales || "",
          autorizacion_publicacion: formData.autorizacion_publicacion
        },
        respuestas: technicalResponses,
        descripcion_servicio: `Diagnóstico rizotipo para ${cita.servicios?.map((s: any) => s.nombre).join(', ') || 'Sin servicio'} - Realizado por ${estilistaData.nombre}`,

        // Fotos (URLs vacías porque el backend las subirá a S3)
        fotos_antes: [],
        fotos_despues: [],

        // Permisos y comentarios
        autorizacion_publicacion: formData.autorizacion_publicacion,
        comentario_interno: formData.observaciones_generales || ""
      };

      // 4. Debug info
      console.log("📤 Enviando datos de ficha DIAGNOSTICO_RIZOTIPO:", fichaData);
      console.log("👤 Estilista que crea la ficha:", estilistaData);

      // 5. Agregar el campo 'data' como string JSON
      formDataToSend.append('data', JSON.stringify(fichaData));

      const isEdit = Boolean(fichaId || modoEdicion);
      const endpoint = isEdit
        ? `${API_BASE_URL}scheduling/quotes/fichas/${fichaId}`
        : `${API_BASE_URL}scheduling/quotes/create-ficha`;
      const method = isEdit ? 'PUT' : 'POST';

      // 6. Enviar petición
      const response = await fetch(endpoint, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formDataToSend,
      });

      console.log("📥 Response status:", response.status);

      if (!response.ok) {
        let errorText = await response.text();
        console.error("❌ Error response text:", errorText);

        try {
          const errorJson = JSON.parse(errorText);
          console.error("❌ Error JSON:", errorJson);

          if (response.status === 422 && errorJson.detail) {
            const validationErrors = errorJson.detail;
            const errorMessages = validationErrors.map((err: any) =>
              `Campo ${err.loc[1]}: ${err.msg}`
            ).join('\n');
            throw new Error(`Errores de validación:\n${errorMessages}`);
          }
          throw new Error(errorJson.detail || errorJson.message || `Error ${response.status}`);
        } catch {
          throw new Error(`Error ${response.status}: ${errorText || response.statusText}`);
        }
      }

      const data = await response.json();
      console.log("✅ Success response:", data);

      if (data.success) {
        // Limpiar previews y datos del localStorage
        previewImages.antes.forEach(url => URL.revokeObjectURL(url));
        previewImages.despues.forEach(url => URL.revokeObjectURL(url));
        localStorage.removeItem(`ficha_diagnostico_rizotipo_${cita.cita_id}`);

        // Notificar éxito
        toast.success(
          isEdit
            ? `Ficha de Diagnóstico Rizotipo actualizada por ${estilistaData.nombre}`
            : `Ficha de Diagnóstico Rizotipo creada exitosamente por ${estilistaData.nombre}`
        );
        onSubmit(data);
      } else {
        throw new Error(data.message || (isEdit ? 'Error al actualizar la ficha' : 'Error al crear la ficha'));
      }

    } catch (error) {
      console.error('❌ Error al guardar ficha:', error);
      toast.error(error instanceof Error ? error.message : 'Error al guardar la ficha');
    } finally {
      setLoading(false);
    }
  };

  const renderImageUploader = (tipo: 'antes' | 'despues', label: string) => {
    const files = tipo === 'antes' ? formData.foto_antes : formData.foto_despues;
    const previews = tipo === 'antes' ? previewImages.antes : previewImages.despues;
    const fileInputRef = tipo === 'antes' ? fileInputRefAntes : fileInputRefDespues;

    return (
      <div>
        <h3 className="mb-3 font-semibold">{label}</h3>

        {/* Input de archivo oculto */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFileSelect(tipo, e.target.files)}
        />

        {/* Área de subida - LA IMAGEN SALE AQUÍ */}
        <div className="space-y-4">
          <div
            className="relative flex flex-col items-center justify-center h-48 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
            onClick={() => openFileSelector(tipo)}
          >
            {previews.length > 0 ? (
              // Mostrar primera imagen si hay
              <div className="w-full h-full p-2">
                <img
                  src={previews[0]}
                  alt="Vista previa"
                  className="w-full h-full object-cover rounded"
                />
                <div className="absolute inset-0 bg-black bg-opacity-30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity rounded">
                  <p className="text-white text-sm bg-black bg-opacity-70 px-3 py-1 rounded">
                    Haz clic para cambiar
                  </p>
                </div>
              </div>
            ) : (
              // Mostrar icono si no hay imágenes
              <div className="text-center">
                <Camera className="mx-auto mb-2 h-12 w-12 text-gray-400" />
                <p className="text-sm text-gray-600">Haz clic para buscar imágenes</p>
                <p className="text-xs text-gray-500 mt-1">
                  {files.length}/5 imágenes • Máx. 10MB por imagen
                </p>
                <p className="text-xs text-gray-500">o arrastra y suelta aquí</p>
              </div>
            )}
          </div>

          {/* Previsualización de imágenes adicionales */}
          {files.length > 1 && (
            <div>
              <p className="text-sm text-gray-600 mb-2">
                Imágenes adicionales ({files.length - 1}):
              </p>
              <div className="grid grid-cols-3 gap-2">
                {files.slice(1).map((_, index) => (
                  <div key={index + 1} className="relative">
                    <div className="aspect-square rounded-lg overflow-hidden border bg-gray-100">
                      <img
                        src={previews[index + 1]}
                        alt={`${label} ${index + 2}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(tipo, index + 1)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-gray-500 text-white rounded-full flex items-center justify-center hover:bg-gray-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderTechnicalField = (field: TechnicalField, label: string) => {
    const options = TECHNICAL_OPTIONS[field];
    const selectedValues = formData[field];
    const metadata = TECHNICAL_METADATA[field];
    const accionesSeleccionadas = selectedValues.length > 0
      ? buildTechnicalActionsText(field, selectedValues)
      : "";

    return (
      <div>
        <label className="block text-sm font-medium mb-2">{label} *</label>
        <div className="grid grid-cols-2 gap-2">
          {options.map((option) => {
            const isSelected = selectedValues.includes(option.value);

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleTechnicalOption(field, option.value)}
                className={`p-2 rounded-lg border text-sm text-left transition-colors ${
                  isSelected
                    ? "border-gray-900 bg-gray-100 text-gray-900"
                    : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {selectedValues.length > 0
            ? `Seleccionado: ${selectedValues.join(", ")}`
            : "Selecciona una o varias opciones"}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          <strong>Definición:</strong> {metadata.definition}
        </p>
        {accionesSeleccionadas && (
          <p className="text-xs text-gray-600 mt-1">
            <strong>Acciones:</strong> {accionesSeleccionadas}
          </p>
        )}
      </div>
    );
  };

  // const tieneFotosAntesDespues = formData.foto_antes.length > 0 && formData.foto_despues.length > 0;

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border bg-white p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold mb-2">Ficha - Diagnóstico Rizotipo</h2>
          <p className="text-gray-600">
            Cliente: {cita.cliente.nombre} {cita.cliente.apellido}
          </p>
        </div>
        {onCancelar && (
          <button
            type="button"
            onClick={onCancelar}
            className="px-4 py-2 border rounded-lg hover:bg-gray-50"
          >
            Cancelar
          </button>
        )}
      </div>

      {/* Información de la cita */}
      <div className="bg-gray-50 p-4 rounded-lg">
        <h3 className="font-semibold mb-2">Información del servicio</h3>
        <div className="grid grid-cols-2 gap-2">
          <p><strong>Cliente:</strong> {cita.cliente.nombre} {cita.cliente.apellido}</p>
          <p><strong>Servicio(s):</strong> {cita.servicios?.map((s: any) => s.nombre).join(', ') || 'Sin servicio'}</p>
          <p><strong>Fecha:</strong> {cita.fecha}</p>
          <p><strong>Hora:</strong> {cita.hora_inicio}</p>
        </div>
      </div>

      {/* Sección de imágenes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {renderImageUploader('antes', '📸 Estado actual (Foto antes)')}
        {renderImageUploader('despues', '📸 Resultado final (Foto después)')}
      </div>

      {/* Parámetros Técnicos */}
      <div className="space-y-6">
        <h3 className="text-lg font-semibold">Parámetros Técnicos</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {renderTechnicalField("plasticidad", "Plasticidad")}
          {renderTechnicalField("permeabilidad", "Permeabilidad")}
          {renderTechnicalField("porosidad", "Porosidad")}
          {renderTechnicalField("exterior_lipidico", "Exterior Lipídico")}
          {renderTechnicalField("densidad", "Densidad")}
          {renderTechnicalField("oleosidad", "Oleosidad")}
          {renderTechnicalField("grosor", "Grosor")}
          {renderTechnicalField("textura", "Textura")}
        </div>
      </div>

      {/* Tipo de Textura */}
      <div className="space-y-3">
        <label className="block text-sm font-medium">Tipo de Textura *</label>
        <p className="text-xs text-gray-500">El estilista selecciona y aparece la imagen de referencia correspondiente</p>

        {/* Ondulados 2 */}
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-2">Ondulados 2</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: "2A", label: "2A" },
              { value: "2B", label: "2B" },
              { value: "2C", label: "2C" },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleInputChange("tipo_textura", opt.value)}
                className={`p-2 rounded-lg border text-sm text-center transition-colors ${
                  formData.tipo_textura === opt.value
                    ? "border-gray-900 bg-gray-100 text-gray-900"
                    : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Rizados 3 */}
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-2">Rizados 3</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: "3A", label: "3A" },
              { value: "3B", label: "3B" },
              { value: "3C", label: "3C" },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleInputChange("tipo_textura", opt.value)}
                className={`p-2 rounded-lg border text-sm text-center transition-colors ${
                  formData.tipo_textura === opt.value
                    ? "border-gray-900 bg-gray-100 text-gray-900"
                    : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Afro 4 */}
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-2">Afro 4</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: "4A", label: "4A" },
              { value: "4B", label: "4B" },
              { value: "4C", label: "4C" },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleInputChange("tipo_textura", opt.value)}
                className={`p-2 rounded-lg border text-sm text-center transition-colors ${
                  formData.tipo_textura === opt.value
                    ? "border-gray-900 bg-gray-100 text-gray-900"
                    : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-gray-500">
          {formData.tipo_textura
            ? `Seleccionado: ${formData.tipo_textura}`
            : "Selecciona una opción"}
        </p>

        {/* SVG de referencia visual */}
        {formData.tipo_textura && (
          <div className="flex justify-center p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <CurlPatternSVG type={formData.tipo_textura} />
          </div>
        )}
      </div>

      {/* Transición */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">Transición</label>
        <p className="text-xs text-gray-500">Cabellos en transición</p>
        <p className="text-xs text-gray-400 italic">Por: decoloración, planchas, alisados químicos</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {[
            { value: "ondulados", label: "Ondulados en transición" },
            { value: "rizados", label: "Rizados en transición" },
            { value: "afro", label: "Afro en transición" },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() =>
                handleInputChange(
                  "transicion",
                  formData.transicion === opt.value ? "" : opt.value
                )
              }
              className={`p-2 rounded-lg border text-sm text-left transition-colors ${
                formData.transicion === opt.value
                  ? "border-gray-900 bg-gray-100 text-gray-900"
                  : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          {formData.transicion
            ? `Seleccionado: ${formData.transicion}`
            : "Selecciona una opción (opcional)"}
        </p>

        {formData.transicion && (
          <div className="flex justify-center p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <TransitionSVG type={formData.transicion} />
          </div>
        )}
      </div>

      {/* Largo del Cabello */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">Largo del Cabello *</label>
        <p className="text-xs text-gray-500">Selecciona una opción</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {[
            { value: "muy_corto", label: "Muy corto" },
            { value: "corto", label: "Corto" },
            { value: "medio", label: "Medio" },
            { value: "largo", label: "Largo" },
            { value: "muy_largo", label: "Muy largo" },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleInputChange("largo_cabello", opt.value)}
              className={`p-2 rounded-lg border text-sm text-center transition-colors ${
                formData.largo_cabello === opt.value
                  ? "border-gray-900 bg-gray-100 text-gray-900"
                  : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          {formData.largo_cabello
            ? `Seleccionado: ${formData.largo_cabello.replace("_", " ")}`
            : "Selecciona una opción"}
        </p>
      </div>

      {/* Estado del Cabello */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">Estado del Cabello *</label>
        <p className="text-xs text-gray-500">Selecciona una o varias opciones</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: "natural", label: "Natural" },
            { value: "semi_procesado", label: "Semi procesado" },
            { value: "procesado", label: "Procesado" },
            { value: "danado", label: "Dañado" },
          ].map((opt) => {
            const isSelected = formData.estado_cabello.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setFormData((prev) => ({
                    ...prev,
                    estado_cabello: isSelected
                      ? prev.estado_cabello.filter((v) => v !== opt.value)
                      : [...prev.estado_cabello, opt.value],
                  }));
                }}
                className={`p-2 rounded-lg border text-sm text-left transition-colors ${
                  isSelected
                    ? "border-gray-900 bg-gray-100 text-gray-900"
                    : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-500">
          {formData.estado_cabello.length > 0
            ? `Seleccionado: ${formData.estado_cabello.join(", ")}`
            : "Selecciona una o varias opciones"}
        </p>
        <p className="text-xs text-gray-500">
          <strong>Definición:</strong> Estado estructural actual de la fibra capilar
        </p>
      </div>

      {/* Recomendaciones */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Recomendaciones</h3>

        <div>
          <label className="block text-sm font-medium mb-2">Recomendaciones Personalizadas</label>
          <textarea
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm leading-relaxed shadow-inner min-h-[140px] resize-none focus:ring-2 focus:ring-gray-900/40 focus:border-gray-900/40"
            value={formData.recomendaciones_personalizadas}
            onChange={(e) => handleInputChange('recomendaciones_personalizadas', e.target.value)}
            onInput={handleTextareaAutoResize}
            placeholder="Escribe recomendaciones específicas para el cliente..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Frecuencia de Corte</label>
          <select
            className="w-full p-2 border rounded-lg"
            value={formData.frecuencia_corte}
            onChange={(e) => handleInputChange('frecuencia_corte', e.target.value)}
          >
            <option value="">Seleccionar</option>
            <option value="1 vez al año">1 vez al año</option>
            <option value="Cada 4 meses">Cada 4 meses</option>
            <option value="Cada 3 meses">Cada 3 meses</option>
            <option value="Cada 2 meses">Cada 2 meses</option>
            <option value="Cada mes">Cada mes</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Técnicas de Estilizado Usadas Hoy</label>
          <textarea
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm leading-relaxed shadow-inner min-h-[120px] resize-none focus:ring-2 focus:ring-gray-900/40 focus:border-gray-900/40"
            value={formData.tecnicas_estilizado}
            onChange={(e) => handleInputChange('tecnicas_estilizado', e.target.value)}
            onInput={handleTextareaAutoResize}
            placeholder="Ej: Plancha, secado, etc."
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Productos Sugeridos y Usados Hoy</label>
          <textarea
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm leading-relaxed shadow-inner min-h-[140px] resize-none focus:ring-2 focus:ring-gray-900/40 focus:border-gray-900/40"
            value={formData.productos_sugeridos}
            onChange={(e) => handleInputChange('productos_sugeridos', e.target.value)}
            onInput={handleTextareaAutoResize}
            placeholder="Lista de productos recomendados y utilizados..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Observaciones Generales</label>
          <textarea
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm leading-relaxed shadow-inner min-h-[140px] resize-none focus:ring-2 focus:ring-gray-900/40 focus:border-gray-900/40"
            value={formData.observaciones_generales}
            onChange={(e) => handleInputChange('observaciones_generales', e.target.value)}
            onInput={handleTextareaAutoResize}
            placeholder="Observaciones adicionales..."
          />
        </div>
      </div>

      {/* Autorización de publicación */}
      <div className="flex items-center space-x-2 p-4 border rounded-lg">
        <input
          type="checkbox"
          id="autoriza"
          checked={formData.autorizacion_publicacion}
          onChange={(e) => handleInputChange('autorizacion_publicacion', e.target.checked)}
          className="w-4 h-4"
        />
        <label htmlFor="autoriza" className="text-sm font-medium">
          ¿Autoriza publicar fotos en redes sociales?
        </label>
      </div>

      {/* FIRMA DEL PROFESIONAL - OBLIGATORIO */}
      <div className="flex items-center space-x-2 p-4 border rounded-lg bg-gray-50">
        <input
          type="checkbox"
          id="firma"
          checked={formData.firma_profesional}
          onChange={(e) => handleInputChange('firma_profesional', e.target.checked)}
          className="w-5 h-5 text-gray-600"
          required
        />
        <label htmlFor="firma" className="text-sm font-medium flex-1">
          <span className="font-bold">Incluir firma del profesional</span>
          <p className="text-gray-600 text-xs mt-1">
            Confirma que como profesional a cargo, te responsabilizas por el diagnóstico realizado.
          </p>
        </label>
      </div>

      {/* Botones de acción */}
      <div className="flex space-x-4 pt-4 border-t">
        <button
          type="button"
          onClick={handleSaveDraft}
          disabled={loading}
          className="px-6 py-3 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 flex items-center"
        >
          <Save className="h-4 w-4 mr-2" />
          Guardar borrador
        </button>

        <button
          type="submit"
          disabled={loading || !formData.firma_profesional ||
            formData.plasticidad.length === 0 || formData.permeabilidad.length === 0 || formData.porosidad.length === 0 ||
            formData.exterior_lipidico.length === 0 || formData.densidad.length === 0 || formData.oleosidad.length === 0 ||
            formData.grosor.length === 0 || formData.textura.length === 0 ||
            !formData.tipo_textura || !formData.largo_cabello || formData.estado_cabello.length === 0}
          className={`flex-1 py-3 rounded-lg font-semibold transition-colors flex items-center justify-center ${loading || !formData.firma_profesional ||
            formData.plasticidad.length === 0 || formData.permeabilidad.length === 0 || formData.porosidad.length === 0 ||
            formData.exterior_lipidico.length === 0 || formData.densidad.length === 0 || formData.oleosidad.length === 0 ||
            formData.grosor.length === 0 || formData.textura.length === 0 ||
            !formData.tipo_textura || !formData.largo_cabello || formData.estado_cabello.length === 0
            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
            : 'bg-gray-600 text-white hover:bg-gray-700'
            }`}
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin h-5 w-5 mr-2" />
              Creando ficha...
            </>
          ) : (
            <>
              <CheckCircle className="h-5 w-5 mr-2" />
              Crear Ficha Completa
            </>
          )}
        </button>
      </div>

      {/* Mensajes de validación */}
      {!formData.firma_profesional && (
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <p className="text-gray-700 text-sm">
            ⚠️ Debe incluir su firma como profesional para crear la ficha.
          </p>
        </div>
      )}

      {/* {!tieneFotosAntesDespues && (
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <p className="text-gray-700 text-sm">
            ⚠️ Debe cargar mínimo una foto de antes y una foto de después.
          </p>
        </div>
      )} */}

      {/* Nota sobre guardado automático */}
      <div className="p-2 bg-gray-50 border border-gray-200 rounded text-center">
        <p className="text-xs text-gray-600">
          💾 Los datos se guardan automáticamente (excepto las imágenes).
          Puedes cerrar y continuar más tarde.
        </p>
      </div>
    </form>
  );
}

