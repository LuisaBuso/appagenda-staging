// src/components/fichas/FichaColor.tsx — Diagnóstico Cromático
"use client";

import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Cita } from '../../../../types/fichas';
import { Camera, Loader2, X, Save, CheckCircle } from 'lucide-react';
import { API_BASE_URL } from '../../../../types/config';
import { getEstilistaDataFromCita, getFichaAuthToken } from './fichaHelpers';
import { handleTextareaAutoResize } from "../../../../lib/textareaAutosize";

interface FichaColorProps {
  cita: Cita;
  datosIniciales?: any;
  onGuardar?: (datos: any) => void;
  onSubmit: (data: any) => void;
  onCancelar?: () => void;
  fichaId?: string;
  modoEdicion?: boolean;
}

const preguntasColor = [
  "¿Estás de acuerdo en que evaluemos la salud antes del color?",
  "¿Comprendes que si no está en buen estado no realizamos color?",
  "¿Aceptas que los resultados dependen del estado inicial?",
  "¿Aceptas los riesgos del servicio?",
  "¿Confías en que usaremos productos de la mejor calidad?",
  "¿Seguirás las recomendaciones posteriores?",
  "¿Aceptas que podemos suspender si el cabello no responde bien?",
  "¿Autorizas fotos para registro y redes?",
  "¿Comprendes que el color puede cambiar si no sigues cuidados?",
  "¿Te sientes seguro(a) y autorizas iniciar el proceso?"
];

