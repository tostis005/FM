# Farmétrica Sync · versión técnica 0.15

Sincronizador configurable para el servidor Windows del cliente con Farmatic / SQL Server y conexiones a otras farmacias mediante Linked Servers. Procesa los cambios de ventas, compras, artículos (con existencias integradas), proveedores y entidades adicionales hacia **PostgreSQL**. Panel web local y servicio en segundo plano.

> **Estado de entrega:** código y compilación Windows automatizada mediante GitHub Actions. **No se ha validado con el SQL Server Farmatic ni con el PostgreSQL de Contabo reales**. Comprobar primero en preproducción; no incluye credenciales.

## Funcionalidades incluidas

- Servicio Windows que arranca con el sistema y opera sin sesión de usuario iniciada.
- Panel web español `http://127.0.0.1:5080` con contraseña admin y sesión protegida.
- Primer conector `Farmatic` (motor SQL Server), conexiones directas o por Linked Server desde el servidor central.
- Configuración multi-farmacia; mapeo SQL independiente por entidad y farmacia, con macro `{{TABLE:dbo.Tabla}}`.
- Entidades definidas con columnas y tipos (4 estructuras de partida + editor de nuevas entidades).
- PostgreSQL configurable: servidor, base de datos, usuario, esquema y SSL; creación automatizada de tablas y columnas **aditivas**.
- **Procesamiento de grandes volúmenes:** lector SQL Server en streaming, lotes editables de 100–20.000 filas, recuentos de tipo `long`, transacción PostgreSQL completa sin límite fijo total.
- **Políticas por fuente:** `incremental` para solo altas inmutables (`ON CONFLICT DO NOTHING`) y `snapshot` para maestros (comparación de altas, cambios, bajas en la misma transacción).
- **Dos consultas por farmacia y entidad:** SELECT de carga completa inicial/manual y SELECT incremental periódico (`@desde`, `@hasta`). También disponible la fotografía completa programada. La carga completa reemplaza solo los registros de esa farmacia en una transacción; tras completarla, establece el checkpoint del incremental. Si has configurado una consulta completa, el incremental automático no arranca hasta la primera carga completa satisfactoria. Frecuencia entre 5 minutos y una semana.
- Persistencia de estado y reanudación con checkpoint al confirmar la escritura; reintentos de fallo cada 5 minutos; historial de las últimas 10.000 ejecuciones con filtros por farmacia, entidad y estado, fechas, duración, registros extraídos/insertados/actualizados/eliminados/repetidos.
- Alertas SMTP mediante STARTTLS con correo de prueba, destinatarios globales o específicos de cada fuente, aviso de recuperación opcional y control de repetición (máximo una por consulta/hora).
- Secrets cifrados con ASP.NET Core Data Protection, con claves protegidas por DPAPI en Windows y carpeta `ProgramData` con ACL restringidas por el instalador.
- Escritura por COPY binario en tabla temporal y UPSERT transaccional en PostgreSQL.

## Arquitectura

```text
Farmacias Farmatic / SQL Server
          │         │
       Linked Servers / conexión SQL directa
          │         │
      Windows Server del cliente
      Farmétrica Sync (servicio Windows .NET 10)
          ├─ Interfaz web en localhost:5080
          ├─ Conector Farmatic (ampliable a futuros conectores)
          ├─ Consultas SQL y planificador
          ├─ Estado y credenciales cifradas en ProgramData
          └─ COPY/UPSERT ── TLS ──> PostgreSQL (esquema farmetrica)
```

## Carga completa seguida de incremental (flujo recomendado)

1. Crear la farmacia y verificar conexión. Elegir entidad de destino (ventas, compras, artículos con existencias, proveedores...).
2. En **Consultas SQL**, crear un trabajo con `Modo = Incremental`. Configurar **dos SELECT diferentes**: **SELECT de sincronización periódica** (`@desde`, `@hasta` y campo de última modificación) y **SELECT de carga completa** (sin filtro por fecha).
3. Activar el trabajo, guardar y pulsar **Carga completa**. Requiere confirmación y se ejecuta en una cola exclusiva.
4. Comprobar que el historial muestra una carga completa correcta y contar registros en PostgreSQL. El servicio habilita entonces el modo incremental horario automáticamente.
5. La pantalla Historial muestra el tipo de ejecución, último checkpoint y última carga completa; se puede repetir el proceso manual cuando sea necesario.

**Protecciones:** carga completa rechazada si devuelve cero filas; si antes había al menos 20 filas y la extracción disminuye más del 50%, se bloquea. La consulta completa sustituye solo las filas de la farmacia seleccionada **en una transacción**, nunca la tabla entera. El checkpoint incremental solo avanza al finalizar una escritura completa con éxito. Los reintentos solapan un intervalo configurable (180 minutos por defecto) y retrasan 5 minutos el cierre de ventana para absorber retrasos de publicación. No se buscan modificaciones ni borrados en fuentes incrementales de solo altas. Los borrados y correcciones se reconcilian únicamente en las fuentes configuradas como carga completa.

