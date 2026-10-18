# Rendimiento de ventas y bloqueos de FarmetricaSync — 18/10/2026

## Situación comprobada en producción

La base de datos real del cliente `ampedia` contiene los seis índices operativos válidos. La API de Farmétrica usa los índices de farmacia y fecha. Sin embargo, se observó una sesión de PostgreSQL cuyo `application_name` es `FarmetricaSync`, con `AccessExclusiveLock` concedido sobre `ampedia.ventas` y estado `idle in transaction`. Ese bloqueo impide `SELECT` incluso cuando el plan de lectura es óptimo.

Comprobación: [auditoría de bloqueos](https://github.com/tostis005/FM/actions/runs/39138286821).

El origen localizado está en el código del servicio Windows `PostgresDestination.WriteAsync`: realizaba `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` dentro de la transacción larga de sincronización. El `ALTER TABLE` requiere bloqueo exclusivo aunque la columna ya exista; dicho bloqueo permanecía hasta que finalizaba toda la importación.

La corrección de la **aplicación web/API** está en este repositorio `FM`: ruta `/api/analytics/ventas/resumen` y `api/src/salesSummary.js`. Los totales, las unidades y los recuentos se agregan en SQL, se usa `f.id=ANY($3::int[])` con farmacias autorizadas, se consulta una vez el mismo conjunto de ventas para el gráfico, los KPI y las referencias y se resuelve el catálogo después de agrupar por artículo ERP. La pantalla de Ventas consume un solo endpoint, sin recalcular el resto de informes.

El código fuente del **servicio Windows** no está en `FM`: su ubicación actual es `tostis005/FARMETRICA-DEMO-PREMIUM/integrations/farmetrica-sync`. Se corrigió allí `PostgresDestination.cs`: los controles de estructura se ejecutan antes de comenzar la transacción de importación, y las columnas existentes no generan ALTER. La atomicidad de los datos de cada trabajo se conserva.

**Importante:** el servicio Windows ya instalado sigue ejecutando su binario anterior hasta su actualización. Ninguna modificación de la API puede liberar por sí misma el bloqueo exclusivo que mantiene el proceso anterior. Debe actualizarse `FarmetricaSync` con la publicación Windows del commit correctivo; hacerlo sin interrumpir una carga en curso y conservando la configuración/copia de seguridad de `%ProgramData%\FarmetricaSync`.

## Comparación medida, tres meses

Benchmarks de solo lectura, mismo PostgreSQL y período (18/07 al 18/10/2026), sin extraer tickets:

| Ámbito | Primera versión unificada | Agrupación antes de catálogo |
|---|---:|---:|
| Abadía | 1427 ms | 951 ms |
| Valdemarías | 913 ms | 716 ms |
| Red (5 farmacias) | 3646 ms | 2461 ms |

Los tiempos varían con la contención y no son tiempos de renderizado del navegador. Se produjeron intentos fallidos por `55P03` (bloqueo PostgreSQL) durante las mediciones, lo que hace necesario también desplegar el fix del servicio Windows.

[Pruebas de benchmark](https://github.com/tostis005/FM/actions/runs/39137696042) · [despliegue de API](https://github.com/tostis005/FM/actions/runs/39138063808).

## Comprobación de bloqueo sin acceder a tickets

```sql
SELECT l.pid,l.mode,l.granted,a.application_name,a.state,
       a.wait_event_type,a.wait_event
FROM pg_locks l LEFT JOIN pg_stat_activity a ON a.pid=l.pid
WHERE l.relation=to_regclass('ampedia.ventas')
ORDER BY l.granted,l.mode;
```

No debe deshabilitarse el sincronizador sin una intervención coordinada ni matar su sesión mientras haya una importación activa: la transacción en curso podría abortarse. Después de actualizar el binario, repetir la comprobación y una prueba de los mismos filtros en la web.
