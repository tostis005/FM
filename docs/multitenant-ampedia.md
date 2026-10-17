# Migración controlada a SaaS multitenant · Ampedia

**ESTADO:** preparado en rama de revisión. **NO supone que producción esté migrada.**

## Alcance

- Esquema `farmetrica`: clientes, farmacias, pertenencia de usuarios a varios clientes, superadministradores y módulos por cliente.
- Cliente inicial `ampedia` (A-M-P-E-D-I-A), cinco farmacias importadas del catálogo de `public`.
- Solo el módulo `promociones` está habilitado inicialmente para Ampedia.
- `jose.fraga@gmail.com`: superadministrador si su cuenta está registrada y activa en `public.acceso_cuentas`. El email no sustituye verificación de identidad.
- Informes futuros: **DEMO**, con cifras inventadas claramente identificadas. **No** se generan datos de compra/stock ficticios en PostgreSQL.

## Orden obligatorio antes de producción

1. Verificar respaldo completo de PostgreSQL y ensayar una restauración.
2. Confirmar que existe y está activa la cuenta `jose.fraga@gmail.com`. Si el correo real es distinto, corregir la identidad de bootstrap y validarlo antes de implantar.
3. En staging, ejecutar `001_farmacias.sql`, `002_accesos.sql` y `003_multitenant.sql` en ese orden. El arranque de la API actualizada aplica las tres primeras migraciones automáticamente, pero esto debe probarse antes del merge a `main`.
4. Comprobar `SELECT slug,nombre,esquema_datos FROM farmetrica.clientes;` (debería aparecer `ampedia / Ampedia / farmatic` hasta la migración física).
5. Comprobar `SELECT modulo_clave, habilitado FROM farmetrica.cliente_modulos WHERE cliente_slug='ampedia';` (solo promociones habilitado).
6. Comprobar `SELECT email FROM farmetrica.superadministradores;` y probar sesión real con la cuenta correcta.
7. Probar acceso sin sesión, superadministrador, administrador del cliente y personal con una sola farmacia. Verificar que no puede accederse por API a otro cliente ni a farmacias ajenas; comprobar exportaciones y vistas.
8. Publicar backend y frontend en un despliegue coordinado, con posibilidad real de rollback. **No fusionar por separado cambios de frontend o API**.
9. Revisar dependencias externas del esquema `farmatic` (Dataflows, Airbyte, DBeaver, SQL de integración, vistas, funciones, procedimientos, copias y monitorización). Cuando estén preparadas, ejecutar de forma **manual** `004_ampedia_cutover_MANUAL.sql` en ventana de mantenimiento. Ese script realiza `ALTER SCHEMA farmatic RENAME TO ampedia` y actualiza el registro del cliente en una única transacción.
10. Verificar conexiones de ventas y permisos, y volver a habilitar los procesos de importación contra `ampedia`.

## Estado y limitaciones conscientes

- Las promociones actuales permanecen en almacenamiento local del navegador; **no son aún persistencia multiusuario/multicliente de producción**. No convertir en acceso compartido para múltiples usuarios de farmacia hasta migrar promociones a API/PostgreSQL y eliminar dependencia de `localStorage`.
- La cuenta de superadministrador se concede por coincidencia exacta en la tabla de cuentas activas; una cuenta inexistente **no se crea por arte de magia**.
- Las pantallas nuevas de compras, proveedores, stock, ventas, reposición, genéricos, rentabilidad, acciones, informes y asistente **no consultan operaciones reales**. Están destinadas a validar experiencia de usuario y modelo de producto.
- Al crear nuevos clientes habrá que automatizar el aprovisionamiento de su esquema y tablas operativas. Esta PR prepara el registro y el control de módulos, no un aprovisionador completo.
- `public.farmacias` y `public.acceso_*` se conservan por compatibilidad. La nueva administración tenant utiliza `farmetrica.farmacias` y `farmetrica.usuario_clientes`. Durante el cutover comprobar ETL dependientes del catálogo antiguo.

## Reversión

El script manual `004` se ejecuta en transacción: un fallo hace rollback sin cambio de nombre. Después del commit, revertir requiere una nueva ventana controlada, apuntar de nuevo los conectores, renombrar `ampedia` a `farmatic` y restaurar el campo `farmetrica.clientes.esquema_datos`. En un incidente mayor, restaurar el backup verificado en un entorno de recuperación.