**Carga de grandes volúmenes (v0.3):** sin límite artificial de 100.000 filas ni límite total por ejecución. El conector SQL Server lee en streaming y envía bloques configurables de **100 a 20.000 filas (5.000 por defecto)**. No se guarda toda la consulta en memoria. Los incrementales realizan inserciones idempotentes por bloque dentro de una sola transacción PostgreSQL; una falla provoca rollback y el checkpoint no avanza. En una carga completa, los bloques se acumulan en una tabla temporal PostgreSQL (en disco del servidor PostgreSQL si resulta necesario), se verifican los recuentos, y **solo al final** se reemplazan los registros de la farmacia, de modo atómico. Si se interrumpe el proceso, debe reintentarse la carga (no hay reanudación física a mitad de un SELECT), con transacción segura e idempotencia. **En históricos de millones de filas** hay que garantizar almacenamiento temporal, mantenimiento de conexiones largas, capacidad de WAL/replicación y rendimiento; ensayar en preproducción antes de activar, especialmente si PostgreSQL está remoto. Las consultas SQL deben poder devolver el conjunto completo y disponer de claves de origen estables.

## 1. Publicación en un PC con SDK de .NET 10

**No es necesario instalar .NET en el servidor del cliente.** Sí hay que compilar **una vez** en un equipo de desarrollo con SDK de .NET 10 y acceso a NuGet.

Desde PowerShell en el proyecto:

```powershell
.\scripts\publicar-win-x64.ps1
```

Genera `dist\win-x64\` con `FarmetricaSync.exe` autocontenido y los archivos de publicación (incluida la web). Se deben copiar **todos** los archivos generados al equipo del cliente, no solo el `.exe`. Si el servidor es ARM64 o Windows de 32 bits, habrá que cambiar el RID. .NET 10 requiere una versión compatible de Windows Server; verificarla en el cliente.

## 2. Instalación en el servidor Farmatic

1. Hacer copia de seguridad del servidor y acordar con su administrador el uso de CPU, memoria y la identidad de cuenta del servicio.
2. Copiar la carpeta `dist\win-x64` y el script `instalar-servicio.ps1` al servidor (o compartir una carpeta con el proyecto completo).
3. Abrir PowerShell **como administrador** y ejecutar:

```powershell
.\scripts\instalar-servicio.ps1 -Source 'C:\Ruta\win-x64'
```

4. Abrir en **el propio servidor**: `http://127.0.0.1:5080`.
5. Crear la contraseña admin (mínimo 12 caracteres).
6. Configurar el destino PostgreSQL y usar **Probar conexión**.
7. Dar de alta la farmacia central y las demás farmacias con el alias del Linked Server, base de datos remota e identidad SQL.
8. Preparar cada consulta con los campos normalizados. Activarlas **solo después** de probarlas y cuadrar los resultados de referencia.
9. Configurar las alertas SMTP; validar la recepción provocando un fallo controlado en preproducción.
10. Comprobar el historial, los datos en PostgreSQL, permisos, certificados y el reinicio automático del servicio.

Servicio Windows: `FarmetricaSync`. Para actualizar, ejecutar de nuevo `instalar-servicio.ps1` con una nueva carpeta publicada: se detiene el servicio, actualizan los binarios y se conserva la configuración de `ProgramData`.

Para desinstalar: `scripts\desinstalar-servicio.ps1`; por defecto conserva las claves y credenciales de `ProgramData`.

## 3. Credenciales, seguridad y red

- El panel escucha **solo en `127.0.0.1`**. Para administrarlo desde otra máquina, usar una sesión remota al servidor o un túnel protegido. **No cambiar a `0.0.0.0` sin HTTPS, acceso restringido y una revisión de seguridad.**
- Las credenciales de SQL Server y PostgreSQL se cifran mediante Data Protection. Las claves DPAPI en `ProgramData` se mantienen en el **mismo servidor**. Para migrar se requiere procedimiento de backup seguro específico, o reintroducir credenciales en la nueva máquina.
- SQL Server: usar cuenta de solo lectura. Con autenticación Windows, la cuenta que se autentica es **la identidad del servicio Windows**, no el usuario que abre el navegador. LocalSystem puede no tener permisos válidos en Linked Servers de otro dominio. Se recomienda una cuenta de servicio de dominio o gMSA correctamente configurada por TI y con lectura mínima; asignar también ACL a `ProgramData` para esa cuenta antes de cambiar la identidad del servicio.
- SQL Server usa `Encrypt=Mandatory;TrustServerCertificate=false` por defecto. Existe una **excepción explícita por farmacia** («Aceptar certificado SQL Server no verificado»), útil para validar instalaciones antiguas en red aislada, pero omite la autenticación del servidor y requiere aprobación de TI. Priorizar certificados TLS confiables en producción.
- PostgreSQL usa `VerifyFull` como modo SSL recomendado. `VerifyCA` y `Require` se pueden seleccionar; `Require` **no verifica la identidad del servidor**, por lo que solo se admite tras analizar el riesgo.
- PostgreSQL requiere permisos `CREATE` sobre el esquema o ejecutar previamente las migraciones DBA. Para operación de menor privilegio, el DBA puede ejecutar `docs/esquema-postgresql.sql` y asignar al servicio permiso de lectura/escritura en las tablas, aunque la comprobación de DDL en cada ejecución debe revisarse en un endurecimiento de producción.
- SMTP admite STARTTLS (normalmente puerto 587), no SMTPS implícito (465).
- La contraseña de administrador no tiene recuperación automática desde la UI. Definir procedimiento de custodia y backup.

