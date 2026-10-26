WITH refs AS MATERIALIZED (
 SELECT reference,cn FROM jsonb_to_recordset($1::jsonb) AS r(reference text,cn text)
), pharmacies AS (
 SELECT f.id,__FARMACIA_CODE__ AS source_code
 FROM farmetrica.farmacias f
 WHERE f.cliente_slug=$3 AND f.id=ANY($2::int[])
), article_matches AS (
 -- Cada vía de identificación se resuelve por separado. El OR anterior
 -- impedía usar los índices de Farmatic y multiplicaba los escaneos.
 SELECT f.id AS pharmacy_id,x.reference,a.origen_id::text AS article_id,
   a.stock_actual::float8 AS stock,a.sincronizado_en AS stock_at
 FROM refs x CROSS JOIN pharmacies f
 JOIN __SCHEMA__.articulos a
  ON upper(btrim(a.farmacia_codigo))=f.source_code
   AND a.origen_id::text=x.cn
 WHERE x.cn IS NOT NULL
 UNION ALL
 SELECT f.id,x.reference,a.origen_id::text,
   a.stock_actual::float8,a.sincronizado_en
 FROM refs x CROSS JOIN pharmacies f
 JOIN __SCHEMA__.articulos a
  ON upper(btrim(a.farmacia_codigo))=f.source_code
   AND btrim(a.codigo_nacional)=x.cn
 WHERE x.cn IS NOT NULL AND nullif(btrim(a.codigo_nacional),'') IS NOT NULL
 UNION ALL
 SELECT f.id,x.reference,a.origen_id::text,
   a.stock_actual::float8,a.sincronizado_en
 FROM refs x CROSS JOIN pharmacies f
 JOIN __SCHEMA__.articulos a
  ON upper(btrim(a.farmacia_codigo))=f.source_code
   AND nullif(btrim(__CN_NORMALIZED__),'')=x.cn
 WHERE x.cn IS NOT NULL
 UNION ALL
 SELECT f.id,x.reference,a.origen_id::text,
   a.stock_actual::float8,a.sincronizado_en
 FROM refs x CROSS JOIN pharmacies f
 JOIN __SCHEMA__.articulos a
  ON upper(btrim(a.farmacia_codigo))=f.source_code
   AND a.origen_id::text=split_part(x.reference,':',3)
 WHERE x.cn IS NULL AND x.reference='ERP:'||f.id::text||':'||a.origen_id::text
), articles AS MATERIALIZED (
 SELECT DISTINCT ON (pharmacy_id,article_id,reference)
  pharmacy_id,reference,article_id,stock,stock_at
 FROM article_matches
 ORDER BY pharmacy_id,article_id,reference,stock_at DESC NULLS LAST
), inventory AS (
 SELECT pharmacy_id,reference,
  CASE WHEN count(stock)=count(*) THEN sum(stock)::float8 ELSE NULL::float8 END AS stock,
  min(stock_at) AS stock_at
 FROM articles GROUP BY pharmacy_id,reference
), eligible_articles AS MATERIALIZED (
 -- La misma referencia/CN puede tener varios registros ERP. Identificar
 -- cada pareja farmacia+artículo una sola vez antes de leer sus ventas.
 SELECT DISTINCT pharmacy_id,article_id FROM articles
), calculation_day AS MATERIALIZED (
 -- Ventas 3m y 12m siempre respecto a HOY en España.
 -- El rango $4/$5 se reserva para "V. período" (ej.: verano anterior).
 SELECT (now() AT TIME ZONE 'Europe/Madrid')::date AS today
), sales_per_article AS MATERIALIZED (
 -- Leer primero solo las líneas de los artículos seleccionados usando
 -- fm_preparador_ventas_linea_idx (farmacia, articulo, sistema, documento).
 -- Unir después las cabeceras por PK y fecha. Evita expandir toda la vista
 -- fm_ventas_analitica por cada CN del laboratorio.
 SELECT a.pharmacy_id,a.article_id,
  coalesce(sum(CASE WHEN l.devuelta THEN -abs(l.cantidad) ELSE l.cantidad END)
    FILTER (WHERE h.fecha >= $4::date AND h.fecha < $5::date+interval '1 day'),0)::float8 AS sold,
  coalesce(sum(CASE WHEN l.devuelta THEN -abs(l.cantidad) ELSE l.cantidad END)
    FILTER (WHERE h.fecha >= d.today-interval '89 days'
       AND h.fecha < d.today+interval '1 day'),0)::float8 AS v3,
  coalesce(sum(CASE WHEN l.devuelta THEN -abs(l.cantidad) ELSE l.cantidad END)
    FILTER (WHERE h.fecha >= d.today-interval '364 days'
       AND h.fecha < d.today+interval '1 day'),0)::float8 AS v12
 FROM eligible_articles a
 CROSS JOIN calculation_day d
 JOIN pharmacies scope ON scope.id=a.pharmacy_id
 JOIN __SCHEMA__.fm_ventas_lineas l
  ON l.farmacia_codigo=scope.source_code AND l.articulo_origen_id=a.article_id
   AND NOT l.eliminada_logicamente AND coalesce(l.anulada,false)=false
 JOIN __SCHEMA__.fm_ventas_cabeceras h
  ON h.farmacia_codigo=l.farmacia_codigo AND h.sistema_origen=l.sistema_origen
   AND h.documento_id=l.documento_id
   AND h.lineas_completas AND NOT h.eliminado_logicamente
   AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')
   AND (
     (h.fecha >= $4::date AND h.fecha < $5::date+interval '1 day')
     OR (h.fecha >= d.today-interval '364 days'
         AND h.fecha < d.today+interval '1 day')
   )
 GROUP BY a.pharmacy_id,a.article_id
), movements AS (
 SELECT a.pharmacy_id,a.reference,
  sum(s.sold)::float8 AS sold,
  sum(s.v3)::float8 AS v3,
  sum(s.v12)::float8 AS v12
 FROM articles a JOIN sales_per_article s
  ON s.pharmacy_id=a.pharmacy_id AND s.article_id=a.article_id
 GROUP BY a.pharmacy_id,a.reference
), pending_orders AS MATERIALIZED (
 -- Expandir el JSON de cada pedido UNA VEZ, no una vez por artículo/CN.
 SELECT p.farmacia_id,order_line.elem->>'articulo' AS article_id,
  sum(coalesce((assignment.elem->>'unidades')::float8,0))::float8 AS qty
 FROM farmetrica.op_pedidos p
 JOIN pharmacies f ON f.id=p.farmacia_id
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.lineas,'[]'::jsonb)) AS order_line(elem)
 CROSS JOIN LATERAL jsonb_array_elements(
  coalesce(order_line.elem->'asignaciones','[]'::jsonb)) AS assignment(elem)
 WHERE p.cliente_slug=$3
  AND p.estado IN ('borrador','pendiente_aprobacion','aprobado','exportado')
 GROUP BY p.farmacia_id,order_line.elem->>'articulo'
), pending AS (
 SELECT a.pharmacy_id,a.reference,
  sum(p.qty)::float8 AS qty
 FROM articles a
 JOIN pending_orders p ON p.farmacia_id=a.pharmacy_id
  AND p.article_id=a.article_id
 GROUP BY a.pharmacy_id,a.reference
)
SELECT x.reference,f.id::text AS "pharmacyId",
 i.stock,i.stock_at AS "stockAt",
 coalesce(m.sold,0)::float8 AS "unitsPeriod",
 coalesce(m.v3,0)::float8 AS "units3",
 coalesce(m.v12,0)::float8 AS "units12",
 coalesce(pending.qty,0)::float8 AS ordered,
 CASE WHEN i.stock IS NULL THEN NULL::int
 ELSE greatest(0,least(999999,ceil(
  greatest(coalesce(m.v3,0)/90.0,coalesce(m.v12,0)/365.0)*
   (coalesce(policy.cobertura_saludable,20) + $6::int + coalesce(policy.plazo_entrega,2))
   -i.stock-coalesce(pending.qty,0)-1e-9)))::int END AS suggested
FROM refs x CROSS JOIN pharmacies f
LEFT JOIN inventory i ON i.pharmacy_id=f.id AND i.reference=x.reference
LEFT JOIN movements m ON m.pharmacy_id=f.id AND m.reference=x.reference
LEFT JOIN pending ON pending.pharmacy_id=f.id AND pending.reference=x.reference
LEFT JOIN farmetrica.op_politicas_reposicion policy
 ON policy.cliente_slug=$3 AND policy.farmacia_id=f.id
ORDER BY x.reference,f.id;
