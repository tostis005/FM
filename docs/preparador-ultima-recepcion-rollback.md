# Preparador de pedidos · modo «Última recepción» (reversible)

Este ajuste **no modifica el histórico**, el maestro ni los pedidos guardados. La regla se aplica al construir la lista de laboratorios y el catálogo de CN.

La pertenencia de un CN se calcula entre las farmacias del cliente, descartando antes las recepciones de cooperativas, mayoristas, proveedores no clasificados e ignorados. Gana la recepción positiva y completa más reciente (fecha de documento; empate determinista por farmacia, sistema, documento y línea). El CN solo aparece en el laboratorio ganador. Un laboratorio sin CN ganador no aparece en el selector.

Para un despliegue normal, el valor de `FM_PREPARADOR_ULTIMA_RECEPCION` es `1` (por defecto). Para volver al comportamiento anterior sin revertir la base de datos:

1. Establecer `FM_PREPARADOR_ULTIMA_RECEPCION=0` en `/opt/farmawao/.env` en el VPS.
2. En `/opt/farmawao`, ejecutar `docker compose -f compose.yaml -f compose.farmacias.yml up -d --no-deps --force-recreate api`.
3. Refrescar el preparador. Las consultas vuelven a ser históricas; se conservan documentos, artículos y borradores.

Para reactivar la asignación única, utilizar `FM_PREPARADOR_ULTIMA_RECEPCION=1` y recrear únicamente `api` de igual manera.

El preparador usa un **snapshot persistente** de la última recepción válida por CN,
con los IDs de farmacias en las que se observó el CN y las farmacias donde
se excluyó. Así, el selector y el catálogo aplican el ámbito autorizado
sin recomputar millones de líneas históricas. La tabla no contiene ventas,
precios ni datos personales. Se actualiza en una transacción atómica y
conserva la versión anterior mientras se reconstruye.

El despliegue crea las tablas con la migración aditiva
`041_preparador_ultima_recepcion_cache.sql` y precalcula el histórico con
`node src/refreshPreparadorLastReceipt.mjs` dentro del contenedor API.
Para forzar una actualización tras una importación, ejecutar el mismo
comando. Los cambios del maestro solicitan un recálculo no bloqueante,
y un snapshot con más de 15 minutos solicita una actualización al
consultarse. No se espera el recálculo durante una petición del selector.
Si todavía no existe un snapshot, se utiliza la consulta exacta anterior
y se registra el origen en logs; el primer acceso puede seguir siendo lento
hasta completar la precarga.

Además existe la caché de proceso de 120 segundos por cliente/farmacia.
Cuando se publica un nuevo snapshot, se invalidan ambas cachés.
Una actualización fallida deja intacto el snapshot anterior y publica
un error en los logs; para diagnósticos se debe comprobar su fecha en
`farmetrica.preparador_ultima_recepcion_estado`.

**Comprobación:**

```sql
SELECT cliente_slug,actualizado_en
FROM farmetrica.preparador_ultima_recepcion_estado;
SELECT cliente_slug,count(*) AS cn
FROM farmetrica.preparador_ultima_recepcion_cache
GROUP BY cliente_slug;
```

El rollback por variable de entorno permanece intacto; ninguna de estas
tablas altera los registros originales.

Si fuera necesario revertir también el código, se puede revertir el commit correspondiente en GitHub; no hay migración de datos que deshacer.