## 4. Contratos SQL y datos

Ver `docs/MAPEO_FARMATIC.md` y `docs/esquema-postgresql.sql`.

- Cada consulta debe devolver **todas las columnas** declaradas por la entidad. Debe incluir `origen_id` único por farmacia y entidad.
- `farmacia_codigo` y `sincronizado_en` los añade el motor. Clave primaria (`farmacia_codigo`, `origen_id`). No se confunden registros iguales de farmacias distintas.
- El modo incremental necesita fecha de última **modificación**, no simplemente fecha comercial de venta; usa `@desde` y `@hasta` para evitar perder correcciones.
- Los snapshots por farmacia **reemplazan** sus filas en una misma transacción. Como protección ante pérdidas, se bloquean si el SELECT devuelve cero filas o menos de la mitad de los registros existentes (para conjuntos previos de 20 o más registros). Estas circunstancias exigen una revisión y ajuste deliberado; no se deben eliminar filas por sorpresa.
- El sistema no importa borrados físicos incrementales. Verificar borrados, devoluciones y rectificaciones antes de operar con datos críticos.
- Las consultas admiten millones de filas mediante lectura streaming y bloques configurables; cada ejecución es una transacción atómica y un fallo vuelve a procesar la consulta desde su checkpoint anterior. En historiales muy grandes, vigilar tiempo de transacción, almacenamiento temporal y WAL. Una futura mejora será reanudación real desde el último bloque mediante paginación estable y marcas persistentes.
- El esquema nuevo puede ganar columnas desde la interfaz, pero **no** se automatizan cambios de tipo ni eliminación de columnas; requieren migraciones y coordinación con la web de Farmétrica.
- Cada farmacia define una zona horaria (por defecto `Romance Standard Time` para España); `@desde` y `@hasta` se convierten a la hora local SQL Server, mientras que los checkpoints se guardan en UTC. Para cambios de hora se utiliza solapamiento de 180 minutos; con fechas locales ambiguas en el cambio de horario de invierno no es posible garantizar captura perfecta sin Change Tracking/CDC. Las columnas `timestamp` conservan la hora entregada por SQL Server sin huso horario. Para expansión internacional hace falta añadir normalización explícita a UTC y la zona horaria de cada farmacia.

## 5. Desarrollo local

```powershell
cd src\FarmetricaSync
dotnet restore
dotnet run
```

En Windows se guarda el estado en `%ProgramData%\FarmetricaSync`. Para pruebas de desarrollo puede configurarse una variable `FARMETRICA_SYNC_DATA` que apunte a una carpeta temporal **no compartida**. La protección DPAPI específica de Windows solo se activa en Windows; en otros sistemas no se debe considerar seguro para producción sin revisar el almacén de claves.

**No utilizar el servidor productivo Farmatic como equipo de desarrollo.** Compilar y probar fuera, luego instalar la publicación autocontenida.

## 6. Limitaciones y siguientes pasos de producto

Esta es una versión técnica inicial que necesita pruebas de compilación y una integración real. Antes de producción conviene añadir tests automatizados contra SQL Server/PostgreSQL de prueba, alertas de falta de sincronización (no solo fallos), monitorización de espacio y latencia, migraciones/versionado de entidades, backfills grandes reanudables por página, recogida de borrados por CDC/Change Tracking y una integración controlada entre nuevas entidades y las pantallas/reportes de Farmétrica.

El servicio escribe **directamente en PostgreSQL**, tal como se acordó. Si el destino pasa a alojarse en Internet, la alternativa con **API de ingesta autenticada** puede ser preferible a abrir PostgreSQL públicamente; no exponer puerto 5432 a Internet sin una conexión privada y controles de red.

## v0.4: políticas y garantías de sincronización

**Una política por farmacia y entidad** (p. ej., `ventas` incremental, `proveedores` completa):

