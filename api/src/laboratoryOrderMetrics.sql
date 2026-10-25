WITH refs AS MATERIALIZED (
 SELECT reference,cn FROM jsonb_to_recordset($1::jsonb) AS r(reference text,cn text)
), pharmacies AS (
 SELECT f.id,__FARMACIA_CODE__ AS source_code
 FROM farmetrica.farmacias f
 WHERE f.cliente_slug=$3 AND f.id=ANY($2::int[])
), articles AS MATERIALIZED (
 SELECT DISTINCT ON (f.id,a.origen_id::text,x.reference)
  f.id AS pharmacy_id,x.reference,a.origen_id::text AS article_id,
  a.stock_actual::float8 AS stock,a.sincronizado_en AS stock_at
 FROM __SCHEMA__.articulos a
 JOIN farmetrica.farmacias f ON f.cliente_slug=$3 AND f.id=ANY($2::int[])
  AND upper(btrim(a.farmacia_codigo))=__FARMACIA_CODE__
 JOIN refs x ON (x.cn IS NOT NULL AND
   (nullif(btrim(a.codigo_nacional),'')=x.cn
    OR (nullif(btrim(a.codigo_nacional),'') IS NULL
     AND btrim(a.origen_id::text)=x.cn)))
  OR (x.cn IS NULL AND x.reference='ERP:'||f.id::text||':'||a.origen_id::text)
 ORDER BY f.id,a.origen_id::text,x.reference,a.sincronizado_en DESC NULLS LAST
), inventory AS (
 SELECT pharmacy_id,reference,
  CASE WHEN count(stock)=count(*) THEN sum(stock)::float8 ELSE NULL::float8 END AS stock,
  min(stock_at) AS stock_at
 FROM articles GROUP BY pharmacy_id,reference
), movements AS (
 SELECT a.pharmacy_id,a.reference,
  coalesce(sum(v.unidades) FILTER(WHERE v.fecha >= $4::date AND v.fecha < $5::date+interval '1 day'),0)::float8 AS sold,
  coalesce(sum(v.unidades) FILTER(WHERE v.fecha >= $5::date-interval '89 days' AND v.fecha < $5::date+interval '1 day'),0)::float8 AS v3,
  coalesce(sum(v.unidades) FILTER(WHERE v.fecha >= $5::date-interval '364 days' AND v.fecha < $5::date+interval '1 day'),0)::float8 AS v12
 FROM articles a JOIN __SCHEMA__.fm_ventas_analitica v
  ON v.articulo_id::text=a.article_id
  AND upper(btrim(v.farmacia_codigo))=(
   SELECT source_code FROM pharmacies p WHERE p.id=a.pharmacy_id)
 WHERE v.fecha >= LEAST($4::date,$5::date-interval '364 days')
   AND v.fecha < $5::date+interval '1 day'
 GROUP BY a.pharmacy_id,a.reference
), pending AS (
 SELECT a.pharmacy_id,a.reference,
  sum(coalesce((assignment.elem->>'unidades')::float8,0))::float8 AS qty
 FROM articles a
 JOIN farmetrica.op_pedidos p ON p.cliente_slug=$3 AND p.farmacia_id=a.pharmacy_id
  AND p.estado IN ('borrador','pendiente_aprobacion','aprobado','exportado')
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.lineas,'[]'::jsonb)) AS line(elem)
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(line.elem->'asignaciones','[]'::jsonb)) AS assignment(elem)
 WHERE line.elem->>'articulo'=a.article_id
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
   greatest(coalesce(policy.cobertura_saludable,90),coalesce(policy.intervalo_pedidos,7))
   -i.stock-coalesce(pending.qty,0)-1e-9)))::int END AS suggested
FROM refs x CROSS JOIN pharmacies f
LEFT JOIN inventory i ON i.pharmacy_id=f.id AND i.reference=x.reference
LEFT JOIN movements m ON m.pharmacy_id=f.id AND m.reference=x.reference
LEFT JOIN pending ON pending.pharmacy_id=f.id AND pending.reference=x.reference
LEFT JOIN farmetrica.op_politicas_reposicion policy
 ON policy.cliente_slug=$3 AND policy.farmacia_id=f.id
ORDER BY x.reference,f.id;
