# Farmétrica para ChatGPT Sites — preparación de la integración

**Estado: código preparado en rama de trabajo; Site NO creado, NO publicado y plugin NO instalado.**

Este directorio es independiente de `api/` y `web/`. No modifica la base PostgreSQL
ni el MCP de Farmétrica. Se usará al crear el Site desde ChatGPT **Work > @Sites / @Plugin Creator**.

## Arquitectura

```
ChatGPT Plus (plugin privado)
  -> MCP de ChatGPT Sites (herramientas solo lectura)
     -> mcp-bridge.mjs (HTTPS POST, sin caché, redirecciones prohibidas)
        -> https://farmetrica.com/api/consulta-temporal/mcp
           -> Farmétrica: validación de URL temporal, permisos y tenant
              -> PostgreSQL (consultas parametrizadas, solo lectura)
```

- Se **reutilizan** `leer_modelo_temporal` y `consultar_datos_temporales`.
- ChatGPT interpreta la pregunta y crea el objeto `consulta` según `esquema_consulta`.
- La API de Farmétrica es la autoridad para fecha, permisos, métricas y filas.
- Sites no interpreta lenguaje natural con otra IA ni almacena bases replicadas.
- Sólo `POST` JSON-RPC al MCP fijo de Farmétrica; nunca cargar la URL con token en el navegador.
- Los enlaces con credenciales incluidos en el modelo devuelto por la API se excluyen del resultado del puente.
- No registrar cuerpos de peticiones/respuestas con credenciales, ni almacenar enlaces en código.
- No se utiliza caché de consultas; cada llamada debe llegar al servidor.
- El aislamiento multicliente se valida **en Farmétrica**; al registrar credenciales persistentes
  en Sites se necesitará además almacenamiento **por identidad autenticada del usuario**,
  nunca un secreto global compartido entre clientes.

## Implementación en Sites

1. Abrir **Work**, crear un Site llamado **Farmétrica** y pedir un MCP server con
   herramientas de solo lectura. El Site puede mostrar una página mínima de estado.
2. Integrar `mcp-bridge.mjs` como módulo **exclusivamente servidor** del Site.
3. En el arranque, obtener el esquema de las dos herramientas con
   `listFarmetricaTools()` (o usar el esquema verificado en `api/src/aiShareMcp.js`).
4. Registrar las dos herramientas en el MCP de Sites, cada una con los mismos esquemas,
   y delegar a `callFarmetricaTool(name, args)`.
   Gestionar `FarmetricaBridgeError` devolviendo errores tipados, sin cifras ficticias.
5. Inicialmente el usuario aporta un enlace temporal **una sola vez por conversación**.
   La IA lo remite en los argumentos de la herramienta en cada consulta de esa conversación;
   el Site no debe guardarlo, imprimirlo ni colocarlo en URLs de navegación.
   Para reutilización entre conversaciones, implementar más adelante sesión privada
   autenticada y almacenamiento seguro por usuario, con expiración/revocación.
6. Comprobar que el Site expone un **MCP ejecutable**, no solo una página web.
7. Publicar Site **privado** como propietario, instalar el plugin provisionado por
   Sites y conectarlo. Probar su ejecución **desde otra conversación** de ChatGPT Plus.
8. Verificar uso en móvil; no asumirlo hasta probar en el cliente móvil.

**No duplicar el complemento mediante `create_plugin` si Sites ya provisionó uno.**

## Verificación exigida con Ampedia (sin inventar resultados)

Crear/generar enlace válido en Farmétrica y probar secuencialmente:

| Operación | Plan para consultar_datos_temporales |
|---|---|
| Ventas farmacia 22 oct 2026 | `{"fuente":"ventas","agrupar":["farmacia"],"metricas":["importe"],"desde":"2026-10-22","hasta":"2026-10-22","limite":100}` |
| Ventas farmacia 21 oct 2026 | `{"fuente":"ventas","agrupar":["farmacia"],"metricas":["importe"],"desde":"2026-10-21","hasta":"2026-10-21","limite":100}` |
| Vendedores oct 2026 | `{"fuente":"ventas","agrupar":["farmacia","vendedor"],"metricas":["importe","unidades"],"desde":"2026-10-01","hasta":"2026-10-22","ordenar":{"campo":"importe","direccion":"desc"},"limite":100}` |
| Vendedores año 2026 hasta 22 oct | `{"fuente":"ventas","agrupar":["farmacia","vendedor"],"metricas":["importe","unidades"],"desde":"2026-01-01","hasta":"2026-10-22","ordenar":{"campo":"importe","direccion":"desc"},"limite":100}` |

Para **mes completo**, el límite de octubre es `2026-10-31`. Elegir fecha final
conforme a lo pedido (hasta hoy vs. mes completo), sin mezclar períodos.
Conservar timezone `Europe/Madrid` para los períodos relativos y mostrar rango concreto.

Verificar que cada consulta tiene `origen: "PostgreSQL"`, cliente y farmacias
autorizadas, período exacto y resultado correspondiente; probar A/B/A con períodos
distintos y confirmar que no se reutilizan respuestas. `filas: []` es un resultado
válido (sin datos), no error de conexión.

## Pruebas locales del código de transporte

```bash
node --test sites/farmetrica/mcp-bridge.test.mjs
```

Estas pruebas son unitarias con respuestas sintéticas controladas; **no prueban
datos reales ni validan el despliegue de Sites**. Para dar el objetivo por terminado,
se necesitan pruebas end-to-end desde el plugin ya instalado en ChatGPT Plus.

## Fuentes del backend revisadas

- `api/src/aiShareMcp.js`: transporte JSON-RPC, catálogo de herramientas y permisos.
- `api/src/aiSemanticQuery.js`: gramática estructurada de consultas y métricas.
- `api/src/aiShareContract.js`: descripción semántica del modelo.
- `api/src/aiShareLinks.js`: manejo de enlaces temporales.
- `.github/workflows/verify-temporary-mcp.yml`: comprobación HTTP existente.

Consultar `SITES-PROMPT.md` para la instrucción lista para pegar en Work.
