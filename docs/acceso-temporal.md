# Acceso privado provisional a FARMAWAO

El servidor Nginx exige sesión administrativa válida antes de entregar cualquier
ruta o recurso de la aplicación React (incluidos `index.html`, JS y CSS).
Solo `/login` es público, además de los endpoints de autenticación necesarios.
El backend ya protege los datos Farmatic con `requireAdmin`. Se permite Google
al mismo tiempo si se configura posteriormente.

## Activación en Contabo

La cuenta y contraseña no se guardan en código, en GitHub, ni en el frontend.
Tras desplegar el código del repositorio en `/opt/farmawao/api`, ejecutar como
root:

```bash
python3 /opt/farmawao/api/src/setup_temp_login.py
```

El asistente solicitará el correo del superadministrador, la contraseña
provisional (dos veces, sin mostrarla) y el dominio HTTPS de FARMAWAO. Guardará
solo un hash `scrypt` con sal aleatoria en `/opt/farmawao/.env`, generará
`SESSION_SECRET` si no existe y configurará cookies Secure. Mantendrá el resto
del archivo y sus permisos. No compartir el archivo `.env` ni el hash.

**Aviso:** una contraseña breve o reutilizada no es adecuada para un portal
público con información comercial. Elegir preferiblemente una clave única y
larga, incluso para esta fase provisional.

Aplicar las variables del contenedor reconstruyendo los dos servicios, sin
recrear ni modificar PostgreSQL:

```bash
cd /opt/farmawao
docker compose -f compose.yaml -f compose.farmacias.yml up -d --build --no-deps api web
```

Comprobar en la URL pública:
- `/promociones` sin sesión → redirección a `/login` sin servir JavaScript;
- `/login` muestra el formulario y no necesita autenticación;
- credenciales inválidas → mensaje de error sin sesión;
- credenciales correctas → cabecera con el correo real y rol Superadministrador;
- `/api/ventas/cobertura` con cookie válida → cinco farmacias;
- cierre de sesión → no permite volver a entrar con el botón «atrás» sin login.

Prueba local sin revelar datos:

```bash
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:18080/
curl -fsS http://127.0.0.1:18080/api/auth/config
```

Se espera redirección en la primera consulta (código 302), y
`temporaryLoginEnabled:true` en la segunda. No copiar el `.env` a GitHub.

## Alcance y seguridad

- La sesión es una cookie HttpOnly, Secure y SameSite=Lax firmada con HS256,
  con vencimiento de 8 horas. El frontend no almacena contraseñas ni tokens.
- `POST /api/auth/local` comprueba el hash con scrypt y comparación en tiempo
  constante; bloquea 15 minutos tras cinco fallos por IP o correo.
- Solo el rol `administrador` puede abrir la web; los demás permisos por
  farmacia aún están pendientes, y no se deben mostrar datos reales a otros roles.
- La cabecera utiliza la identidad autenticada. El catálogo de usuarios,
  promociones y objetivos del prototipo todavía está parcialmente en
  `localStorage`: **no es un sistema multiusuario persistido**. Las
  agregaciones de ventas se consultan de PostgreSQL cuando hay sesión.
- Nginx usa DNS Docker con resolución renovable para tolerar recreaciones de API.

## Paso a Google y retirada del acceso provisional

Cuando Google Identity Services funcione en `/login`, eliminar del `.env`:
`TEMP_ADMIN_EMAIL` y `TEMP_ADMIN_PASSWORD_HASH`. Mantener
`SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `ADMIN_BOOTSTRAP_EMAILS` y
`PUBLIC_APP_ORIGIN`. Reiniciar únicamente API (para revocar el acceso local) y
volver a probar `/login`.

No se debe añadir una contraseña provisional directamente a ningún workflow,
build arg, archivo público del repositorio ni navegador.
