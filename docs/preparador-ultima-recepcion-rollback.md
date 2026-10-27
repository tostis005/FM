# Preparador de pedidos · modo «Última recepción» (reversible)

Este ajuste **no modifica el histórico**, el maestro ni los pedidos guardados. La regla se aplica al construir la lista de laboratorios y el catálogo de CN.

La pertenencia de un CN se calcula entre las farmacias del cliente, descartando antes las recepciones de cooperativas, mayoristas, proveedores no clasificados e ignorados. Gana la recepción positiva y completa más reciente (fecha de documento; empate determinista por farmacia, sistema, documento y línea). El CN solo aparece en el laboratorio ganador. Un laboratorio sin CN ganador no aparece en el selector.

Para un despliegue normal, el valor de `FM_PREPARADOR_ULTIMA_RECEPCION` es `0` en el despliegue de comprobación; debe activarse expresamente a `1` después de verificar la auditoría. Para volver al comportamiento anterior sin revertir la base de datos:

1. Establecer `FM_PREPARADOR_ULTIMA_RECEPCION=0` en `/opt/farmawao/.env` en el VPS.
2. En `/opt/farmawao`, ejecutar `docker compose -f compose.yaml -f compose.farmacias.yml up -d --no-deps --force-recreate api`.
3. Refrescar el preparador. Las consultas vuelven a ser históricas; se conservan documentos, artículos y borradores.

Para reactivar la asignación única, utilizar `FM_PREPARADOR_ULTIMA_RECEPCION=1` y recrear únicamente `api` de igual manera.

La consulta utiliza una caché aislada por cliente y selección de farmacias, con vencimiento de 120 segundos. Los cambios manuales en las identidades unificadas invalidan esta caché. Un fallo en la consulta **no** habilita silenciosamente el modo histórico: devuelve un error para evitar asignaciones incorrectas.

Si fuera necesario revertir también el código, se puede revertir el commit correspondiente en GitHub; no hay migración de datos que deshacer.
