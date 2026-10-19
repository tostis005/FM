# Sincronizador consolidado en FM

El código mantenido para Windows vive en `integrations/farmetrica-sync/` de `tostis005/FM`.
La compilación de Windows es **independiente** del despliegue web: `.github/workflows/farmetrica-sync-windows.yml` valida el conector y genera un ZIP.
El workflow web `deploy.yml` solo escucha cambios de `web/**`, `api/**`, `deploy/**` y su propia configuración. Un commit en el sincronizador no despliega la web.

## Separación operativa

- **Web + API** (Vite/Express): procesos Docker del VPS. Ni el login ni las páginas necesitan que el servicio Windows esté arrancado.
- **FarmetricaSync**: servicio Windows .NET local, con panel en loopback; consulta el SQL Server ERP y escribe PostgreSQL por su propia conexión (con SSH si está habilitado).
- **PostgreSQL**: es el único recurso compartido. Una escritura intensiva puede causar contención de E/S y locks si no se programa correctamente, por lo que independencia de procesos no equivale a garantía absoluta de disponibilidad.

La API configura tiempos máximos de conexión, consulta y espera por bloqueo. El conector hace los DDL puntuales fuera de los ciclos largos de importación, con `lock_timeout` y transacciones cortas. No ejecutar manualmente `ALTER TABLE` de ventas/recepciones durante una carga activa.

## Despliegue seguro del servicio

1. Verificar y descargar el ZIP compilado por **Farmetrica Sync · Windows** desde las Actions de FM.
2. Comprobar que no hay ninguna ejecución activa, hacer copia de `%ProgramData%\\FarmetricaSync` y una copia apropiada de la base de datos.
3. Detener el servicio en mantenimiento, instalar el ZIP y reiniciarlo conservando configuración, claves y cursores.
4. Probar conexión SQL Server, PostgreSQL y SSH, previsualizar 100 filas de cada flujo, ejecutar una carga pequeña y comprobar duplicados/bloqueos de `pg_stat_activity`.
5. Solo después habilitar las programaciones y observar resultados y latencias web.

**No se ha instalado un binario ni se ha ejecutado una migración sobre el VPS al cambiar el repositorio.** La versión instalada debe verificarse antes de afirmar que los bloqueos están corregidos en producción.

## Pendiente de definición SQL

- Tickets: SELECT de cabeceras, SELECT de líneas, claves comunes, fecha/modificación/estado y descuentos.
- Recepciones: SELECT de cabeceras, SELECT de líneas, claves comunes, fecha/modificación/estado y descuentos/bonificaciones.
- Pedidos: cabeceras y líneas, si Farmatic los expone.

No inventar columnas del ERP. Mantener plantillas compatibles con los SELECT existentes hasta validar esquemas reales.
