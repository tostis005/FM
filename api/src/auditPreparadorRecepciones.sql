-- Auditoría agregada, de solo lectura, del conjunto exacto de laboratorios del selector.
WITH aliases AS MATERIALIZED (
 SELECT a.proveedor_id AS lab,upper(btrim(a.farmacia_codigo)) AS pharmacy,
  CASE WHEN btrim(a.codigo_origen)~'^[0-9]+$'
   THEN coalesce(nullif(ltrim(btrim(a.codigo_origen),'0'),''),'0')
   ELSE upper(btrim(a.codigo_origen)) END AS supplier,
  EXISTS(SELECT 1 FROM farmetrica.proveedores_maestro pm
   WHERE pm.cliente_slug='ampedia'
    AND (pm.cooperativa OR pm.ignorar_informes OR pm.tipo='cooperativa')
    AND CASE WHEN btrim(pm.codigo_origen)~'^[0-9]+$'
      THEN coalesce(nullif(ltrim(btrim(pm.codigo_origen),'0'),''),'0')
      ELSE upper(btrim(pm.codigo_origen)) END =
        CASE WHEN btrim(a.codigo_origen)~'^[0-9]+$'
         THEN coalesce(nullif(ltrim(btrim(a.codigo_origen),'0'),''),'0')
         ELSE upper(btrim(a.codigo_origen)) END
    AND upper(btrim(pm.nombre))=upper(btrim(a.nombre_origen))) AS blocked
 FROM farmetrica.proveedores_unificados_alias a
 WHERE a.cliente_slug='ampedia' AND a.proveedor_id=ANY($1::bigint[])
  AND upper(btrim(a.farmacia_codigo))=ANY($2::text[])
),
received AS MATERIALIZED (
 SELECT k.lab,k.blocked,h.fecha,
  coalesce(
   CASE WHEN btrim(ar.codigo_nacional) ~ '^[0-9]{6,7}$' THEN btrim(ar.codigo_nacional) END,
   CASE WHEN btrim(ar.origen_id::text) ~ '^[0-9]{6,7}$' THEN btrim(ar.origen_id::text) END
  ) AS cn
 FROM aliases k
 JOIN ampedia.fm_recepciones_cabeceras h
  ON h.farmacia_codigo=k.pharmacy
   AND (CASE WHEN btrim(h.proveedor_origen_id)~'^[0-9]+$'
    THEN coalesce(nullif(ltrim(btrim(h.proveedor_origen_id),'0'),''),'0')
    ELSE upper(btrim(h.proveedor_origen_id)) END)=k.supplier
   AND h.lineas_completas AND NOT h.eliminada_logicamente
   AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')
 JOIN ampedia.fm_recepciones_lineas l ON l.farmacia_codigo=h.farmacia_codigo
  AND l.sistema_origen=h.sistema_origen AND l.documento_id=h.documento_id
  AND NOT l.eliminada_logicamente AND l.cantidad>0 AND l.devuelta IS NOT TRUE
 LEFT JOIN ampedia.articulos ar ON ar.farmacia_codigo=l.farmacia_codigo
  AND ar.origen_id::text=l.articulo_origen_id::text
),
