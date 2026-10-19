# Asistente de Farmétrica · maqueta de interfaz y dictado

Esta iteración continúa siendo una **maqueta de frontend**. No consulta PostgreSQL, no ejecuta Ollama ni llama a ningún modelo de Farmétrica. Las respuestas del chat son mensajes de demostración, nunca cifras reales.

## Experiencia del chat

La burbuja «Asistente IA» aparece en las páginas autenticadas. Al pulsarla se abre una pantalla completa con chat, sugerencias y contexto de la sección activa. El historial de la conversación actual permanece en memoria, sin guardarse en localStorage. Al cambiar de cliente se reinicia el asistente.

- Escribir una pregunta y enviarla con Intro (Mayús + Intro añade una línea).
- Dictar una pregunta desde el botón de micrófono del compositor.
- Durante el dictado aparece un panel destacado con **dos botones grandes**, «Descartar» y «Detener y transcribir», contador y vista previa del reconocimiento.
- Al pulsar **Detener y transcribir**, el texto reconocido se inserta en la misma caja del compositor, junto al borrador que ya existiera. **No se envía automáticamente**.
- Al pulsar **Descartar**, no se añade ningún texto al borrador.
- Si el navegador no soporta dictado, se muestra un mensaje claro y se mantiene disponible la escritura.

### Transcripción temporal desde navegador

Mientras no esté instalado Whisper u otro motor local, esta demo utiliza `SpeechRecognition` / `webkitSpeechRecognition` del navegador, en idioma español, cuando está disponible. **La compatibilidad depende del navegador** y algunos proveedores pueden enviar el audio a sus propios servicios externos para reconocimiento. La web de Farmétrica no recibe ni almacena una grabación, pero **no se puede prometer procesamiento local ni privacidad del audio por parte del proveedor del navegador**. Esta advertencia está también visible en la interfaz del chat. Si el proveedor del navegador no funciona o deniega permiso, el asistente invita a escribir.

En una futura integración, sustituiremos esta dependencia por transcripción controlada (p. ej., Whisper local en el servidor) y adaptaremos la política de privacidad y consentimiento.

## Pruebas

1. Iniciar sesión; comprobar botón flotante, pantalla completa y versión móvil.
2. Abrir micrófono en HTTPS en un navegador compatible, permitir acceso y dictar una pregunta.
3. Revisar que se muestre texto mientras se dicta; detener y comprobar que aparece en el textarea (no aparece ningún reproductor de audio).
4. Editar la transcripción y enviarla; verificar que la respuesta se identifica como demo.
5. Comprobar que al descartar no se pierde el texto que ya estaba escrito.
6. Repetir con una pregunta ya escrita para comprobar que el dictado se añade sin sustituir el borrador.
7. Comprobar micrófono denegado, navegador incompatible, dictado sin voz, Escape y cambio de cliente.
8. Verificar que al cerrar o cambiar de conversación no se aplican resultados de una sesión de dictado antigua.

Las reglas para unir transcripciones y texto se encuentran en `web/src/dictadoVoz.js` y tienen pruebas unitarias en `web/src/dictadoVoz.test.js`.

## Integración futura

Backend autenticado para conversaciones, transcripción controlada y autorización por cliente/farmacia; herramientas analíticas auditables, modelo LLM intercambiable, límites de consultas y pruebas de carga. Hasta entonces, el envío del chat **solo produce respuestas explicativas prefijadas**.
