import asyncio
import httpx
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email import encoders
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer,
                                 Table, TableStyle, Image,
                                 HRFlowable, KeepTogether)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from PIL import Image as PILImage
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib import colors
from reportlab.lib.units import cm
from email.utils import formataddr
import smtplib
import ssl
from io import BytesIO
import os
import base64

EMAIL_SENDER     = os.getenv("EMAIL_REMITENTE")
EMAIL_PASSWORD   = os.getenv("EMAIL_CONTRASENA")
SMTP_SERVER      = "smtp.gmail.com"
SMTP_PORT        = 465
LOGO_URL         = "https://s3.us-east-1.amazonaws.com/rf.images/companies/default/clients/RF+PNG.png"
LOGO_ALTERNATIVO = "https://rizosfelicesdata.s3.us-east-2.amazonaws.com/logo+rosado+letra+blanca.png"

# ─── PALETA (solo escala de grises) ──────────────────────────────────────────
NEGRO       = "#000000"
GRIS_OSCURO = "#333333"
GRIS_MEDIO  = "#666666"
GRIS_BORDE  = "#DDDDDD"
GRIS_FONDO  = "#F5F5F5"


# ─────────────────────────────────────────────────────────────────────────────
# DESCARGA ASÍNCRONA + PARALELO
# ─────────────────────────────────────────────────────────────────────────────

# ✅ Registrar soporte HEIC al inicio del archivo
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
    print("✅ Soporte HEIC activado")
except ImportError:
    print("⚠️ pillow-heif no instalado, fotos HEIC no serán soportadas")


async def descargar_imagen(url: str) -> BytesIO | None:
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            r = await client.get(url)
            r.raise_for_status()
            return BytesIO(r.content)
    except Exception as e:
        print(f"⚠️  No se pudo descargar {url}: {e}")
        return None


async def descargar_imagenes_paralelo(urls: list[str]) -> list[BytesIO | None]:
    return await asyncio.gather(*[descargar_imagen(url) for url in urls])


def imagen_a_base64(img_buffer: BytesIO) -> str:
    try:
        img_buffer.seek(0)
        return base64.b64encode(img_buffer.read()).decode("utf-8")
    except:
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# ESTILOS (escala de grises, espaciado compacto)
# ─────────────────────────────────────────────────────────────────────────────
def _estilos():
    base = getSampleStyleSheet()
    return {
        "title":      ParagraphStyle("T",  parent=base["Heading1"],
                          fontSize=22, alignment=TA_CENTER,
                          spaceAfter=2, spaceBefore=0,
                          textColor=colors.black, fontName="Helvetica-Bold"),
        "subtitle":   ParagraphStyle("Su", parent=base["Normal"],
                          fontSize=10, alignment=TA_CENTER,
                          spaceAfter=0, spaceBefore=0,
                          textColor=colors.HexColor(GRIS_MEDIO), fontName="Helvetica"),
        "section":    ParagraphStyle("Se", parent=base["Heading2"],
                          fontSize=13, spaceAfter=4, spaceBefore=10,
                          textColor=colors.black, fontName="Helvetica-Bold"),
        "subsection": ParagraphStyle("Ss", parent=base["Heading3"],
                          fontSize=11, spaceAfter=2, spaceBefore=6,
                          textColor=colors.HexColor(GRIS_OSCURO), fontName="Helvetica-Bold"),
        "label":      ParagraphStyle("L",  parent=base["Normal"],
                          fontSize=10, textColor=colors.HexColor(GRIS_OSCURO),
                          fontName="Helvetica-Bold", leading=13),
        "value":      ParagraphStyle("V",  parent=base["Normal"],
                          fontSize=10, textColor=colors.black,
                          leading=13, wordWrap="LTR"),
        "body":       ParagraphStyle("B",  parent=base["Normal"],
                          fontSize=10, textColor=colors.HexColor(GRIS_OSCURO),
                          leading=13, wordWrap="LTR"),
        "footer":     ParagraphStyle("F",  parent=base["Normal"],
                          fontSize=8, alignment=TA_CENTER,
                          textColor=colors.HexColor(GRIS_MEDIO), leading=11),
        "img_cap":    ParagraphStyle("IC", parent=base["Normal"],
                          fontSize=9, alignment=TA_CENTER,
                          textColor=colors.HexColor(GRIS_MEDIO),
                          fontName="Helvetica-Bold"),
    }


def _hr():
    return HRFlowable(width="100%", thickness=0.4,
                      color=colors.HexColor(GRIS_BORDE),
                      spaceAfter=4, spaceBefore=2)


def _tabla_kv(filas, col1=4*cm, col2=11*cm):
    """Tabla clave-valor con línea inferior por fila."""
    t = Table(filas, colWidths=[col1, col2])
    t.setStyle(TableStyle([
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
        ("LINEBELOW",     (0, 0), (-1, -2), 0.3, colors.HexColor(GRIS_BORDE)),
    ]))
    return t

from PIL import Image as PILImage

