\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
BEGIN READ ONLY;
SET LOCAL statement_timeout = '150s';
SET LOCAL work_mem = '24MB';
-- Solo agregados mensuales, nunca líneas individuales o datos personales.
WITH sales AS (
 SELECT h.farmacia_codigo, date_trunc('month',h.fecha)::date AS mes,
  count(DISTINCT (h.sistema_origen,h.documento_id))::bigint AS tickets,
  count(*)::bigint AS lineas,
  count(*) FILTER (WHERE l.importe_neto IS NULL)::bigint AS sin_importe,
  round(sum(CASE WHEN l.devuelta THEN -abs(l.importe_neto) ELSE l.importe_neto END)::numeric,2) AS importe_neto,
  round(sum(CASE WHEN l.devuelta THEN -abs(l.impuestos) ELSE l.impuestos END)::numeric,2) AS impuestos,
  round(sum(CASE WHEN l.devuelta THEN -abs(l.cantidad) ELSE l.cantidad END)::numeric,2) AS unidades
 FROM ampedia.fm_ventas_cabeceras h JOIN ampedia.fm_ventas_lineas l
  USING (farmacia_codigo,sistema_origen,documento_id)
 WHERE h.fecha>='2025-01-01' AND h.fecha<'2026-11-01'
  AND h.lineas_completas AND NOT h.eliminado_logicamente AND NOT l.eliminada_logicamente
  AND NOT coalesce(l.anulada,false)
  AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')
 GROUP BY 1,2
), buy AS (
 SELECT h.farmacia_codigo,date_trunc('month',h.fecha)::date AS mes,
  count(DISTINCT (h.sistema_origen,h.documento_id))::bigint AS recepciones,
  count(*)::bigint AS lineas,
  count(*) FILTER (WHERE l.coste_neto IS NULL)::bigint AS sin_importe,
  round(sum(CASE WHEN l.devuelta THEN -abs(l.coste_neto) ELSE l.coste_neto END)::numeric,2) AS importe_neto,
  round(sum(CASE WHEN l.devuelta THEN -abs(l.impuestos) ELSE l.impuestos END)::numeric,2) AS impuestos,
  round(sum(CASE WHEN l.devuelta THEN -abs(l.cantidad) ELSE l.cantidad END)::numeric,2) AS unidades
 FROM ampedia.fm_recepciones_cabeceras h JOIN ampedia.fm_recepciones_lineas l
  USING (farmacia_codigo,sistema_origen,documento_id)
 WHERE h.fecha>='2025-01-01' AND h.fecha<'2026-11-01'
  AND h.lineas_completas AND NOT h.eliminada_logicamente AND NOT l.eliminada_logicamente
  AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')
 GROUP BY 1,2
)
SELECT 'COMPARE|'||row_to_json(x)::text FROM (
 SELECT coalesce(s.farmacia_codigo,b.farmacia_codigo) AS pharmacy,
  coalesce(s.mes,b.mes) AS month,
  s.tickets,s.lineas AS sales_lines,s.sin_importe AS missing_sale_amounts,
  s.importe_neto AS sales_net,s.impuestos AS sales_taxes,
  b.recepciones,b.lineas AS receipt_lines,b.sin_importe AS missing_purchase_amounts,
  b.importe_neto AS purchase_net,b.impuestos AS purchase_taxes,
  CASE WHEN s.importe_neto>0 THEN round(100*b.importe_neto/s.importe_neto,2) ELSE NULL END AS purchase_to_sale_pct
 FROM sales s FULL JOIN buy b ON s.farmacia_codigo=b.farmacia_codigo AND s.mes=b.mes
 ORDER BY 1,2
) x;
SELECT 'DOCUMENT_STATUS|'||row_to_json(x)::text FROM (
 SELECT 'sales' AS source,date_trunc('year',fecha)::date AS year,
 farmacia_codigo AS pharmacy,count(*)::bigint AS headers,
 count(*) FILTER(WHERE lineas_completas AND NOT eliminado_logicamente)::bigint AS complete,
 count(*) FILTER(WHERE NOT lineas_completas)::bigint AS incomplete,
 count(*) FILTER(WHERE eliminado_logicamente)::bigint AS deleted,
 min(fecha)::date AS first_day,max(fecha)::date AS last_day
 FROM ampedia.fm_ventas_cabeceras
 WHERE fecha>='2025-01-01' AND fecha<'2026-11-01'
 GROUP BY 1,2,3
 UNION ALL
 SELECT 'purchases',date_trunc('year',fecha)::date,farmacia_codigo,
 count(*)::bigint,
 count(*) FILTER(WHERE lineas_completas AND NOT eliminada_logicamente)::bigint,
 count(*) FILTER(WHERE NOT lineas_completas)::bigint,
 count(*) FILTER(WHERE eliminada_logicamente)::bigint,
 min(fecha)::date,max(fecha)::date
 FROM ampedia.fm_recepciones_cabeceras
 WHERE fecha>='2025-01-01' AND fecha<'2026-11-01'
 GROUP BY 1,2,3
) x;
COMMIT;
