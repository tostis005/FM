# Validación preproducción — lista de aceptación

- [ ] Compilar en Windows con .NET 10 SDK (`publicar-win-x64.ps1`) sin errores ni advertencias críticas.
- [ ] Instalar y comprobar inicio/reinicio del servicio Windows con cuenta de servicio aprobada.
- [ ] Panel admin solo en `127.0.0.1:5080`; primera contraseña creada, sesión protegida, sin acceso sin autenticación.
- [ ] SQL Server accesible con certificado TLS confiable desde la identidad real del servicio.
- [ ] Linked Server verificado y permisos SELECT sobre tablas remotas de cada farmacia.
- [ ] PostgreSQL de pruebas: autenticación, SSL y permisos mínimos verificados.
- [ ] Contratos de columnas y consultas reales revisados con técnico de Farmatic.
- [ ] Alta de una farmacia y prueba de conexión, sin afectar al SQL original.
- [ ] Snapshot de stock y artículos: contar filas, importes y comparar muestras con SQL origen.
- [ ] Incremental de ventas/compras: primera carga, segunda sin cambios, altas con igual fecha y distintos identificadores, alta tardía dentro/fuera de solapamiento y nueva venta.
- [ ] Corte de red simulado: falla, mantiene watermark anterior, reintenta y evita duplicados.
- [ ] Reinicio del servicio durante operación: transacciones consistentes y reintento posterior.
- [ ] Verificar alertas SMTP de fallo y control de un aviso máximo por hora/consulta.
- [ ] Medir el volumen histórico, tiempos de consulta y bloqueo en SQL Server; evitar cargas en horas críticas.
- [ ] Cuadrar diferencias de unidades, descuentos, devoluciones, IVA y zona horaria.
- [ ] Confirmar que fuentes incrementales son realmente inmutables y registran la **fecha efectiva de inserción**.
- [ ] Confirmar la mayor latencia de publicación y verificar que está cubierta por ReplayMinutes.
- [ ] Confirmar gestión de bajas/borrados únicamente para fuentes snapshot.
- [ ] Añadir una entidad propia desde la interfaz y validar DDL normalizado.
- [ ] Documentar procedimientos de backup/restore de PostgreSQL, estado, claves y credenciales.
- [ ] Ajustar integración con la web Farmétrica para consumir las tablas reales y gestionar metadatos nuevos.

## Cargas históricas masivas: millones de tickets y TimeoutException

Si una reconciliación completa muestra millones de filas leídas y termina con
`NpgsqlException: Exception while reading from stream / Timeout during reading attempt`
durante «Staging privado preparado», **no es un resultado correcto**.
La versión original de `JoinedDocumentWriter` tenía comandos PostgreSQL con
`CommandTimeout = 180` y `statement_timeout = 180s`. Aunque el
`COPY` terminase, la validación de duplicados o los UPSERT podían exceder
3 minutos. El error ocurre antes del `Commit` final y no avanza el cursor
de sincronización. **No repetir masivamente hasta actualizar el ejecutable.**

La versión corregida construye un índice temporal por documento/línea
para lotes de al menos 1.000 filas, ejecuta `ANALYZE`, amplía cada
operación pesada a 30 minutos, conserva `lock_timeout = 5s` y muestra
«Indexando staging», «Validando ...», «Insertando ...» y
«Confirmando transacción». Los datos se siguen publicando atómicamente,
sin recortar la validación de duplicados o cabeceras. Si una fase vuelve
a alcanzar 30 minutos o el VPS carece de espacio para índices temporales,
será necesario analizar recursos y dividir la carga histórica de forma
segura; aumentar el timeout por sí solo no lo soluciona.

Para reintentar: (1) conservar copia de `%ProgramData%\\FarmetricaSync`,
(2) instalar el ZIP Windows de FM compilado *después* de la corrección,
(3) verificar espacio y actividad de PostgreSQL y el túnel SSH si se usa,
(4) previsualizar la consulta y probar primero un periodo acotado,
(5) ejecutar la reconciliación completa en una ventana de mantenimiento y
supervisar la fase de cada operación. **No cambiar el cursor manualmente**.
Si hay errores al confirmar, revisar `pg_stat_activity`, capacidad del
disco `pg_temp`, memoria y logs del servidor. No incluir credenciales ni
datos reales en los tickets públicos.
