// src/components/fichas/FichaOzonoterapiaCapilar.tsx — Ozonoterapia Capilar RF®
"use client";

import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Cita } from '../../../../types/fichas';
import { Camera, Loader2, X, Save, CheckCircle } from 'lucide-react';
import { API_BASE_URL } from '../../../../types/config';
import { getEstilistaDataFromCita, getFichaAuthToken } from './fichaHelpers';
import { handleTextareaAutoResize } from "../../../../lib/textareaAutosize";

interface FichaOzonoterapiaCapilarProps {
  cita: Cita;
  datosIniciales?: any;
  onGuardar?: (datos: any) => void;
  onSubmit: (data: any) => void;
  onCancelar?: () => void;
  fichaId?: string;
  modoEdicion?: boolean;
}

export function FichaOzonoterapiaCapilar({ cita, datosIniciales, onGuardar, onSubmit, onCancelar, fichaId, modoEdicion }: FichaOzonoterapiaCapilarProps) {
  const [formData, setFormData] = useState({
    autorizacion_publicacion: false,
    firma_profesional: false,
    foto_antes: [] as File[],
    foto_despues: [] as File[],
    // Sección 1
    numero_sesion: "",
    // Sección 2
    estado_cabello_ozono: [] as string[],
    estado_cabello_ozono_otro: "",
    obs_estado_cabello: "",
    // Sección 3
    objetivo_ozonoterapia: [] as string[],
    // Sección 4
    permeabilidad_ozono: "",
    porosidad_ozono: "",
    plasticidad_ozono: "",
    densidad_ozono: "",
    oleosidad_ozono: "",
    grosor_fibra_ozono: "",
    textura_ozono: "",
    // Sección 5
    tipo_limpieza: "",
    tiempo_exposicion_ozono: "",
    tratamiento_medios_puntas: "",
    metodo_lavado: "",
    // Sección 6
    ingredientes_domicilio: [] as string[],
    frecuencia_ingredientes: "",
    // Sección 7
    resultados_post_servicio: [] as string[],
    obs_resultados: "",
    // Sección 8
    frecuencia_seguimiento: "",
    recomendaciones_adicionales: "",
  });

  const [loading, setLoading] = useState(false);
  const [previewImages, setPreviewImages] = useState<{
    antes: string[];
    despues: string[];
  }>({ antes: [], despues: [] });

  const fileInputRefAntes = useRef<HTMLInputElement>(null);
  const fileInputRefDespues = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedData = localStorage.getItem(`ficha_ozonoterapia_capilar_${cita.cita_id}`);
    if (savedData) {
      const parsedData = JSON.parse(savedData);
      setFormData({
        ...parsedData,
        foto_antes: [],
        foto_despues: [],
      });
    } else if (datosIniciales) {
      setFormData(datosIniciales);
    }
  }, [cita.cita_id, datosIniciales]);

  useEffect(() => {
    const dataToSave = {
      ...formData,
      foto_antes: [],
      foto_despues: [],
    };
    localStorage.setItem(`ficha_ozonoterapia_capilar_${cita.cita_id}`, JSON.stringify(dataToSave));
  }, [formData, cita.cita_id]);

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
    const remainingSlots = 5 - currentFiles.length;
    if (remainingSlots <= 0) {
      toast.warning(`Máximo 5 imágenes permitidas para ${tipo === 'antes' ? 'antes' : 'después'}`);
      return;
    }
    const filesToAdd = newFiles.slice(0, remainingSlots);
    setFormData(prev => ({ ...prev, [`foto_${tipo}`]: [...currentFiles, ...filesToAdd] }));
    const newPreviews = filesToAdd.map(file => URL.createObjectURL(file));
    setPreviewImages(prev => ({ ...prev, [tipo]: [...prev[tipo], ...newPreviews] }));
  };

  const handleRemoveImage = (tipo: 'antes' | 'despues', index: number) => {
    if (previewImages[tipo][index]) URL.revokeObjectURL(previewImages[tipo][index]);
    const key = tipo === 'antes' ? 'foto_antes' : 'foto_despues';
    setFormData(prev => ({ ...prev, [key]: prev[key].filter((_, i) => i !== index) }));
    setPreviewImages(prev => ({ ...prev, [tipo]: prev[tipo].filter((_, i) => i !== index) }));
  };

  const openFileSelector = (tipo: 'antes' | 'despues') => {
    if (tipo === 'antes') fileInputRefAntes.current?.click();
    else fileInputRefDespues.current?.click();
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const toggleArrayField = (field: string, value: string) => {
    setFormData(prev => {
      const current = (prev as any)[field] as string[];
      const isSelected = current.includes(value);
      return {
        ...prev,
        [field]: isSelected
          ? current.filter((v: string) => v !== value)
          : [...current, value],
      };
    });
  };

  const handleSaveDraft = () => {
    if (onGuardar) {
      onGuardar({ ...formData, fecha_guardado: new Date().toISOString(), estado: 'borrador' });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.firma_profesional) {
      toast.warning('Debe incluir su firma como profesional para crear la ficha');
      return;
    }

    setLoading(true);

    try {
      const token = getFichaAuthToken();
      if (!token) throw new Error('No hay token de autenticación');

      const estilistaData = getEstilistaDataFromCita(cita);
      if (!estilistaData.id) throw new Error('No se pudo identificar al profesional de la cita. Recarga la agenda e intenta nuevamente.');

      const formDataToSend = new FormData();
      formData.foto_antes.forEach((file) => formDataToSend.append('fotos_antes', file));
      formData.foto_despues.forEach((file) => formDataToSend.append('fotos_despues', file));

      const fichaData = {
        cliente_id: cita.cliente.cliente_id,
        servicio_id: cita.servicios?.[0]?.servicio_id || "",
        profesional_id: estilistaData.id,
        sede_id: cita.sede?.sede_id || 'sede_default',
        tipo_ficha: "OZONOTERAPIA_CAPILAR",

        servicio_nombre: cita.servicios?.map((s: any) => s.nombre).join(', ') || "",
        profesional_nombre: estilistaData.nombre,
        profesional_email: estilistaData.email,
        fecha_ficha: new Date().toISOString(),
        fecha_reserva: cita.fecha || "",

        email: cita.cliente.email || "",
        nombre: cita.cliente.nombre || "",
        apellido: cita.cliente.apellido || "",
        cedula: "",
        telefono: cita.cliente.telefono || "",

        precio: cita.precio_total || cita.servicios?.reduce((sum: number, s: any) => sum + (s.precio || 0), 0) || 0,
        estado: "completado",
        estado_pago: "pagado",

        datos_especificos: {
          cita_id: cita.cita_id,
          firma_profesional: formData.firma_profesional,
          fecha_firma: new Date().toISOString(),
          profesional_firmante: estilistaData.nombre,
          profesional_firmante_id: estilistaData.id,
          profesional_firmante_email: estilistaData.email,
          // TODO: incluir en payload cuando backend lo soporte
          numero_sesion: formData.numero_sesion,
          estado_cabello_ozono: formData.estado_cabello_ozono,
          estado_cabello_ozono_otro: formData.estado_cabello_ozono_otro,
          obs_estado_cabello: formData.obs_estado_cabello,
          objetivo_ozonoterapia: formData.objetivo_ozonoterapia,
          permeabilidad_ozono: formData.permeabilidad_ozono,
          porosidad_ozono: formData.porosidad_ozono,
          plasticidad_ozono: formData.plasticidad_ozono,
          densidad_ozono: formData.densidad_ozono,
          oleosidad_ozono: formData.oleosidad_ozono,
          grosor_fibra_ozono: formData.grosor_fibra_ozono,
          textura_ozono: formData.textura_ozono,
          tipo_limpieza: formData.tipo_limpieza,
          tiempo_exposicion_ozono: formData.tiempo_exposicion_ozono,
          tratamiento_medios_puntas: formData.tratamiento_medios_puntas,
          metodo_lavado: formData.metodo_lavado,
          ingredientes_domicilio: formData.ingredientes_domicilio,
          frecuencia_ingredientes: formData.frecuencia_ingredientes,
          resultados_post_servicio: formData.resultados_post_servicio,
          obs_resultados: formData.obs_resultados,
          frecuencia_seguimiento: formData.frecuencia_seguimiento,
          recomendaciones_adicionales: formData.recomendaciones_adicionales,
          autorizacion_publicacion: formData.autorizacion_publicacion,
        },
        descripcion_servicio: `Ozonoterapia Capilar RF® - Realizado por ${estilistaData.nombre}`,
        fotos_antes: [],
        fotos_despues: [],
        autorizacion_publicacion: formData.autorizacion_publicacion,
        comentario_interno: formData.obs_resultados || "",
      };

      formDataToSend.append('data', JSON.stringify(fichaData));

      const isEdit = Boolean(fichaId || modoEdicion);
      const endpoint = isEdit
        ? `${API_BASE_URL}scheduling/quotes/fichas/${fichaId}`
        : `${API_BASE_URL}scheduling/quotes/create-ficha`;
      const method = isEdit ? 'PUT' : 'POST';

      const response = await fetch(endpoint, {
        method,
        headers: { 'Authorization': `Bearer ${token}` },
        body: formDataToSend,
      });

      if (!response.ok) {
        let errorText = await response.text();
        try {
          const errorJson = JSON.parse(errorText);
          if (response.status === 422 && errorJson.detail) {
            const errorMessages = errorJson.detail.map((err: any) => `Campo ${err.loc[1]}: ${err.msg}`).join('\n');
            throw new Error(`Errores de validación:\n${errorMessages}`);
          }
          throw new Error(errorJson.detail || errorJson.message || `Error ${response.status}`);
        } catch {
          throw new Error(`Error ${response.status}: ${errorText || response.statusText}`);
        }
      }

      const data = await response.json();

      if (data.success) {
        previewImages.antes.forEach(url => URL.revokeObjectURL(url));
        previewImages.despues.forEach(url => URL.revokeObjectURL(url));
        localStorage.removeItem(`ficha_ozonoterapia_capilar_${cita.cita_id}`);
        toast.success(
          isEdit
            ? `Ozonoterapia Capilar RF® actualizada por ${estilistaData.nombre}`
            : `Ozonoterapia Capilar RF® creada exitosamente por ${estilistaData.nombre}`
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
        <input ref={fileInputRef} type="file" multiple accept="image/*" className="hidden"
          onChange={(e) => handleFileSelect(tipo, e.target.files)} />
        <div className="space-y-4">
          <div
            className="relative flex flex-col items-center justify-center h-48 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
            onClick={() => openFileSelector(tipo)}
          >
            {previews.length > 0 ? (
              <div className="w-full h-full p-2">
                <img src={previews[0]} alt="Vista previa" className="w-full h-full object-cover rounded" />
                <div className="absolute inset-0 bg-black bg-opacity-30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity rounded">
                  <p className="text-white text-sm bg-black bg-opacity-70 px-3 py-1 rounded">Haz clic para cambiar</p>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <Camera className="mx-auto mb-2 h-12 w-12 text-gray-400" />
                <p className="text-sm text-gray-600">Haz clic para buscar imágenes</p>
                <p className="text-xs text-gray-500 mt-1">{files.length}/5 imágenes • Máx. 10MB por imagen</p>
                <p className="text-xs text-gray-500">o arrastra y suelta aquí</p>
              </div>
            )}
          </div>
          {files.length > 1 && (
            <div>
              <p className="text-sm text-gray-600 mb-2">Imágenes adicionales ({files.length - 1}):</p>
              <div className="grid grid-cols-3 gap-2">
                {files.slice(1).map((_, index) => (
                  <div key={index + 1} className="relative">
                    <div className="aspect-square rounded-lg overflow-hidden border bg-gray-100">
                      <img src={previews[index + 1]} alt={`${label} ${index + 2}`} className="w-full h-full object-cover" />
                    </div>
                    <button type="button" onClick={() => handleRemoveImage(tipo, index + 1)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-gray-500 text-white rounded-full flex items-center justify-center hover:bg-gray-600">
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

  const renderChipsSingle = (field: string, options: string[]) => (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      {options.map((opt) => (
        <button key={opt} type="button" onClick={() => handleInputChange(field, opt)}
          className={`p-2 rounded-lg border text-sm text-center transition-colors ${
            (formData as any)[field] === opt
              ? "border-gray-900 bg-gray-100 text-gray-900"
              : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
          }`}
        >{opt}</button>
      ))}
    </div>
  );

  const renderChipsMulti = (field: string, options: string[]) => (
    <div className="grid grid-cols-2 gap-2">
      {options.map((opt) => {
        const isSelected = ((formData as any)[field] as string[]).includes(opt);
        return (
          <button key={opt} type="button" onClick={() => toggleArrayField(field, opt)}
            className={`p-2 rounded-lg border text-sm text-left transition-colors ${
              isSelected
                ? "border-gray-900 bg-gray-100 text-gray-900"
                : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
            }`}
          >{opt}</button>
        );
      })}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border bg-white p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold mb-2">Ozonoterapia Capilar RF®</h2>
          <p className="text-gray-600">
            Cliente: {cita.cliente.nombre} {cita.cliente.apellido}
          </p>
        </div>
        {onCancelar && (
          <button type="button" onClick={onCancelar} className="px-4 py-2 border rounded-lg hover:bg-gray-50">Cancelar</button>
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

      {/* SECCIÓN 1 — NÚMERO DE SESIÓN */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Número de Sesión</h3>
        {renderChipsSingle("numero_sesion", ["Primera", "Segunda", "Tercera", "Mantenimiento"])}
        <p className="text-xs text-gray-500">
          {formData.numero_sesion ? `Seleccionado: ${formData.numero_sesion}` : "Selecciona una opción"}
        </p>
      </div>

      {/* SECCIÓN 2 — ESTADO ACTUAL DEL CABELLO Y CUERO CABELLUDO */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold">Estado Actual del Cabello y Cuero Cabelludo</h3>
        <p className="text-xs text-gray-500">Selecciona una o varias opciones</p>
        {renderChipsMulti("estado_cabello_ozono", [
          "Deshidratado",
          "Opaco",
          "Frizz elevado",
          "Pérdida de definición",
          "Sensibilizado químicamente",
          "Quiebre",
          "Puntas abiertas",
          "Enredo excesivo",
          "Cuero cabelludo graso",
          "Cuero cabelludo seco",
          "Caspa / descamación",
          "Irritación / inflamación",
          "Foliculitis",
          "Caída difusa",
          "Otro",
        ])}
        {formData.estado_cabello_ozono.includes("Otro") && (
          <input type="text" className="w-full p-2 border rounded-lg text-sm"
            value={formData.estado_cabello_ozono_otro}
            onChange={(e) => handleInputChange("estado_cabello_ozono_otro", e.target.value)}
            placeholder="Especifica..." />
        )}
        <div>
          <label className="block text-sm font-medium mb-2">Observaciones del profesional</label>
          <textarea
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm leading-relaxed shadow-inner min-h-[100px] resize-none focus:ring-2 focus:ring-gray-900/40 focus:border-gray-900/40"
            value={formData.obs_estado_cabello}
            onChange={(e) => handleInputChange("obs_estado_cabello", e.target.value)}
            onInput={handleTextareaAutoResize}
            placeholder="Observaciones adicionales sobre el estado del cabello..."
          />
        </div>
      </div>

      {/* SECCIÓN 3 — OBJETIVO DEL SERVICIO DE OZONOTERAPIA */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold">Objetivo del Servicio</h3>
        <p className="text-xs text-gray-500">Selecciona una o varias opciones</p>
        {renderChipsMulti("objetivo_ozonoterapia", [
          "Desintoxicar cuero cabelludo",
          "Oxigenar folículo",
          "Regular oleosidad",
          "Disminuir inflamación",
          "Estimular crecimiento",
          "Mejorar hidratación",
          "Recuperar elasticidad",
          "Apoyar reconstrucción capilar",
          "Controlar microbiota capilar",
          "Preparar el cabello para procesos químicos",
          "Mantener la salud capilar",
        ])}
      </div>

      {/* SECCIÓN 4 — VALORACIÓN CAPILAR RESUMIDA SEGÚN RIZOTIPO */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Valoración Capilar Resumida según Rizotipo</h3>

        {[
          { field: "permeabilidad_ozono", label: "Permeabilidad", options: ["Baja", "Media", "Alta"] },
          { field: "porosidad_ozono", label: "Porosidad", options: ["Baja", "Media", "Alta"] },
          { field: "plasticidad_ozono", label: "Plasticidad", options: ["Baja", "Media", "Alta"] },
          { field: "densidad_ozono", label: "Densidad", options: ["Baja", "Media", "Alta"] },
          { field: "oleosidad_ozono", label: "Oleosidad", options: ["Seca", "Normal", "Oleosa"] },
          { field: "grosor_fibra_ozono", label: "Grosor de fibra", options: ["Fino", "Medio", "Grueso"] },
          { field: "textura_ozono", label: "Textura", options: ["Ondulada", "Rizada", "Afro"] },
        ].map(({ field, label, options }) => (
          <div key={field} className="space-y-1">
            <label className="block text-sm font-medium">{label}</label>
            <div className="grid grid-cols-3 gap-2">
              {options.map((opt) => (
                <button key={opt} type="button" onClick={() => handleInputChange(field, opt)}
                  className={`p-2 rounded-lg border text-sm text-center transition-colors ${
                    (formData as any)[field] === opt
                      ? "border-gray-900 bg-gray-100 text-gray-900"
                      : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                  }`}
                >{opt}</button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* SECCIÓN 5 — PROTOCOLO REALIZADO */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Protocolo Realizado</h3>

        <div>
          <label className="block text-sm font-medium mb-2">Tipo de limpieza</label>
          {renderChipsSingle("tipo_limpieza", ["Limpieza suave", "Detox profundo"])}
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Tiempo de exposición al ozono</label>
          <input type="text" className="w-full p-2 border rounded-lg text-sm"
            value={formData.tiempo_exposicion_ozono}
            onChange={(e) => handleInputChange("tiempo_exposicion_ozono", e.target.value)}
            placeholder="Ej: 15 minutos" />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Tratamiento aplicado en medios y puntas</label>
          <textarea
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm leading-relaxed shadow-inner min-h-[100px] resize-none focus:ring-2 focus:ring-gray-900/40 focus:border-gray-900/40"
            value={formData.tratamiento_medios_puntas}
            onChange={(e) => handleInputChange("tratamiento_medios_puntas", e.target.value)}
            onInput={handleTextareaAutoResize}
            placeholder="Describe el tratamiento aplicado..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Método de lavado aplicado</label>
          {renderChipsSingle("metodo_lavado", ["ASA", "COPU"])}
        </div>
      </div>

      {/* SECCIÓN 6 — INGREDIENTES RECOMENDADOS PARA USO DOMICILIARIO */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold">Ingredientes Recomendados para Uso Domiciliario</h3>
        {renderChipsMulti("ingredientes_domicilio", [
          "Hidratantes (pantenol, glicerina, ácido hialurónico)",
          "Reparadores (proteínas hidrolizadas, aminoácidos, ceramidas)",
          "Calmantes (extractos botánicos, niacinamida)",
          "Estimulantes (cafeína, biotina, zinc)",
          "Nutritivos (aceites vegetales ligeros)",
        ])}

        <div>
          <label className="block text-sm font-medium mb-2">Frecuencia sugerida</label>
          <input type="text" className="w-full p-2 border rounded-lg text-sm"
            value={formData.frecuencia_ingredientes}
            onChange={(e) => handleInputChange("frecuencia_ingredientes", e.target.value)}
            placeholder="Frecuencia de uso recomendada..." />
        </div>
      </div>

      {/* SECCIÓN 7 — RESULTADOS OBSERVADOS POST SERVICIO */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold">Resultados Observados Post Servicio</h3>
        {renderChipsMulti("resultados_post_servicio", [
          "Mayor suavidad",
          "Mejor definición",
          "Disminución de frizz",
          "Mayor brillo",
          "Mejor elasticidad",
          "Sensación de cuero cabelludo limpio",
          "Disminución de irritación",
          "Mejor peinabilidad",
        ])}

        <div>
          <label className="block text-sm font-medium mb-2">Observaciones del profesional</label>
          <textarea
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm leading-relaxed shadow-inner min-h-[100px] resize-none focus:ring-2 focus:ring-gray-900/40 focus:border-gray-900/40"
            value={formData.obs_resultados}
            onChange={(e) => handleInputChange("obs_resultados", e.target.value)}
            onInput={handleTextareaAutoResize}
            placeholder="Observaciones adicionales post servicio..."
          />
        </div>
      </div>

      {/* SECCIÓN 8 — PLAN DE SEGUIMIENTO */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Plan de Seguimiento</h3>

        <div>
          <label className="block text-sm font-medium mb-2">Frecuencia recomendada del servicio</label>
          {renderChipsSingle("frecuencia_seguimiento", ["Cada 15 días", "Cada mes", "Cada 2 meses"])}
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Recomendaciones adicionales</label>
          <textarea
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm leading-relaxed shadow-inner min-h-[140px] resize-none focus:ring-2 focus:ring-gray-900/40 focus:border-gray-900/40"
            value={formData.recomendaciones_adicionales}
            onChange={(e) => handleInputChange("recomendaciones_adicionales", e.target.value)}
            onInput={handleTextareaAutoResize}
            placeholder="Recomendaciones personalizadas para el cliente..."
          />
        </div>
      </div>

      {/* Constancia del servicio */}
      <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
        <p className="text-sm text-gray-700">
          Declaro haber recibido información clara sobre el servicio de ozonoterapia capilar, sus beneficios y cuidados posteriores.
        </p>
      </div>

      {/* Autorización de publicación */}
      <div className="flex items-center space-x-2 p-4 border rounded-lg">
        <input type="checkbox" id="autoriza-ozono" checked={formData.autorizacion_publicacion}
          onChange={(e) => handleInputChange('autorizacion_publicacion', e.target.checked)} className="w-4 h-4" />
        <label htmlFor="autoriza-ozono" className="text-sm font-medium">
          ¿Autoriza publicar fotos en redes sociales?
        </label>
      </div>

      {/* FIRMA DEL PROFESIONAL */}
      <div className="flex items-center space-x-2 p-4 border rounded-lg bg-gray-50">
        <input type="checkbox" id="firma-ozono" checked={formData.firma_profesional}
          onChange={(e) => handleInputChange('firma_profesional', e.target.checked)}
          className="w-5 h-5 text-gray-600" required />
        <label htmlFor="firma-ozono" className="text-sm font-medium flex-1">
          <span className="font-bold">Incluir firma del profesional</span>
          <p className="text-gray-600 text-xs mt-1">
            Confirma que como profesional a cargo, te responsabilizas por la calidad del servicio prestado.
          </p>
        </label>
      </div>

      {/* Botones de acción */}
      <div className="flex space-x-4 pt-4 border-t">
        <button type="button" onClick={handleSaveDraft} disabled={loading}
          className="px-6 py-3 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 flex items-center">
          <Save className="h-4 w-4 mr-2" />
          Guardar borrador
        </button>

        <button type="submit" disabled={loading || !formData.firma_profesional}
          className={`flex-1 py-3 rounded-lg font-semibold transition-colors flex items-center justify-center ${
            loading || !formData.firma_profesional
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-gray-600 text-white hover:bg-gray-700'
          }`}>
          {loading ? (
            <><Loader2 className="animate-spin h-5 w-5 mr-2" />Creando ficha...</>
          ) : (
            <><CheckCircle className="h-5 w-5 mr-2" />Crear Ficha Completa</>
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
