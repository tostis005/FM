# Clientes, cuentas internas y demos vinculadas

## Usuarios (sin romper los existentes)

Las cuentas existentes de Google continúan iniciando sesión con una credencial OIDC verificada por Google. El sistema **no** concede acceso a todo correo Gmail por defecto: cada correo debe estar habilitado y asignado a un cliente y farmacias concretos.

Desde **Usuarios → Equipo y permisos**, un administrador del cliente puede crear:
- **Google:** permiso existente para iniciar sesión con la cuenta Google verificada.
- **Interno:** correo identificador y contraseña de al menos 12 caracteres; el servidor guarda únicamente un hash scrypt con sal aleatoria, nunca la contraseña. El usuario entra desde `/login`.

Ambas modalidades comparten el mismo directorio base `public.acceso_cuentas`, membresías `farmetrica.usuario_clientes`, sesiones HttpOnly y permisos por cliente/farmacia. El tipo se guarda en `usuario_clientes.metodo_acceso`, con `google` por defecto para respetar usuarios actuales. Los hashes internos se guardan separados en `farmetrica.credenciales_locales`; los errores de inicio no revelan si existe el usuario. Existe limitación de intentos por correo e IP. Los cambios de membresía invalidan el acceso a dicho cliente en la siguiente petición.

Los usuarios con acceso a varios clientes ven únicamente los que su membresía les permite. El superadministrador puede crear clientes y módulos, pero no debe distribuir contraseñas iniciales por correo no seguro. El administrador establece la clave en persona o mediante un canal seguro.

## Clientes demo privados

**Clientes → Nuevo cliente → Datos del cliente → Demo enlazada a …** crea un nuevo slug, un esquema SQL propio de vistas **no actualizables**, y un maestro de farmacias con alias («Farmacia Demo 1», etc.). El esquema demo comparte datos de ventas, compras, artículos y proveedores a través de vistas contra el esquema real; no duplica tablas masivas, ni utiliza caché, ni modifica los movimientos. Los códigos originales de farmacia permanecen en la correspondencia interna para mantener el ámbito del cliente y el rendimiento de sus índices.

Los datos comerciales **no están anonimizados**: importes, productos, precios y proveedores siguen siendo reales. Utilizar esta opción solamente para demos privadas, con personas autorizadas y cláusulas de confidencialidad; **no publicar** estas cuentas como un entorno de prueba abierto. Para una demo pública es necesario un esquema independiente con datos sintéticos.

El demo recibe módulos de consulta, sin promociones activadas inicialmente. La API deniega modificaciones operativas en su esquema; se pueden gestionar sus usuarios, política de análisis y los nombres ficticios de sus farmacias. El identificador del cliente y sus permisos son independientes del origen.

Algunos módulos dependientes de tablas externas al esquema (por ejemplo, una instantánea de stock publicada en `public.stock_farmacia`) pueden necesitar una adaptación adicional para replicar toda la experiencia del cliente real. No afirmar que hay stock si no existe una instantánea válida.

## Rendimiento de Genéricos

La consulta real agrega primero ventas por artículo y compras por artículo/proveedor antes de acceder al catálogo de presentaciones. El cálculo del percentil agrupa unidades por precio pagado, manteniendo la ponderación y el mínimo de tres líneas de compra reales. No se guarda ni reutiliza en caché ningún resultado de negocio.

Benchmark de producción del 18/10/2026: Valdemarías, ~1,5 s; cinco farmacias, ~3,1 s, tres meses de movimientos. La latencia seguirá condicionada por los bloqueos de la versión antigua de `FarmetricaSync` hasta que se actualice el ejecutable Windows (incidencia #59).

## Migraciones

`013_accesos_locales.sql` y `014_clientes_demo.sql` son aditivas. Las aplica el despliegue y el arranque, con pruebas PostgreSQL de compatibilidad. No borrar/renombrar el esquema del cliente original.
