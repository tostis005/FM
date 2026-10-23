# Piloto del asistente Farmétrica: Qwen3 0.6B local

## Estado y arquitectura

El asistente en producción queda habilitado por \`deploy/compose.farmacias.yml\` con
\`AI_ENABLED=true\`, \`AI_MODEL=qwen3:0.6b\` y \`AI_OLLAMA_URL=http://ollama:11434\`.
El modelo está dentro de la red de Docker; no se expone un puerto de Ollama al exterior.
El servicio solo permite solicitudes autenticadas y acotadas al cliente y farmacias
autorizados. El MCP permanece con sus controles y permisos actuales.

- La pregunta se interpreta en el backend con \`semanticInterpreter.js\`.
- Las consultas SQL se construyen en Farmétrica desde el catálogo permitido,
  con parámetros, aislamiento de cliente y consultas de solo lectura.
- La API construye la tabla oficial y calcula los hechos destacados.
- Qwen3 0.6B solo redacta un resumen corto (90 tokens, 2 hilos) que Farmétrica
  valida; si falla o inventa afirmaciones, se presenta un resumen seguro.
- El chat soporta progreso y respuesta por SSE; la tabla oficial se entrega
  al final para no difundir cantidades no verificadas durante el streaming.

No se ejecuta SQL arbitrario y no se usa el modelo para calcular importes.

## Verificación del modelo

Al desplegar, GitHub Actions comprueba que el proceso de API tiene exactamente
\`AI_ENABLED=true\` y \`AI_MODEL=qwen3:0.6b\`, consulta \`/api/tags\` y realiza
una pequeña inferencia de prueba contra Ollama desde la misma red Docker.
La comprobación está en \`api/src/checkAssistantReady.mjs\`; si no existe el
modelo o no puede responder, falla el despliegue (aunque la web siga accesible).

Dentro de Farmétrica, abrir el asistente tras iniciar sesión. La cabecera indica
\`Conectado · Qwen3 0.6B\`. Si se muestra "Modelo no disponible", revisar
los logs de API, Ollama y la comprobación del despliegue. El estado del modelo
se consulta en \`GET /api/asistente/estado\` con sesión de usuario autenticada.

## Preguntas recomendadas para las primeras pruebas

1. ¿Cuánto vendió cada farmacia ayer?
2. Top 10 vendedores con más ventas este mes.
3. Ventas por fecha de los últimos 7 días.
4. Compras por farmacia este mes.
5. ¿Qué proveedores registraron más compras este mes?
6. ¿Cuánto hemos comprado a Cofares este mes?
7. ¿Cuánto vendimos de solares el año pasado?
8. ¿Cuál es el porcentaje de margen estimado de ventas por farmacia este mes?
9. ¿Cuánto stock tenemos por farmacia?
10. Compara las ventas por farmacia este mes con el mes pasado.

Los proveedores pueden seguir sin nombre si falta su maestro; "solares" se
aproxima por denominación comercial; el margen es estimado a PMC actual,
no beneficio neto contable. Las consultas avanzadas fuera del catálogo
pueden requerir aclaración o no estar disponibles.

## Voz

\`AI_VOICE_ENABLED\` permanece desactivado por defecto. No activar Whisper
sin comprobar su disponibilidad. En navegadores compatibles puede haber dictado
del navegador con servicios externos sujetos a sus propias condiciones.
