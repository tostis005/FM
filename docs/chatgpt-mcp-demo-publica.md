# MCP de demostración pública sin credenciales

El endpoint **https://farmetrica.com/api/mcp-demo** está abierto para
demostraciones públicas: no necesita sesión, contraseña, clave API ni OAuth.

**Nunca consulta PostgreSQL ni devuelve datos reales de clientes.**
Usa tres farmacias ficticias y valores sintéticos para probar las cuatro
herramientas MCP de lectura (`listar_contexto`, `catalogo_analitico`,
`consultar_indicador` y `explorar_pregunta`).
Cada respuesta indica `ficticio: true` y el origen sintético de los importes.

El endpoint privado **https://farmetrica.com/api/mcp** conserva OAuth
y las consultas reales autorizadas de Farmétrica; no está abierto al público.

El complemento privado Farmétrica Demo utiliza auth=none y puede apuntarse al MCP.
La activación en ChatGPT depende de las funcionalidades disponibles en la cuenta
y su interfaz; eliminar la autenticación no asegura que el cliente admita MCP.
