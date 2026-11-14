# FARMÉTRICA · Evolución SaaS con base independiente por cliente (14/11/2026)

## Decisión
Mantener **un solo producto y código**. El cliente real Ampedia continúa utilizando la misma base de datos, esquema `ampedia`, sincronizador, permisos y API mientras no termine una migración verificada. Cada alta comercial nueva pasará a una **base PostgreSQL separada**, no a un esquema ni a vistas enlazadas. La identidad (superadmin, permisos de pertenencia y catálogo de clientes) será un plano de control; los movimientos, configuraciones y datos operativos de un cliente pertenecerán a su plano de datos.

### Hallazgos confirmados en `main`
- `api/src/server.js` instancia un único `pg.Pool` desde `DATABASE_URL`.
- `api/src/tenant.js` resuelve cliente, rol, farmacia y módulos, pero sólo selecciona `esquema_datos` dentro de esa base; **no resuelve base de datos física**.
- Funcionalidades del preparador, transferidor, ventas, dashboards y otras cruzan `farmetrica.*` (tablas de control, consolidaciones, maestros) con `ampedia.*` (movimientos). La separación física requiere inventario de consultas y migración por etapas.
- `api/src/demoClients.js` crea vistas sobre movimientos del origen: comparte importes, productos, proveedores y datos operativos reales. **No es demo pública ni datos anonimizados**, aunque `pharmacyCodes.js` cambie códigos visibles.
- `web/src/main.jsx` conserva semilla local de Ampedia; cuando haya sesión real el cliente debe tomarse del contexto autenticado del servidor, sin que una pantalla demo herede esa semilla.
- `farmetrica.cliente_apariencia` ya permite marca, colores, logo y estilo visual por cliente; `farmetrica.cliente_modulos` ya habilita módulos; configuraciones del preparador y transferidor ya se guardan por `cliente_slug`.

## Arquitectura objetivo
```text
                   web Farmétrica (mismo frontend)
                             |
          login / autorización / selección de tenant
                             |
            plano de control SaaS (base propia)
            clientes, membresías, licencias, destino
                  /             |             \
       Ampedia actual      Demo Grupo     Demo Individual
       PostgreSQL real     PostgreSQL     PostgreSQL
       sin cambios         independiente  independiente
                                   ^           ^
                                   |           |
                    publicador de datasets DEMO validados
                                   ^
                             almacén de lectura
                          / réplica / export incremental
                                   ^
                          sincronizador de Ampedia
```

**Compatibilidad inicial:** el cliente sin entrada en `cliente_despliegues` sigue en la ruta heredada. El registro de ubicación introducido en `064` **aún no cambia conexiones**. No activar `base_independiente` hasta desarrollar y probar el router/pool por cliente o un API dedicado por tenant usando la misma imagen. Al principio un proceso API por cliente con `DATABASE_URL` propio puede reducir el riesgo frente a un refactor masivo; el control de sesión y dominios debe probarse igualmente.

## Las dos demos
1. **Demo Grupo**: todas las farmacias elegibles del origen, nombres/códigos ficticios, apariencia y logos de Farmétrica o marca genérica. Sin nombre de cadena, ubicaciones, hostname, cuentas ni logos originales.
2. **Demo Individual**: una farmacia del mismo origen, con su propio catálogo y operaciones, **una sola farmacia en base de datos, permisos, API, filtros, informes y exportaciones**. No basta esconder cuatro opciones en el frontend. Todos los totales y comparativas se recalculan sólo desde esa farmacia.
3. Dos destinos **físicamente distintos**. La demo de grupo no debe ser la base de datos de lectura de la demo individual; ambas derivan de una entrega saneada y versionada. Los nombres demo se configurarán por tenant y no en el origen. El maestro de farmacias, los perfiles, la marca y la configuración de módulos deben ser específicos a cada demo.

**Copia exacta funcional, no copia literal de datos:** reproducir esquemas, cobertura analítica, histórico útil y funcionalidad sin copiar identificadores personales, datos identificables de empleados, pacientes, recetas, documentos libres, hosts internos ni identificadores comerciales cuya divulgación no esté autorizada. Los nombres de farmacias no son garantía de anonimización. Si un dato se comparte con posibles clientes ajenos, exigir revisión de reidentificación y de secretos comerciales; para pantallas con información sensible o imposible de sanear, usar datos sintéticos coherentes. Los importes y los patrones reales pueden revelar identidad por comparación externa.

