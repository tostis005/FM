# Auditoría transversal de diseño y rendimiento · 28/10/2026

## Alcance y grado de comprobación

Inspección estática del frontend React/Vite, rutas analíticas y servicios PostgreSQL del repositorio FM. Se han revisado las rutas de carga comunes, Inicio, Ventas, Compras, catálogos, pantallas documentales y Preparador. No se ha navegado con una sesión de farmacia real ni se han ejecutado consultas sobre producción. **No se deben atribuir mejoras de milisegundos ni afirmar uniformidad visual demostrada** hasta completar las mediciones Playwright/Lighthouse y SQL en entorno autorizado.

## Diseño transversal

- **Base común existente:** `web/src/main.jsx` importa `styles.css`, `loginTheme.css` y `settingsLayout.css` en la entrada; `ReportPageHeader`, `ReportFilterBar`, `LoadingState`, `ListTable` y los componentes de tabla permiten una línea visual unificada.
- **Oportunidad comprobable:** `styles.css` contiene numerosas reglas globales y `loginTheme.css` sobrescribe dimensiones y colores globales (`.main-content`, `body`, botones). Otros módulos importan su CSS al cargar componentes `React.lazy`. El orden de aplicación y las diferencias de selector requieren una auditoría de estilos computados antes de retirar reglas. No se propone eliminar CSS a ciegas.
- **Variantes a normalizar después de comparar pantallas:** alturas y radios de controles (7, 8, 10 px), márgenes de cabeceras, tablas con mucho dato, tonos de verde y estados de carga. Extraer tokens de superficie, borde, espaciado y tipografía; migrar por componentes compartidos sin variar el comportamiento.
- **Arranque:** `web/index.html` ya incorpora una pantalla crítica de inicio con el mismo marcado de `StartupScreen`, para evitar pantalla blanca; la revisión funcional debe medir el salto entre primer HTML, React y carga de contexto/selector de farmacia.
- **Comprobaciones visuales recomendadas:** capturas y comparación de Inicio, Ventas, Compras, Stock, Reposición, Preparador, Proveedores, Genéricos, Promociones, Ajustes y pantallas documentales en 1440, 1024, 768 y 390 px; estados vacío, error, cargando, datos voluminosos, diálogos y teclado. Revisar específicamente CLS y tamaños de tablas/filtros.

## Rendimiento y consultas

| Área | Estado observado en código | Próximo control |
| --- | --- | --- |
| Inicio | Separación de totales ligeros y detalle de catálogo bajo demanda. Consolidados mensuales (038) y diarios (039). | Verificar que las tablas están rellenadas; monitorizar aciertos, pendientes y fallback. |
| Históricos con fechas parciales | Antes, los rangos mensuales que no empezaban el día 1 o no terminaban a fin de mes descartaban los agregados. | Este cambio divide en meses cerrados de caché y hasta dos extremos en vivo, con tests de límites y disponibilidad. |
| Ventas / Compras | Totales y tablas detalladas separados; los históricos largos se fragmentan en años (`historicalSummaries.js`). | Medir y cotejar paridad antes de reutilizar consolidados del dashboard en otras pantallas: los detalles y el número de proveedores no son directamente aditivos. |
| Preparador: selector | Caché de opciones por cliente/farmacias, 120 s, consultas concurrentes compartidas e invalidación al editar maestro. | Medir p50/p95 del endpoint y tasa de aciertos. No aumentar TTL sin verificar invalidación. |
| Preparador: artículos | Catálogo unificado en una llamada, fallback paginado y pequeña caché de navegación en la vista. | Medir tamaño de respuesta, transferencia y tiempo total por laboratorio representativo. |
| Preparador: stock/ventas/sugerencias | SQL conjunto para venta de periodo/3m/12m, stock y pedidos pendientes; fallback por bloques de 200 referencias. Índices especializados existentes. | Ejecutar `EXPLAIN (ANALYZE, BUFFERS)` controlado para 200 y N referencias; analizar fecha, farmacia y artículo. |
| Pantallas documentales | Paginación de servidor y búsqueda con retraso de 320 ms; carga de líneas bajo demanda. | Medir recuentos, desplazamiento y paginación a grandes volúmenes. |
| Stock y Genéricos | Servicios y pruebas específicas; índices ya introducidos para algunas consultas. | Revisar planes reales antes de incorporar índices redundantes o resúmenes que pierdan granularidad. |

## Exactitud, seguridad y mantenimiento

