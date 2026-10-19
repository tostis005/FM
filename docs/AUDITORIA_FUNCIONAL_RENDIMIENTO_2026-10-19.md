# Auditoría funcional y de rendimiento · Farmétrica · 19/10/2026

## Alcance y límites
Revisión de navegación, estados de carga, selectores, endpoints de la API, fuentes SQL
de los informes, regresiones funcionales, esquema documental, índices y pruebas CI.
La comprobación automatizada de navegador intercepta autenticación y responde con
contratos controlados. Las pruebas de integración usan PostgreSQL con fixture
documental, NO la base de datos privada de producción. No afirmar mediciones
de tiempos reales de farmacia sin una sesión de prueba autorizada y EXPLAIN medido.

## Hallazgos y cambios

1. **Dashboard bloqueante**: Inicio solicitaba simultáneamente `/api/analytics/ventas`
   y `/api/analytics/reportes?modulo=dashboard`, con agregaciones extensas de ventas,
   compras y catálogo de stock. El cargador global dependía de estas llamadas.
   Se sustituyó el arranque por dos resúmenes independientes, sobre fuentes
   definitivas (`/api/analytics/ventas/totales` y
   `/api/analytics/dashboard/compras`). El análisis completo de artículos
   sigue disponible bajo petición explícita. No hay cifras simuladas en producción.
2. **Autenticación condicionada por promociones**: la descarga de promociones
   retrasaba la disponibilidad del usuario en Inicio. El contexto autorizado se
   muestra antes y la reconciliación de campañas se realiza después.
3. **Compras rápidas**: para Inicio se agrupa por mes, no por mes/farmacia/proveedor.
   El listado específico de Compras conserva su detalle y filtro por proveedor.
4. **Espera sin fin**: los fetch analíticos críticos incorporan plazos recuperables.
   Un fallo se muestra y no retiene indefinidamente los skeletons.
5. **KPI ilegibles**: tarjetas con anchos mínimos más generosos y tipografía
   adaptable a cada tarjeta. Se comprueba en Chromium la ausencia de saltos
   de línea, desbordamiento y fuente inferior a 18 px en los dos importes principales.
6. **Unidades de ticket especiales**: importes de líneas documentales sin
   `articulo_id` cuentan en la facturación, no como unidades vendidas.
7. **Compatibilidad**: las compras de estructura antigua, sin claves
   documentales de recepción, no producen una consulta SQL inválida ni
   inventan recuentos de recepciones: la métrica queda indeterminada.

## Mapa de orígenes definitivos

| Pantalla | Ruta principal | Origen / política |
| --- | --- | --- |
| Inicio | `ventas/totales`, `dashboard/compras` | Vistas `fm_ventas_analitica` y `fm_recepciones_analitica`, sin catálogo en el camino rápido |
| Ventas | `ventas/totales`, `ventas/recuento`, `ventas/detalle` | Ventas completas de cabeceras/líneas documentales, costes explícitos cuando existen |
| Compras | `compras/resumen`, `compras/recepciones`, `reportes` | Recepciones completas; no interpreta pedidos pendientes como compras realizadas |
| Stock / Reposición | `reportes` | Instantánea válida de `articulos.stock_actual`, con compatibilidad cuando la fuente principal falta; no inferir inventario de ventas menos compras |
| Proveedores | `reportes`, `catalogos/proveedores` | Recepciones documentales y catálogo/maestro real por farmacia |
| Rentabilidad / Informes / Oportunidades | `reportes` | Ventas, costes y existencia según disponibilidad de origen, dejando `null` sin cobertura |
| Genéricos | `genericos/reales` | Ventas/recepciones documentales y artículos reales, agrupados por DCPF |
| Tickets, devoluciones, histórico documental, recepciones completas | `pantallas/:section` | Cabeceras y líneas reales, con paginación y búsqueda servidor |
| Preparador, traspasos y otras operaciones manuales | `operativa` | Registros operativos de Farmétrica; no se presentan como documentos ERP sincronizados |

Las vistas `fm_ventas_analitica` y `fm_recepciones_analitica` se construyen
en `018_lectura_documental.sql`; exigen documentos completos y excluyen
anulaciones/eliminaciones. Los fallbacks legacy en algunos reportes tienen
alcance de compatibilidad con otros clientes: no equivalen a datos de ejemplo.

## PostgreSQL e índices

El proyecto ya incluye creación concurrente, validación de `indisvalid`/
`indisready` y comprobaciones idempotentes en
`ops/indices-documentales-concurrentes.sql` (2 índices por esquema)
y `ops/indices-consultas-operativas.sql` (6 índices de Ampedia).
Además, los documentos y sus líneas tienen claves primarias para los joins.
Los flujos `optimizar-indices-documentales.yml` y
`optimizar-indices-operativos.yml` verifican los índices en el VPS tras
un despliegue satisfactorio. Una comprobación de existencia no prueba que
todos los planes SQL los usen: requiere `EXPLAIN (ANALYZE, BUFFERS)` sobre
los filtros de la farmacia concreta y sin sobrecargar horarios de operación.

## Comprobaciones CI

- Compilación Vite + tests Node de periodos, correspondencias, resúmenes y costes.
- Integraciones PostgreSQL para vistas/documentos, permisos y reportes.
- Playwright: rutas del sistema, informes documentales, navegación, períodos,
  scroll, anchos responsive y nuevo caso `check-dashboard-audit.mjs`:
  Inicio sin llamadas pesadas automáticas, seis KPI reales, tipografía >=18px
  para los importes, continuidad de Este año entre Inicio/Ventas y consulta
  de detalle sólo al solicitarla.
- Los escenarios de navegador son con API simulada para probar estados
  y contrato. El fixture SQL prueba la consulta real sin datos privados.

## Pendiente de verificación presencial en producción

1. Acceder como usuario autorizado a un cliente de prueba y recorrer
   **todos** los módulos contra sus datos y permisos reales.
2. Medir p50/p95 y tiempo SQL de Inicio, Ventas, Compras, Stock, Genéricos,
   informes de rentabilidad y oportunidades con varios períodos y farmacias.
3. Obtener planes SQL reales y estadísticas `pg_stat_user_indexes` antes
   de crear índices adicionales (evitar costes de escritura innecesarios).
4. Validar cobertura real del stock y coste PMC/PUC por farmacia; la
   ausencia de datos se indica como indisponibilidad, nunca cero ficticio.
