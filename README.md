# Farmétrica · prototipo

Primera interfaz interactiva para la gestión de promociones de la red de farmacias. Diseño basado en el estilo visual verde/blanco acordado.

## Incluye

- Crear, editar y duplicar promociones con fechas, descripción y CN pegados masivamente.
- Elegir farmacias participantes y asignar objetivos de venta en unidades.
- Seguimiento con ventas ilustrativas y exportación CSV compatible con Excel.
- Maestro de farmacias y usuarios con tres roles.
- Buscar y filtrar promociones por estado y rango de fechas.
- Persistencia temporal en el navegador (localStorage) para los módulos DEMO. Maestro de farmacias persistente en PostgreSQL cuando se active Microsoft Entra ID.

IMPORTANTE: La aplicación pública sigue siendo una DEMO salvo el módulo de farmacias, que puede conectarse mediante Entra ID a una API autenticada y PostgreSQL. No introducir información real en promociones/usuarios de demostración.

## Desarrollo local

Requiere Node.js 22+. Ejecutar dentro de `web`: `npm install` y `npm run dev`.

## Despliegue Contabo

El workflow de GitHub Actions valida React en una rama preview y, al actualizar `main`, copia únicamente el directorio `web` a `/opt/farmawao/web` y reconstruye exclusivamente el servicio Docker `web`.
NO modifica el `compose.yaml` existente, el backend `api`, PostgreSQL, volúmenes ni el archivo `.env` del VPS.

Próximo paso: backend real para promociones y permisos, integración con PostgreSQL, Microsoft Entra ID y sincronización Airbyte.

## Maestro de farmacias real

Nueva API en `api/` y migración PostgreSQL idempotente. Cinco farmacias precargadas (ABA/EUR/BUE/EST/POL) con nombres editables. **No se ha desplegado el backend todavía**: requiere Entra ID, variables de entorno y adaptación del servicio API del VPS existente. Consulta [despliegue](docs/despliegue-farmacias.md) y [primera carga con DBeaver](docs/importacion-dbeaver.md).
