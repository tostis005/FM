# Captación comercial de Farmetrica

La web pública publica `/solicitar-demo/`. El formulario envía un POST JSON a `/api/public/solicitudes-demo`, sin necesidad de sesión.

- Se validan servidor y cliente; se requiere consentimiento afirmativo. No se piden datos clínicos, contraseñas ni documentación de la farmacia.
- Honeypot y límites por IP/correo (en memoria de proceso) para reducir spam. Para ataques de alto volumen será necesario completar con protección a nivel proxy.
- Las solicitudes se guardan en `farmetrica.solicitudes_demo`, migración idempotente `006_solicitudes_demo.sql`.
- Se ven solo mediante una sesión de superadministrador en el apartado **Solicitudes**, con estados Nueva, Contactada y Cerrada.
- La referencia de respuesta confirma la inserción en PostgreSQL. No implica una reunión confirmada ni un correo de aviso.
- No hay emails automáticos configurados por este cambio: la gestión y respuesta se realiza desde el panel de administración.
- Establecer, antes de captación comercial a escala, el responsable del tratamiento, dirección de contacto, política formal de privacidad, periodos de conservación y borrado, y políticas de seguridad operativa.
- No se registra la IP del interesado en PostgreSQL. Las IP se usan solo temporalmente para los límites antifraude en memoria.
