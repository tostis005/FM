# Modelo común de datos e indicadores · Farmetrica

## Fuentes

Los módulos de análisis utilizan las mismas **cinco tablas operativas** y el catálogo de farmacias autorizado por sesión. En cada esquema PostgreSQL de cliente deberán normalizarse estas entidades:

| Tabla | Campos mínimos | Relación |
|---|---|---|
| `articulos` | `cn`, `descripcion`, `familia`, `pvp`, `generico`, `grupoGenerico` | Clave: CN de seis cifras |
| `ventas` | `id`, `fecha`, `farmaciaId`, `cn`, `unidades`, `importeNeto` | CN + farmacia |
| `compras` | `id`, `fecha`, `farmaciaId`, `cn`, `proveedorId`, `unidades`, `puc`, `total` | CN + farmacia + proveedor |
| `proveedores` | `id`, `nombre`, `tipo` | Proveedor ID |
| `stock` | `farmaciaId`, `cn`, `unidades`, `fecha` | CN + farmacia, última foto |

Las farmacias y sus permisos se obtienen desde el esquema común `farmetrica`. Ni las pantallas ni los usuarios seleccionan esquemas PostgreSQL arbitrarios.

### Cómo se conecta

- `web/src/businessDemoData.js` genera estas cinco tablas **una sola vez por contexto** con registros ficticios coherentes. También incluye `normalizeTables(raw)`, que acepta exactamente el mismo contrato cuando haya datos de producción.
- `web/src/businessAnalytics.js` calcula la misma lógica independientemente del origen. El dashboard y cada módulo reutilizan el mismo resultado.
- `web/src/ModuloDemo.jsx` puede recibir `realTables` normalizadas. Si falta ese origen, utiliza el generador ficticio y muestra una única marca discreta «Datos de ejemplo». Los datos reales **todavía no están conectados a este adaptador**: no mezclar ventas reales con compras/stock ficticios, pues produciría márgenes y potenciales falsos.
- En producción se preparará el endpoint autenticado y paginado/agregado (o vistas normalizadas) con filtros de tenant y farmacias aplicados en servidor. Los datos actuales `ampedia.lineaventa` y `productos` del esquema de aprovisionamiento tienen formatos distintos y necesitan mapearse a las entidades anteriores; no basta con cambiar el nombre de la tabla. Las compras deben referenciar al proveedor y al CN, y los stocks deben ser snapshots fechados.
- Evitar descargar tablas masivas de ventas al navegador: calcular agregados y paginación a nivel de API para clientes de gran volumen.

### Indicadores derivados

- **Ventas**: suma de `ventas.importeNeto` del periodo (incluye devoluciones cuando aparezcan como unidades/importes negativos).
- **Compras**: suma de `compras.total`, y **PUC observado** como media ponderada por unidades.
- **PUC objetivo**: percentil 25 de precios `puc` observados del mismo CN en el periodo seleccionado, solo filas con unidades y PUC positivos. **Potencial de precio** = max(0, PUC observado − objetivo) × unidades positivas; no es ahorro realizado.
- **Proveedor**: sumatorio del gasto y potencial de sus líneas de compras. No atribuir al proveedor las ventas directas.
- **Stock valorado**: unidades del snapshot × coste ponderado observado de compras del mismo CN y farmacia. Si falta coste, el importe es desconocido, no cero.
- **Cobertura y reposición**: demanda diaria media del periodo, stock actual y umbrales operativos de 60 y 15 días respectivamente. Estimaciones, no previsiones clínicas.
- **Margen estimado**: ventas netas menos unidades vendidas × coste ponderado observado del mismo CN y farmacia; informar cobertura de costes.
- **Genéricos**: agrupar por las etiquetas de artículos y CN; no declarar equivalencia o sustitución terapéutica solo por pertenecer a un grupo de demo.
- **Acciones**: compras mejorables, sobrestock y reposición con *tipos de importe distintos*. No sumar coste de reposición como si fuera ahorro.

Los filtros comunes de **farmacias multiselección**, **familias multiselección**, **periodo** y **búsqueda por artículo/CN** afectan simultáneamente a las tablas, los indicadores y las gráficas, y se mantienen al cambiar de módulo. El dashboard enlaza con los módulos autorizados del cliente.

## Pruebas

`node --test web/src/businessAnalytics.test.js` valida integridad referencial, conciliación de importes entre dashboard y módulos, escenarios con una/dos/tres farmacias, filtros, cobertura de costes y modelo sin farmacias. La integración sigue pasando las pruebas responsive automatizadas.
