# Conectar Farmétrica Demo mediante OAuth en ChatGPT

- Plugin privado: https://chatgpt.com/plugins/plugins_6ad9e5125d4c8191b0344aa42f6a369d
- Servidor: https://farmetrica.com/api/mcp-demo
- Recurso OAuth: https://farmetrica.com/api/mcp-demo
- Metadatos: https://farmetrica.com/.well-known/oauth-protected-resource/api/mcp-demo
- Issuer: https://farmetrica.com
- Flujo: OAuth authorization_code + PKCE S256, client_id por CIMD (o DCR).
- Permisos: farmetrica.read; opcional offline_access.
- En el navegador se inicia sesión con la cuenta de Farmétrica, se selecciona el cliente y se autoriza de forma expresa.
- En cada petición se revalidan permisos de Farmétrica y se utilizan consultas SQL predefinidas de solo lectura. La clave API anterior se mantiene como método alternativo para consumidores técnicos, pero no es necesaria para ChatGPT.
- Por seguridad los tokens del MCP Demo solo funcionan contra /api/mcp-demo; los del MCP principal contra /api/mcp.
- Para conectar un MCP personalizado usa ChatGPT en navegador web: el flujo de conexión no está disponible en la aplicación móvil. La visibilidad del plugin en el buscador no implica una conexión funcional.
- Tras la configuración web, comprobar si el plugin está disponible en las interfaces y modelos de la cuenta. No afirmar que está verificada una conexión de cuenta hasta completar consentimiento y consulta.
