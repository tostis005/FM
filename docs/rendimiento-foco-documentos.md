# Rendimiento y actualización de informes — modelo documental

## Comportamiento al recuperar el foco

Las pantallas de informes (`ModuloDemo`) y genéricos (`Genericos`) conservan los datos, filtros, selección y scroll cuando se abandona y recupera la pestaña. Se elimina el disparador `visibilitychange`: no vuelve a montar el contenido ni solicita todos los datos al recibir el foco.

Se mantiene:
- Consulta inicial al abrir un informe o cambiar filtros, farmacia, cliente o periodo.
- Botón **Actualizar** para obtener cifras nuevas voluntariamente.
- Actualización cada cinco minutos **solo mientras la pestaña está visible**. Volver a ella no genera una actualización inmediata.

## Índices de ventas y recepciones completas

Las consultas filtran cabeceras por farmacia normalizada (`upper(btrim(farmacia_codigo))`), fecha y estado de completitud. Las cuatro tablas reales son `fm_ventas_cabeceras`, `fm_ventas_lineas`, `fm_recepciones_cabeceras` y `fm_recepciones_lineas`, siempre por esquema de cliente. Las vistas analíticas unen cabeceras y líneas por la clave documental.

`ops/indices-documentales-concurrentes.sql` crea, por cada esquema de cliente registrado que dispone del modelo:

- `fm_doc_ventas_codigo_fecha_idx` en cabeceras de ventas: farmacia normalizada, fecha descendente, sistema de origen y documento; índice parcial de cabeceras completas y no eliminadas.
- `fm_doc_recepciones_codigo_fecha_idx` con el mismo criterio en cabeceras de recepciones.

**No se duplican índices de líneas:** sus claves primarias ya cubren la unión `(farmacia_codigo, sistema_origen, documento_id)`, y `016_modelo_documental.sql` ya crea índices por farmacia y artículo en ambas tablas de líneas.

La creación es **CONCURRENTLY**, fuera de transacciones de migración de arranque: no bloquea `INSERT/UPDATE` del sincronizador. El workflow `optimizar-indices-documentales.yml` corre tras un despliegue correcto de `main` y puede ejecutarse manualmente. Comprueba índices válidos, reintenta bloqueos transitorios y limpia solo índices parciales inválidos con esos dos nombres. Si ya están válidos, evita reconstruirlos.

## Comprobación y límites

- CI aplica el script dos veces sobre PostgreSQL de pruebas y verifica `pg_index.indisvalid` / `indisready`.
- El script ejecuta `ANALYZE` **solo en las dos cabeceras documentales**, una vez que instala índices nuevos.
- El beneficio en producción depende del tamaño de las tablas, el volumen por farmacia, la selectividad de las fechas y los planes de ejecución. Si alguna consulta continúa lenta, revisar `EXPLAIN (ANALYZE, BUFFERS)` en una ventana controlada, sin asumir mejoras de tiempo no medidas.
- No se modifican los movimientos existentes, los importes, la sincronización ni las tablas antiguas.

**SQL nuevo:** archivo operativo concurrente, no migración transaccional ni cambio de esquema de datos. **Actualizar análisis:** no se reprocesan ventas ni recepciones; solo se actualizan las estadísticas del planificador.
