// utils/pdfGenerator.ts
import { jsPDF } from 'jspdf';
import { formatDateDMY } from './dateFormat';

export interface FichaPDFData {
  cliente: {
    nombre: string;
    email: string;
    telefono: string;
  };
  ficha: {
    servicio: string;
    fecha: string;
    sede: string;
    estilista: string;
    notas_cliente: string;
    comentario_interno: string;
    antes_url?: string;
    despues_url?: string;
    fotos?: {
      antes?: string[];
      despues?: string[];
    };
    // 🔥 NUEVAS PROPIEDADES PARA DIAGNÓSTICO
    datos_especificos?: {
      plasticidad?: string;
      permeabilidad?: string;
      porosidad?: string;
      exterior_lipidico?: string;
      densidad?: string;
      oleosidad?: string;
      grosor?: string;
      textura?: string;
      recomendaciones_personalizadas?: string;
      frecuencia_corte?: string;
      tecnicas_estilizado?: string;
      productos_sugeridos?: string;
      observaciones_generales?: string;
    };
    respuestas?: Array<{
      pregunta_id: number;
      pregunta: string;
      respuesta: string;
      observaciones?: string;
    }>;
  };
}

// Función para cargar imagen
const cargarImagen = async (url: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    const timeout = setTimeout(() => {
      reject(new Error('Timeout'));
    }, 5000);

    img.onload = () => {
      clearTimeout(timeout);
      resolve(img);
    };

    img.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('No se pudo cargar la imagen'));
    };

    img.src = url;
  });
};

// 🔥 FUNCIÓN PARA FORMATO DE FECHA CORRECTO
const formatearFechaPDF = (fecha: string): string => {
  if (!fecha) return 'Fecha no disponible';
  
  console.log(`📅 Formateando fecha para PDF: "${fecha}"`);
  
  try {
    // Si ya viene formateada como "19 dic 2025", dejarla
    if (fecha.includes('dic') || fecha.includes('/')) {
      return fecha;
    }
    
    // Si viene como "2025-12-19" o "2025-12-19T..."
    let datePart = fecha;
    if (fecha.includes('T')) {
      datePart = fecha.split('T')[0];
    }
    
    const [year, month, day] = datePart.split('-');
    
    if (!year || !month || !day) {
      return fecha;
    }
    
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 
                   'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    
    const diaNum = parseInt(day, 10);
    const mesNum = parseInt(month, 10) - 1;
    
    if (isNaN(diaNum) || mesNum < 0 || mesNum > 11) {
      return `${day}/${month}/${year}`;
    }
    
    return `${diaNum} ${meses[mesNum]} ${year}`;
    
  } catch (error) {
    console.error('Error formateando fecha para PDF:', error);
    return fecha;
  }
};

// 🔥 FUNCIÓN PARA AGREGAR TEXTO CON ENCODING CORRECTO
const agregarTexto = (pdf: jsPDF, text: string, x: number, y: number, options?: any) => {
  // Reemplazar caracteres problemáticos
  const textoLimpio = text
    .replace(/[^\x00-\x7F]/g, '') // Remover caracteres no ASCII
    .replace(/[^\x20-\x7E]/g, ''); // Mantener solo caracteres imprimibles
  
  pdf.text(textoLimpio, x, y, options);
};