- **Incremental de solo inserciones:** el SELECT debe utilizar `WHERE FechaAlta >= @desde AND FechaAlta < @hasta` o un filtro semánticamente equivalente, devolver un `origen_id` estable e inmutable y consultar una fecha de alta **fiable** (no fecha comercial editable). Se extraen los lotes en streaming. El destino ejecuta `ON CONFLICT ... DO NOTHING` con PK `(farmacia_codigo, origen_id)`; las relecturas, los reinicios y los solapamientos no cambian filas anteriores y se cuentan como «ya presentes». El checkpoint local avanza solo después del commit de todos los lotes en PostgreSQL. Si el servicio cae después del commit pero antes de guardar el checkpoint, releerá los datos y el conflicto los ignorará sin duplicarlos. Se recomiendan 180 minutos de solapamiento y 5 de demora de seguridad, editables por trabajo.
- **Completa con reconciliación:** extracción total a staging PostgreSQL, comparación de claves y valores, cálculo de nuevas/modificadas/ausentes, y aplicación de cambios y bajas **en una transacción**. Sin borrado masivo previo; los registros inalterados no se reescriben. Si se cae a mitad, rollback del conjunto y conservación del estado anterior.
- **Auditoría:** hasta 10.000 ejecuciones locales, paginación de 100, filtros por farmacia, entidad y error/éxito, y exportación CSV de la página visible. El historial muestra número de leídos, insertados, actualizados, eliminados y ya presentes, rango UTC y duración.
- **Avisos:** SMTP STARTTLS (normalmente 587), correo de prueba desde el panel, lista de destinatarios global y destinatarios opcionales por fuente. Notificación de recuperación opcional.
- **Identidad visual:** icono aprobado con cruz y flecha, PNG transparentes de varios tamaños, favicon y `.ico` de Windows.

**Límite de garantía:** la ausencia de duplicados está protegida por PK y `DO NOTHING` mientras `origen_id` sea estable. Para garantizar ausencia absoluta de pérdidas, SQL Server debe ofrecer una marca de inserción **monótona respecto a visibilidad/commit**, o una garantía contractual de máximo retraso y un intervalo de solapamiento mayor que dicho retraso. Si una fila nueva aparece días más tarde con `FechaAlta` de hace meses, un filtro por «última fecha» no puede descubrirla y ninguna aplicación puede prometer captura perfecta sin releer ese periodo o utilizar un registro de cambios/cursor de commit. Cambios de hora en marcas de tiempo locales también requieren especial atención: preferir UTC en origen. Antes de producción, validar estas condiciones con Farmatic y comparar contadores y máximos durante varios ciclos, simulando retrasos, caídas, reinicios y reintentos.

**Compilación:** la fuente está preparada para publicar Windows x64 con `scripts/publicar-win-x64.ps1`. Esta revisión necesita una compilación .NET y pruebas de integración sobre SQL Server y PostgreSQL del cliente; no se afirma que esté probada en un servidor real.

## Condiciones para una incremental sin omisiones

- La fecha usada en `@desde`/`@hasta` debe ser una **fecha de alta o de publicación fiable**, no una fecha comercial retroactiva: si se incorpora una venta antigua hoy con fecha de ayer, una ventana demasiado corta no la detectará.
- Las consultas deben filtrar con límites coherentes con el contrato `>= @desde AND < @hasta`, y devolver `origen_id` **estable y único por farmacia/entidad**.
- Configurar `ReplayMinutes` al menos igual al mayor retraso conocido de publicación; si el retraso no tiene cota, no puede prometerse extracción exhaustiva mediante filtro temporal. Hará falta una secuencia monotónica del origen, CDC/Change Tracking o conciliación periódica.
- Las transacciones PostgreSQL y `ON CONFLICT DO NOTHING` evitan registros repetidos al reintentar o solapar ventanas. El checkpoint solo se confirma después de que todos los lotes hayan sido escritos satisfactoriamente.
- Para comprobar ausencia de pérdidas hay que cotejar recuentos y claves reales entre SQL Server y PostgreSQL en las pruebas del cliente, incluyendo ventas con la misma marca temporal y reinicios en mitad de un lote.

## v0.5 · Plantillas, descuentos y pruebas antes de guardar

- El formulario de Consultas SQL precarga la plantilla de ventas si la farmacia es Farmatic y la entidad es `ventas`. Las dos variantes son editables y hay una opción para recuperar el SELECT estándar.
- `descuento_linea` (Farmatic `DescuentoLinea`) y `descuento_operacion` (`DescuentoOpera`) son columnas numéricas independientes. No se suman ni se interpreta aún si son porcentajes o importes.
- `farmacia` se genera automáticamente desde el código de farmacia y es equivalente a `farmacia_codigo` (clave interna). No introducirla en SELECT personalizados.
- Las conexiones de Farmatic/Linked Server, PostgreSQL y SMTP pueden comprobarse desde los formularios **antes de guardar**.
- En Consultas SQL, la vista previa permite seleccionar intervalo de fechas y leer **hasta 100 filas** tanto para incremental como completa. No escribe ni crea tablas en PostgreSQL. Para previsualizar una consulta, la farmacia y entidad deben haberse guardado previamente.
- Las configuraciones previas no se sobreescriben. Si la consulta de ventas antigua omite descuentos, se rellenan `NULL` hasta que se modifique su SELECT.
- Para asegurar continuidad incremental con el filtro `FechaHora`, verificar que es fiable como timestamp de alta inmutable y que no se publican filas después de vencer el solapamiento de seguridad.