1. Los sumatorios de importes, unidades, devoluciones y cobertura de costes deben preservar la semántica de documentos válidos en cada fuente. Si falta una fila consolidada, **no presentar cero**: usar el cálculo original.
2. Los consolidados cerrados se regeneran para los dos meses anteriores en el trabajo nocturno; una sincronización tardía que modifique meses aún más antiguos exige detectar los meses afectados y reabrir su consolidación. Pendiente de revisar contra el sincronizador real.
3. El filtro de farmacia debe aplicarse tanto a la consulta de consolidados como a los tramos en vivo, siempre con permisos del cliente. El endpoint ya valida el alcance autorizado.
4. No crear índices adicionales por intuición. Obtener `EXPLAIN (ANALYZE, BUFFERS)`, cardinalidades, latencia p50/p95 y estadísticas de uso antes de intervenir. Mantener un rollback y comparar resultados antes/después.
5. No precalcular tablas de detalle de artículos si solo se requieren totales de Inicio; conservar la opción de ver la fuente original para informes filtrados por producto/proveedor.

## Mejoras adicionales preparadas en la rama

- **Preparador, selector real:** se confirma que la pantalla usa `pedidos/proveedores-unificados`; ahora ese endpoint reutiliza una caché de opciones independiente por cliente y farmacias (TTL 120 s). Se invalida inmediatamente al importar, crear, editar o vincular proveedores, sin interferir con el catálogo legado. El precálculo de últimas recepciones ya tenía otra caché propia.
- **Preparador, consultas de metadatos:** la comprobación de la columna ERP `cn_normalizado` pasa a compartirse entre catálogo y matriz en una caché por conexión/esquema, con vencimiento de 5 minutos, consultas simultáneas deduplicadas y reintento tras un error. En el catálogo se resuelve en paralelo con las exclusiones de artículos.
- **Consistencia visual:** se incorpora `--fm-control-radius` en el tema que ya se carga con el arranque y se reutiliza en controles de Documentos, Genéricos, Compras/Reposición, Operativa y Preparador. No se altera la geometría de gráficos, tarjetas ni las fórmulas de informes.
- **Regresión de CI:** se añaden pruebas del caché de metadatos . Al reducir una consulta redundante, se ha actualizado el recuento esperado en la prueba de matriz.

## Validación y despliegue

- Ejecutar en CI tests `dashboardConsolidations.test.js`, `dashboardDailyService.test.js`, `dashboardConsolidations.pg.test.js`, compilación del frontend y las comprobaciones de navegación existentes.
- Probar periodos: año cerrado, mes cerrado, mes actual, último trimestre, 17/09/2025–17/10/2026, un único mes parcial, sin farmacia autorizada y mes consolidado ausente. Comparar cifras con las consultas directas en un cliente de prueba.
- Verificar que el backfill mensual existente ha cubierto toda la historia consultada; una rama de código no rellena por sí sola los consolidados.
- Registrar latencia de red, servidor y SQL; capturar waterfall y CLS en carga en frío y navegación entre módulos.
- El cambio de este PR está aislado en rama. Si se detecta diferencia, se revierte sin migrar ni alterar datos.

### Optimización del acceso frío (sin dependencia de usuarios frecuentes)
En el selector del preparador, la carga de proveedores unificados y la consulta de `última recepción por CN` se ejecutan ahora en paralelo. Son operaciones independientes; solo se aplica el filtro final tras disponer de ambos resultados, manteniendo la prioridad de la recepción histórica más reciente en el conjunto de farmacias del cliente.

El servicio de última recepción registra en servidor tiempo real de misses de caché (estado, milisegundos, cantidad de farmacias y referencias, sin CN ni nombres), para que se pueda distinguir un atasco de SQL de la representación de la tabla. La duración de la caché se mantiene en 120 segundos: no se prolonga sin una política completa de invalidación tras las sincronizaciones.

Al editar exclusiones de artículos se invalidan tanto el resultado de últimas recepciones como la caché del selector, además de la invalidación por cambios en el maestro unificado. No se introducen consultas nuevas en producción ni migraciones SQL en este PR.

### Decisión de interfaz: tabla completa
El preparador conserva **todas las referencias del laboratorio visibles en una sola tabla**, sin tope de 150 filas, carga incremental ni botón «mostrar más», para mantener el modo de revisión equivalente al Excel utilizado por las farmacias. La optimización de metadatos y selector permanece independiente de esta decisión. Una mejora futura de renderizado deberá preservar esta vista completa.
