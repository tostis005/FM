# Unificación conservadora del maestro de laboratorios

Solo se consideran identidades activas y de la misma clase: DIRECTO, VACUNAS o FÓRMULAS. Se excluyen cooperativas, mayoristas y nombres genéricos. Se compara después de normalizar acentos, puntuación, prefijo Laboratorios y formas jurídicas SA, SL, SAU y SLU. No se equiparan nombres por subcadenas ni similitud aproximada.

Si un grupo contiene asociaciones de procedencia manual, se reserva para revisión y no se fusiona.

La auditoría previa es `api/src/auditLaboratoryMerges.mjs`. La fusión se ejecuta una sola vez desde el contenedor API con `FM_LAB_MERGE_ACTION=apply node src/applyLaboratoryMerges.mjs`.

La operación es una transacción con registro persistente del lote, las fichas originales y el destino de cada alias. Mueve únicamente `proveedores_unificados_alias.proveedor_id` y desactiva las fichas redundantes; no cambia ventas, recepciones, artículos, CN ni pedidos.

## Rollback

1. Identificar el valor `batch` que devuelve el mensaje `FM_UNIFICAR_LABORATORIOS`.
2. Ejecutar `FM_LAB_MERGE_ACTION=rollback FM_LAB_MERGE_BATCH_ID=UUID_DEL_LOTE node src/applyLaboratoryMerges.mjs` desde el contenedor API.
3. Reiniciar solo API o esperar hasta dos minutos para descartar la caché.

El rollback restaura las asignaciones originales y el estado activo. Si un alias cambió manualmente después de la unión, se cancela el rollback automático para no revertir decisiones posteriores. La clave única de criterio impide aplicar el mismo conjunto de asociaciones dos veces.