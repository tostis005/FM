# Analítica operativa de Farmétrica · contrato real de Ampedia

## Origen confirmado en producción (18 octubre 2026)

Los reportes consultan PostgreSQL por el contexto autenticado del cliente. El origen de datos de Ampedia incluye:

| Tabla | Identificadores / fechas | Valores útiles |
|---|---|---|
| `ampedia.articulos` | `farmacia_codigo`, `origen_id`, `codigo_nacional` | `nombre`, `familia`, `laboratorio`, `pvp`, `puc`, `pmc` |
| `ampedia.ventas` | `farmacia_codigo`, `articulo_id`, `fecha` | `unidades`, `importe` |
| `ampedia.compras` | `farmacia_codigo`, `articulo_id`, `proveedor_id`, `fecha` | `unidades`, `coste_unitario`, `importe`, `proveedor_nombre` |
| `ampedia.proveedores` | `farmacia_codigo`, `origen_id` | `nombre` |

**Atención:** no existen los campos `farmacia_id`, `producto_id` o `puc` en `ampedia.compras`. Es erróneo consultar las tablas como si fueran el contrato de aprovisionamiento genérico de clientes nuevos. La relación correcta usa código de farmacia de origen + ID de artículo/proveedor.

Los códigos nacionales para el Nomenclátor se recuperan con `articulos.codigo_nacional`; cuando falta, solo puede usarse `articulo_id` si coincide directamente con un CN. Nunca se interpreta automáticamente cualquier ID de ERP como un CN.

## API de informes

`GET /api/analytics/reportes?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&modulo=compras&farmacias=1,2`:

- Requiere sesión, contexto de cliente, módulo y farmacias autorizadas en **servidor**.
- Fecha máxima: 366 días; devuelve agregados sin tickets ni clientes particulares.
- Los totales mensuales se calculan sobre **todos** los movimientos del período. Las tablas se limitan a 3.000 filas y muestran aviso si se ha alcanzado el límite.
- La compra observada de artículo/proveedor se calcula por `sum(unidades positivas × coste_unitario positivo) / sum(unidades positivas con coste válido)`; el gasto de factura proviene del `importe` sincronizado y se informa por separado.
- Las ventas se basan en importe real. El margen **estimado** usa coste medio ponderado de compras observadas del artículo y farmacia en el período, o el PMC registrado en artículos cuando no hay compras utilizables. Cuando la cobertura no es completa, el total del margen se deja desconocido, nunca se supone cero.
- Los reportes de stock usan únicamente la instantánea real `public.stock_farmacia` **para Ampedia**, y solo cuando tiene fecha de importación de las últimas 48 horas. La tabla actual `ampedia.articulos` no contiene unidades de stock, por lo que no debe afirmarse que se disponen de existencias actuales por el mero hecho de tener artículos. Cobertura y reposición son estimaciones basadas en ventas históricas con instantánea válida.

## Genéricos y precios de referencia

El catálogo AEMPS `farmetrica.nomenclator_presentaciones` une los CN de **un mismo DCPF** (principio activo, dosis, forma y envase). Puede haber varios CN y laboratorios dentro de un conjunto.

`GET /api/genericos/reales` y `GET /api/genericos/reales/:dcpf`:

- Suman ventas netas y compras por conjunto, farmacia, CN y proveedor (sin cruzar información de otra farmacia).
- **PUC real medio** del período seleccionado: ponderado por las unidades con coste válido.
- **PVP medio**: ponderado por las unidades compradas de referencias con PVP válido. **Margen PVP bruto** = (PVP medio − PUC medio) / PVP medio. No es beneficio neto ni descuenta impuestos, tarifas o otros gastos.
- **Margen estimado de ventas**: ventas reales menos unidades vendidas por el PUC medio observado del mismo DCPF y farmacia, solo donde existe cobertura de compras.
- **Ahorro potencial**: para cada línea agregada de compra del período se compara su PUC real ponderado con el menor precio de referencia disponible para una presentación equivalente del mismo DCPF **en esa farmacia**; `max(0,PUC_real − PUC_referencia) × unidades con coste válido`. Es una oportunidad orientativa, no un ahorro conseguido ni un precio comercial vigente.

En `Ajustes → Precios de referencia para genéricos`, el administrador de cliente o superadministrador configura una política global y opcionalmente excepciones por farmacia (persistidas en `farmetrica.politica_precios`):

- Percentiles permitidos: 10, 20, 25, 30, 40, 50.
- Ventana histórica: últimos 3, 6 o 12 meses, contados hacia atrás desde el final del período seleccionado.
- **Definición precisa**: el precio de referencia de un *proveedor + CN + farmacia* es la media ponderada de las unidades de compra más baratas que suman el percentil elegido de todas las unidades compradas a ese proveedor para ese CN dentro de la ventana histórica. Las líneas sin precio positivo o unidades positivas no se utilizan.
- Se requieren al menos **tres líneas de compra válidas** para atribuir un precio histórico de referencia a esa combinación. Una compra aislada no sirve para recomendar un cambio de proveedor.
- Las excepciones de farmacia prevalecen sobre la política general; los filtros de usuario nunca permiten consultar otras farmacias.
- La política de referencia **no altera** el coste contable observado, el histórico de compras, los importes de venta ni los precios guardados de origen.

## Límites y validación

La base de artículos confirmada no tiene campo de unidades de stock y el acceso a las compras puede ser parcial por fechas o por CN. El sistema no debe crear márgenes, precios, inventario o ahorros ficticios para rellenar KPI vacíos. No se deben usar los antiguos generadores `businessDemoData` en módulos de producción.

La integración se prueba con PostgreSQL 16 en `api/src/integrationLiveReports.test.js`, una base temporal, datos sintéticos exclusivamente en CI y comprobaciones de permisos y políticas en `api/src/realReports.test.js` y `api/src/pricePolicy.test.js`.