def comprimir_imagen_para_pdf(buf: BytesIO, max_px: int = 1200, quality: int = 75) -> BytesIO | None:
    try:
        buf.seek(0)
        
        # ✅ Detectar formato real ANTES de abrir
        header = buf.read(24)
        buf.seek(0)
        
        formato_detectado = "desconocido"
        if header[4:8] == b"ftyp":
            subtipo = header[8:12]
            if subtipo in (b"heic", b"heis"):
                formato_detectado = "HEIC (iPhone)"
            elif subtipo in (b"mif1", b"msf1"):
                formato_detectado = "HEIF (Samsung)"
            elif subtipo in (b"hevc", b"hevx"):
                formato_detectado = "HEIF (Samsung video-still)"
            else:
                formato_detectado = f"HEIF/HEIC variante: {subtipo}"
        elif header[:2] == b"\xff\xd8":
            formato_detectado = "JPEG"
        elif header[:8] == b"\x89PNG\r\n\x1a\n":
            formato_detectado = "PNG"
        
        print(f"    📷 Formato detectado: {formato_detectado}")

        img = PILImage.open(buf)
        print(f"    📐 Modo PIL: {img.mode}, Tamaño: {img.size}, Formato PIL: {img.format}")
        img.load()

        # Corregir rotación EXIF (iPhone Y Samsung la necesitan)
        try:
            from PIL import ImageOps
            img = ImageOps.exif_transpose(img)
        except Exception as e:
            print(f"    ⚠️ exif_transpose falló (no crítico): {e}")

        # Componer sobre fondo blanco si tiene transparencia
        if img.mode in ("RGBA", "LA", "P"):
            fondo = PILImage.new("RGB", img.size, (255, 255, 255))
            if img.mode == "P":
                img = img.convert("RGBA")
            fondo.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
            img = fondo
        else:
            img = img.convert("RGB")

        w, h = img.size
        if max(w, h) > max_px:
            ratio = max_px / max(w, h)
            img = img.resize((int(w * ratio), int(h * ratio)), PILImage.LANCZOS)

        out = BytesIO()
        img.save(out, format="JPEG", quality=quality, optimize=True)
        out.seek(0)
        print(f"    ✅ Convertida OK → JPEG {img.size}")
        return out

    except Exception as e:
        print(f"    ❌ Error comprimiendo imagen: {type(e).__name__}: {e}")
        import traceback; traceback.print_exc()
        return None