Archivos de SQL listos para copiar: `docs/ABADIA_VENTAS_INCREMENTAL.sql` y `docs/ABADIA_VENTAS_COMPLETA.sql`.

## v0.6 · Conexión PostgreSQL por SSH

En la pestaña PostgreSQL puedes habilitar **Túnel SSH** integrado, autenticar por contraseña o clave privada, fijar la huella SHA256 del VPS, probar SSH **sin contraseña de PostgreSQL**, probar la conexión completa y guardar la configuración para que cada ejecución abra y cierre su propio túnel. La cuenta del servicio Windows debe poder acceder a cualquier clave privada configurada. Se mantiene el modo de conexión PostgreSQL directa para otros entornos.

Instrucciones paso a paso: [Conexión Docker/Contabo mediante SSH](docs/CONEXION_CONTABO_SSH.md). Se usa SSH.NET 2026.0.0 y la conexión se limita a loopback local; no es necesario exponer el puerto 5432 a Internet.

## v0.7 · Navegación y progreso en vivo

- Cada apartado de Farmétrica Sync tiene una ruta independiente: `/resumen`, `/farmacias`, `/consultas`, `/entidades`, `/postgresql`, `/alertas`, `/historial`. En Windows abre `http://127.0.0.1:5080/historial`, por ejemplo. Recargar la página o utilizar Atrás/Adelante mantiene el apartado; el servidor sirve la interfaz para rutas directas.
- El historial y resumen combinan el histórico terminado con ejecuciones activas (`En cola` / `Ejecutando`). Cada 3 segundos el historial consulta el servicio para mostrar la **fase actual**, tiempo transcurrido, lotes procesados y filas procesadas. Los resultados no se marcan confirmados hasta terminar la transacción.
- **No se inventan porcentajes**: sin recuento total de origen, se muestran recuentos reales de filas y lotes, no porcentajes/ETA falsos. Durante cargas completas se refleja la fase de comparación y confirmación PostgreSQL.
- El progreso vive en memoria del servicio Windows, no en la pestaña del navegador: cerrar o recargar el navegador no detiene la sincronización. Después de reiniciar el servicio, las ejecuciones que estuvieran en curso se marcan como interrumpidas y **el checkpoint incremental no se adelanta**.
- Nuevos endpoints del panel `/api/config` y `/api/runs` incorporan las ejecuciones en curso. El acceso sigue limitado a la sesión autenticada.

Validación automatizada en GitHub Actions (Node.js smoke test y compilación Windows). Aún pendiente verificar cargas reales SQL Server → Contabo con decenas de miles de registros y cortes de conexión en entorno del cliente.

## v0.8 · Incremental Farmatic corregido y periodicidad por fuente

- Corrección de sintaxis SQL `AS vWHERE` en la plantilla por defecto de ventas de Farmatic. Se separan `FROM ... AS v` y `WHERE v.FechaHora >= @desde AND v.FechaHora < @hasta` mediante salto de línea explícito.
- Reparación puntual de las consultas de ventas de Farmatic ya guardadas que contengan exactamente el defecto anterior. No reescribe otras consultas SQL personalizadas, ni cambia el cursor incremental, ni repite la carga completa.
- En **Consultas SQL → Editar**, selección de periodicidad (5–30 minutos, cada 1–12 horas, diaria, cada 2 días, semanal) o minutos personalizados entre 5 y 10080; el servidor conserva una duración en minutos, independiente de la interfaz.
- **Reintento tras error** configurable por fuente, distinto de la periodicidad habitual; por defecto 5 minutos, rango 5–1440 minutos.
- La lista de sincronizaciones muestra la próxima ejecución estimada calculada desde la última correcta o desde el último intento si hubo error.
- Pruebas de regresión .NET para la generación/reparación de SQL: `dotnet run --project tests/SqlTemplateRegression/SqlTemplateRegression.csproj`; las ejecuta automáticamente GitHub Actions antes de generar Windows.

La carga completa ya finalizada de ABA/ventas no debe repetirse; tras actualizar se puede probar la consulta incremental y reanudar desde el cursor confirmado. Las pruebas automatizadas no reemplazan la comprobación real frente al SQL Server del cliente.

## v0.9 · Nuevas plantillas Farmatic

Al crear un trabajo Farmatic para `compras`, `stock`, `articulos` o `proveedores`, la consulta se preconfigura con los SELECT reales de `vRecep`, `Articu` y `vProveedor`. Estas cuatro entidades proponen **carga completa periódica (snapshot)** para detectar altas, cambios y bajas. `ventas` conserva la plantilla incremental ya probada.

**Compras son cabeceras de recepciones:** `vRecep` no aporta líneas, artículos, unidades ni importes. Esos campos se guardan a `NULL`, no son métricas de compra calculables hasta recibir la tabla de detalle. **Stock** utiliza `Articu.StockActual`, sin histórico de movimientos ni marca exacta de captura. **Artículos** no asigna CN/EAN en ausencia de columnas de origen. **Proveedores** excluye cuentas bancarias y datos personales ajenos al análisis. Más detalles en `docs/MAPEO_FARMATIC.md`.

