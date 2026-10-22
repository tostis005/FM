# Farmétrica ↔ clientes IA: conector privado MCP (piloto)

## Diseño: una sola API de negocio, dos interfaces

- **Datos y autorización**: la API Express existente (api/) y PostgreSQL. No se crea otra API analítica ni una copia de datos.
- **Modelo local/web**: POST /api/asistente/chat conserva el proveedor Ollama y sus herramientas. Se podrá sustituir por otro proveedor o interfaz sin cambiar las reglas de datos.
- **ChatGPT**: POST https://DOMINIO/api/mcp es un servidor MCP stateless que utiliza las mismas consultas de assistantAnalytics.js y la misma política multi-tenant. ChatGPT interpreta los resultados, sin segundo LLM en el VPS.
- **Identidad**: OAuth authorization-code + PKCE (S256), sesión existente de Farmétrica para consentimiento, tokens aleatorios almacenados como hash SHA-256. Los tokens se vinculan a un único usuario, método de acceso, cliente y audiencia.
- **Revocación inmediata**: todas las llamadas revalidan la cuenta y el contexto de cliente/farmacias/módulos en PostgreSQL. Desactivar una cuenta, quitarle un cliente o modificar sus permisos deja de autorizar las llamadas. Además, cada usuario puede revocar su conexión manualmente.
- **Sin SQL libre**: las herramientas solo invocan las funciones cerradas existentes, con fechas, límites, READ ONLY, timeouts y esquema obtenido del tenant en servidor.

## Herramientas disponibles en el piloto

| Herramienta | Uso |
| --- | --- |
| listar_contexto | Farmacias y módulos accesibles por el usuario |
| catalogo_analitico | Indicadores y limitaciones del motor |
| consultar_indicador | ventas_resumen, compras_resumen, stock_capital, ventas_articulos, ahorro_economico |
| explorar_pregunta | Selección de hasta dos indicadores conocidos a partir de una pregunta y devolución de datos, sin modelo local |

Esto es una **base real pero no todavía cobertura total del negocio**. El siguiente bloque de desarrollo puede reutilizar las APIs existentes de informes/documentos/stock/proveedores/promociones en nuevas herramientas cerradas, verificando filtros, exclusiones y permisos. No exponer endpoints administrativos ni datos de pacientes. La métrica ahorro es un diferencial de PUC documentado, **no ahorro garantizado**. Las tablas ventas y compras básicas pueden diferir de los informes documentales netos; las preguntas de conciliación requieren ampliar herramientas usando las funciones oficiales.

## Activación del piloto en producción (22-10-2026)

**Activado y verificado** para uso privado por OAuth. El servicio usa la API actual y no altera pantallas ni la lógica web. Se activa por `deploy/compose.farmacias.yml` con `AI_MCP_ENABLED: 'true'` y `AI_MCP_PUBLIC_ORIGIN: 'https://farmetrica.com'`. De esta forma no hay que editar el archivo privado `/opt/farmawao/.env`, que pertenece a otro usuario.

- Despliegue validado: GitHub Actions `Build and deploy Farmetrica SaaS` (39754910206).
- Validación externa validada: `Verificar MCP privado Farmetrica` (39755159879), con descubrimiento OAuth y `401` sin token.
- Complemento privado creado en ChatGPT: `https://chatgpt.com/plugins/plugins_6ad9d2c08bfc81918bdf70793c89ac75`.
- Falta el consentimiento OAuth de la persona propietaria y una consulta real usando su cuenta; nunca se debe automatizar ni suplantar este paso.
- Desactivar: cambiar la variable `AI_MCP_ENABLED` a `'false'` en el override de Compose y desplegar/recrear `api`. Revocación individual vía `/api/ai/conexiones/:id/revocar`.

## Procedimiento manual alternativo (si se abandona el override desplegado)


1. Publicar el código con el proceso de despliegue habitual y verificar que la migración aditiva 022_ai_mcp.sql se aplica; también se ejecuta en el arranque de la API. El conector está **desactivado por defecto**.
2. Confirmar HTTPS público, PUBLIC_APP_ORIGIN exacto y rutas Nginx de descubrimiento OAuth.
3. Añadir al .env privado de Contabo (no compartir claves en el chat ni subirlas a GitHub):

   ~~~dotenv
   AI_MCP_ENABLED=true
   AI_MCP_PUBLIC_ORIGIN=https://TU_DOMINIO_REAL
   ~~~