export function FichaColor({ cita, datosIniciales, onGuardar, onSubmit, onCancelar, fichaId, modoEdicion }: FichaColorProps) {
  const [formData, setFormData] = useState({
    autorizacion_publicacion: false,
    firma_profesional: false,
    foto_antes: [] as File[],
    foto_despues: [] as File[],
    descripcion: "",
    observaciones: "",
    respuestas: preguntasColor.map(pregunta => ({
      pregunta,
      respuesta: null as boolean | null,
      observaciones: ""
    })),
    // Objetivo Cromático del Cliente
    objetivo_cromatico: [] as string[],
    objetivo_cromatico_otro: "",
    resultado_deseado: "",
    nivel_expectativa: "",
    // Historial Químico
    ultimo_proceso_quimico: "",
    tipo_proceso: [] as string[],
    tipo_proceso_otro: "",
    frecuencia_procesos: "",
    dano_visible: "",
    // Diagnóstico Rizotipo Aplicado al Color
    permeabilidad_color: "",
    obs_tecnicas_permeabilidad: "",
    impacto_cromatico: "",
    plasticidad_color: "",
    riesgo_ruptura: "",
    porosidad_color: "",
    requiere_reconstruccion: "",
    densidad_color: "",
    estrategia_aplicacion: "",
    oleosidad_color: "",
    requiere_detox: "",
    grosor_fibra_color: "",
    tolerancia_quimica: "",
    textura_color: "",
    nivel_encogimiento: "",
    impacto_visual_color: "",
    // Nivel de Riesgo Cromático RF®
    nivel_riesgo_cromatico: "",
    justificacion_tecnica: "",
    // Plan Cromático Personalizado RF®
    tecnica_sugerida: "",
    nivel_max_aclaracion: "",
    tipo_oxidante: "",
    proteccion_estructural: "",
    tonalizacion_prevista: "",
    num_sesiones: "",
    tiempo_recuperacion: "",
  });

  const [loading, setLoading] = useState(false);
  const [previewImages, setPreviewImages] = useState<{
    antes: string[];
    despues: string[];
  }>({ antes: [], despues: [] });

  const fileInputRefAntes = useRef<HTMLInputElement>(null);
  const fileInputRefDespues = useRef<HTMLInputElement>(null);

  // Cargar datos iniciales del localStorage al montar
  useEffect(() => {
    const savedData = localStorage.getItem(`ficha_color_${cita.cita_id}`);
    if (savedData) {
      const parsedData = JSON.parse(savedData);

      // Nota: No podemos guardar Files en localStorage, solo el estado del formulario
      setFormData({
        ...parsedData,
        foto_antes: [], // Los archivos no se pueden guardar, se limpian
        foto_despues: [] // Los archivos no se pueden guardar, se limpian
      });
    } else if (datosIniciales) {
      setFormData(datosIniciales);
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
    localStorage.setItem(`ficha_color_${cita.cita_id}`, JSON.stringify(dataToSave));
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

  const updateRespuesta = (index: number, field: string, value: any) => {
    setFormData(prev => {
      const nuevasRespuestas = [...prev.respuestas];
      nuevasRespuestas[index] = { ...nuevasRespuestas[index], [field]: value };
      return { ...prev, respuestas: nuevasRespuestas };
    });
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

    const todasRespondidas = formData.respuestas.every(r => typeof r.respuesta === 'boolean');
    if (!todasRespondidas) {
      toast.warning('Debe responder todas las preguntas del consentimiento informado');
      return;
    }

    if (!formData.descripcion.trim()) {
      toast.warning('Debe agregar una descripción del servicio de color realizado');
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

      // 3. Preparar datos según el modelo FichaCreate
      const fichaData = {
        // Campos REQUERIDOS
        cliente_id: cita.cliente.cliente_id,
        servicio_id: cita.servicios?.[0]?.servicio_id || "",
        profesional_id: estilistaData.id,
        sede_id: cita.sede?.sede_id || 'sede_default',
        tipo_ficha: "COLOR",

        // Información básica
        servicio_nombre: cita.servicios?.map((s: any) => s.nombre).join(', ') || "",
        profesional_nombre: estilistaData.nombre,
        profesional_email: estilistaData.email,
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
          descripcion: formData.descripcion,
          observaciones: formData.observaciones,
          respuestas: formData.respuestas,
          autorizacion_publicacion: formData.autorizacion_publicacion,
          // TODO: incluir en payload cuando backend lo soporte
          objetivo_cromatico: formData.objetivo_cromatico,
          objetivo_cromatico_otro: formData.objetivo_cromatico_otro,
          resultado_deseado: formData.resultado_deseado,
          nivel_expectativa: formData.nivel_expectativa,
          ultimo_proceso_quimico: formData.ultimo_proceso_quimico,
          tipo_proceso: formData.tipo_proceso,
          tipo_proceso_otro: formData.tipo_proceso_otro,
          frecuencia_procesos: formData.frecuencia_procesos,
          dano_visible: formData.dano_visible,
          permeabilidad_color: formData.permeabilidad_color,
          obs_tecnicas_permeabilidad: formData.obs_tecnicas_permeabilidad,
          impacto_cromatico: formData.impacto_cromatico,
          plasticidad_color: formData.plasticidad_color,
          riesgo_ruptura: formData.riesgo_ruptura,
          porosidad_color: formData.porosidad_color,
          requiere_reconstruccion: formData.requiere_reconstruccion,
          densidad_color: formData.densidad_color,
          estrategia_aplicacion: formData.estrategia_aplicacion,
          oleosidad_color: formData.oleosidad_color,
          requiere_detox: formData.requiere_detox,
          grosor_fibra_color: formData.grosor_fibra_color,
          tolerancia_quimica: formData.tolerancia_quimica,
          textura_color: formData.textura_color,
          nivel_encogimiento: formData.nivel_encogimiento,
          impacto_visual_color: formData.impacto_visual_color,
          nivel_riesgo_cromatico: formData.nivel_riesgo_cromatico,
          justificacion_tecnica: formData.justificacion_tecnica,
          tecnica_sugerida: formData.tecnica_sugerida,
          nivel_max_aclaracion: formData.nivel_max_aclaracion,
          tipo_oxidante: formData.tipo_oxidante,
          proteccion_estructural: formData.proteccion_estructural,
          tonalizacion_prevista: formData.tonalizacion_prevista,
          num_sesiones: formData.num_sesiones,
          tiempo_recuperacion: formData.tiempo_recuperacion
        },
        respuestas: formData.respuestas.map((r, index) => ({
          pregunta_id: index + 1,
          pregunta: r.pregunta,
          respuesta: r.respuesta ? "Sí" : "No",
          observaciones: r.observaciones,
          respondido_por: estilistaData.nombre,
          respondido_por_id: estilistaData.id
        })),
        descripcion_servicio: formData.descripcion || `Servicio de color realizado por ${estilistaData.nombre}`,

        // Fotos (URLs vacías porque el backend las subirá a S3)
        fotos_antes: [],
        fotos_despues: [],

        // Permisos y comentarios
        autorizacion_publicacion: formData.autorizacion_publicacion,
        comentario_interno: formData.observaciones || ""
      };

      // 4. Debug info
      console.log("📤 Enviando datos de ficha COLOR:", fichaData);
      console.log("👤 Estilista que crea la ficha:", estilistaData);

      // 5. Agregar el campo 'data' como string JSON
      formDataToSend.append('data', JSON.stringify(fichaData));

      // 6. Enviar petición
      const isEdit = Boolean(fichaId || modoEdicion);
      const endpoint = isEdit
        ? `${API_BASE_URL}scheduling/quotes/fichas/${fichaId}`
        : `${API_BASE_URL}scheduling/quotes/create-ficha`;
      const method = isEdit ? 'PUT' : 'POST';

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
        localStorage.removeItem(`ficha_color_${cita.cita_id}`);

        // Notificar éxito
        toast.success(
          isEdit
            ? `Diagnóstico Cromático actualizado por ${estilistaData.nombre}`
            : `Diagnóstico Cromático creado exitosamente por ${estilistaData.nombre}`
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

  const todasRespondidas = formData.respuestas.every(r => typeof r.respuesta === 'boolean');
  // const tieneFotosAntesDespues = formData.foto_antes.length > 0 && formData.foto_despues.length > 0;

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border bg-white p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold mb-2">Diagnóstico Cromático</h2>
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

      {/* Consentimiento Informado para Color */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Consentimiento Informado para Color</h3>
        <p className="text-sm text-gray-600 mb-4">
          Por favor, responde todas las preguntas para proceder con el servicio de color.
        </p>

        {formData.respuestas.map((respuesta, index) => (
          <div key={index} className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="font-medium text-sm flex-1">
                {index + 1}. {respuesta.pregunta}
              </label>
              <div className="flex items-center space-x-4 ml-4">
                <label className="flex items-center space-x-2">
                  <input
                    type="radio"
                    name={`pregunta-${index}`}
                    checked={respuesta.respuesta === true}
                    onChange={() => updateRespuesta(index, 'respuesta', true)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Sí</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input
                    type="radio"
                    name={`pregunta-${index}`}
                    checked={respuesta.respuesta === false}
                    onChange={() => updateRespuesta(index, 'respuesta', false)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">No</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Observaciones:</label>
              <textarea
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm leading-relaxed shadow-inner min-h-[140px] resize-none focus:ring-2 focus:ring-gray-900/40 focus:border-gray-900/40"
                value={respuesta.observaciones}
                onChange={(e) => updateRespuesta(index, 'observaciones', e.target.value)}
                onInput={handleTextareaAutoResize}
                placeholder="Observaciones adicionales..."
              />
            </div>
          </div>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECCIÓN 1 — OBJETIVO CROMÁTICO DEL CLIENTE
          ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Objetivo Cromático del Cliente</h3>

        <div>
          <label className="block text-sm font-medium mb-2">Tipo de servicio solicitado *</label>
          <p className="text-xs text-gray-500 mb-2">Selecciona una o varias opciones</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              "Cubrimiento de canas",
              "Cambio de tono",
              "Aclaración",
              "Iluminaciones",
              "Corrección de color",
              "Color fantasía",
              "Neutralización / Matización",
              "Otro",
            ].map((opt) => {
              const isSelected = formData.objetivo_cromatico.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggleArrayField("objetivo_cromatico", opt)}
                  className={`p-2 rounded-lg border text-sm text-left transition-colors ${
                    isSelected
                      ? "border-gray-900 bg-gray-100 text-gray-900"
                      : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          {formData.objetivo_cromatico.includes("Otro") && (
            <input
              type="text"
              className="mt-2 w-full p-2 border rounded-lg text-sm"
              value={formData.objetivo_cromatico_otro}
              onChange={(e) => handleInputChange("objetivo_cromatico_otro", e.target.value)}
              placeholder="Especifica el servicio..."
            />
          )}
          <p className="text-xs text-gray-500 mt-1">
            {formData.objetivo_cromatico.length > 0
              ? `Seleccionado: ${formData.objetivo_cromatico.join(", ")}`
              : "Selecciona al menos una opción"}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Resultado deseado</label>
          <textarea
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm leading-relaxed shadow-inner min-h-[100px] resize-none focus:ring-2 focus:ring-gray-900/40 focus:border-gray-900/40"
            value={formData.resultado_deseado}
            onChange={(e) => handleInputChange("resultado_deseado", e.target.value)}
            onInput={handleTextareaAutoResize}
            placeholder="Descripción del resultado deseado por el cliente..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Nivel de expectativa *</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: "realista", label: "Realista" },
              { value: "medianamente_realista", label: "Medianamente realista" },
              { value: "irreal", label: "Irreal (requiere asesoría técnica)" },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleInputChange("nivel_expectativa", opt.value)}
                className={`p-2 rounded-lg border text-sm text-left transition-colors ${
                  formData.nivel_expectativa === opt.value
                    ? "border-gray-900 bg-gray-100 text-gray-900"
                    : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {formData.nivel_expectativa
              ? `Seleccionado: ${formData.nivel_expectativa.replace(/_/g, " ")}`
              : "Selecciona una opción"}
          </p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECCIÓN 2 — HISTORIAL QUÍMICO
          ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Historial Químico</h3>

        <div>
          <label className="block text-sm font-medium mb-2">Último proceso químico realizado</label>
          <input
            type="text"
            className="w-full p-2 border rounded-lg text-sm"
            value={formData.ultimo_proceso_quimico}
            onChange={(e) => handleInputChange("ultimo_proceso_quimico", e.target.value)}
            placeholder="Describe el último proceso químico..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Tipo de proceso</label>
          <p className="text-xs text-gray-500 mb-2">Selecciona una o varias opciones</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              "Color vegetal",
              "Color semipermanente",
              "Color permanente",
              "Decoloración",
              "Alisado químico",
              "Keratina",
              "Botox capilar",
              "Otro",
            ].map((opt) => {
              const isSelected = formData.tipo_proceso.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggleArrayField("tipo_proceso", opt)}
                  className={`p-2 rounded-lg border text-sm text-left transition-colors ${
                    isSelected
                      ? "border-gray-900 bg-gray-100 text-gray-900"
                      : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          {formData.tipo_proceso.includes("Otro") && (
            <input
              type="text"
              className="mt-2 w-full p-2 border rounded-lg text-sm"
              value={formData.tipo_proceso_otro}
              onChange={(e) => handleInputChange("tipo_proceso_otro", e.target.value)}
              placeholder="Especifica el proceso..."
            />
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Frecuencia de procesos químicos</label>
          <div className="grid grid-cols-3 gap-2">
            {["Baja", "Media", "Alta"].map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => handleInputChange("frecuencia_procesos", opt)}
                className={`p-2 rounded-lg border text-sm text-center transition-colors ${
                  formData.frecuencia_procesos === opt
                    ? "border-gray-900 bg-gray-100 text-gray-900"
                    : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Daño visible en la fibra capilar</label>
          <div className="grid grid-cols-4 gap-2">
            {["No", "Leve", "Moderado", "Severo"].map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => handleInputChange("dano_visible", opt)}
                className={`p-2 rounded-lg border text-sm text-center transition-colors ${
                  formData.dano_visible === opt
                    ? "border-gray-900 bg-gray-100 text-gray-900"
                    : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECCIÓN 3 — DIAGNÓSTICO RIZOTIPO APLICADO AL COLOR
          ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-5">
        <h3 className="text-lg font-semibold">Diagnóstico Rizotipo Aplicado al Color</h3>

        {/* Permeabilidad */}
        <div className="space-y-2 border-b pb-4">
          <label className="block text-sm font-medium">Permeabilidad</label>
          <div className="grid grid-cols-3 gap-2">
            {["Baja", "Media", "Alta"].map((opt) => (
              <button key={opt} type="button" onClick={() => handleInputChange("permeabilidad_color", opt)}
                className={`p-2 rounded-lg border text-sm text-center transition-colors ${formData.permeabilidad_color === opt ? "border-gray-900 bg-gray-100 text-gray-900" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
              >{opt}</button>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Observaciones técnicas</label>
            <textarea className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm min-h-[60px] resize-none focus:ring-2 focus:ring-gray-900/40 focus:border-gray-900/40"
              value={formData.obs_tecnicas_permeabilidad} onChange={(e) => handleInputChange("obs_tecnicas_permeabilidad", e.target.value)} onInput={handleTextareaAutoResize} placeholder="Observaciones técnicas..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Impacto cromático previsto</label>
            <textarea className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm min-h-[60px] resize-none focus:ring-2 focus:ring-gray-900/40 focus:border-gray-900/40"
              value={formData.impacto_cromatico} onChange={(e) => handleInputChange("impacto_cromatico", e.target.value)} onInput={handleTextareaAutoResize} placeholder="Impacto cromático previsto..." />
          </div>
        </div>

        {/* Plasticidad */}
        <div className="space-y-2 border-b pb-4">
          <label className="block text-sm font-medium">Plasticidad</label>
          <div className="grid grid-cols-3 gap-2">
            {["Baja", "Media", "Alta"].map((opt) => (
              <button key={opt} type="button" onClick={() => handleInputChange("plasticidad_color", opt)}
                className={`p-2 rounded-lg border text-sm text-center transition-colors ${formData.plasticidad_color === opt ? "border-gray-900 bg-gray-100 text-gray-900" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
              >{opt}</button>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Riesgo de ruptura</label>
            <div className="grid grid-cols-3 gap-2">
              {["Bajo", "Medio", "Alto"].map((opt) => (
                <button key={opt} type="button" onClick={() => handleInputChange("riesgo_ruptura", opt)}
                  className={`p-2 rounded-lg border text-sm text-center transition-colors ${formData.riesgo_ruptura === opt ? "border-gray-900 bg-gray-100 text-gray-900" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
                >{opt}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Porosidad */}
        <div className="space-y-2 border-b pb-4">
          <label className="block text-sm font-medium">Porosidad (equilibrio de pH)</label>
          <div className="grid grid-cols-3 gap-2">
            {["Baja", "Media", "Alta"].map((opt) => (
              <button key={opt} type="button" onClick={() => handleInputChange("porosidad_color", opt)}
                className={`p-2 rounded-lg border text-sm text-center transition-colors ${formData.porosidad_color === opt ? "border-gray-900 bg-gray-100 text-gray-900" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
              >{opt}</button>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Requiere reconstrucción previa</label>
            <div className="grid grid-cols-2 gap-2">
              {["Sí", "No"].map((opt) => (
                <button key={opt} type="button" onClick={() => handleInputChange("requiere_reconstruccion", opt)}
                  className={`p-2 rounded-lg border text-sm text-center transition-colors ${formData.requiere_reconstruccion === opt ? "border-gray-900 bg-gray-100 text-gray-900" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
                >{opt}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Densidad */}
        <div className="space-y-2 border-b pb-4">
          <label className="block text-sm font-medium">Densidad</label>
          <div className="grid grid-cols-3 gap-2">
            {["Baja", "Media", "Alta"].map((opt) => (
              <button key={opt} type="button" onClick={() => handleInputChange("densidad_color", opt)}
                className={`p-2 rounded-lg border text-sm text-center transition-colors ${formData.densidad_color === opt ? "border-gray-900 bg-gray-100 text-gray-900" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
              >{opt}</button>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Estrategia de aplicación</label>
            <div className="grid grid-cols-2 gap-2">
              {["Montaje abierto", "Montaje cerrado", "Color dimensional", "Color global"].map((opt) => (
                <button key={opt} type="button" onClick={() => handleInputChange("estrategia_aplicacion", opt)}
                  className={`p-2 rounded-lg border text-sm text-left transition-colors ${formData.estrategia_aplicacion === opt ? "border-gray-900 bg-gray-100 text-gray-900" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
                >{opt}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Oleosidad del cuero cabelludo */}
        <div className="space-y-2 border-b pb-4">
          <label className="block text-sm font-medium">Oleosidad del cuero cabelludo</label>
          <div className="grid grid-cols-3 gap-2">
            {["Seca", "Normal", "Oleosa"].map((opt) => (
              <button key={opt} type="button" onClick={() => handleInputChange("oleosidad_color", opt)}
                className={`p-2 rounded-lg border text-sm text-center transition-colors ${formData.oleosidad_color === opt ? "border-gray-900 bg-gray-100 text-gray-900" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
              >{opt}</button>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Requiere detox previo</label>
            <div className="grid grid-cols-2 gap-2">
              {["Sí", "No"].map((opt) => (
                <button key={opt} type="button" onClick={() => handleInputChange("requiere_detox", opt)}
                  className={`p-2 rounded-lg border text-sm text-center transition-colors ${formData.requiere_detox === opt ? "border-gray-900 bg-gray-100 text-gray-900" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
                >{opt}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Grosor de fibra */}
        <div className="space-y-2 border-b pb-4">
          <label className="block text-sm font-medium">Grosor de fibra</label>
          <div className="grid grid-cols-3 gap-2">
            {["Fino", "Medio", "Grueso"].map((opt) => (
              <button key={opt} type="button" onClick={() => handleInputChange("grosor_fibra_color", opt)}
                className={`p-2 rounded-lg border text-sm text-center transition-colors ${formData.grosor_fibra_color === opt ? "border-gray-900 bg-gray-100 text-gray-900" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
              >{opt}</button>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tolerancia química estimada</label>
            <div className="grid grid-cols-3 gap-2">
              {["Baja", "Media", "Alta"].map((opt) => (
                <button key={opt} type="button" onClick={() => handleInputChange("tolerancia_quimica", opt)}
                  className={`p-2 rounded-lg border text-sm text-center transition-colors ${formData.tolerancia_quimica === opt ? "border-gray-900 bg-gray-100 text-gray-900" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
                >{opt}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Textura */}
        <div className="space-y-2">
          <label className="block text-sm font-medium">Textura</label>
          <div className="grid grid-cols-3 gap-2">
            {["Ondulada", "Rizada", "Afro"].map((opt) => (
              <button key={opt} type="button" onClick={() => handleInputChange("textura_color", opt)}
                className={`p-2 rounded-lg border text-sm text-center transition-colors ${formData.textura_color === opt ? "border-gray-900 bg-gray-100 text-gray-900" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
              >{opt}</button>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nivel de encogimiento</label>
            <div className="grid grid-cols-3 gap-2">
              {["Bajo", "Medio", "Alto"].map((opt) => (
                <button key={opt} type="button" onClick={() => handleInputChange("nivel_encogimiento", opt)}
                  className={`p-2 rounded-lg border text-sm text-center transition-colors ${formData.nivel_encogimiento === opt ? "border-gray-900 bg-gray-100 text-gray-900" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
                >{opt}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Impacto visual del color</label>
            <textarea className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm min-h-[60px] resize-none focus:ring-2 focus:ring-gray-900/40 focus:border-gray-900/40"
              value={formData.impacto_visual_color} onChange={(e) => handleInputChange("impacto_visual_color", e.target.value)} onInput={handleTextareaAutoResize} placeholder="Impacto visual del color en este tipo de textura..." />
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECCIÓN 4 — NIVEL DE RIESGO CROMÁTICO RF®
          ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Nivel de Riesgo Cromático RF®</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { value: "bajo", label: "Bajo", sublabel: "Procedimiento seguro", borderColor: "border-green-500", bgColor: "bg-green-50", textColor: "text-green-800", dotColor: "bg-green-500" },
            { value: "medio", label: "Medio", sublabel: "Procedimiento condicionado", borderColor: "border-amber-500", bgColor: "bg-amber-50", textColor: "text-amber-800", dotColor: "bg-amber-500" },
            { value: "alto", label: "Alto", sublabel: "Procedimiento no recomendado", borderColor: "border-red-500", bgColor: "bg-red-50", textColor: "text-red-800", dotColor: "bg-red-500" },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleInputChange("nivel_riesgo_cromatico", opt.value)}
              className={`p-4 rounded-lg border-2 text-left transition-colors ${
                formData.nivel_riesgo_cromatico === opt.value
                  ? `${opt.borderColor} ${opt.bgColor}`
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`inline-block w-3 h-3 rounded-full ${opt.dotColor}`} />
                <span className={`font-semibold text-sm ${formData.nivel_riesgo_cromatico === opt.value ? opt.textColor : "text-gray-800"}`}>
                  {opt.label}
                </span>
              </div>
              <p className={`text-xs ${formData.nivel_riesgo_cromatico === opt.value ? opt.textColor : "text-gray-500"}`}>
                {opt.sublabel}
              </p>
            </button>
          ))}
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Justificación técnica</label>
          <textarea
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm leading-relaxed shadow-inner min-h-[100px] resize-none focus:ring-2 focus:ring-gray-900/40 focus:border-gray-900/40"
            value={formData.justificacion_tecnica}
            onChange={(e) => handleInputChange("justificacion_tecnica", e.target.value)}
            onInput={handleTextareaAutoResize}
            placeholder="Justificación técnica del nivel de riesgo asignado..."
          />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECCIÓN 5 — PLAN CROMÁTICO PERSONALIZADO RF®
          ═══════════════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Plan Cromático Personalizado RF®</h3>

        {[
          { field: "tecnica_sugerida", label: "Técnica sugerida", placeholder: "Ej: Balayage, babylights, color global..." },
          { field: "nivel_max_aclaracion", label: "Nivel máximo de aclaración permitido", placeholder: "Ej: Nivel 7, 2 tonos máximo..." },
          { field: "tipo_oxidante", label: "Tipo de oxidante", placeholder: "Ej: 20 vol, 30 vol..." },
          { field: "proteccion_estructural", label: "Protección estructural requerida", placeholder: "Ej: Olaplex, bond protector..." },
          { field: "tonalizacion_prevista", label: "Tonalización prevista", placeholder: "Ej: Cenizo, dorado, cobrizo..." },
          { field: "num_sesiones", label: "Número de sesiones estimadas", placeholder: "Ej: 1, 2-3 sesiones..." },
          { field: "tiempo_recuperacion", label: "Tiempo de recuperación entre sesiones", placeholder: "Ej: 3-4 semanas, 1 mes..." },
        ].map(({ field, label, placeholder }) => (
          <div key={field}>
            <label className="block text-sm font-medium mb-2">{label}</label>
            <input
              type="text"
              className="w-full p-2 border rounded-lg text-sm"
              value={(formData as any)[field]}
              onChange={(e) => handleInputChange(field, e.target.value)}
              placeholder={placeholder}
            />
          </div>
        ))}
      </div>

      {/* Descripción del servicio de color */}
      <div>
        <label className="block text-sm font-medium mb-2">
          Descripción del servicio de color realizado *
        </label>
        <textarea
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm leading-relaxed shadow-inner min-h-[160px] resize-none focus:ring-2 focus:ring-gray-900/40 focus:border-gray-900/40"
          value={formData.descripcion}
          onChange={(e) => handleInputChange('descripcion', e.target.value)}
          onInput={handleTextareaAutoResize}
          placeholder="Describe en detalle el servicio de color realizado, tonalidades utilizadas, técnicas aplicadas, etc."
          required
        />
        <p className="text-xs text-gray-500 mt-1">
          Este campo es obligatorio
        </p>
      </div>

      {/* Observaciones */}
      <div>
        <label className="block text-sm font-medium mb-2">Observaciones</label>
        <textarea
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-sm leading-relaxed shadow-inner min-h-[140px] resize-none focus:ring-2 focus:ring-gray-900/40 focus:border-gray-900/40"
          value={formData.observaciones}
          onChange={(e) => handleInputChange('observaciones', e.target.value)}
          onInput={handleTextareaAutoResize}
          placeholder="Observaciones adicionales, recomendaciones de cuidado, productos utilizados..."
        />
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
            Confirma que como profesional a cargo, te responsabilizas por la calidad del servicio prestado.
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
          disabled={loading || !formData.firma_profesional || !todasRespondidas || !formData.descripcion.trim() /* || !tieneFotosAntesDespues */}
          className={`flex-1 py-3 rounded-lg font-semibold transition-colors flex items-center justify-center ${loading || !formData.firma_profesional || !todasRespondidas || !formData.descripcion.trim() /* || !tieneFotosAntesDespues */
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

      {!todasRespondidas && (
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <p className="text-gray-700 text-sm">
            ⚠️ Debe responder todas las preguntas del consentimiento informado.
          </p>
        </div>
      )}

      {!formData.descripcion.trim() && (
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <p className="text-gray-700 text-sm">
            ⚠️ Debe agregar una descripción del servicio de color realizado.
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
