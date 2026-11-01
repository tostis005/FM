# FARMÉTRICA · Primera demo comercial compacta (01/11/2026)

## Principio del producto
No vender decenas de informes. Mostrar un ciclo de trabajo: detectar una oportunidad con datos reales, decidir, asignar, ejecutar y verificar su impacto económico.

## Navegación comercial
- **Inicio:** ventas, compras, margen cuando hay cobertura suficiente y diferencia documental ventas-compras, con advertencia expresa de que no es beneficio. Incluye resultados económicos **verificados**, si hay permiso para consultarlos, y accesos a trabajo, pedidos, promociones y stock inmovilizado.
- **Ventas:** analítica ya existente, detalle de artículos, mapa de calor y vendedores. Los tickets, anulaciones y vistas documentales siguen teniendo rutas válidas aunque se oculten del menú comercial.
- **Compras:** analítica existente, comparativa PUC mayorista/laboratorio, análisis de ahorro real bajo demanda y enlaces para preparar pedidos o convertir una diferencia de PUC en oportunidad de trabajo.
- **Preparador de pedidos:** sigue como subentrada visible de Compras. No se cambia su lógica ni el límite de artículos; conserva todas las referencias.
- **Stock:** análisis general y **Stock sin recepciones** visible, sin modificar sus criterios ni cálculo. Histórico/traspasos siguen operativos mediante rutas anteriores.
- **Genéricos:** permanece como módulo propio sin refactorizar su comparador.
- **Promociones:** permanece como módulo propio y conserva seguimiento.
- **Trabajo y ahorro:** una única vista con pestañas de oportunidades, tareas personales, alertas, resultados verificados y preferencias de correo, según permisos. Se reutilizan las APIs operativas persistentes y sus transiciones/auditoría.
- **Configuración y Administración:** sin cambios funcionales.

## Ahorro: tres magnitudes distintas
1. **Potencial de ahorro:** diferencia histórica o posibilidad detectada, condicionada por precios, descuentos, rappels, portes, mínimos y suministro. No equivale a ahorro conseguido.
2. **Ahorro o mejora de margen verificados:** resultados guardados en `op_resultados_verificados`, con metodología, evidencia y períodos comparados. Cambiar una oportunidad a «Aplicada» no crea un registro de ahorro.
3. **Capital liberado:** existe por separado; nunca se suma al ahorro o margen de la explotación.

No se inventan importes ni se reemplazan fallos de consulta con cero.

## Correos de trabajo
- Preferencia personal por `cliente_slug + email`. Por defecto **desactivado**.
- Frecuencia diaria o semanal, día de semana y hora de España peninsular. Se envía a la dirección autenticada; no existe campo de destinatario libre.
- El mensaje solo incluye **recuentos** de tareas abiertas, urgentes y oportunidades asignadas, más acceso a la aplicación. No contiene nombres de artículos, pacientes ni datos comerciales detallados.
- Solo se envía si `FM_DIGEST_EMAILS_ENABLED=true` y `SMTP_HOST`, `SMTP_FROM` y, si corresponde, `SMTP_USER` y `SMTP_PASSWORD` están configurados. Guardar preferencias cuando el servicio está desactivado no activa los envíos.
- El trabajador se inicia con la API, reclama cada entrega con bloqueo de fila y mantiene `ultima_fecha_procesada` para no repetir el resumen en un mismo día. Ante error SMTP, puede reintentar después de treinta minutos.
- No es todavía un motor de alertas predictivas configurables por umbrales: en esta versión se envían **recordatorios de oportunidades y tareas ya registradas**.

## Aislamiento y seguridad
- Rutas anteriores y permisos conservados. La navegación compacta no es una capa de autorización.
- Las preferencias requieren sesión, acceso a trabajo y pertenencia activa al cliente.
- Los resúmenes se filtran por cliente, responsable y farmacias autorizadas en el momento del envío.
- No hay exportación de datos a servicios de terceros ni cambios de stock/ERP por el mero hecho de marcar una acción.

## Validación y despliegue
1. CI React/API y nueva migración aditiva `045_resumen_trabajo_correo.sql` dos veces para validar idempotencia.
2. En una sesión real comprobar menú y acceso de administración, gestor, farmacia, y subsecciones sin permisos.
3. Revisar Inicio, Ventas, Compras y Trabajo y ahorro con una y varias farmacias; resultados verificados vacíos, parciales y completos.
4. Verificar registrar una oportunidad desde comparador y su aparición en Trabajo y ahorro.
5. Probar correos solo en entorno controlado con SMTP de prueba y bandera de envío habilitada; comprobar desactivación y periodicidad.
6. Mantener este cambio aislado en rama/PR para volver al menú anterior mediante reversión sin borrar datos. La nueva tabla de preferencias es aditiva.

**Fuera de alcance para cerrar esta demo:** automatización que descubra sola acciones nuevas, cómputo automático de ahorro realizado sin evidencia, refactorización interna de promociones, preparador, stock sin recepciones, genéricos o configuración.