El esquema PostgreSQL se amplía automáticamente con columnas nuevas cuando se importe cada entidad. La configuración existente, los ID de trabajos, las consultas personalizadas y el punto de sincronización de ventas se conservan. Los SELECT antiguos admiten `NULL` únicamente en los campos nuevos declarados, manteniendo estricta la validación del resto.

Antes de activar los trabajos, utilizar **Ver primeros 100 · periódica** para validar cada plantilla contra el SQL Server real, y contrastar el total de filas. Es recomendable probar primero `proveedores` y `articulos`, después `stock` y por último las cabeceras de `compras`.

## v0.10 · Incremental de recepciones basado en Fecha

- La vista Farmatic `dbo.vRecep` contiene `Fecha` y `Hora` por separado; **no existe el campo `FechaHora`**. El campo `Hora` sigue siendo informativo (`hora_recepcion`) hasta verificar su tipo real.
- La nueva plantilla incremental de `compras` (cabeceras de recepciones) utiliza parámetros `@desde` y `@hasta` sobre `r.Fecha`. Solo lee días locales completos: `r.Fecha >= CONVERT(date, @desde) AND r.Fecha < CONVERT(date, @hasta)`. La plantilla de carga completa sigue sin filtros.
- Al crear una nueva fuente de compras Farmatic recomienda **incremental diario**, con **7 días de relectura**. El panel adapta el SELECT al cambiar de modo de carga sin sobrescribir consultas personalizadas.
- Compatibilidad v0.9: si un trabajo de recepciones existente estaba en modo incremental pero se había guardado exactamente el SELECT completo de la plantilla estándar, se sustituye en memoria por la versión con parámetros antes de ejecutar. No cambia modos, IDs, historiales ni cursores confirmados; la configuración se guarda en la próxima actualización del estado. Los SELECT personalizados no se modifican automáticamente.
- Los SQL personalizados que mencionan `FechaHora` en un incremental de `vRecep` muestran un error explicativo en lugar de un fallo SQL ambiguo. No impiden iniciar el servicio.
- Esta es una **aproximación basada en fecha comercial**, no garantía de importación de recepciones dadas de alta con fechas anteriores al solapamiento. Para eliminar cualquier riesgo de omisiones es necesario conocer un campo de inserción técnico o complementar con cargas completas de reconciliación.
- Copia del SQL: [Plantilla incremental de recepciones](docs/FARMATIC_RECEPCIONES_INCREMENTAL.sql).

## v0.11 · Recepciones Farmatic de distintas versiones (EUR, ABA y demás)

La vista `dbo.vRecep` no tiene un esquema idéntico en todas las farmacias. En el origen EUR y otras farmacias se confirmó que falta `Descuento2`; en la vista que se facilitó inicialmente estaba presente.

- Antes de consultar **recepciones** por la plantilla estándar (tanto vista previa como importación), el conector abre la conexión SQL Server central y consulta solo el **esquema** de `vRecep` mediante `SELECT TOP (0) *` (sin leer registros).
- Si la vista devuelve `Descuento2`, el campo se importa como `descuento_recepcion`.
- Si la columna **no existe**, se utiliza `CAST(NULL AS decimal(18,4)) AS descuento_recepcion`: queda `NULL`, nunca un cero inventado, y los SELECT estándar no fallan. Solo se modifica la expresión de la plantilla conocida; no se reescribe SQL personalizado arbitrario.
- `Hora` ha sido confirmado con valores de fecha y hora completa, por ejemplo `2007-11-05 09:54:57.197`. Además del campo existente `hora_recepcion` de texto, se incorpora `fecha_hora_recepcion` de tipo timestamp. La tabla PostgreSQL amplía este campo aditivamente en la próxima importación.
- El incremental de vRecep sigue filtrando `Fecha` por días completos, con recomendación diaria y 7 días de solapamiento. **No** cambiamos automáticamente el cursor a `Hora` ni al identificador `IdRecepcion` porque todavía no se ha demostrado que representen una alta técnica siempre creciente y sin registros tardíos.
- Las configuraciones, IDs, Linked Servers, cursores y cargas finalizadas permanecen intactos. Una ejecución fallida por columna inexistente no avanza la marca de agua; vuelve a intentarse normalmente al actualizar el servicio.

Antes de instalar, terminar cargas activas y realizar copia de `%ProgramData%\FarmetricaSync`. Tras instalar, entrar en `/consultas`, seleccionar EUR / compras y pulsar **Ver primeros 100 · periódica**. Verificar `descuento_recepcion = NULL` cuando no existe la columna.

## v0.12 · Compras Farmatic homogéneas en todas las farmacias

**Contrato único:** los cinco orígenes Farmatic usan exactamente el mismo SELECT de `dbo.vRecep`, con los campos compartidos `IdRecepcion`, `Fecha`, `Hora`, `XProv_IdProveedor`, `XCPro_IdCondicion`, `XVend_IdVendedor`, `Actualizado`, `Demorada`, `FIS_NOMBRE`, `Descripcion`, `NPedido` e `IdAlbaran`. Se han excluido `Descuento2`, `Ejercicio`, `Mes` y `NOMBRE` (redundantes o no comunes). Los campos de línea de compra permanecen `NULL` porque `vRecep` es de cabeceras.

