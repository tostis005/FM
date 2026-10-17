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

Nueva API en `api/` y migración PostgreSQL idempotente. Cinco farmacias precargadas con IDs numéricos 1–5 (ABA/EUR/BUE/EST/POL) y nombres editables. **No se ha desplegado el backend todavía**: requiere Entra ID, variables de entorno y adaptación del servicio API del VPS existente. Consulta [despliegue](docs/despliegue-farmacias.md) y [primera carga con DBeaver](docs/importacion-dbeaver.md).

### Aplicación del maestro en Contabo
Al fusionar a `main`, el despliegue automático aplica la migración **idempotente** de las tablas `farmacias` y `stock_farmacia` en el PostgreSQL existente y despliega React. No elimina datos, no modifica volúmenes y no sustituye todavía la API existente. La persistencia de edición desde React solo estará activa tras completar Microsoft Entra ID y desplegar la API autenticada. Si existe una tabla antigua con ID no numérico, el proceso se detendrá para exigir migración supervisada.

## Rutas de la aplicación

Cada sección tiene URL propia: `/promociones`, `/seguimiento`, `/farmacias`, `/usuarios`, `/ajustes`. La navegación usa History API y permite volver/avanzar y recargar sin salir de la sección; Nginx reenvía las rutas a `index.html` sin cambiar el enrutamiento de `/api/`.

## Seguimiento unificado

El menú lateral muestra **Seguimiento** como submenú de **Promociones**. La ruta única de reporting es `/promociones/seguimiento`; las rutas antiguas `/seguimiento` y `/promociones/ID/seguimiento` se siguen aceptando, abriendo la misma interfaz con la campaña de la URL seleccionada. El selector permite multiselección mediante casillas, seleccionar todas las campañas filtradas o limpiar la selección; incluye estado (Activas por defecto), año de inicio, búsqueda por nombre/CN y farmacia para comparar los datos visualizados. El campo `ids` y los filtros de estado y año se mantienen en la URL para recarga y enlaces compartibles. El botón de exportación descarga un XLSX cuando hay una sola promoción seleccionada y un ZIP con resumen y XLSX individuales cuando hay varias; **nunca incluye campañas que estén fuera de la selección filtrada actual**. Las ventas actuales siguen siendo ficticias hasta la integración de SQL Server.

## Visualización del seguimiento y filtros

Seguimiento muestra directamente el resumen KPI, **Detalle de promociones** y un desglose de cumplimiento con barra agregada por campaña y barras por farmacia. Cada barra tiene su meta al **100 %**, valor vendido/objetivo, porcentaje y unidades pendientes o superadas. Ya no se pinta una curva semanal inventada: solo se representan los acumulados ilustrativos existentes hasta conectar ventas reales.

El botón **Filtrar campañas**, junto a **Descargar**, abre un modal amplio con estado, año, búsqueda por nombre/CN, selección múltiple y acciones **Cancelar** / **Aplicar filtros y visualizar**. La selección se edita en borrador y no modifica indicadores ni exportaciones hasta pulsar Aplicar. La farmacia se puede filtrar rápidamente en la vista principal. El selector conserva la funcionalidad de selección múltiple y el ZIP de las campañas seleccionadas, con XLSX individual cuando solo hay una.

## Consolidado, acordeones y farmacias múltiples

En Seguimiento, el **Consolidado por farmacia** se muestra destacado inmediatamente tras los KPI, antes de «Detalle de promociones» y de «Avance hacia los objetivos». El avance agrupa cada campaña en una tarjeta plegable: dos activas desplegadas inicialmente, **Plegar todas** / **Desplegar todas**, y carga visual de 15 campañas por tanda. El selector de **Farmacias** junto al resumen es multiselección con casillas y opción Todas; afecta a KPI, tabla, consolidado y objetivos, y se conserva en la URL. Cuando el filtro efectivo deja solo una farmacia, la tarjeta de campaña muestra una única barra de progreso para evitar duplicar el total. Las exportaciones siguen filtradas por campañas seleccionadas, no por farmacias, como se indica en la vista.

## Formato de CNs

Los **CNs** son cadenas de exactamente seis cifras (expresión `^[0-9]{6}$`), sin puntos ni otros caracteres. Las promociones predeterminadas se han actualizado; al cargar promociones antiguas del navegador, los valores con seis dígitos seguidos de punto y un dígito se convierten automáticamente a seis cifras. Los valores que no se ajustan a ninguno de esos dos patrones no se incluyen en el listado normalizado. El formulario bloquea guardar CNs inválidos y la exportación Excel/ZIP los rechaza. Pruebas: `node --test web/src/cns.test.js`.
