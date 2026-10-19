# Diagnóstico de bloqueos y sesiones · Farmétrica Sync v0.15

## Qué depende de qué

- **Panel local `127.0.0.1:5080`**: Kestrel/.NET, contraseña local en `sync-config.json`, cookies protegidas por Data Protection/DPAPI en la carpeta `keys`. No consulta PostgreSQL para cargar `/api/config`, `/api/runs` ni para validar la contraseña.
- **Web principal**: Next.js + autenticación **Supabase Auth** y perfiles en Supabase. Los reportes utilizan un pool PostgreSQL separado, en Contabo, con `FARMETRICA_POSTGRES_URL`.
- **Sincronizador**: lee Farmatic SQL Server y escribe en el esquema configurado de Contabo PostgreSQL. La carga completa prepara lotes temporalmente sin mantener una transacción larga en las tablas de negocio; solo la publicación final es transaccional.

## Si la web no responde durante la carga

1. **Windows, PowerShell**:
   ```powershell
   Invoke-RestMethod http://127.0.0.1:5080/api/ping
   Invoke-RestMethod http://127.0.0.1:5080/api/bootstrap-status
   Get-Service FarmetricaSync
   ```
   La primera ruta no autentica ni accede a PostgreSQL. Si responde y la web principal no, el servicio Windows está vivo y se debe investigar la web o PostgreSQL, no la contraseña local. Si `initialized = false` tras haber configurado contraseña, revisar la carpeta ProgramData/configuración: NO crear nuevo admin a ciegas.
2. **Contabo (psql)**: comprobar las sesiones bloqueadas:
   ```sql
   SELECT pid, application_name, state,
          now() - query_start AS tiempo_consulta,
          wait_event_type, wait_event,
          pg_blocking_pids(pid) AS bloqueadores,
          left(query, 180) AS consulta
   FROM pg_stat_activity
   WHERE datname = 'farmawao'
     AND pid <> pg_backend_pid()
   ORDER BY query_start NULLS LAST;
   ```
   `pg_blocking_pids(pid)` no vacío demuestra espera por bloqueo. Si está vacío y las peticiones tardan, estudiar CPU, disco, red, índices y conexiones; no asumir un lock. El sincronizador identifica sus sesiones como `application_name = 'FarmetricaSync'`.
3. **Web/Supabase**: un error HTTP de red, tiempo agotado o una indisponibilidad de Supabase Auth no demuestra contraseña incorrecta. La web ahora distingue esos errores. Verificar despliegue web por separado del servicio Windows.
4. En **Historial** inspeccionar la farmacia, entidad, fase, última actividad, lotes y error interno. Las cifras provisionales de una carga fallida no se han confirmado.

## Qué cambia en v0.15

- El histórico puede persistir 10.000 ejecuciones sin mantener bloqueado el login ni los GET de configuración. Las lecturas consumen snapshots de memoria publicados atómicamente.
- El middleware público de Next.js no espera por refrescos innecesarios de Supabase; rutas protegidas **sí** deben validar la sesión.
- PostgreSQL ejecuta DDL de schema solo cuando falta una tabla o columna; una transacción DDL corta tiene `lock_timeout = 5s`. Se evitan los bloqueos exclusivos prolongados de `ALTER TABLE`.
- En snapshot: preparar en tablas temporales privadas `ON COMMIT PRESERVE ROWS`, sin transacción de negocio. Al concluir la lectura, comparar y aplicar cambios en una sola transacción. Fallos antes de esa fase dejan el destino sin modificar.
- En la web principal: pool PostgreSQL con `lock_timeout=5s`, `statement_timeout=60s`, `query_timeout=65s`; un informe lento falla de forma acotada, en lugar de agotar indefinidamente conexiones.

## Seguridad y operación

- No exponer directamente el panel en `0.0.0.0`; permanece en loopback.
- No quitar la verificación de host SSH ni la protección DPAPI.
- Nunca reiniciar el servicio ni instalar una actualización mientras esté ejecutando una carga: interrumpe la conexión y revierte el trabajo.
- Hacer copia de `%ProgramData%\FarmetricaSync` y del PostgreSQL antes de cambios de versión.
- No borrar ni regenerar `keys`, `sync-config.json` ni restablecer usuario si aparece login no disponible. Distinguir falta de servicio, sesión vencida, error de contraseña y caída de Supabase.
- Los cambios del repositorio de la web principal requieren su despliegue (por ejemplo Vercel) para entrar en funcionamiento; instalar el ZIP del servicio Windows no actualiza por sí solo esa web.

Esta guía no sustituye un análisis real de `pg_stat_activity` y logs del servidor. Los tests CI verifican compilación y concurrencia local, no simulan la base de datos ni la red real del usuario.
