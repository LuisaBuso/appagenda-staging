from datetime import datetime, time, timedelta

def construir_html_confirmacion(cita: dict, sede: dict) -> str:
    """Genera el HTML del correo de confirmación a partir de un doc de cita ya guardado."""
    nombres_servicios = ", ".join(
        s.get("nombre", "Servicio") for s in cita.get("servicios", [])
    ) or cita.get("servicio_nombre", "Sin servicio")

    return f"""
    <!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
    <body style="font-family:'Segoe UI',sans-serif;background:#f4f4f4;margin:0;padding:0;">
      <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:15px;
                  overflow:hidden;border:1px solid #f198c0;">
        <div style="background:#000;padding:40px 20px;text-align:center;">
          <img src="https://rizosfelicesdata.s3.us-east-2.amazonaws.com/logo+principal+rosado+letra+blanco_Mesa+de+tra+(1).png"
               style="max-width:180px;margin-bottom:20px;" alt="Rizos Felices">
          <h1 style="color:#f198c0;margin:0;font-size:28px;letter-spacing:2px;">¡CITA CONFIRMADA!</h1>
          <p style="color:#fff;margin:10px 0 0;opacity:.9;">Tu reserva ha sido agendada exitosamente</p>
        </div>
        <div style="padding:30px;">
          <div style="font-size:18px;font-weight:bold;color:#333;margin-bottom:20px;
                      padding-bottom:10px;border-bottom:2px solid #f198c0;">📅 Detalles de la cita</div>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:15px;margin-bottom:20px;">
            <div style="padding:15px;border-radius:10px;border:1px solid #f198c0;">
              <div style="color:#f198c0;font-size:12px;font-weight:bold;margin-bottom:5px;">CLIENTE</div>
              <div style="color:#333;font-size:15px;font-weight:600;">{cita.get('cliente_nombre','')}</div>
            </div>
            <div style="padding:15px;border-radius:10px;border:1px solid #f198c0;">
              <div style="color:#f198c0;font-size:12px;font-weight:bold;margin-bottom:5px;">SERVICIO(S)</div>
              <div style="color:#333;font-size:15px;font-weight:600;">{nombres_servicios}</div>
            </div>
            <div style="padding:15px;border-radius:10px;border:1px solid #f198c0;">
              <div style="color:#f198c0;font-size:12px;font-weight:bold;margin-bottom:5px;">PROFESIONAL</div>
              <div style="color:#333;font-size:15px;font-weight:600;">{cita.get('profesional_nombre','')}</div>
            </div>
            <div style="padding:15px;border-radius:10px;border:1px solid #f198c0;">
              <div style="color:#f198c0;font-size:12px;font-weight:bold;margin-bottom:5px;">SEDE</div>
              <div style="color:#333;font-size:15px;font-weight:600;">{cita.get('sede_nombre','')}</div>
              <small style="color:#888;">{sede.get('direccion','')}</small>
            </div>
            <div style="padding:15px;border-radius:10px;border:1px solid #f198c0;">
              <div style="color:#f198c0;font-size:12px;font-weight:bold;margin-bottom:5px;">FECHA</div>
              <div style="color:#333;font-size:15px;font-weight:600;">{cita.get('fecha','')}</div>
            </div>
            <div style="padding:15px;border-radius:10px;border:1px solid #f198c0;">
              <div style="color:#f198c0;font-size:12px;font-weight:bold;margin-bottom:5px;">HORARIO</div>
              <div style="color:#333;font-size:15px;font-weight:600;">{cita.get('hora_inicio','')} - {cita.get('hora_fin','')}</div>
            </div>
          </div>
          <div style="background:#fff0f6;padding:20px;border-radius:12px;border-left:5px solid #f198c0;">
            <div style="color:#f198c0;font-weight:bold;margin-bottom:10px;">📋 Recomendaciones importantes</div>
            <ul style="margin:0;padding-left:20px;color:#555;font-size:14px;">
              <li style="margin-bottom:8px;">Llega 10 minutos antes de tu cita</li>
              <li style="margin-bottom:8px;">En caso de servicio completo, traer cabello desenredado</li>
              <li style="margin-bottom:8px;">Notifica cancelaciones con al menos 24 horas de anticipación</li>
              <li style="margin-bottom:8px;">En caso de corte, traer el cabello limpio y desenredado</li>
            </ul>
          </div>
          <div style="margin-top:20px;padding:20px;border-radius:12px;border:1px solid #f198c0;">
            <div style="font-size:16px;font-weight:600;color:#f198c0;margin-bottom:8px;">📞 ¿Necesitas ayuda?</div>
            <p style="color:#333;margin:0;"><strong>{sede.get('nombre','')}:</strong> {sede.get('telefono','No disponible')}</p>
          </div>
        </div>
        <div style="background:#f9f9f9;padding:20px;text-align:center;color:#777;font-size:13px;">
          <p>© {datetime.now().year} Rizos Felices. Todos los derechos reservados.</p>
          <p style="margin-top:8px;font-size:12px;opacity:.7;">Este es un correo automático, por favor no responder.</p>
        </div>
      </div>
    </body></html>
    """