# Catálogo semántico de Farmétrica para consultas por IA

El usuario autorizado genera en **Clientes → Enlace temporal de consultas IA** un vínculo de
solo lectura. La validez se elige entre **24 horas, 7 días, 30 días, 365 días o sin caducidad**.
El enlace continúa siendo una credencial de tipo bearer: cualquiera que lo conozca accede
a los indicadores comerciales del cliente hasta que venza o se revoque. Generar otro enlace
invalida el anterior, pues el sistema conserva solo una credencial de lectura activa.

No se permite que una IA ejecute SQL arbitrario. El catálogo JSON en
`https://farmetrica.com/api/consulta-temporal/<TOKEN>?formato=json`
publica las **fuentes, dimensiones, métricas y filtros permitidos**. Una IA construye
una consulta semántica, por ejemplo:

```json
{
 "fuente": "ventas",
 "agrupar": ["farmacia", "vendedor"],
 "metricas": ["importe", "unidades"],
 "periodo": "hoy",
 "ordenar": {"campo": "importe", "direccion": "desc"},
 "limite": 30
}
```

Para ejecutarla vía GET:

```text
https://farmetrica.com/api/consulta-temporal/<TOKEN>?consulta=<JSON_URLENCODED>&formato=json
```

Los parámetros son combinables, sin herramientas rígidas por pregunta:
- **Fuentes:** ventas, compras y stock actual.
- **Dimensiones:** farmacia, vendedor, producto, código nacional, familia, proveedor,
  día, mes y año, si son compatibles con la fuente.
- **Medidas:** importes, unidades, movimientos, margen estimado (no contable), coste
  unitario medio, unidades y valor de stock, ventas en 90 días y días de cobertura.
- **Fechas:** intervalos `desde`-`hasta`, hoy, ayer, semanas, meses, años o
  `historico`, siempre sujetos al plazo máximo de ejecución.
- **Filtros:** farmacia(s) autorizada(s), producto, vendedor, proveedor, estado de stock.

El backend genera SELECT parametrizados con joins fijos al cliente y sus farmacias,
usa transacciones READ ONLY, un presupuesto máximo de ejecución de 12 segundos y
un máximo de 100 filas por petición. No devuelve pacientes, recetas individuales ni
SQL bruto. Los datos de costes incompletos se identifican expresamente y los
márgenes son estimaciones (PMC actual vs. venta neta); no margen contable real.

**Límites relevantes:** la IA de ChatGPT Plus debe ser capaz de abrir la URL temporal
y derivar la consulta estructurada desde el catálogo. Esta implementación no instala
un conector MCP ni garantiza invocaciones automáticas desde todas las interfaces.
Preguntas que requieran fuentes fuera de ventas, compras y stock deberán esperar
la ampliación de un catálogo auditado; no se responde con columnas imaginadas.


## MCP para preguntas libres

Tanto `/api/mcp` como `/api/mcp-demo` publican las mismas herramientas semánticas,
además de las herramientas analíticas clásicas:

- `listar_contexto`: farmacias y módulos permitidos.
- `catalogo_semantico`: tablas semánticas, dimensiones, métricas, sus límites y ejemplos.
- `consultar_semantica`: recibe una combinación válida de esos elementos y devuelve
  filas verificadas de PostgreSQL.

El modelo de IA interpreta la pregunta libre del usuario y **construye él mismo**
el plan JSON según el catálogo. La API no requiere rutas por farmacia, período ni
tipo de análisis. Una misma herramienta resuelve vendedores de hoy, artículos de
julio pasado, tendencias históricas por mes o referencias con riesgo de falta de stock.

Este servidor no incluye un modelo propio que traduzca texto libre a SQL;
esa responsabilidad corresponde al cliente con IA que consume MCP. Las consultas
del MCP requieren OAuth. El acceso por enlace es distinto: expone el catálogo
y una URL genérica `?consulta=<JSON_URLENCODED>&formato=json`, no convierte por sí
mismo cualquier frase en una consulta. Si el cliente ChatGPT no soporta llamadas
a herramientas MCP o no puede seguir URL parametrizadas, el servidor por sí solo
no suprime esa limitación.

Solo se autorizan los datos comerciales identificados en el catálogo (ventas,
compras, stock). No se promete responder preguntas sobre tablas ajenas ni datos
no contrastados; ampliar fuentes requiere auditar y añadir su modelo semántico.


## Una única URL temporal, sin IA en el servidor

La IA **es ChatGPT**. Al abrir la URL temporal raíz,
Farmétrica entrega el contrato `AGENTS.md` **integrado en el propio HTML**, además de:

- `<URL_TEMPORAL>/AGENTS.md`: mismo modelo de lectura en Markdown.
- `<URL_TEMPORAL>?modelo=json`: modelo estructurado con las tablas comerciales
  autorizadas, relaciones, columnas, fórmulas, farmacias y el JSON Schema de consulta.
- `<URL_TEMPORAL>?consulta=<JSON_CODIFICADO>&formato=json`: consulta genérica.
- `<URL_TEMPORAL>?fuente=ventas&agrupar=farmacia,vendedor&metricas=importe,unidades&periodo=hoy&farmacia=Abadía&formato=json`:
  la misma consulta genérica con parámetros GET fáciles de generar. El nombre Abadía
  se resuelve a ID de farmacia de forma autorizada.

No hay otro modelo de IA ni rutas especiales por informe. ChatGPT interpreta la
petición, elige dimensiones/métricas y utiliza la API que devuelve cifras
de PostgreSQL. La API nunca acepta SQL enviado por el usuario.

**Contrato limitado a lectura comercial auditada:** actualmente ventas, compras y
stock; no se publica el esquema completo ni se habilita acceso a otras tablas,
datos personales, recetas o pacientes. Al ampliar las fuentes del motor se debe
ampliar el contrato y sus pruebas simultáneamente.

**Limitación de la herramienta de navegación de ChatGPT:** aunque el servidor
sirva correctamente el catálogo, el navegador de algunas interfaces de ChatGPT
puede bloquear URL con parámetros construidas dinámicamente. Publicar un
`AGENTS.md` no concede capacidades de navegación ni permisos MCP por sí mismo.
Las consultas completas requieren que el cliente pueda seguir las URL GET del
contrato o que conecte el MCP compatible.
