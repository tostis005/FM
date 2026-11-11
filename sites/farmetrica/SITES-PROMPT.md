# Instrucción para Work / @Plugin Creator / @Sites

Crea un nuevo **Site privado** llamado **Farmétrica** y publica su complemento
MCP de uso desde ChatGPT Plus. Prioridad: herramientas reales ejecutables
desde una conversación; la página del Site debe ser mínima.

Repositorio público para el código: https://github.com/tostis005/FM
Rama de integración: `feature/sites-farmetrica-mcp-bridge`.
Usa `sites/farmetrica/mcp-bridge.mjs` como adaptador de transporte reutilizable,
`sites/farmetrica/README.md` para el procedimiento, y revisa en `main`:
`api/src/aiShareMcp.js`, `api/src/aiShareContract.js`,
`api/src/aiSemanticQuery.js`.

IMPORTANTE: NO modifiques `api/`, `web/`, ni el MCP de Farmétrica por ahora.
El backend existente `https://farmetrica.com/api/consulta-temporal/mcp`
es el único origen de datos. El Site no debe crear otra base de datos, IA,
proxy público sin autenticación ni almacén de ventas. No implementar OAuth
por ahora salvo que el host lo requiera y se confirme esa limitación.

Registrar exactamente las herramientas de solo lectura:
- `leer_modelo_temporal`: requiere `url` de enlace temporal y devuelve esquema,
  farmacias, fuentes, dimensiones, métricas y reglas con credenciales omitidas de las respuestas.
- `consultar_datos_temporales`: requiere `url` y `consulta` JSON; ChatGPT
  compone la consulta con el esquema devuelto por `leer_modelo_temporal`.
  Prohibir SQL libre y acciones de escritura.

Usar el esquema exacto de herramientas del MCP existente, descubierto con
`tools/list`; no inventar nombres de campos. Llamar al upstream mediante
`POST` y JSON-RPC 2.0, sin redirecciones ni cache, con timeout y control de
errores; `callFarmetricaTool` ya prepara esto. Tratar `filas: []` como
resultado correcto y diferenciarlo de error/red caída/enlace revocado.

No exponer enlaces temporales en frontend, logs, URLs de navegación ni
archivos públicos. Para la primera demo permitir que se suministre el enlace
una vez en la conversación y lo reutilice ChatGPT en las herramientas.
Si Sites ofrece credenciales privadas **por usuario**, valorar el almacenamiento
seguro por usuario para futuras conversaciones, verificando aislamiento;
no guardar el token como secreto global compartido entre usuarios/tenants.

Publica como **privado**, instala/conecta el plugin generado por Sites y
verifica que puede invocarse desde otro chat usando @Farmétrica. No crear un
segundo plugin vía ZIP, ni dar por finalizado el trabajo si solo hay página Site.
Prueba con un token vigente autorizado para Ampedia, **sin imprimirlo**:
ventas por farmacia 22 y 21 de octubre 2026; ranking vendedores 1–22 octubre
y 1 enero–22 octubre; secuencia A/B/A para probar ausencia de caché; controles
de período `Europe/Madrid`. Nunca inventes importes. Comprueba compatibilidad
web y móvil, reporta cualquier limitación sin dar éxito por supuesto.

Devuélveme la URL privada de administración del Site, la ficha del plugin,
las herramientas detectadas y pruebas end-to-end verificadas.
