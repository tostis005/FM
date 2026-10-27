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
