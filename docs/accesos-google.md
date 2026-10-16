# Autenticación y administración de accesos — FARMAWAO

## Objetivo
El administrador gestiona desde **Accesos** (ruta `/accesos`) un catálogo de dominios autorizados y cuentas individuales, sin fijar dominios en el código. Se puede habilitar `farmacia-ejemplo.es` y vincularlo al ID del maestro `public.farmacias`; también permitir `consultor@gmail.com` o `colaborador@externo.es` individualmente.

## Política de acceso
- **Cuenta individual activa:** prevalece sobre cualquier regla de dominio; define rol y farmacias explícitas. Una cuenta desactivada **deniega** acceso aunque el dominio sea válido.
- **Dominio activo:** permite usar Google para iniciar sesión a correos verificados del dominio. Si hay una farmacia asociada se asigna esa farmacia; si no, el usuario no recibe automáticamente ninguna farmacia.
- **Rol administrador:** se gestiona en el servidor. Puede configurar dominios, cuentas y farmacias.
- **Resto de roles:** no pueden utilizar por ahora los endpoints de ventas/maestro, que siguen siendo **solo admin**. El control por farmacia en promociones y ventas está pendiente: la UI de promociones aún es una demo local y NO un portal seguro multicuenta.
- No se precarga ningún dominio. El primer administrador es el correo indicado en `ADMIN_BOOTSTRAP_EMAILS` del VPS, verificado mediante Google.
- La UI no almacena contraseñas ni los códigos. La sesión usa cookie HttpOnly firmada, 8 horas, SameSite=Lax y Secure por defecto. Cada petición reevalúa la autorización contra PostgreSQL: si se bloquea la cuenta o se elimina el dominio, se pierde acceso inmediatamente.

## Cómo se configura en Contabo
**NO introducir secretos en GitHub, frontend, chat ni archivos públicos.** Crear un cliente OAuth 2.0 de tipo **Web application** en Google Cloud Console, con **Authorized JavaScript origins** configurado para el HTTPS de la web. El inicio de sesión usa Google Identity Services (ID token verificado contra las claves de Google en la API). El CLIENT ID es público.

En `/opt/farmawao/.env`, añadir:
```dotenv
GOOGLE_CLIENT_ID=TU_CLIENT_ID.apps.googleusercontent.com
SESSION_SECRET=VALOR_ALEATORIO_MINIMO_32_CARACTERES
ADMIN_BOOTSTRAP_EMAILS=tu.correo@dominio.com
PUBLIC_APP_ORIGIN=https://DOMINIO_ACTUAL_FARMAWAO
COOKIE_SECURE=true
```
**Opcional** para enviar códigos a cualquier dirección expresamente autorizada (incluidos dominios que no sean Google):
```dotenv
SMTP_HOST=smtp.proveedor.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM=accesos@dominio.com
```
El frontend recibe solo `VITE_GOOGLE_CLIENT_ID` a través del argumento del build Docker. No se publica `SESSION_SECRET`, la contraseña SMTP o `DATABASE_URL`. El `deploy/compose.farmacias.yml` obtiene estos valores del VPS. El workflow de API **no despliega** mientras falte la configuración.

## Administración
1. Iniciar sesión en `/accesos` con el administrador inicial y Google.
2. Añadir dominios con el dominio sin `@`, elegir la farmacia (o "Sin asignar") y activar/desactivar.
3. Añadir cuentas individuales con email, rol y farmacia(s); pueden estar fuera de los dominios.
4. La persona puede entrar con Google si su cuenta lo admite; si no, y SMTP está configurado, solicita un código de 6 cifras por email (10 minutos y máximo 5 intentos por código).
5. "Bloquear" desactiva la cuenta, sin eliminarla. Así no se reautoriza automáticamente por su dominio.

## API
- `GET /api/auth/config` (público): estado de Google y códigos, nunca secretos.
- `POST /api/auth/google`: comprueba firma JWT, emisor, audiencia, `email_verified` y autorización.
- `POST /api/auth/request-code`, `POST /api/auth/verify-code`: solo cuentas explícitas activas, SMTP necesario.
- `GET /api/auth/me` y `POST /api/auth/logout`.
- `GET/PUT/DELETE /api/admin/domains`: dominio, activo, farmacia_id.
- `GET/PUT/DELETE /api/admin/accounts`: correo, rol, farmacias, estado.
- Las rutas `/api/admin/*` están protegidas con rol administrador real.
- La migración `002_accesos.sql` es idempotente y no toca `farmatic.lineaventa`.

## Pendiente
La web de promociones y los usuarios ficticios del prototipo permanecen visibles sin iniciar sesión, pero no representan permisos reales. Para habilitar acceso a métricas de ventas a farmacias y colaboradores habrá que adaptar cada endpoint con filtrado en backend por `farmacias` y persistir las promociones de forma autenticada. Evitar dar acceso a `/api/ventas/*` a un usuario no administrador hasta implementar ese filtrado. Confirmar primero que el servicio API de Contabo dispone de `DATABASE_URL` correcto y que la tabla `farmatic.lineaventa` está presente.
