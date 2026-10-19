# Catálogos comerciales: proveedores y vendedores

## Resultado en FM

La aplicación muestra los **nombres** en vez de IDs en informes de compras y proveedores, albaranes, devoluciones, tickets, comparativas de genéricos y el preparador de pedidos. El identificador técnico de origen se conserva de forma separada para conciliación, exportación y cruces con el ERP.

El servicio de nombres `api/src/commercialNames.js` es de lectura:

1. Busca `cliente.schema.proveedores` o `cliente.schema.vendedores` por **farmacia + origen_id**.
2. Para proveedores que todavía no figuran en la fuente, consulta `farmetrica.proveedores_maestro` del mismo cliente. El catálogo antiguo `proveedores(id,nombre)` sin farmacia solo se admite cuando el cliente tiene una única farmacia: de otro modo el mismo código puede significar proveedores distintos.
3. Si aún no hay nombre, muestra **el código ERP original**. Nunca atribuye el nombre de otra farmacia ni crea nombres ficticios.

Todos los accesos están protegidos por cliente autenticado y `allowedPharmacyIds`. Los IDs `12` o `3` de dos farmacias no se consideran globales.

## Sincronización del maestro de vendedores

El flujo `vendedores` ya está definido en `integrations/farmetrica-sync`, con `origen_id`, `nombre`, `tipo`, `color_ventas`. En Farmatic, `origen_id` corresponde a `IDVENDEDOR`. Las ventas completas exponen `fm_ventas_analitica.vendedor_id`, procedente de `Venta.XVend_IdVendedor`.

Cuando llegue el maestro a la tabla `<esquema_cliente>.vendedores` con `farmacia_codigo` y `origen_id`, **el nombre aparece automáticamente en tickets y líneas promocionales en la siguiente consulta**. No es necesario un nuevo despliegue. Si existen nombres repetidos, no se deduplican: se conserva la relación con cada ID y farmacia.

No se utiliza `NOMBRE` para reconciliar tickets; solo se muestra.

## Proveedores, compras y pedidos

El flujo sincronizado `proveedores` ya está definido, con `origen_id` y `nombre`. Las recepciones completas incluyen `proveedor_id` a partir de la cabecera documental. Una recepción sigue siendo una recepción aunque contenga varias líneas.

El preparador obtiene el catálogo mediante `GET /api/analytics/catalogos/proveedores?farmacia=<id>` (sesión verificada y farmacia autorizada). La interfaz usa los nombres para mostrar y sugerir; las asignaciones mantienen su `proveedor` original para exportar posteriormente al ERP.

Los checks **Cooperativa** e **Ignorar en informes** siguen siendo independientes de la visualización del nombre. El resolver nunca modifica su valor ni los importes.

## Verificación

- Pruebas unitarias e integración PostgreSQL con dos farmacias que comparten un código de proveedor y de vendedor pero tienen nombres diferentes.
- Verificación de acceso denegado a farmacias ajenas y de ausencia temporal del maestro.
- Prueba visual Playwright de nombres en Tickets y Devoluciones.
- **SQL nuevo:** no. **Actualizar análisis:** no. No hay cambios de migraciones ni reimportaciones.

En el informe por proveedor, los totales y la exclusión se siguen agrupando por **código y farmacia**, no por texto del nombre. Así no se mezclan proveedores homónimos.