## Alimentación asíncrona propuesta
1. **No** realizar escrituras a demos desde las transacciones del sincronizador Windows.
2. Publicar del origen una única fuente incremental controlada (idealmente réplica de lectura o proceso de exportación limitado). Los mecanismos de replicación SQL nativos **no anonimizan por sí mismos** y pueden retener WAL si el destino se atasca. Medir y monitorizar antes de habilitar.
3. Un worker separado lee sólo columnas y tablas de una **lista permitida**; transforma nombres, códigos, IDs, vendedores, documentos y campos libres con reglas aprobadas; rechaza por defecto tablas y columnas nuevas.
4. Preparar una instantánea coherente de datos saneados en staging con versión de esquema. Validar FKs, filas, coherencia entre compras/ventas, duplicados, filtros de farmacia, agregados, PUC, stock y exclusiones. No usar `SELECT *`.
5. Publicar con upsert incremental idempotente y borrados propagados. Dos consumidores independientes escriben en Demo Grupo y Demo Individual con permisos de escritura exclusivos de esos destinos.
6. Grabar checkpoint por origen/tabla, sello de actualización, versión de transformación y estado por demo. Mostrar en superadministración frescura y fallos. No reanudar un destino si la versión de anonimización no está auditada.
7. Limitar consultas en el origen por lotes, tiempo y horario, con backpressure. Si hay saturación, **la demo se retrasa**; la carga operativa del real siempre tiene prioridad.

Recomendación: empezar con una copia completa inicial fuera del horario operativo y actualizaciones incrementales cada 30–60 minutos, ajustando con benchmarks; no prometer impacto cero. Publicar demos sólo si los datos tienen suficiente frescura y la auditoría está aprobada.

## Personalización sin bifurcar el código
**Nivel 1:** identidad visual, nombres, permisos, módulos y ubicación/farmacias.
**Nivel 2:** parámetros por cliente: días de cobertura, umbrales, columnas visibles, métricas, filtros, vistas predeterminadas.
**Nivel 3:** variantes aprobadas de algoritmos y flujos (p. ej. transferidor `estandar`, `con_reserva`, `consolidado`), habilitadas mediante `cliente_personalizaciones` y validadas en backend. No aceptar SQL ni fragmentos de código del cliente, no crear un fork por farmacia. Las nuevas variantes comienzan con comportamiento estándar si no existe configuración.

## Fases verificables
- **Fase 0 (este PR):** inventario, contrato de arquitectura, tablas de registro aditivas, validaciones y tests de planificación. Sin conexiones nuevas, sin copias, sin activar demos, sin cambios de sincronizador ni de cálculo.
- **Fase 1:** preparar plantilla de BD independiente y migraciones reproducibles. Ejecutarla en una base vacía, contar tablas/vistas dependientes, comprobar que una instancia puede servir todas las pantallas de Ampedia sin dependencia cruzada.
- **Fase 2:** separar control plane y data plane, resolver tenant **sólo desde sesión verificada**, no desde un valor libre que seleccione DSN. Implementar pool/router con credenciales mínimas, límite de conexiones, lista cerrada de destinos y bloqueo de fallback. Pruebas de acceso cruzado, SQL, descargas, cachés, procesos programados, IA/MCP y auditar subconsultas no cualificadas.
- **Fase 3:** worker de datos saneados con prueba reproducible de anonimizacion, export y validación por tabla, incluyendo datos históricos. Garantizar no publicar hasta aprobación de auditoría y prueba de consistencia.
- **Fase 4:** crear físicamente Demo Grupo y Demo Individual, tematizar, asignar accesos limitados y probar todas las pantallas reales de ambos escenarios. Activación progresiva sin cambiar el DSN del origen.
- **Fase 5:** nuevas farmacias reales con BD independiente y variantes configurables. Medir consumo, migraciones, observabilidad, mantenimiento, backups/restauración por cliente, portabilidad y eliminación segura.

## Criterios de aceptación antes de compartir demos
- Ninguna query de una demo puede acceder a `ampedia.*`, al PostgreSQL real o a una vista del origen.
- Ningún identificador original aparece en UI, export CSV, informe, URL, metadatos JSON, caché local, logs accesibles, imagen, documento adjunto ni asistente/MCP.
- Caso monofarmacia: exactamente una farmacia en las respuestas API, permisos y tablas fuente; todo indicador responde sólo a ella.
- Seguridad: login separado y revocación, sin cambios de escritura en el cliente de origen; verificar también tareas en segundo plano.
- Rendimiento: latencias P95/P99, uso de CPU/I/O, bloqueos y tiempo de sincronización reales comparados antes y después. Si empeoran, desactivar el worker sin tocar Ampedia.
- Cada destino es restaurable individualmente y conserva auditoría de fuente y versión de anonimización.

## Riesgos de despliegue
La lista de migraciones del workflow de producción es **explícita**: añadir `064` a la lista, sin reejecutar DDL pesada. Los datos del origen permanecen intactos. Reversión del código: desactivar las nuevas rutas y conservar tablas aditivas sin pérdida de datos. **No** ejecutar `CREATE DATABASE`, `pg_dump`, `CREATE SUBSCRIPTION`, importar datos reales ni activar accesos comerciales en esta fase.
