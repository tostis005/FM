# Familias y superfamilias Farmatic · carga completa

Origen **único** para las cinco farmacias, formado por `dbo.Familia`, `dbo.FamiliaAux` y `dbo.SuperFamilia`.

La plantilla preconfigurada se guarda como SELECT único de snapshot, sin `TOP` y sin parámetros temporales. Se relaciona con los artículos mediante `Articu.XFam_IdFamilia`, ya normalizado como `farmetrica.articulos.familia`.

## SELECT que ejecuta el sincronizador

```sql
SELECT
    CONVERT(varchar(100), f.IdFamilia) AS origen_id,
    LTRIM(RTRIM(CONVERT(nvarchar(500), f.Descripcion))) AS nombre,
    CONVERT(varchar(100), fa.IdSuperFamilia) AS superfamilia_id,
    LTRIM(RTRIM(CONVERT(nvarchar(500), sf.Descripcion))) AS superfamilia_nombre,
    TRY_CONVERT(decimal(18,4), f.Coef1) AS coeficiente_1,
    TRY_CONVERT(decimal(18,4), f.Coef2) AS coeficiente_2,
    TRY_CONVERT(decimal(18,4), f.FactorDtoCredito) AS factor_descuento_credito,
    TRY_CONVERT(decimal(18,4), f.desviacion) AS desviacion,
    CONVERT(varchar(100), f.XGrup_IdGrupoIva) AS grupo_iva_id,
    TRY_CONVERT(bit, f.DeducibleHacienda) AS deducible_hacienda,
    CONVERT(varchar(100), f.GRUPOFORMU) AS grupo_formulacion,
    CONVERT(varchar(100), f.Empresa) AS empresa,
    CONVERT(nvarchar(1000), f.InfoEspecial) AS informacion_especial
FROM {{TABLE:dbo.Familia}} AS f
LEFT JOIN {{TABLE:dbo.FamiliaAux}} AS fa
    ON fa.IdFamilia = f.IdFamilia
LEFT JOIN {{TABLE:dbo.SuperFamilia}} AS sf
    ON sf.IdSuperFamilia = fa.IdSuperFamilia
```

La macro `{{TABLE:dbo.X}}` se convierte automáticamente a `[BDFarmatic].[dbo].[X]` o `[LinkedServer].[BDFarmatic].[dbo].[X]` según la farmacia.

Se preservan familias sin superfamilia (campos `superfamilia_*` como NULL). Los nombres se recortan para eliminar los espacios de relleno habituales de columnas CHAR en Farmatic. El grupo de IVA queda en `text` para conservar ceros iniciales como `02`.

`empresa` es un atributo descriptivo. No se ha demostrado que `IdFamilia` sea único en todas las empresas/farmacias: por ello, antes de publicar cada snapshot el proceso **falla sin modificar destino** si el JOIN ha duplicado algún `origen_id`. No resolver por `TOP(1)`, porque ocultaría una jerarquía inconsistente.

## Validación de cardinalidad en SQL Server

Ejecutar en la conexión SQL Server *directa* Farmatic (o adaptar los nombres al Linked Server) para localizar problemas de clave:

```sql
SELECT f.IdFamilia, COUNT(*) AS filas_join
FROM Farmatic.dbo.Familia AS f
LEFT JOIN Farmatic.dbo.FamiliaAux AS fa
    ON fa.IdFamilia = f.IdFamilia
LEFT JOIN Farmatic.dbo.SuperFamilia AS sf
    ON sf.IdSuperFamilia = fa.IdSuperFamilia
GROUP BY f.IdFamilia
HAVING COUNT(*) > 1;
```

Esta consulta debe devolver **cero filas** si `IdFamilia` es una clave única válida. Si devuelve registros, revisar `Empresa` y multiplicidad antes de cambiar el diseño.

## Vinculación normalizada con artículos en PostgreSQL

```sql
SELECT
    a.farmacia_codigo,
    a.origen_id AS articulo_id,
    a.nombre AS articulo,
    a.familia AS familia_id,
    f.nombre AS familia_nombre,
    f.superfamilia_id,
    f.superfamilia_nombre,
    a.pvp,
    a.stock_actual
FROM farmetrica.articulos AS a
LEFT JOIN farmetrica.familias AS f
       ON f.farmacia_codigo = a.farmacia_codigo
      AND f.origen_id = a.familia
ORDER BY a.farmacia_codigo, a.origen_id
LIMIT 100;
```

La condición `farmacia_codigo` es imprescindible: una familia con ID 190 puede tener nombre y superfamilia diferentes en cada farmacia. No crear FK rígida hasta cargar y comprobar los maestros, porque podrían existir artículos con familias no dadas de alta en las vistas.

## Configuración / migración

En **Consultas SQL → Familias y superfamilias → Preparar familias para todas las farmacias** se crean solo los trabajos faltantes, uno por cada Farmatic, con `Mode=snapshot`, periodicidad diaria (1440 minutos), lote 1000, y **desactivados**. La acción es idempotente.

En cada farmacia: entrar a Editar, pulsar **Ver primeros 100 · periódica**, comprobar códigos y activar. Ejecutar una carga completa para el primer llenado de `farmetrica.familias`. A partir de ahí las completas periódicas reconcilian altas, cambios y bajas, sin afectar a otras farmacias.

El contrato se añade de forma **aditiva** a instalaciones existentes: no se recrean ventas, compras, artículos ni proveedores; se conservan credenciales, cursores, historial y claves. No hay llamadas externas nuevas ni tablas temporales permanentes.

Pendiente: verificar esta consulta contra cada SQL Server Farmatic real; los resultados facilitados validan el formato observado, pero no demuestran la ausencia de duplicados en toda la base ni en las cinco farmacias.