export async function generarPDFFicha(data: FichaPDFData): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      console.log('🎯 Iniciando generación de PDF mejorado');
      console.log('📊 Datos recibidos:', {
        cliente: data.cliente.nombre,
        servicio: data.ficha.servicio,
        fechaOriginal: data.ficha.fecha,
        fechaFormateada: formatearFechaPDF(data.ficha.fecha),
        tieneDiagnostico: !!(data.ficha.datos_especificos || data.ficha.respuestas?.length),
        numRespuestas: data.ficha.respuestas?.length || 0
      });

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 20;
      let yPos = margin;

      // 🔥 ENCABEZADO SIMPLE Y CORRECTO
      pdf.setFontSize(24);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(0, 0, 0); // Negro puro
      agregarTexto(pdf, 'RIZOS FELICES', pageWidth / 2, yPos, { align: 'center' });
      yPos += 8;

      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'italic');
      pdf.setTextColor(100, 100, 100);
      agregarTexto(pdf, 'Sistema de Gestion Profesional', pageWidth / 2, yPos, { align: 'center' });
      yPos += 20;

      // Línea divisoria
      pdf.setLineWidth(0.5);
      pdf.setDrawColor(200, 200, 200);
      pdf.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 15;

      // 🔥 SECCIÓN 1: INFORMACIÓN DEL CLIENTE
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(0, 0, 0);
      agregarTexto(pdf, 'INFORMACION DEL CLIENTE', margin, yPos);
      yPos += 10;

      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'normal');
      
      agregarTexto(pdf, 'Nombre:', margin, yPos);
      agregarTexto(pdf, data.cliente.nombre, margin + 25, yPos);
      yPos += 7;

      agregarTexto(pdf, 'Email:', margin, yPos);
      agregarTexto(pdf, data.cliente.email || 'No especificado', margin + 25, yPos);
      yPos += 7;

      agregarTexto(pdf, 'Telefono:', margin, yPos);
      agregarTexto(pdf, data.cliente.telefono || 'No especificado', margin + 25, yPos);
      yPos += 20;

      // 🔥 SECCIÓN 2: INFORMACIÓN DEL SERVICIO
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'bold');
      agregarTexto(pdf, 'INFORMACION DEL SERVICIO', margin, yPos);
      yPos += 10;

      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'normal');
      
      // 🔥 FECHA CORRECTA
      const fechaCorregida = formatearFechaPDF(data.ficha.fecha);
      console.log(`✅ Fecha para PDF: "${fechaCorregida}" (original: "${data.ficha.fecha}")`);
      
      agregarTexto(pdf, 'Servicio:', margin, yPos);
      agregarTexto(pdf, data.ficha.servicio, margin + 25, yPos);
      yPos += 7;

      agregarTexto(pdf, 'Fecha:', margin, yPos);
      agregarTexto(pdf, fechaCorregida, margin + 25, yPos);
      yPos += 7;

      agregarTexto(pdf, 'Sede:', margin, yPos);
      agregarTexto(pdf, data.ficha.sede, margin + 25, yPos);
      yPos += 7;

      agregarTexto(pdf, 'profesional:', margin, yPos);
      agregarTexto(pdf, data.ficha.estilista, margin + 25, yPos);
      yPos += 15;

      // 🔥 SECCIÓN 3: DIAGNÓSTICO RIZOTIPO (si existe)
      const tieneDiagnostico = data.ficha.datos_especificos || (data.ficha.respuestas && data.ficha.respuestas.length > 0);
      
      if (tieneDiagnostico) {
        if (yPos > pageHeight - 100) {
          pdf.addPage();
          yPos = margin;
        }
        
        pdf.setFontSize(16);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(100, 0, 200); // Púrpura
        agregarTexto(pdf, 'DIAGNOSTICO RIZOTIPO', margin, yPos);
        yPos += 12;
        
        // 🔥 ANÁLISIS CAPILAR COMPLETO (8 respuestas)
        if (data.ficha.respuestas && data.ficha.respuestas.length > 0) {
          pdf.setFontSize(12);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(0, 0, 0);
          agregarTexto(pdf, 'Analisis Capilar:', margin, yPos);
          yPos += 8;
          
          // Mostrar TODAS las respuestas
          data.ficha.respuestas.forEach((respuesta,) => {
            if (yPos > pageHeight - 20) {
              pdf.addPage();
              yPos = margin;
            }
            
            // Determinar color según valor
            let color = [0, 0, 0]; // Negro por defecto
            const lowerRespuesta = respuesta.respuesta.toLowerCase();
            if (lowerRespuesta.includes('alta')) color = [220, 50, 50];
            else if (lowerRespuesta.includes('media')) color = [255, 150, 0];
            else if (lowerRespuesta.includes('baja')) color = [50, 150, 255];
            
            pdf.setFontSize(10);
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(0, 0, 0);
            agregarTexto(pdf, `${respuesta.pregunta}:`, margin, yPos);
            
            pdf.setFont('helvetica', 'normal');
            pdf.setTextColor(color[0], color[1], color[2]);
            agregarTexto(pdf, respuesta.respuesta, margin + 50, yPos);
            
            yPos += 6;
          });
          
          yPos += 10;
        }
        
        // 🔥 RECOMENDACIONES PERSONALIZADAS
        if (data.ficha.datos_especificos?.recomendaciones_personalizadas) {
          if (yPos > pageHeight - 50) {
            pdf.addPage();
            yPos = margin;
          }
          
          pdf.setFontSize(12);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(0, 100, 0); // Verde
          agregarTexto(pdf, 'Recomendaciones Personalizadas:', margin, yPos);
          yPos += 8;
          
          pdf.setFontSize(10);
          pdf.setFont('helvetica', 'normal');
          pdf.setTextColor(0, 0, 0);
          
          const recLines = pdf.splitTextToSize(
            data.ficha.datos_especificos.recomendaciones_personalizadas,
            pageWidth - 2 * margin
          );
          
          recLines.forEach((line: string) => {
            agregarTexto(pdf, line, margin, yPos);
            yPos += 5;
          });
          
          yPos += 10;
        }
        
        // 🔥 INFORMACIÓN ADICIONAL
        const infoExtra = [];
        if (data.ficha.datos_especificos?.frecuencia_corte) {
          infoExtra.push({ titulo: 'Frecuencia de corte', texto: data.ficha.datos_especificos.frecuencia_corte });
        }
        if (data.ficha.datos_especificos?.tecnicas_estilizado) {
          infoExtra.push({ titulo: 'Tecnicas de estilizado', texto: data.ficha.datos_especificos.tecnicas_estilizado });
        }
        if (data.ficha.datos_especificos?.productos_sugeridos) {
          infoExtra.push({ titulo: 'Productos sugeridos', texto: data.ficha.datos_especificos.productos_sugeridos });
        }
        
        if (infoExtra.length > 0) {
          if (yPos > pageHeight - (infoExtra.length * 25)) {
            pdf.addPage();
            yPos = margin;
          }
          
          pdf.setFontSize(12);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(0, 0, 0);
          agregarTexto(pdf, 'Informacion Adicional:', margin, yPos);
          yPos += 8;
          
          infoExtra.forEach(info => {
            pdf.setFontSize(10);
            pdf.setFont('helvetica', 'bold');
            agregarTexto(pdf, `${info.titulo}:`, margin, yPos);
            
            pdf.setFont('helvetica', 'normal');
            const textLines = pdf.splitTextToSize(info.texto, pageWidth - margin - 50);
            textLines.forEach((line: string) => {
              agregarTexto(pdf, line, margin + 5, yPos);
              yPos += 5;
            });
            
            yPos += 3;
          });
        }
      }

      // 🔥 SECCIÓN 4: NOTAS DEL CLIENTE (si existen)
      if (data.ficha.notas_cliente && data.ficha.notas_cliente.trim() !== '') {
        if (yPos > pageHeight - 50) {
          pdf.addPage();
          yPos = margin;
        }
        
        pdf.setFontSize(16);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(0, 0, 0);
        agregarTexto(pdf, 'NOTAS DEL CLIENTE', margin, yPos);
        yPos += 10;
        
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        
        const notasLines = pdf.splitTextToSize(
          data.ficha.notas_cliente,
          pageWidth - 2 * margin
        );
        
        notasLines.forEach((line: string) => {
          agregarTexto(pdf, line, margin, yPos);
          yPos += 5;
        });
        
        yPos += 10;
      }

      // 🔥 SECCIÓN 5: COMENTARIO INTERNO (si existe)
      if (data.ficha.comentario_interno && data.ficha.comentario_interno.trim() !== '') {
        if (yPos > pageHeight - 50) {
          pdf.addPage();
          yPos = margin;
        }
        
        pdf.setFontSize(16);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(0, 0, 0);
        agregarTexto(pdf, 'COMENTARIO INTERNO', margin, yPos);
        yPos += 10;
        
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        
        const comentarioLines = pdf.splitTextToSize(
          data.ficha.comentario_interno,
          pageWidth - 2 * margin
        );
        
        comentarioLines.forEach((line: string) => {
          agregarTexto(pdf, line, margin, yPos);
          yPos += 5;
        });
        
        yPos += 10;
      }

      // 🔥 SECCIÓN 6: IMÁGENES (si existen)
      const imagenesAntes: string[] = [...(data.ficha.fotos?.antes || [])];
      const imagenesDespues: string[] = [...(data.ficha.fotos?.despues || [])];
      
      if (data.ficha.antes_url) imagenesAntes.unshift(data.ficha.antes_url);
      if (data.ficha.despues_url) imagenesDespues.unshift(data.ficha.despues_url);

      const tieneImagenes = imagenesAntes.length > 0 || imagenesDespues.length > 0;

      if (tieneImagenes) {
        if (yPos > pageHeight - 120) {
          pdf.addPage();
          yPos = margin;
        }
        
        pdf.setFontSize(16);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(0, 0, 0);
        agregarTexto(pdf, 'IMAGENES DEL SERVICIO', pageWidth / 2, yPos, { align: 'center' });
        yPos += 12;
        
        // Intentar cargar y mostrar imágenes
        try {
          const maxImageWidth = 80;
          const maxImageHeight = 100;
          const spacing = 15;
          
          const imagenesParaMostrar = [];
          
          // ANTES
          if (imagenesAntes.length > 0) {
            try {
              const img = await cargarImagen(imagenesAntes[0]);
              imagenesParaMostrar.push({
                img: img,
                titulo: 'ANTES',
                color: [220, 50, 50] // Rojo
              });
            } catch (error) {
              console.error('Error cargando imagen ANTES:', error);
            }
          }
          
          // DESPUÉS
          if (imagenesDespues.length > 0) {
            try {
              const img = await cargarImagen(imagenesDespues[0]);
              imagenesParaMostrar.push({
                img: img,
                titulo: 'DESPUES',
                color: [50, 150, 50] // Verde
              });
            } catch (error) {
              console.error('Error cargando imagen DESPUES:', error);
            }
          }
          
          if (imagenesParaMostrar.length > 0) {
            // Calcular posición centrada
            const totalWidth = imagenesParaMostrar.length * maxImageWidth + 
                             (imagenesParaMostrar.length - 1) * spacing;
            const startX = (pageWidth - totalWidth) / 2;
            
            // Títulos
            imagenesParaMostrar.forEach((info, index) => {
              const xPos = startX + index * (maxImageWidth + spacing);
              
              pdf.setFontSize(11);
              pdf.setFont('helvetica', 'bold');
              pdf.setTextColor(info.color[0], info.color[1], info.color[2]);
              agregarTexto(pdf, info.titulo, xPos + maxImageWidth / 2, yPos, { align: 'center' });
            });
            
            yPos += 10;
            
            // Imágenes
            imagenesParaMostrar.forEach((info, index) => {
              const xPos = startX + index * (maxImageWidth + spacing);
              
              // Calcular dimensiones manteniendo relación de aspecto
              const ratio = info.img.width / info.img.height;
              let width = maxImageWidth;
              let height = maxImageWidth / ratio;
              
              if (height > maxImageHeight) {
                height = maxImageHeight;
                width = maxImageHeight * ratio;
              }
              
              const yImg = yPos;
              
              try {
                pdf.addImage(info.img, 'JPEG', xPos, yImg, width, height);
                
                // Borde
                pdf.setLineWidth(0.5);
                pdf.setDrawColor(200, 200, 200);
                pdf.rect(xPos, yImg, width, height);
              } catch (error) {
                console.error(`Error agregando imagen ${info.titulo}:`, error);
              }
            });
            
            yPos += maxImageHeight + 20;
          }
        } catch (error) {
          console.error('Error procesando imágenes:', error);
          pdf.setFontSize(9);
          pdf.setFont('helvetica', 'italic');
          pdf.setTextColor(100, 100, 100);
          agregarTexto(pdf, '(Imagenes no disponibles)', margin, yPos);
          yPos += 10;
        }
      }

      // 🔥 PIE DE PÁGINA CORRECTO
      const fechaGeneracion = formatDateDMY(new Date());

      // Línea
      pdf.setLineWidth(0.3);
      pdf.setDrawColor(200, 200, 200);
      pdf.line(margin, pageHeight - 25, pageWidth - margin, pageHeight - 25);

      // Texto del pie
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'italic');
      pdf.setTextColor(100, 100, 100);
      
      agregarTexto(pdf, `Documento generado el ${fechaGeneracion}`, 
        pageWidth / 2, pageHeight - 18, { align: 'center' });

      pdf.setFont('helvetica', 'bold');
      agregarTexto(pdf, '© Rizos Felices - Sistema de Gestion Profesional', 
        pageWidth / 2, pageHeight - 12, { align: 'center' });

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      agregarTexto(pdf, 'Este documento es confidencial y para uso exclusivo del cliente', 
        pageWidth / 2, pageHeight - 7, { align: 'center' });

      // 🔥 NOMBRE DEL ARCHIVO
      const safeNombre = data.cliente.nombre
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remover acentos
        .replace(/[^a-zA-Z0-9\s]/g, '') // Remover caracteres especiales
        .replace(/\s+/g, '_') // Espacios a guiones bajos
        .substring(0, 20);
      
      const fileName = `Ficha_${safeNombre}_${fechaCorregida.replace(/\s+/g, '_')}.pdf`;
      
      // Guardar
      pdf.save(fileName);
      console.log('✅ PDF generado exitosamente:', fileName);
      resolve();
      
    } catch (error) {
      console.error('❌ Error crítico generando PDF:', error);
      reject(error);
    }
  });
}
