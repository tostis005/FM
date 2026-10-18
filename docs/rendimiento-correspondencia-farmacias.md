# Auditoría de códigos de farmacia e índices · 18/10/2026

## Hallazgo en la base PostgreSQL de producción

Se consultaron **metadatos y estadísticas** (sin acceder a tickets ni datos personales) del esquema `ampedia`:

| Farmacia (ID) | Código en el maestro previo | Código observado en tablas operativas |
|---|---|---|
| Abadía (1) | `ABA` | `ABA` |
| Europa (2) | `EUR` | `EUR` |
| Buenavista (3) | `BUE` | `BUE` |
| Estación (4) | `EST` | `EST` |
| Valdemarías (5) | `POL` **código público** | `VAL` **código real del sincronizador** |

`pg_stats` detecta `VAL` en `ampedia.ventas`, `ampedia.articulos` y `ampedia.proveedores`. **No se modifican las tablas maestras** ni los identificadores de usuario: Valdemarías conserva `POL` como código visible y Farmétrica resuelve explícitamente `VAL` como código del sincronizador para el cliente `ampedia`, farmacia 5. Esto corrige los cruces sin alterar registros ni otros clientes.

**Cobertura de datos:** las estadísticas actuales de `ampedia.compras` solo incluyen `ABA`; no debe interpretarse la ausencia de compras en Valdemarías como fallo de código ni inventarse compras. La tabla `public.stock_farmacia` no tiene filas de existencias para ninguna de las cinco farmacias; las pantallas de stock y reposición deben seguir mostrando ausencia de instantánea.

## Causa de las búsquedas lentas

La auditoría del catálogo `pg_index` confirmó que `ampedia.ventas`, `ampedia.compras`, `ampedia.articulos` y `ampedia.proveedores` tenían únicamente sus índices primarios. No existían índices por **fecha, farmacia normalizada, artículo y proveedor**. Una agrupación exhaustiva de fuentes superó un timeout de 110 segundos. No implica que una consulta individual siempre tarde 110 segundos, pero es una señal inequívoca de que hay recorridos masivos costosos.

El SQL `ops/indices-consultas-operativas.sql` crea seis índices B-tree **CONCURRENTLY**, sin bloquear las altas de las sincronizaciones. Las claves funcionales reproducen `upper(btrim(farmacia_codigo))` usado por la API (un índice simple sobre `farmacia_codigo` no cubriría igual ese filtro):

1. Ventas: (farmacia normalizada, fecha DESC).
2. Artículos: (farmacia normalizada, ID de origen, sincronizado_en DESC) para los LATERAL del catálogo.
3. Compras: (farmacia normalizada, fecha DESC).
4. Proveedores: (farmacia normalizada, ID de origen, sincronizado_en DESC).
5. Ventas: (farmacia normalizada, ID de artículo sin espacios, fecha DESC) para detalle y campañas.
6. Compras: (farmacia normalizada, ID de artículo, fecha DESC) para histórico de precios.

El script reanaliza estadísticas del optimizador tras crear los índices. Debido al tamaño de las tablas, se ejecuta desde el workflow `optimizar-indices-operativos.yml` **solo después de que el despliegue principal termine correctamente**. Se realiza en una conexión independiente y sin `--single-transaction` (prohibido con CREATE INDEX CONCURRENTLY). Si los seis ya están instalados y validados, no vuelve a construirlos ni a analizar las tablas en despliegues siguientes. Ante una interrupción puede ser necesario comprobar/reparar un índice invalidado antes de reejecutar; no eliminar tablas ni indices de clave primaria.

## Comprobaciones de aceptación

- `farmetrica.farmacias` y `public.farmacias`: el ID 5 conserva el código público `POL`, pero el contexto de Farmétrica informa `databaseCode=VAL`.
- Filtrar `ventas` por ID 5 devuelve exclusivamente líneas sincronizadas con `farmacia_codigo='VAL'`.
- `pg_index.indisvalid=true` e `indisready=true` para los seis índices con prefijo `fm_`.
- PostgreSQL CI prueba de forma repetible los índices operativos, simula movimientos de `VAL` y comprueba que las ventas se asignan a la farmacia 5 sin mezclar códigos públicos con códigos de datos.
- La mejora exacta de latencia debe medirse sobre consultas y períodos equivalentes; no se garantiza un tiempo específico sin un benchmark posterior.
