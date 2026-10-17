# Captación comercial de Farmetrica

La web pública publica `/solicitar-demo/`. El formulario envía un POST JSON a `/api/public/solicitudes-demo`, sin necesidad de sesión.

- Se validan servidor y cliente; se requiere consentimiento afirmativo. No se piden datos clínicos, contraseñas ni documentación de la farmacia.
- Honeypot y límites por IP/correo (en memoria de proceso) para reducir spam. Para ataques de alto volumen será necesario completar con protección a nivel proxy.
- Las solicitudes se guardan en `farmetrica.solicitudes_demo`, migración idempotente `006_solicitudes_demo.sql`.
- Se ven solo mediante una sesión de superadministrador en el apartado **Solicitudes**, con estados Nueva, Contactada y Cerrada.
- La referencia de respuesta confirma la inserción en PostgreSQL. No implica una reunión confirmada ni un correo de aviso.
- La entrega de avisos automáticos es opcional: si se configura SMTP y un destinatario, se envía una referencia sin datos personales; sin configuración, se gestiona desde el panel privado.
- Existe página pública `/privacidad/` y canal específico `/privacidad/solicitud/`, con registros separados en `farmetrica.solicitudes_privacidad` y bandeja privada del superadministrador. Queda **pendiente de confirmar con el titular** la identidad jurídica, NIF/CIF, domicilio, contacto legal y condiciones reales de proveedores de infraestructura para completar la información RGPD.
- No se registra la IP del interesado en PostgreSQL. Las IP se usan solo temporalmente para los límites antifraude en memoria.

- Al iniciar y cada 24 horas se purgan los contactos comerciales con más de 12 meses desde su última actualización y solicitudes de derechos con más de 24 meses desde su última actualización. Revisar estos plazos con el titular y su asesoría legal.

- Los agregados web se purgan a los 13 meses. No se guardan rutas privadas ni valores de consulta, y las visitas no se asocian a personas ni a los formularios enviados.