**Sin excepciones por farmacia:** eliminada la lógica de descubrimiento y sustitución de `Descuento2` según el origen. `descuento_recepcion` sale del contrato PostgreSQL y de los SELECT; no se calcularán valores artificiales.

**Trabajos existentes (ABA, BUE, EUR y restantes):** en **Consultas SQL** hay un botón **«Actualizar desde esquema»** al editar cada trabajo de compras Farmatic, y un botón para **actualizar y guardar todos los orígenes de compras de una vez**. Sobrescribe ambos SELECT de compras con la plantilla común para el modo actual (incremental o snapshot). Conserva IDs, contraseñas, conexiones, configuración de periodicidad, historial y cursores; no exige recrear los cinco orígenes. Se pide confirmación porque sustituye SQL personalizado.

**Esquema de PostgreSQL:** tras copia de seguridad, pulsar **«Actualizar tabla compras en PostgreSQL»**. Esta migración independiente añade `vendedor_id`, `recepcion_actualizada`, `recepcion_demorada` y demás columnas comunes pendientes, y elimina exclusivamente `descuento_recepcion` con `DROP COLUMN IF EXISTS` **sin CASCADE**. Es una operación destructiva respecto de los valores antiguos de dicha columna, pero no elimina filas ni tablas completas. La migración requiere permiso ALTER; no se ejecuta automáticamente al arrancar ni dentro de transacciones largas de sincronización. Alternativa para el DBA: `docs/MIGRAR_COMPRAS_ESQUEMA_COMUN.sql`.

**Recuperación:** botón **«Relanzar compras fallidas»**; reencola solo trabajos de compras que quedaron con error. Respeta la carga inicial completa obligatoria cuando no se había completado; un trabajo correcto como ABA no vuelve a ejecutarse por esta acción. **No instalar durante cargas en curso**.

**Integridad:** el incremental de `vRecep` sigue filtrando `Fecha` con días completos, con periodicidad recomendada diaria y solapamiento de siete días. `Fecha` no es un cursor técnico fiable de inserción; movimientos introducidos tarde con fechas anteriores pueden perderse. Reconciliar periódicamente por carga completa hasta disponer de un campo de alta real. La eliminación del descuento no subsana esta limitación.

La migración de SQL y los controles se han probado por compilación automatizada, pero no se ha ejecutado contra el PostgreSQL Contabo real ni contra las cinco vistas Farmatic remotas. Probar las vistas previas de las cinco farmacias y contrastar recuentos antes de dejarlas programadas.

## v0.13 · Stock integrado en artículos (sin entidad independiente)

- Se retira la entidad `stock` de las plantillas Farmatic y del catálogo inicial. Las cuatro entidades canónicas quedan **ventas, compras, articulos, proveedores**.
- El SELECT de `dbo.Articu` ahora incluye `StockActual → stock_actual`, `StockMinimo → stock_minimo`, `StockMaximo → stock_maximo`, `LoteOptimo → lote_optimo`, además de los campos de catálogo. Las existencias son la foto actual y deben sincronizarse por **snapshot** para recoger modificaciones.
- La actualización retira del planificador los trabajos heredados de stock, sus checkpoints ya inútiles y la entidad retirada. **No borra los historiales de ejecuciones anteriores** ni la tabla PostgreSQL `stock` automáticamente. El cambio se guarda en la configuración local.
- Los trabajos existentes de artículos que utilicen exactamente la antigua plantilla de Farmatic se amplían automáticamente para incluir las cuatro columnas, preservando ID, periodicidad y estados. No se sobreescribe SQL personalizado. Para consultas personalizadas se proporciona **Actualizar desde esquema** en el editor de artículos y una opción para **actualizar todos los SELECT de artículos**, después de confirmación.
- PostgreSQL añade las cuatro columnas a `farmetrica.articulos` en la siguiente carga. La carga completa de artículos incorporará los valores y el usuario podrá verificarlos.
- **Retirar tabla stock antigua de PostgreSQL** en *Entidades de datos* es una operación separada y explícita, previa copia de seguridad. El servidor compara por farmacia e identificador cada fila existente en `stock` con `articulos` y comprueba `stock_actual, stock_minimo, stock_maximo, lote_optimo`. Si falta una fila o difieren valores, **no se elimina nada**; ejecuta primero las cargas completas de artículos necesarias. El borrado se hace con `DROP TABLE ... RESTRICT`, sin `CASCADE`.
- No volver a crear manualmente una entidad independiente llamada `stock`. Si se necesita el histórico de existencias en una evolución futura, utilizar una entidad claramente diferente para snapshots temporales o movimientos de inventario; `articulos.stock_actual` solo representa el estado presente.

