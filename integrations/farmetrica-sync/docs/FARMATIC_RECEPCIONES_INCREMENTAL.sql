SELECT
    CONVERT(varchar(100), r.IdRecepcion) AS origen_id,
    TRY_CONVERT(datetime2, r.Fecha) AS fecha,
    CAST(NULL AS varchar(100)) AS articulo_id,
    CONVERT(varchar(100), r.XProv_IdProveedor) AS proveedor_id,
    CAST(NULL AS decimal(18,4)) AS unidades,
    CAST(NULL AS decimal(18,4)) AS coste_unitario,
    CAST(NULL AS decimal(18,4)) AS importe,
    CONVERT(varchar(60), r.Hora) AS hora_recepcion,
    TRY_CONVERT(datetime2, r.Hora) AS fecha_hora_recepcion,
    CONVERT(varchar(100), r.NPedido) AS numero_pedido,
    CONVERT(varchar(100), r.IdAlbaran) AS albaran_id,
    CONVERT(varchar(100), r.XCPro_IdCondicion) AS condicion_id,
    CONVERT(varchar(100), r.XVend_IdVendedor) AS vendedor_id,
    TRY_CONVERT(bit, r.Actualizado) AS recepcion_actualizada,
    TRY_CONVERT(bit, r.Demorada) AS recepcion_demorada,
    CONVERT(nvarchar(255), r.FIS_NOMBRE) AS proveedor_nombre,
    CONVERT(nvarchar(2000), r.Descripcion) AS descripcion
FROM {{TABLE:dbo.vRecep}} AS r
WHERE r.Fecha >= CONVERT(date, @desde)
  AND r.Fecha < CONVERT(date, @hasta)
