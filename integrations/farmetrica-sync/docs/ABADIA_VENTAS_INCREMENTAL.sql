SELECT
    CONCAT(CONVERT(varchar(50), v.Empresa), '|',
           CONVERT(varchar(50), v.IdVenta), '|',
           CONVERT(varchar(50), v.IdNLinea)) AS origen_id,
    v.FechaHora AS fecha,
    CONVERT(varchar(100), v.Codigo) AS articulo_id,
    CAST(v.Cantidad AS decimal(18,4)) AS unidades,
    CAST(v.Pvp AS decimal(18,4)) AS precio_unitario,
    CAST(v.ImporteNeto AS decimal(18,4)) AS importe,
    CONVERT(varchar(100), v.NumeroDoc) AS numero_ticket,
    CAST(v.DescuentoLinea AS decimal(18,4)) AS descuento_linea,
    CAST(v.DescuentoOpera AS decimal(18,4)) AS descuento_operacion
FROM {{TABLE:dbo.vLineaVenta}} AS v
WHERE v.FechaHora >= @desde AND v.FechaHora < @hasta