4. Re-crear la API y comprobar sin sesión:
   - GET https://TU_DOMINIO_REAL/.well-known/oauth-protected-resource/api/mcp: publica resource y authorization_servers, **sin datos de farmacias**.
   - GET https://TU_DOMINIO_REAL/.well-known/oauth-authorization-server: publica metadata OAuth.
   - POST https://TU_DOMINIO_REAL/api/mcp: debe devolver 401 sin token válido; **nunca un resultado analítico**.
5. En ChatGPT web, abrir **Plugins → + → Add custom MCP server**, añadir «Farmétrica», URL https://TU_DOMINIO_REAL/api/mcp, autenticación OAuth mediante **Client ID Metadata Document (CIMD)** y alcance farmetrica.read offline_access si solicita scopes. Elegir privado, instalarlo y comenzar un chat indicando @Farmétrica.
6. ChatGPT abrirá Farmétrica para autenticación (Google o cuenta local) y consentimiento de cliente. No enviar passwords, claves de base de datos ni cookies a ChatGPT. Después probar listar_contexto y una consulta de un período corto. Si ChatGPT utiliza un callback no contemplado, examinar su metadata y validar ese callback antes de ampliarlo (jamás permitir redirecciones arbitrarias).

## Clientes MCP de distintos proveedores

Se admiten clientes públicos OAuth con código de autorización + PKCE S256, sin lista cerrada de proveedores:

- **CIMD**: el identificador HTTPS se resuelve como un documento JSON; se exige coincidencia exacta de identidad y callback. No se siguen redirecciones HTTP. La descarga limita tamaño y tiempo, rechaza redes privadas y fija la dirección DNS durante TLS. Actualmente requiere un destino IPv4 público; un cliente sin él puede usar DCR.
- **DCR (RFC 7591)**: `POST /api/ai/oauth/register`, anunciado en los metadatos OAuth. Guarda el ID y sus callbacks en PostgreSQL mediante la migración 023. El registro por sí solo no concede acceso a datos.
- **Claude**: usar `https://farmetrica.com/api/mcp`, OAuth y la identidad publicada de Claude; si el documento no está disponible, elegir «Register automatically». No introducir las credenciales OAuth de Google en Claude.
- **Otros clientes**: deben implementar CIMD o DCR, autenticación de cliente `none`, PKCE S256, `resource=https://farmetrica.com/api/mcp` y scope `farmetrica.read` (opcional `offline_access`). No se promete compatibilidad con clientes que solo admitan otros mecanismos de autenticación.
- Callbacks HTTPS o HTTP con IP de loopback para aplicaciones locales; coincidencia exacta, sin comodines, credenciales ni fragmentos.
- Cada conexión requiere sesión de Farmétrica (Google o cuenta local), consentimiento explícito y un cliente/farmacias autorizados. Se muestra el identificador y el destino además del nombre declarado por la aplicación. POST de consentimiento exige Origin de Farmétrica.
- Permisos de lectura, revocación, tokens guardados como hash, vinculación al recurso y comprobación de permisos en cada consulta se mantienen.

Pruebas: `node --test api/src/aiMcp.test.js api/src/oauthClients.test.js api/src/oauthFlow.test.js`. El test de flujo utiliza una base simulada; la conexión personal en Claude requiere que el usuario complete el consentimiento.

## Gestión de accesos

- GET /api/ai/conexiones (con sesión web de Farmétrica) devuelve las conexiones propias, sin tokens.
- POST /api/ai/conexiones/{id}/revocar (con sesión y mismo origen) invalida la conexión propia; en futuros ajustes podemos añadir un botón.
- Retirar a alguien de farmetrica.usuario_clientes, desactivar public.acceso_cuentas o modificar su selección de farmacias afecta también al MCP al siguiente uso.
- Nunca compartir un usuario ni una cuenta de ChatGPT entre titulares. Cada titular accede con su propia cuenta de Farmétrica.

## Validación antes de ampliar usuarios

- node --check api/src/aiMcp.js
- node --test api/src/aiMcp.test.js
- Pruebas de integración de acceso real en un entorno con PostgreSQL, dos clientes y usuarios con permisos distintos: no permitir consultas intercliente, revocación en tiempo real y token refresh con rotación.
- Comprobar OAuth PKCE con el callback real, tiempo de respuesta, latencia y errores del frontend en Contabo. Supervisar farmetrica.ai_oauth_auditoria (solo conexión, cliente, herramienta y fecha; sin preguntas ni valores).
- Controlar retención de auditorías/conexiones mediante política de datos antes de un despliegue comercial.

El acceso es privado por **autenticación y autorización de Farmétrica**. La distribución del plugin a distintas cuentas externas de ChatGPT depende de las modalidades de publicación/compartición de ChatGPT; no se puede prometer una lista privada de correos externos sin comprobar esa opción.

