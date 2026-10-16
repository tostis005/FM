# Activar el maestro real de farmacias (PostgreSQL + Entra)

La rama añade un backend Node/Express con autenticación JWT por **Microsoft Entra ID** y un frontend que pasa de modo DEMO a PostgreSQL **solo cuando se configura la autenticación**. El sitio previo es público y no es seguro permitir modificaciones administrativas anónimas.

## Antes de desplegar
1. El servicio PostgreSQL ya existe en Docker (contenedor `farmawao-db-1`); **no recrear** la base de datos, no tocar volúmenes.
2. Registrar dos aplicaciones en Entra ID: (a) API con scope delegado `Pharmacies.Manage`, que emita tokens de **versión 2**; (b) SPA con redirect URI HTTPS de la web y permiso delegado para ese scope. Conceder consentimiento autorizado.
3. Anotar tenant ID, client ID de SPA, client ID de API y `oid` de los administradores. **No** guardar secretos en Git.
4. Configurar en el VPS las variables de `api/.env.example` como entorno del servicio API; la contraseña PostgreSQL nunca se envía al navegador. No abrir el puerto 8000 al público.
5. El `compose.yaml` aportado confirma que existe el servicio `api` (`build: ./api`), PostgreSQL `db` y web. Antes de reemplazar `/opt/farmawao/api`, hacer copia de seguridad de ese directorio. **No sustituir ni eliminar `postgres_data`**.

## Docker existente
El frontend Nginx de FM ya redirige `/api/*` al hostname interno Docker `api:8000`. El servicio `api` debe apuntar al código del directorio `api` de este repo y compartir red con `web` y `db`. En el compose del VPS, el servicio `api` necesita `build: ./api`, `env_file` o variables de entorno equivalentes, y conectividad a PostgreSQL mediante su nombre de servicio Docker; ajustar `DATABASE_URL` al nombre real del servicio (normalmente `db`). El compose actual puede conservarse. Añadir únicamente el override del archivo `deploy/compose.farmacias.yml` una vez configuradas las variables.

Para que Vite incluya la configuración de Entra en el frontend, el override `deploy/compose.farmacias.yml` pasa los valores `VITE_ENTRA_TENANT_ID`, `VITE_ENTRA_CLIENT_ID` y `VITE_ENTRA_API_SCOPE` como **build args** del servicio `web`. Estos valores no son secretos.

Una vez revisado el compose:
```bash
cd /opt/farmawao
docker compose -f compose.yaml -f compose.farmacias.yml up -d --build --no-deps api web
docker compose logs --tail=100 api
```

La API ejecuta la migración idempotente al arrancar y precarga cinco farmacias sin sobrescribir cambios de nombres. Queda cerrada si faltan configuraciones de Microsoft o la lista `ADMIN_OIDS`.

## Estado de funcionalidades
- **Real:** maestro de farmacias en PostgreSQL, edición de nombre, código origen, host/IP, ciudad, estado y base origen, con API protegida para administradores.
- **Solo demostración:** promociones, usuarios y resultados; el login de este módulo no habilita todavía permisos de acceso por farmacia para el resto de módulos.
- **Pendiente:** sincronizar SQL Server, integración automática de ventas y objetivos; se hará desde DBeaver/Hop o un proceso dedicado.

El repositorio FM es **público** actualmente. Se recomienda hacerlo privado antes de añadir detalles internos o nuevas configuraciones.

## Variables de entorno adicionales en `/opt/farmawao/.env`

Conservar `POSTGRES_PASSWORD` que ya funciona. Añadir (valores reales solo en el VPS):

```dotenv
AZURE_TENANT_ID=TENANT_ID
AZURE_API_CLIENT_ID=API_APP_CLIENT_ID
ADMIN_OIDS=OID_ADMINISTRADOR
VITE_ENTRA_TENANT_ID=TENANT_ID
VITE_ENTRA_CLIENT_ID=SPA_APP_CLIENT_ID
VITE_ENTRA_API_SCOPE=api://API_APP_CLIENT_ID/Pharmacies.Manage
```

Copiar `deploy/compose.farmacias.yml` a `/opt/farmawao/compose.farmacias.yml`. No publicar la contraseña o el archivo `.env`; verificar manualmente la existencia de variables sin imprimir sus valores. Utilizar **HTTPS** para Microsoft Entra.

El workflow manual de despliegue del backend solo se debe ejecutar una vez que Entra ID esté configurado y las variables estén en el VPS; si falla la comprobación previa, no instala nada. La automatización normal de web permanece independiente del backend.
