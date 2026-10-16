# Farmetrica · prototipo

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

Nueva API en `api/` y migración PostgreSQL idempotente. Cinco farmacias precargadas con IDs numéricos 1–5 (ABA/EUR/BUE/EST/POL) y nombres editables. **No se ha desplegado el backend todavía**: requiere Entra ID, variables de entorno y adaptación del servicio API del VPS existente. Consulta [despliegue](docs/despliegue-farmacias.md) y [primera carga con DBeaver](docs/importacion-dbeaver.md).

### Aplicación del maestro en Contabo
Al fusionar a `main`, el despliegue automático aplica la migración **idempotente** de las tablas `farmacias` y `stock_farmacia` en el PostgreSQL existente y despliega React. No elimina datos, no modifica volúmenes y no sustituye todavía la API existente. La persistencia de edición desde React solo estará activa tras completar Microsoft Entra ID y desplegar la API autenticada. Si existe una tabla antigua con ID no numérico, el proceso se detendrá para exigir migración supervisada.

## Rutas de la aplicación

Cada sección tiene URL propia: `/promociones`, `/seguimiento`, `/farmacias`, `/usuarios`, `/ajustes`. La navegación usa History API y permite volver/avanzar y recargar sin salir de la sección; Nginx reenvía las rutas a `index.html` sin cambiar el enrutamiento de `/api/`.

## Seguimiento unificado

El menú lateral muestra **Seguimiento** como submenú de **Promociones**. La ruta única de reporting es `/promociones/seguimiento`; las rutas antiguas `/seguimiento` y `/promociones/ID/seguimiento` se siguen aceptando, abriendo la misma interfaz con la campaña de la URL seleccionada. El selector permite multiselección mediante casillas, seleccionar todas las campañas filtradas o limpiar la selección; incluye estado (Activas por defecto), año de inicio, búsqueda por nombre/CN y farmacia para comparar los datos visualizados. El campo `ids` y los filtros de estado y año se mantienen en la URL para recarga y enlaces compartibles. El botón de exportación descarga un XLSX cuando hay una sola promoción seleccionada y un ZIP con resumen y XLSX individuales cuando hay varias; **nunca incluye campañas que estén fuera de la selección filtrada actual**. Las ventas actuales siguen siendo ficticias hasta la integración de SQL Server.