Secuencia recomendada: actualizar Farmétrica Sync, revisar los trabajos de artículos, pulsar **Actualizar desde esquema** si alguna consulta es personalizada, completar las cargas de artículos de las cinco farmacias, verificar PostgreSQL y retirar la tabla antigua de stock con el botón protegido.

## v0.14 · Progreso en vivo durante lecturas Farmatic y diagnóstico de cortes de stream

La versión v0.13 podía mostrar `0 lotes` hasta terminar el primer batch (normalmente 5.000 filas) **y la pantalla Resumen no se actualizaba automáticamente**. Esto podía interpretarse como un proceso colgado incluso cuando Farmatic seguía leyendo registros.

- La lectura SQL Server comunica las **filas ya recibidas** al sincronizador tras la primera y cada 250 filas, y al finalizar la lectura. Este contador es provisional hasta el `COMMIT` PostgreSQL. El número de **lotes completados** solo aumenta cuando el lote se ha importado, reconciliado y vaciado en PostgreSQL.
- Las pantallas **Resumen e Historial** se actualizan automáticamente cada tres segundos mientras estén visibles. No hace falta refrescar manualmente. No se actualizan automáticamente formularios de edición.
- La vista de ejecuciones informa de la fase y **última actividad**; si no hay avance comunicado en dos minutos, lo indica como aviso, sin afirmar que el proceso haya muerto.
- Los errores `Exception while reading from stream` se registran con la **etapa de ejecución y cadena de excepciones internas**, para diferenciar cortes PostgreSQL/SSH de otros problemas de SQL Server. Las cadenas con `Password=`/`Pwd=` se ocultan. El punto incremental nunca se adelanta ante un fallo.
- Si fallan lotes después de haber leído registros, el historial conserva el **número de filas recibidas y lotes que alcanzó a preparar**, señalados como **provisionales y no confirmados**. El dato no representa filas importadas con éxito: la transacción se revierte.
- Ningún error se reintenta a mitad de la transacción; la siguiente ejecución planificada reanuda desde el último cursor confirmado. No modificar trabajos ni conexiones de las farmacias durante cargas en curso.

Diagnóstico recomendado en la propia instalación si persiste: revisar **fase**, **última actividad**, **mensaje interno**, versión `/api/bootstrap-status`, y probar SSH/PostgreSQL desde el panel. La prueba local Windows/CI no reproduce por sí misma las condiciones reales de red del cliente.

## v0.15 · Panel y web responsivos bajo carga de sincronización

Se corrigen dos familias distintas de cuellos de botella:

1. **Servicio Windows y panel local** (`http://127.0.0.1:5080`): la lectura de configuración utiliza snapshots publicados de forma atómica, sin tomar el bloqueo que serializa o escribe el historial. El login verifica la contraseña fuera del cierre exclusivo, el panel evita acumular refrescos concurrentes y aplica tiempos de espera a las peticiones cortas. `GET /api/ping` no depende de PostgreSQL ni de la autenticación y permite comprobar la disponibilidad del servicio. Las cookies continúan protegidas con claves DPAPI persistidas en `%ProgramData%\FarmetricaSync\keys`; las sesiones de 12 horas pueden caducar normalmente y se solicitará nueva autenticación.
2. **PostgreSQL compartido con la web**: la preparación de esquema se realiza en transacciones CORTAS, únicamente si hacen falta columnas, con `lock_timeout=5s` en el DDL. Las cargas completas crean tablas temporales privadas y acumulan los lotes *sin abrir la transacción definitiva*. La transacción de la tabla de negocio empieza al terminar de recibir los lotes y aplica de manera atómica los cambios, con límite de espera por bloqueos. Los incrementales conservan su semántica transaccional de solo altas. Si una carga se interrumpe antes del COMMIT final, la tabla visible permanece intacta y su punto incremental no avanza.

**Web principal:** en el mismo repositorio se ha corregido el login React/Supabase Auth, que antes mostraba "Credenciales incorrectas" incluso ante problemas de conexión y esperaba la auditoría para redirigir. Las rutas públicas evitan el refresco de cookie en el middleware; las rutas protegidas siguen verificando autorización. El pool PostgreSQL de reportes limita las esperas por locks a 5 s y las consultas a 60 s. Debe desplegarse también la web para que estas mejoras estén activas, además de instalar v0.15 de Windows.

**Diagnóstico:** `(Invoke-RestMethod "http://127.0.0.1:5080/api/ping").version` confirma si Kestrel responde independientemente de la base de datos, mientras `/api/bootstrap-status` muestra el estado de la configuración. Ver también `docs/DIAGNOSTICO_BLOQUEOS_WEB.md` para identificar bloqueos reales en Contabo sin compartir contraseñas.

**Límites:** esto elimina la espera del panel tras el candado del historial y reduce el alcance de los locks de esquema y las transacciones largas. No garantiza latencia nula si PostgreSQL está saturado de CPU, disco o red durante la publicación final. No se ha ejecutado contra las cinco farmacias ni el Contabo real; primero comprobar ventanas y tiempos reales después de actualizar.
