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
receipt_count AS (
 SELECT lab,count(*)::int AS lines,
 count(*) FILTER(WHERE NOT blocked)::int AS included_lines
 FROM received GROUP BY lab
), cn_by_lab AS MATERIALIZED (
 SELECT lab,cn,bool_or(NOT blocked) AS allowed,
 max(fecha) FILTER(WHERE NOT blocked) AS latest
 FROM received WHERE cn IS NOT NULL GROUP BY lab,cn
),
lab_count AS (
 SELECT lab,count(*)::int AS cn,
 count(*) FILTER(WHERE allowed)::int AS included_cn
 FROM cn_by_lab GROUP BY lab
), labs AS MATERIALIZED (
 SELECT v.lab,coalesce(r.lines,0) AS lines,
 coalesce(r.included_lines,0) AS included_lines,
 coalesce(c.cn,0) AS cn,coalesce(c.included_cn,0) AS included_cn
 FROM unnest($1::bigint[]) v(lab)
 LEFT JOIN receipt_count r ON r.lab=v.lab
 LEFT JOIN lab_count c ON c.lab=v.lab
),
duplicate_cn AS (
 SELECT cn,count(*)::int AS laboratories
 FROM cn_by_lab WHERE allowed GROUP BY cn HAVING count(*)>1
),
last_received AS (
 SELECT cn,lab,rank() OVER(PARTITION BY cn ORDER BY latest DESC) AS rank_order
 FROM cn_by_lab WHERE allowed
)
SELECT count(*)::int AS laboratories,
 count(*) FILTER(WHERE lines=0)::int AS no_receipt_lines,
 count(*) FILTER(WHERE included_lines=0)::int AS no_unblocked_receipt_lines,
 count(*) FILTER(WHERE cn=0)::int AS no_cn,
 count(*) FILTER(WHERE included_cn=0)::int AS no_eligible_cn,
 count(*) FILTER(WHERE cn>0 AND included_cn=0)::int AS excluded_labs,
 count(*) FILTER(WHERE included_cn>0)::int AS labs_with_cn,
 (SELECT count(*)::int FROM duplicate_cn) AS cn_multiple_labs,
 (SELECT coalesce(sum(laboratories-1),0)::int FROM duplicate_cn) AS extra_assignments,
 (SELECT count(DISTINCT cn)::int FROM cn_by_lab WHERE allowed) AS unique_cn,
