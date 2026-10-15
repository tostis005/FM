# Activar el maestro real de farmacias (PostgreSQL + Entra)

La rama añade un backend Node/Express con autenticación JWT por **Microsoft Entra ID** y un frontend que pasa de modo DEMO a PostgreSQL **solo cuando se configura la autenticación**. El sitio previo es público y no es seguro permitir modificaciones administrativas anónimas.

## Antes de desplegar
1. El servicio PostgreSQL ya existe en Docker (contenedor `farmawao-db-1`); **no recrear** la base de datos, no tocar volúmenes.
2. Registrar dos aplicaciones en Entra ID: (a) API con scope delegado `Pharmacies.Manage`, que emita tokens de **versión 2**; (b) SPA con redirect URI HTTPS de la web y permiso delegado para ese scope. Conceder consentimiento autorizado.
3. Anotar tenant ID, client ID de SPA, client ID de API y `oid` de los administradores. **No** guardar secretos en Git.
4. Configurar en el VPS las variables de `api/.env.example` como entorno del servicio API; la contraseña PostgreSQL nunca se envía al navegador. No abrir el puerto 8000 al público.
5. Comprobar en `/opt/farmawao/compose.yaml` cómo está definido el servicio `api` **antes** de modificarlo. El backend existente en Contabo no está versionado en FM y no podemos conocer su configuración desde el repositorio. Hacer copia de seguridad de ese archivo.

## Docker existente
El frontend Nginx de FM ya redirige `/api/*` al hostname interno Docker `api:8000`. El servicio `api` debe apuntar al código del directorio `api` de este repo y compartir red con `web` y `db`. En el compose del VPS, el servicio `api` necesita `build: ./api`, `env_file` o variables de entorno equivalentes, y conectividad a PostgreSQL mediante su nombre de servicio Docker; ajustar `DATABASE_URL` al nombre real del servicio (normalmente `db`). No reemplazar ciegamente `compose.yaml` existente.

Para que Vite incluya la configuración de Entra en el frontend, pasar los valores `VITE_ENTRA_TENANT_ID`, `VITE_ENTRA_CLIENT_ID` y `VITE_ENTRA_API_SCOPE` como **build args** del servicio `web` en Compose. Esos tres valores no son secretos. La imagen Docker admite dichos argumentos.

Una vez revisado el compose:
```bash
cd /opt/farmawao
docker compose up -d --build --no-deps api web
docker compose logs --tail=100 api
```

La API ejecuta la migración idempotente al arrancar y precarga cinco farmacias sin sobrescribir cambios de nombres. Queda cerrada si faltan configuraciones de Microsoft o la lista `ADMIN_OIDS`.

## Estado de funcionalidades
- **Real:** maestro de farmacias en PostgreSQL, edición de nombre, código origen, host/IP, ciudad, estado y base origen, con API protegida para administradores.
- **Solo demostración:** promociones, usuarios y resultados; el login de este módulo no habilita todavía permisos de acceso por farmacia para el resto de módulos.
- **Pendiente:** sincronizar SQL Server, integración automática de ventas y objetivos; se hará desde DBeaver/Hop o un proceso dedicado.

El repositorio FM es **público** actualmente. Se recomienda hacerlo privado antes de añadir detalles internos o nuevas configuraciones.
