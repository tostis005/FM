# Asistente de Farmétrica · maqueta de interfaz

Esta primera iteración contiene **solo frontend**. No ejecuta modelos, no consulta PostgreSQL, no llama a Ollama y no transmite mensajes ni grabaciones a servidores. Los ejemplos de respuesta son textos explicativos predefinidos; nunca se presentan como cifras reales.

## Dónde aparece

La burbuja «Asistente IA» está anclada abajo a la derecha en **todas las páginas autenticadas** de la aplicación. Al pulsarla, abre una vista de pantalla completa con:
- Cabecera y botón de cierre (o tecla Escape).
- Contexto de la sección activa (ventas, compras, dashboard, etc.).
- Sugerencias para iniciar consultas y botón de nueva conversación.
- Campo de texto: Intro envía, Mayús+Intro inserta nueva línea.
- Historial visible de la conversación actual, exclusivamente en memoria de la pestaña.
- Grabación local con MediaRecorder, contador y límite de dos minutos.
- Controles para detener, descartar, escuchar y enviar el audio dentro de la maqueta.
- Mensajes de estado y errores cuando no hay permiso de micrófono.

Al cambiar de cliente se reinicia el asistente para que no se reutilice una conversación en otro contexto. Tampoco se guarda texto ni audio en localStorage.

## Probar manualmente

1. Iniciar sesión y recorrer varias secciones: la burbuja debe mantenerse visible.
2. Abrir, cerrar, usar Escape y volver a abrir. Comprobar foco y desplazamiento.
3. Escribir y enviar una pregunta; probar Intro, Mayús+Intro, sugerencias y nueva conversación.
4. Permitir micrófono en un origen HTTPS (o localhost), grabar, detener y reproducir.
5. Enviar audio y verificar que se puede reproducir el mensaje en la conversación.
6. Cancelar grabación y revocar permisos: comprobar mensajes de error.
7. Comprobar móvil y escritorio, incluidos botones con teclado.
8. Cambiar de cliente y verificar que no reaparecen mensajes ni audios del cliente anterior.

**Importante:** enviar un audio en esta versión significa añadirlo al chat como reproducción local. Todavía **no** hay transcripción ni respuesta al contenido de la voz; tampoco persistencia del historial.

## Integración futura (fuera de esta iteración)

- Endpoint autenticado para conversaciones, rate limiting, límites de tamaño de los archivos y política de retención.
- Servicio de transcripción de audio con consentimiento y controles de privacidad.
- Orquestador de consultas autorizado por cliente/farmacia (nunca acceso a SQL arbitrario desde el navegador).
- Motor LLM intercambiable (Ollama o proveedor externo) y respuestas con fuentes de datos verificables.
- Pruebas de carga, permisos de usuario y aislamiento multi-tenant antes de habilitarlo para clientes.

La interfaz está encapsulada en `web/src/AsistenteDemo.jsx` y `web/src/AsistenteDemo.css`, lo que permite sustituir la respuesta simulada por peticiones autenticadas sin rehacer la navegación de Farmétrica.
