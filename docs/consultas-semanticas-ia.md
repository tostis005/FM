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
