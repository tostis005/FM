# Maestro unificado y agenda de pedidos

## Identidades definitivas
El Maestro de proveedores tiene dos pestañas: proveedores unificados (una identidad real con clasificación y frecuencia únicas) y pendientes de unificar (códigos de Farmatic aún no relacionados). Fusionar varias identidades en una mueve sus alias y registros de planificación. La identidad destino conserva su clase; las originales quedan inactivas y enlazadas para trazabilidad. No se alteran los movimientos de compras ni de ventas. Los borradores originales permanecen recuperables.

## Cobertura global
Ajustes > Cobertura de stock global define un valor por cliente, inicialmente 20 días. El preparador estima unidades usando la demanda de 90 y 365 días, el objetivo común, el stock y los pedidos pendientes. La frecuencia de pedido **no se suma** a la cobertura. No modifica el stock real ni borra políticas operativas anteriores por farmacia.

## Periodicidad y agenda
Cada laboratorio unificado puede estar bajo demanda (sin vencimiento), o planificarse cada 1-10, 14, 21 o 30 días. La agenda consulta solo identidades, fechas y farmacias, sin cargar los artículos hasta elegir Preparar. El seguimiento es por farmacia y se agrupa por laboratorio. La agenda incorpora las farmacias que tienen código vinculado o una confirmación anterior.

Cuando se desconoce el pedido anterior, la fecha se registra manualmente mediante Fecha inicial. No se sustituye por la fecha de última recepción porque recepción y pedido son eventos distintos.

Generar Excel no hace ni confirma un pedido. Marcar pedido realizado registra una fecha, un grupo de farmacias y el usuario que confirma; recalcula la próxima fecha para esas farmacias. El historial permite anular una confirmación errónea sin cambiar los pedidos en Farmatic. Las fechas civiles siguen el calendario Europe/Madrid.

## Migración y reversión
La migración 042_preparador_agenda_y_cobertura.sql añade tablas idempotentes y no altera recepciones ni existencias. Para revertir la presentación, desplegar la versión anterior sin eliminar las nuevas tablas. Las fusiones conservan la identidad origen inactiva y su vínculo fusionado_a; restaurar una fusión requeriría reasignar alias manualmente, recalcular el resumen de recepciones y restaurar las configuraciones si fuera necesario.