# ─────────────────────────────────────────────────────────────────────────────
# GENERADOR PRINCIPAL
# ─────────────────────────────────────────────────────────────────────────────
async def generar_pdf_ficha(ficha_data: dict, cita_data: dict) -> bytes:

    # ── PRE-CARGA PARALELA ───────────────────────────────────────────────────
    fotos_antes   = ficha_data.get("fotos", {}).get("antes",   []) or []
    fotos_despues = ficha_data.get("fotos", {}).get("despues", []) or []

    urls_map: dict[str, str] = {"logo": LOGO_URL}
    for i, u in enumerate(fotos_antes[:4]):   urls_map[f"antes_{i}"]   = u
    for i, u in enumerate(fotos_despues[:4]): urls_map[f"despues_{i}"] = u

    print(f"🌐 Descargando {len(urls_map)} imágenes en paralelo…")
    keys = list(urls_map.keys())
    bufs = await descargar_imagenes_paralelo(list(urls_map.values()))
    imgs: dict[str, BytesIO | None] = dict(zip(keys, bufs))
    print(f"✅ {sum(1 for v in imgs.values() if v)}/{len(imgs)} descargadas")

    # ── DOCUMENTO ────────────────────────────────────────────────────────────
    buf  = BytesIO()
    doc  = SimpleDocTemplate(buf, pagesize=A4,
                             topMargin=1.5*cm, bottomMargin=1.5*cm,
                             leftMargin=2*cm,  rightMargin=2*cm)
    story = []
    st    = _estilos()

    # ── ENCABEZADO ───────────────────────────────────────────────────────────
    logo_buf = imgs.get("logo")
    if logo_buf:
        logo_buf = comprimir_imagen_para_pdf(logo_buf, max_px=800, quality=85)
        logo_img = Image(logo_buf, width=9*cm, height=3.5*cm, kind="proportional")
        story.append(logo_img)
        story.append(Spacer(1, 2))
    else:
        story.append(Paragraph("RIZOS FELICES", st["title"]))

    story.append(Paragraph("Sistema de Gestión Profesional", st["subtitle"]))
    story.append(Spacer(1, 6))
    story.append(_hr())

    # ── 1. CLIENTE ───────────────────────────────────────────────────────────
    story.append(Paragraph("INFORMACIÓN DEL CLIENTE", st["section"]))
    nombre = f"{ficha_data.get('nombre','') or ''} {ficha_data.get('apellido','') or ''}".strip()
    if nombre.lower().endswith("none"): nombre = nombre[:-4].strip()

    story.append(_tabla_kv([
        [Paragraph("<b>Nombre:</b>",   st["label"]), Paragraph(nombre or "No especificado", st["value"])],
        [Paragraph("<b>Email:</b>",    st["label"]), Paragraph(ficha_data.get("email") or ficha_data.get("correo") or "No especificado", st["value"])],
        [Paragraph("<b>Teléfono:</b>", st["label"]), Paragraph(str(ficha_data.get("telefono") or "No especificado"), st["value"])],
    ]))

    # ── 2. SERVICIO ──────────────────────────────────────────────────────────
    story.append(Paragraph("INFORMACIÓN DEL SERVICIO", st["section"]))
    fecha_r = ficha_data.get("fecha_reserva") or "No especificado"
    try:
        fecha_r = datetime.strptime(fecha_r.split("T")[0], "%Y-%m-%d").strftime("%d %b %Y").lower()
    except:
        pass

    story.append(_tabla_kv([
        [Paragraph("<b>Servicio:</b>",    st["label"]), Paragraph(ficha_data.get("servicio_nombre") or "No especificado", st["value"])],
        [Paragraph("<b>Fecha:</b>",       st["label"]), Paragraph(fecha_r, st["value"])],
        [Paragraph("<b>Sede:</b>",        st["label"]), Paragraph(ficha_data.get("sede_nombre") or "No especificado", st["value"])],
        [Paragraph("<b>Profesional:</b>", st["label"]), Paragraph(ficha_data.get("profesional_nombre") or "No especificado", st["value"])],
    ]))
    story.append(Spacer(1, 4))
    story.append(_hr())

    # ── 3. CONTENIDO POR TIPO ────────────────────────────────────────────────
    tipo = ficha_data.get("tipo_ficha", "")
    de   = ficha_data.get("datos_especificos", {}) or {}
    resp = ficha_data.get("respuestas", []) or []

    def bloque(titulo: str, valor):
        """Título en negrita + párrafo. Solo si hay contenido."""
        v = str(valor or "").strip()
        if not v or v.lower() == "no especificado":
            return
        story.append(Paragraph(f"<b>{titulo}</b>", st["subsection"]))
        story.append(Paragraph(v, st["body"]))
        story.append(Spacer(1, 3))

    # ══════════════════════════════════════════════════════════════════════
    # DIAGNÓSTICO RIZOTIPO
    # ══════════════════════════════════════════════════════════════════════
    if tipo == "DIAGNOSTICO_RIZOTIPO":
        story.append(Paragraph("DIAGNÓSTICO RIZOTIPO", st["section"]))

        CAMPOS = [
            ("plasticidad",       "Plasticidad"),
            ("permeabilidad",     "Permeabilidad"),
            ("porosidad",         "Porosidad"),
            ("exterior_lipidico", "Exterior Lipídico"),
            ("densidad",          "Densidad"),
            ("oleosidad",         "Oleosidad"),
            ("grosor",            "Grosor"),
            ("textura",           "Textura"),
        ]

        filas = []
        for key, lbl in CAMPOS:
            val = str(de.get(key, "") or "").strip()
            if not val or val.lower() == "no especificado":
                continue

            # Obtener acciones desde _detalle o _acciones
            # 🔥 FIX: el detalle puede tener texto muy largo → solo mostrar acciones
            acciones = str(de.get(f"{key}_acciones", "") or "").strip()
            if not acciones:
                # Intentar extraer de _detalle
                detalle_full = str(de.get(f"{key}_detalle", "") or "").strip()
                if "Acciones recomendadas:" in detalle_full:
                    acciones = detalle_full.split("Acciones recomendadas:")[-1].strip()

            # Construir texto de la celda derecha
            # val puede ser "MEDIA, BAJA" o "OTRA" — mostrar tal cual
            if acciones:
                display = f"<b>{val}</b><br/><font size='9' color='#{GRIS_MEDIO[1:]}'>{acciones}</font>"
            else:
                display = f"<b>{val}</b>"

            filas.append([
                Paragraph(f"<b>{lbl}</b>", st["label"]),
                Paragraph(display, st["value"]),
            ])

        if filas:
            t = Table(filas, colWidths=[4.5*cm, 10.5*cm])
            t.setStyle(TableStyle([
                ("VALIGN",        (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING",    (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING",   (0, 0), (-1, -1), 0),
                ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
                ("BACKGROUND",    (0, 0), (0, -1),  colors.HexColor(GRIS_FONDO)),
                ("LINEBELOW",     (0, 0), (-1, -2), 0.3, colors.HexColor(GRIS_BORDE)),
            ]))
            story.append(t)
            story.append(Spacer(1, 6))

        # ── CAMPOS NUEVOS ─────────────────────────────────────────────
        # Tipo de textura (patrón de rizo: 2A, 3B, 4C, etc.)
        tipo_textura = str(de.get("tipo_textura") or "").strip()
        if tipo_textura:
            story.append(Paragraph("<b>Tipo de textura (patrón de rizo):</b>", st["subsection"]))
            story.append(Paragraph(tipo_textura, st["body"]))
            story.append(Spacer(1, 3))

        # Transición
        transicion = str(de.get("transicion") or "").strip()
        if transicion:
            story.append(Paragraph("<b>Estado de transición:</b>", st["subsection"]))
            story.append(Paragraph(transicion, st["body"]))
            story.append(Spacer(1, 3))

        # Largo del cabello
        largo = str(de.get("largo_cabello") or "").strip()
        if largo:
            story.append(Paragraph("<b>Largo del cabello:</b>", st["subsection"]))
            story.append(Paragraph(largo, st["body"]))
            story.append(Spacer(1, 3))

        # Estado del cabello (lista múltiple)
        estado_cabello = de.get("estado_cabello") or []
        if isinstance(estado_cabello, str):
            estado_cabello = [s.strip() for s in estado_cabello.split(",") if s.strip()]
        if estado_cabello:
            story.append(Paragraph("<b>Estado del cabello:</b>", st["subsection"]))
            filas_ec = [
                [Paragraph("✓", st["label"]), Paragraph(str(item), st["body"])]
                for item in estado_cabello
            ]
            tec = Table(filas_ec, colWidths=[0.6*cm, 14.4*cm])
            tec.setStyle(TableStyle([
                ("VALIGN",        (0,0), (-1,-1), "TOP"),
                ("TOPPADDING",    (0,0), (-1,-1), 3),
                ("BOTTOMPADDING", (0,0), (-1,-1), 3),
                ("LEFTPADDING",   (0,0), (-1,-1), 0),
            ]))
            story.append(tec)
            story.append(Spacer(1, 4))

        bloque("Recomendaciones personalizadas:", de.get("recomendaciones_personalizadas"))
        bloque("Frecuencia de corte:",            de.get("frecuencia_corte"))
        bloque("Técnicas de estilizado:",         de.get("tecnicas_estilizado"))
        bloque("Productos sugeridos:",            de.get("productos_sugeridos"))
        bloque("Observaciones generales:",        de.get("observaciones_generales"))

    # ══════════════════════════════════════════════════════════════════════
    # COLOR  ← 🔥 SIN tabla de consentimiento, solo descripción y observaciones
    # ══════════════════════════════════════════════════════════════════════
    elif tipo == "COLOR":
        story.append(Paragraph("FICHA DE COLOR", st["section"]))
        bloque("Descripción del servicio de color:", de.get("descripcion"))
        bloque("Observaciones:",                     de.get("observaciones"))
        # ✅ Consentimiento informado ELIMINADO

    # ══════════════════════════════════════════════════════════════════════
    # ASESORÍA DE CORTE
    # ══════════════════════════════════════════════════════════════════════
    elif tipo == "ASESORIA_CORTE":
        story.append(Paragraph("ASESORÍA DE CORTE", st["section"]))
        bloque("Descripción del corte realizado:", de.get("descripcion"))
        bloque("Observaciones:",                   de.get("observaciones"))

    # ══════════════════════════════════════════════════════════════════════
    # CUIDADO POST COLOR
    # ══════════════════════════════════════════════════════════════════════
    elif tipo == "CUIDADO_POST_COLOR":
        story.append(Paragraph("CUIDADO POST COLOR", st["section"]))
        bloque("Observaciones personalizadas:", de.get("observaciones_personalizadas"))
        bloque("Tenga en cuenta:",              de.get("tenga_en_cuenta"))

        rec_aplicadas = de.get("recomendaciones_aplicadas", []) or []
        if not rec_aplicadas and resp:
            rec_aplicadas = [r.get("pregunta","") for r in resp
                             if str(r.get("respuesta","")).lower() == "aplica"]

        if rec_aplicadas:
            story.append(Paragraph("<b>Recomendaciones de cuidado:</b>", st["subsection"]))
            filas_r = [[Paragraph("✓", st["label"]),
                        Paragraph(str(r), st["body"])] for r in rec_aplicadas]
            tr = Table(filas_r, colWidths=[0.6*cm, 14.4*cm])
            tr.setStyle(TableStyle([
                ("VALIGN",        (0,0), (-1,-1), "TOP"),
                ("TOPPADDING",    (0,0), (-1,-1), 3),
                ("BOTTOMPADDING", (0,0), (-1,-1), 3),
                ("LEFTPADDING",   (0,0), (-1,-1), 0),
            ]))
            story.append(tr)
            story.append(Spacer(1, 4))

    # ══════════════════════════════════════════════════════════════════════
    # VALORACIÓN Y PRUEBA DE COLOR
    # ══════════════════════════════════════════════════════════════════════
    elif tipo == "VALORACION_PRUEBA_COLOR":
        story.append(Paragraph("VALORACIÓN Y PRUEBA DE COLOR", st["section"]))
        bloque("Servicio valorado:",                de.get("servicio_valorado"))
        bloque("Acuerdos con el cliente:",          de.get("acuerdos"))
        bloque("Recomendaciones de la valoración:", de.get("recomendaciones"))
        if str(de.get("observaciones_adicionales") or "").strip():
            bloque("Observaciones adicionales:", de.get("observaciones_adicionales"))

        aut = ("Sí" if de.get("autorizacion_publicacion") else "No") + \
              " autoriza publicar fotos en redes sociales"
        story.append(Paragraph(f"<b>Autorización de publicación:</b> {aut}", st["body"]))
        story.append(Spacer(1, 3))

    # ══════════════════════════════════════════════════════════════════════
    # OZONOTERAPIA CAPILAR RF®
    # ══════════════════════════════════════════════════════════════════════
    elif tipo == "OZONOTERAPIA_CAPILAR":
        story.append(Paragraph("OZONOTERAPIA CAPILAR RF®", st["section"]))

        # Número de sesión
        numero_sesion = str(de.get("numero_sesion") or "").strip()
        if numero_sesion:
            story.append(_tabla_kv([
                [Paragraph("<b>Número de sesión:</b>", st["label"]),
                Paragraph(numero_sesion, st["value"])],
            ]))
            story.append(Spacer(1, 4))

        # ── Estado actual del cabello ─────────────────────────────────
        story.append(Paragraph("Estado Actual del Cabello y Cuero Cabelludo", st["subsection"]))
        estado_oz = de.get("estado_cabello_ozono") or []
        if isinstance(estado_oz, str):
            estado_oz = [s.strip() for s in estado_oz.split(",") if s.strip()]
        otro_oz = str(de.get("estado_cabello_ozono_otro") or "").strip()
        if otro_oz and "Otro" in estado_oz:
            estado_oz = [otro_oz if v == "Otro" else v for v in estado_oz]

        if estado_oz:
            filas_ez = [
                [Paragraph("✓", st["label"]), Paragraph(str(item), st["body"])]
                for item in estado_oz
            ]
            tez = Table(filas_ez, colWidths=[0.6*cm, 14.4*cm])
            tez.setStyle(TableStyle([
                ("VALIGN",        (0,0), (-1,-1), "TOP"),
                ("TOPPADDING",    (0,0), (-1,-1), 3),
                ("BOTTOMPADDING", (0,0), (-1,-1), 3),
                ("LEFTPADDING",   (0,0), (-1,-1), 0),
                ]))
            story.append(tez)
            story.append(Spacer(1, 3))

        bloque("Observaciones del estado del cabello:", de.get("obs_estado_cabello"))

        # ── Objetivo del servicio ─────────────────────────────────────
        objetivos = de.get("objetivo_ozonoterapia") or []
        if isinstance(objetivos, str):
            objetivos = [s.strip() for s in objetivos.split(",") if s.strip()]
        if objetivos:
            story.append(Paragraph("Objetivo del Servicio", st["subsection"]))
            filas_obj = [
                [Paragraph("✓", st["label"]), Paragraph(str(item), st["body"])]
                for item in objetivos
            ]
            tobj = Table(filas_obj, colWidths=[0.6*cm, 14.4*cm])
            tobj.setStyle(TableStyle([
                ("VALIGN",        (0,0), (-1,-1), "TOP"),
                ("TOPPADDING",    (0,0), (-1,-1), 3),
                ("BOTTOMPADDING", (0,0), (-1,-1), 3),
                ("LEFTPADDING",   (0,0), (-1,-1), 0),
            ]))
            story.append(tobj)
            story.append(Spacer(1, 4))

        # ── Valoración capilar resumida ───────────────────────────────
        CAMPOS_OZONO = [
            ("permeabilidad_ozono", "Permeabilidad"),
            ("porosidad_ozono",     "Porosidad"),
            ("plasticidad_ozono",   "Plasticidad"),
            ("densidad_ozono",      "Densidad"),
            ("oleosidad_ozono",     "Oleosidad"),
            ("grosor_fibra_ozono",  "Grosor de fibra"),
            ("textura_ozono",       "Textura"),
        ]
        filas_val = []
        for key, lbl in CAMPOS_OZONO:
            val = str(de.get(key) or "").strip()
            if val:
                filas_val.append([
                    Paragraph(f"<b>{lbl}:</b>", st["label"]),
                    Paragraph(val, st["value"]),
                ])
        if filas_val:
            story.append(Paragraph("Valoración Capilar según Rizotipo", st["subsection"]))
            tv = Table(filas_val, colWidths=[4.5*cm, 10.5*cm])
            tv.setStyle(TableStyle([
                ("VALIGN",        (0,0), (-1,-1), "TOP"),
                ("TOPPADDING",    (0,0), (-1,-1), 5),
                ("BOTTOMPADDING", (0,0), (-1,-1), 5),
                ("LEFTPADDING",   (0,0), (-1,-1), 0),
                ("RIGHTPADDING",  (0,0), (-1,-1), 4),
                ("BACKGROUND",    (0,0), (0,-1),  colors.HexColor(GRIS_FONDO)),
                ("LINEBELOW",     (0,0), (-1,-2), 0.3, colors.HexColor(GRIS_BORDE)),
            ]))
            story.append(tv)
            story.append(Spacer(1, 6))

        # ── Protocolo aplicado ────────────────────────────────────────
        PROTOCOLO = [
            ("tipo_limpieza",              "Tipo de limpieza"),
            ("tiempo_exposicion_ozono",    "Tiempo de exposición"),
            ("tratamiento_medios_puntas",  "Tratamiento medios y puntas"),
            ("metodo_lavado",              "Método de lavado"),
        ]
        filas_prot = []
        for key, lbl in PROTOCOLO:
            val = str(de.get(key) or "").strip()
            if val:
                filas_prot.append([
                    Paragraph(f"<b>{lbl}:</b>", st["label"]),
                    Paragraph(val, st["value"]),
                ])
        if filas_prot:
            story.append(Paragraph("Protocolo Aplicado", st["subsection"]))
            tp = Table(filas_prot, colWidths=[4.5*cm, 10.5*cm])
            tp.setStyle(TableStyle([
                ("VALIGN",        (0,0), (-1,-1), "TOP"),
                ("TOPPADDING",    (0,0), (-1,-1), 5),
                ("BOTTOMPADDING", (0,0), (-1,-1), 5),
                ("LEFTPADDING",   (0,0), (-1,-1), 0),
                ("RIGHTPADDING",  (0,0), (-1,-1), 4),
                ("LINEBELOW",     (0,0), (-1,-2), 0.3, colors.HexColor(GRIS_BORDE)),
            ]))
            story.append(tp)
            story.append(Spacer(1, 4))

        # ── Ingredientes para casa ────────────────────────────────────
        ingredientes = de.get("ingredientes_domicilio") or []
        if isinstance(ingredientes, str):
            ingredientes = [s.strip() for s in ingredientes.split(",") if s.strip()]
        if ingredientes:
            story.append(Paragraph("Ingredientes para Casa", st["subsection"]))
            filas_ing = [
                [Paragraph("✓", st["label"]), Paragraph(str(item), st["body"])]
                for item in ingredientes
            ]
            ting = Table(filas_ing, colWidths=[0.6*cm, 14.4*cm])
            ting.setStyle(TableStyle([
                ("VALIGN",        (0,0), (-1,-1), "TOP"),
                ("TOPPADDING",    (0,0), (-1,-1), 3),
                ("BOTTOMPADDING", (0,0), (-1,-1), 3),
                ("LEFTPADDING",   (0,0), (-1,-1), 0),
            ]))
            story.append(ting)
            story.append(Spacer(1, 3))

        bloque("Frecuencia de uso:", de.get("frecuencia_ingredientes"))

        # ── Resultados post servicio ──────────────────────────────────
        resultados = de.get("resultados_post_servicio") or []
        if isinstance(resultados, str):
            resultados = [s.strip() for s in resultados.split(",") if s.strip()]
        if resultados:
            story.append(Paragraph("Resultados Post Servicio", st["subsection"]))
            filas_res = [
                [Paragraph("✓", st["label"]), Paragraph(str(item), st["body"])]
                for item in resultados
            ]
            tres = Table(filas_res, colWidths=[0.6*cm, 14.4*cm])
            tres.setStyle(TableStyle([
                ("VALIGN",        (0,0), (-1,-1), "TOP"),
                ("TOPPADDING",    (0,0), (-1,-1), 3),
                ("BOTTOMPADDING", (0,0), (-1,-1), 3),
                ("LEFTPADDING",   (0,0), (-1,-1), 0),
            ]))
            story.append(tres)
            story.append(Spacer(1, 3))

        bloque("Observaciones de resultados:", de.get("obs_resultados"))

        # ── Seguimiento ───────────────────────────────────────────────
        story.append(_hr())
        bloque("Frecuencia de seguimiento:", de.get("frecuencia_seguimiento"))
        bloque("Recomendaciones adicionales:",  de.get("recomendaciones_adicionales"))

        # Autorización publicación
        aut_oz = ("Sí" if de.get("autorizacion_publicacion") else "No") + \
                 " autoriza publicar fotos en redes sociales"
        story.append(Paragraph(f"<b>Autorización de publicación:</b> {aut_oz}", st["body"]))
        story.append(Spacer(1, 3))

    # ══════════════════════════════════════════════════════════════════════
    # TIPO DESCONOCIDO
    # ══════════════════════════════════════════════════════════════════════
    else:
        if de:
            story.append(Paragraph("DETALLES DEL SERVICIO", st["section"]))
            SKIP = {"cita_id","firma_profesional","fecha_firma",
                    "profesional_firmante_id","profesional_firmante_email"}
            for k, v in de.items():
                if k not in SKIP:
                    bloque(f"{k.replace('_',' ').title()}:", v)

    # ── FIRMA PROFESIONAL ────────────────────────────────────────────────────
    if de.get("firma_profesional") and de.get("profesional_firmante"):
        # 🔥 Solo fecha, sin hora
        fecha_firma = str(de.get("fecha_firma") or "")
        try:
            if "T" in fecha_firma:
                fecha_firma = datetime.fromisoformat(
                    fecha_firma.replace("Z", "+00:00")
                ).strftime("%d/%m/%Y")   # ← sin hora
        except:
            fecha_firma = fecha_firma.split("T")[0] if "T" in fecha_firma else fecha_firma

        ft = Table(
            [[Paragraph("<b>Firmado por:</b>",    st["label"]),
              Paragraph(de.get("profesional_firmante",""), st["value"])],
             [Paragraph("<b>Fecha de firma:</b>", st["label"]),
              Paragraph(fecha_firma, st["value"])]],
            colWidths=[4*cm, 11*cm]
        )
        ft.setStyle(TableStyle([
            ("BACKGROUND",    (0,0), (-1,-1), colors.HexColor(GRIS_FONDO)),
            ("GRID",          (0,0), (-1,-1), 0.3, colors.HexColor(GRIS_BORDE)),
            ("TOPPADDING",    (0,0), (-1,-1), 4),
            ("BOTTOMPADDING", (0,0), (-1,-1), 4),
            ("LEFTPADDING",   (0,0), (-1,-1), 4),
            ("RIGHTPADDING",  (0,0), (-1,-1), 4),
        ]))
        story.append(Spacer(1, 4))
        story.append(ft)
        story.append(Spacer(1, 3))

    # ── COMENTARIO INTERNO ───────────────────────────────────────────────────
    com = str(ficha_data.get("comentario_interno") or "").strip()
    if com and com.lower() != "no especificado":
        story.append(_hr())
        story.append(Paragraph("COMENTARIO INTERNO", st["section"]))
        story.append(Paragraph(com, st["body"]))
        story.append(Spacer(1, 3))

    # ── IMÁGENES ─────────────────────────────────────────────────────────────
    # 🔥 Sin PageBreak — las imágenes fluyen inmediatamente después del texto
    if fotos_antes or fotos_despues:
        story.append(Spacer(1, 8))
        story.append(_hr())
        story.append(Paragraph("IMÁGENES DEL SERVICIO", st["section"]))

        def render_fotos(titulo: str, prefix: str, urls: list[str]):
            if not urls:
                return
            story.append(Paragraph(titulo, st["subsection"]))
            story.append(Spacer(1, 3))

            for i in range(0, min(len(urls), 4), 2):
                celdas = []
                for j in (i, i + 1):
                    if j < len(urls):
                        b = imgs.get(f"{prefix}_{j}")
                        if b:
                            print(f"    🖼️ Comprimiendo foto {prefix}_{j}...")
                            b = comprimir_imagen_para_pdf(b, max_px=1200, quality=75)
                            if b:
                                img_el = Image(b, width=8*cm, height=8*cm, kind="proportional")
                                img_el.hAlign = "CENTER"
                                inner = Table(
                                    [[img_el],
                                    [Paragraph(f"Foto {j+1}", st["img_cap"])]],
                                    colWidths=[8*cm]
                                )
                                inner.setStyle(TableStyle([
                                    ("ALIGN",         (0,0), (-1,-1), "CENTER"),
                                    ("TOPPADDING",    (0,0), (-1,-1), 2),
                                    ("BOTTOMPADDING", (0,0), (-1,-1), 2),
                                ]))
                                celdas.append(inner)
                            else:
                                print(f"    ❌ Foto {prefix}_{j} no se pudo convertir → celda vacía")
                                celdas.append(Paragraph("(imagen no disponible)", st["body"]))
                        else:
                            print(f"    ⚠️ Foto {prefix}_{j} no se descargó o era None")
                            celdas.append(Paragraph("", st["body"]))

                row = Table([celdas], colWidths=[8.25*cm, 8.25*cm])
                row.setStyle(TableStyle([
                    ("VALIGN",        (0,0), (-1,0), "TOP"),
                    ("ALIGN",         (0,0), (-1,0), "CENTER"),
                    ("BOTTOMPADDING", (0,0), (-1,0), 8),
                ]))
                story.append(row)

        render_fotos("ANTES DEL SERVICIO:",   "antes",   fotos_antes)
        if fotos_antes and fotos_despues:
            story.append(Spacer(1, 6))
        render_fotos("DESPUÉS DEL SERVICIO:", "despues", fotos_despues)

    # ── FOOTER ───────────────────────────────────────────────────────────────
    story.append(Spacer(1, 12))
    story.append(_hr())

    now   = datetime.now()
    MESES = {"January":"enero","February":"febrero","March":"marzo","April":"abril",
              "May":"mayo","June":"junio","July":"julio","August":"agosto",
              "September":"septiembre","October":"octubre","November":"noviembre",
              "December":"diciembre"}
    mes_es  = MESES.get(now.strftime("%B"), now.strftime("%B").lower())
    fecha_f = f"{now.day} de {mes_es} de {now.year}"

    story.append(Paragraph(
        f"Documento generado el {fecha_f}<br/>"
        f"<b>Rizos Felices</b> — Sistema de Gestión Profesional<br/>"
        f"<i>Este documento es confidencial y para uso exclusivo del cliente</i>",
        st["footer"]
    ))

    # ── BUILD ─────────────────────────────────────────────────────────────────
    try:
        doc.build(story)
        buf.seek(0)
        return buf.getvalue()
    except Exception as e:
        print(f"❌ Error construyendo PDF: {e}")
        import traceback; traceback.print_exc()
        return await generar_pdf_simple_fallback(ficha_data, cita_data)


# ─────────────────────────────────────────────────────────────────────────────
# FALLBACK
# ─────────────────────────────────────────────────────────────────────────────
async def generar_pdf_simple_fallback(ficha_data: dict, cita_data: dict) -> bytes:
    buf   = BytesIO()
    doc   = SimpleDocTemplate(buf, pagesize=A4)
    story = []
    base  = getSampleStyleSheet()
    story.append(Paragraph("RIZOS FELICES",
        ParagraphStyle("T", parent=base["Heading1"], fontSize=18,
                       alignment=TA_CENTER, textColor=colors.black)))
    story.append(Spacer(1, 20))
    t = Table([
        ["Cliente:",  ficha_data.get("nombre", "")],
        ["Servicio:", ficha_data.get("servicio_nombre", "")],
        ["Fecha:",    datetime.now().strftime("%d/%m/%Y")],
        ["Sede:",     ficha_data.get("sede_nombre", "")],
    ], colWidths=[4*cm, 10*cm])
    t.setStyle(TableStyle([
        ("FONTNAME", (0,0), (0,-1), "Helvetica-Bold"),
        ("FONTSIZE", (0,0), (-1,-1), 11),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
        ("TOPPADDING",    (0,0), (-1,-1), 8),
    ]))
    story.append(t)
    doc.build(story)
    buf.seek(0)
    return buf.getvalue()


# ─────────────────────────────────────────────────────────────────────────────
# EMAIL
# ─────────────────────────────────────────────────────────────────────────────
def crear_html_correo_ficha(cliente_nombre: str, servicio_nombre: str, fecha: str) -> str:
    year = datetime.now().year
    return f"""<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8">
<style>
body{{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;
     margin:0 auto;padding:20px;background:#f8f9fa}}
.header{{background:#222;color:white;padding:25px 20px;text-align:center;
         border-radius:8px 8px 0 0}}
.content{{padding:30px;background:white;border:1px solid #ddd;
          border-top:none;border-radius:0 0 8px 8px}}
.info-box{{background:#f5f5f5;border-left:4px solid #555;padding:16px;
           margin:16px 0;border-radius:4px}}
.footer{{margin-top:24px;padding-top:16px;border-top:1px solid #eee;
         font-size:11px;color:#888;text-align:center}}
.hl{{color:#222;font-weight:bold}}
</style>
</head>
<body>
<div class="header"><h2>Servicio Finalizado</h2></div>
<div class="content">
  <p>Estimado/a <span class="hl">{cliente_nombre}</span>,</p>
  <p>Su servicio de <span class="hl">{servicio_nombre}</span> ha sido finalizado exitosamente.</p>
  <div class="info-box">
    <p><strong>Servicio:</strong> {servicio_nombre}</p>
    <p><strong>Fecha:</strong> {fecha}</p>
    <p><strong>Estado:</strong>COMPLETADO</p>
  </div>
  <p>Se adjunta la <strong>Ficha de Diagnostico</strong> en PDF.</p>
  <p>¡Gracias por confiar en nosotros!<br><strong>El equipo de Rizos Felices</strong></p>
</div>
<div class="footer">
  <p>© {year} Rizos Felices — Todos los derechos reservados</p>
</div>
</body></html>"""


async def enviar_correo_con_pdf(
    destinatario: str,
    asunto: str,
    mensaje_html: str,
    pdf_bytes: bytes,
    nombre_archivo: str = "comprobante_servicio.pdf"
) -> bool:
    try:
        msg = MIMEMultipart()
        msg["Subject"] = asunto
        msg["From"] = formataddr(("Rizos Felices", EMAIL_SENDER))
        msg["To"]      = destinatario
        msg.attach(MIMEText(mensaje_html, "html", "utf-8"))
        part = MIMEBase("application", "pdf")
        part.set_payload(pdf_bytes)
        encoders.encode_base64(part)
        part.add_header("Content-Disposition",
                        f'attachment; filename="{nombre_archivo}"')
        msg.attach(part)
        ctx = ssl.create_default_context()
        with smtplib.SMTP_SSL(SMTP_SERVER, SMTP_PORT, context=ctx) as server:
            server.login(EMAIL_SENDER, EMAIL_PASSWORD)
            server.send_message(msg)
        print(f"✅ Correo enviado a {destinatario}")
        return True
    except Exception as e:
        print(f"❌ Error enviando email: {e}")
        return False