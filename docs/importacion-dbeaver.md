# Primera carga SQL Server → PostgreSQL (DBeaver Community)

## 1. Conexiones
- SQL Server: conexión VPN ya configurada en Windows, usuario de **solo lectura**.
- PostgreSQL en Contabo: DBeaver con túnel SSH al VPS y conexión PostgreSQL a `127.0.0.1:15432` **en el lado del VPS**.
- Base de datos: la del contenedor `farmawao-db-1`. La API crea el maestro `public.farmacias` y la tabla inicial `public.stock_farmacia` al arrancar, mediante la migración `api/src/migrations/001_farmacias.sql`. Si todavía no está desplegada, ejecuta esa migración en DBeaver conectado a PostgreSQL, una sola vez.

## 2. Consulta SQL Server para un stock unificado inicial
Ejecutar desde la conexión SQL Server **central** donde ya funcionan los linked servers del ejemplo. No crea ni modifica tablas de origen.

```sql
SELECT 'F001' AS id_farmacia, CAST(a.IdArticu AS nvarchar(100)) AS id_articu,
       a.Descripcion AS descripcion, a.StockActual AS stock_actual
FROM Farmatic.dbo.Articu AS a

UNION ALL
SELECT 'F002', CAST(e.IdArticu AS nvarchar(100)), e.Descripcion, e.StockActual
FROM OPENQUERY([192.168.11.11],
  'SELECT IdArticu, Descripcion, StockActual FROM Farmatic.dbo.Articu') AS e

UNION ALL
SELECT 'F003', CAST(b.IdArticu AS nvarchar(100)), b.Descripcion, b.StockActual
FROM OPENQUERY([192.168.13.11],
  'SELECT IdArticu, Descripcion, StockActual FROM Farmatic.dbo.Articu') AS b

UNION ALL
SELECT 'F004', CAST(s.IdArticu AS nvarchar(100)), s.Descripcion, s.StockActual
FROM OPENQUERY([192.168.12.11],
  'SELECT IdArticu, Descripcion, StockActual FROM Farmatic.dbo.Articu') AS s

UNION ALL
SELECT 'F005', CAST(p.IdArticu AS nvarchar(100)), p.Descripcion, p.StockActual
FROM OPENQUERY([192.168.14.11],
  'SELECT IdArticu, Descripcion, StockActual FROM Farmatic.dbo.Articu') AS p;
```

**Aviso:** antes de cargar, verifica con el administrador que la tabla `Articu` tiene `Descripcion` y `StockActual` en todas las farmacias, y confirma que ABA/EUR/BUE/EST/POL corresponden a las cinco farmacias. La tabla `dbo.Articu` del servidor central (`alm` en el SQL aportado) parece representar otro stock y **no se ha confundido con una sexta farmacia**.

## 3. Transferir los resultados
1. Ejecuta la consulta y revisa el número de filas y las columnas.
2. Clic derecho **sobre la cuadrícula de resultados** → **Export Resultset** (o **Export data**, según la versión).
3. Destino **Database** → conexión PostgreSQL → tabla **existente** `public.stock_farmacia`.
4. En el paso de mapeo, verifica que las columnas coinciden: `id_farmacia`, `id_articu`, `descripcion`, `stock_actual`. La columna `importado_en` toma su valor por defecto.
5. Ejecuta la importación. La clave primaria es (`id_farmacia`,`id_articu`), por lo que **una segunda carga INSERT no es incremental**: daría duplicados. Para repetición, usar un upsert programado y tratamiento de bajas.

## 4. Comprobar en PostgreSQL
```sql
SELECT f.id, f.nombre, count(s.id_articu) AS articulos,
       max(s.importado_en) AS ultima_carga
FROM public.farmacias f
LEFT JOIN public.stock_farmacia s ON s.id_farmacia = f.id
GROUP BY f.id, f.nombre
ORDER BY f.id;
```

## 5. Ventas: pendientes del esquema real
Para replicar **ventas exactamente**, necesitamos conocer el nombre real de la tabla, clave primaria, columnas, tipos y qué campos marcan modificaciones/anulaciones. No se puede deducir el esquema de ventas a partir de una consulta de stock. Cuando se facilite el DDL o `SELECT TOP 10`, crearemos una tabla de destino con las columnas originales, `id_farmacia` y una clave compuesta por farmacia + clave del origen. Evitar unir por `IdArticu` si el origen de ventas usa otra clave o negocio.

**Seguridad:** no incluir passwords ni credenciales SQL en el repositorio. No abrir PostgreSQL al público; usar SSH o VPN.
