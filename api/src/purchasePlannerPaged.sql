
WITH
ventas AS MATERIALIZED (
 SELECT f.id AS fid,upper(btrim(v.farmacia_codigo)) AS farmacia_codigo,
  v.articulo_id::text AS articulo,
  COALESCE(sum(v.unidades) FILTER (
   WHERE v.fecha >= $1::date AND v.fecha < $2::date+interval '1 day'),0)::float8 AS periodo,
  COALESCE(sum(v.unidades) FILTER (
   WHERE v.fecha >= current_date-interval '30 days' AND v.fecha < current_date+interval '1 day'),0)::float8 AS v30,
  COALESCE(sum(v.unidades) FILTER (
   WHERE v.fecha >= current_date-interval '90 days' AND v.fecha < current_date+interval '1 day'),0)::float8 AS v90,
  COALESCE(sum(v.unidades) FILTER (
   WHERE v.fecha >= current_date-interval '365 days' AND v.fecha < current_date+interval '1 day'),0)::float8 AS v365,
  -- Agregaciones lineales: min/max y count, sin count(distinct) sobre
  -- millones de líneas (evita timeout de la página completa).
  min(v.fecha::date) FILTER (
   WHERE v.unidades>0 AND v.fecha >= current_date-interval '365 days'
     AND v.fecha < current_date+interval '1 day') AS primera_venta,
  max(v.fecha::date) FILTER (
   WHERE v.unidades>0 AND v.fecha >= current_date-interval '365 days'
     AND v.fecha < current_date+interval '1 day') AS ultima_venta,
  count(*) FILTER (
   WHERE v.unidades>0 AND v.fecha >= current_date-interval '365 days'
     AND v.fecha < current_date+interval '1 day')::int AS lineas_venta,
  -- Más robusto que primera/última fecha: registra en qué tramos de ~90 días
  -- hubo actividad. Evita tomar dos campañas aisladas como venta sostenida.
  coalesce(bit_or(
   1::int << least(3,greatest(0,
    ((current_date-v.fecha::date)/91)::int))
  ) FILTER (WHERE v.unidades>0
   AND v.fecha >= current_date-interval '365 days'
   AND v.fecha < current_date+interval '1 day'),0)::int AS tramos_actividad
 FROM __SCHEMA__.fm_ventas_analitica v
 JOIN farmetrica.farmacias f ON f.cliente_slug=$4 AND f.id=ANY($3::int[])
  AND upper(btrim(v.farmacia_codigo))=__FARMACIA_CODE__
 WHERE v.fecha >= least($1::date,current_date-interval '365 days')
  AND v.fecha < greatest($2::date,current_date)+interval '1 day'
  AND nullif(btrim(v.articulo_id),'') IS NOT NULL
 GROUP BY f.id,upper(btrim(v.farmacia_codigo)),v.articulo_id
),
catalogo AS MATERIALIZED (
 SELECT v.fid,v.articulo,v.farmacia_codigo,
  coalesce(nullif(btrim(a.nombre),''),v.articulo) AS nombre,
  COALESCE(nullif(btrim(a.codigo_nacional),''),
   CASE WHEN v.articulo ~ '^[0-9]{6,7}$' THEN v.articulo END) AS cn,
  a.stock_actual::float8 AS stock,a.sincronizado_en AS fecha_stock,
  v.periodo,v.v30,v.v90,v.v365,
  v.primera_venta,v.ultima_venta,v.lineas_venta,v.tramos_actividad
 FROM ventas v LEFT JOIN LATERAL (
  SELECT nombre,codigo_nacional,stock_actual,sincronizado_en
  FROM __SCHEMA__.articulos a
  WHERE a.farmacia_codigo=v.farmacia_codigo AND a.origen_id=v.articulo
  ORDER BY a.sincronizado_en DESC NULLS LAST LIMIT 1
 ) a ON true
),
catalogo_sin_ventas AS MATERIALIZED (
 SELECT f.id AS fid,a.origen_id AS articulo,upper(btrim(a.farmacia_codigo)) AS farmacia_codigo,
  a.nombre AS nombre,COALESCE(nullif(btrim(a.codigo_nacional),''),
   CASE WHEN a.origen_id ~ '^[0-9]{6,7}$' THEN a.origen_id END) AS cn,
  a.stock_actual::float8 AS stock,a.sincronizado_en AS fecha_stock,
  0::float8 AS periodo,0::float8 AS v30,0::float8 AS v90,0::float8 AS v365,
  NULL::date AS primera_venta,NULL::date AS ultima_venta,
  0::int AS lineas_venta,0::int AS tramos_actividad
 FROM __SCHEMA__.articulos a JOIN farmetrica.farmacias f
  ON f.cliente_slug=$4 AND f.id=ANY($3::int[])
  AND upper(btrim(a.farmacia_codigo))=__FARMACIA_CODE__
 WHERE $5::text<>'' AND
  (upper(a.origen_id) LIKE '%'||$5||'%' OR upper(a.nombre) LIKE '%'||$5||'%'
   OR upper(coalesce(a.codigo_nacional,'')) LIKE '%'||$5||'%')
  AND NOT EXISTS(SELECT 1 FROM catalogo c WHERE c.fid=f.id AND c.articulo=a.origen_id)
),
articulos AS MATERIALIZED (
 SELECT * FROM catalogo
 UNION ALL SELECT * FROM catalogo_sin_ventas
),
clasificados AS MATERIALIZED (
 SELECT a.*, n.dcpf,n.nombre AS nombre_generico,
  CASE WHEN n.dcpf IS NOT NULL THEN 'DCPF:'||n.dcpf
   WHEN a.cn IS NOT NULL THEN 'CN:'||a.cn
   ELSE 'ERP:'||a.fid::text||':'||a.articulo END AS grupo,
  CASE WHEN n.dcpf IS NOT NULL THEN 'generico' ELSE 'articulo' END AS tipo,
  COALESCE(n.nombre,a.nombre,a.articulo) AS etiqueta
 FROM articulos a LEFT JOIN LATERAL (
  SELECT dcpf,COALESCE(nullif(btrim(principio_activo),''),nombre) AS nombre
  FROM farmetrica.nomenclator_presentaciones n
  WHERE n.cn=a.cn AND n.generico=true AND nullif(btrim(n.dcpf),'') IS NOT NULL
  ORDER BY n.dcpf LIMIT 1
 ) n ON true
),
pendientes AS MATERIALIZED (
 SELECT p.farmacia_id AS fid,upper(btrim(l.line->>'articulo')) AS articulo,
  COALESCE(sum((asig.row->>'unidades')::float8),0)::float8 AS unidades
 FROM farmetrica.op_pedidos p
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.lineas,'[]'::jsonb)) AS l(line)
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(l.line->'asignaciones','[]'::jsonb)) AS asig(row)
 WHERE p.cliente_slug=$4 AND p.farmacia_id=ANY($3::int[])
  AND p.estado IN ('borrador','pendiente_aprobacion','aprobado','exportado')
 GROUP BY p.farmacia_id,upper(btrim(l.line->>'articulo'))
),
por_farmacia AS MATERIALIZED (
 SELECT c.grupo,c.fid,max(c.tipo) AS tipo,max(c.etiqueta) AS nombre,
  max(c.cn) AS cn,max(c.dcpf) AS dcpf,
  count(*)::int AS referencias,
  sum(c.periodo)::float8 AS periodo,sum(c.v30)::float8 AS v30,
  sum(c.v90)::float8 AS v90,sum(c.v365)::float8 AS v365,
  min(c.primera_venta) AS primera_venta,
  max(c.ultima_venta) AS ultima_venta,
  sum(c.lineas_venta)::int AS lineas_venta,
  bit_or(c.tramos_actividad)::int AS tramos_actividad,
  CASE WHEN count(c.stock)=count(*) THEN sum(c.stock)::float8 ELSE NULL END AS stock,
  min(c.fecha_stock) AS fecha_stock,
  sum(coalesce(p.unidades,0))::float8 AS encargadas,
  COALESCE(max(pol.cobertura_saludable),90)::int AS cobertura_dias,
  COALESCE(max(pol.intervalo_pedidos),7)::int AS intervalo_dias,
  bool_and(pol.farmacia_id IS NULL) AS politica_default
 FROM clasificados c LEFT JOIN pendientes p ON p.fid=c.fid AND p.articulo=upper(btrim(c.articulo))
 LEFT JOIN farmetrica.op_politicas_reposicion pol
  ON pol.cliente_slug=$4 AND pol.farmacia_id=c.fid
 GROUP BY c.grupo,c.fid
),
-- Observación real: intervalo entre la primera y la última venta
-- positiva de 12 meses, más número de transacciones y actividad en 30/90d.
-- No hay ninguna excepción por producto, nombre, familia ni CN.
necesidades AS MATERIALIZED (
 SELECT pf.*,
  CASE
   WHEN pf.v365>=20 AND pf.ultima_venta-pf.primera_venta<=6
    AND pf.ultima_venta>=current_date-interval '14 days' THEN 'pico_reciente'
   WHEN pf.v365>=20 AND pf.ultima_venta-pf.primera_venta<=6
    AND pf.ultima_venta<current_date-interval '14 days' THEN 'concentrada'
   WHEN pf.v30>0 AND pf.ultima_venta-pf.primera_venta>=120
    AND pf.lineas_venta>=12 AND
    bit_count(pf.tramos_actividad::bit(4))>=3 THEN 'recurrente'
   WHEN pf.v30=0 AND pf.v90>0
    AND pf.ultima_venta-pf.primera_venta>=21
    AND pf.lineas_venta>=10 THEN 'posible_estacional'
   WHEN pf.v30=0 THEN 'sin_actividad'
   ELSE 'intermitente'
  END AS patron,
  greatest(pf.v30/30.0,pf.v90/90.0,pf.v365/365.0) AS media_dia,
  CASE
   WHEN pf.stock IS NULL OR pf.stock<0 THEN NULL
   WHEN pf.v365>=20 AND pf.ultima_venta-pf.primera_venta<=6 THEN 0::float8
   WHEN pf.v30=0 THEN 0::float8
   ELSE greatest(0,least(999999,ceil(
    greatest(pf.v30/30.0,pf.v90/90.0,pf.v365/365.0)*
     greatest(pf.cobertura_dias,pf.intervalo_dias)
     -pf.stock-pf.encargadas-1e-9)))::float8
  END AS sugeridas
 FROM por_farmacia pf
),
grupos AS MATERIALIZED (
 SELECT n.grupo AS key,max(n.tipo) AS kind,max(n.nombre) AS "articleName",
  max(n.cn) AS cn,max(n.dcpf) AS dcpf,
  sum(n.referencias)::int AS "productCount",
  sum(n.periodo)::float8 AS "unitsPeriod",
  sum(n.v90)::float8 AS "units3",sum(n.v365)::float8 AS "units12",
  sum(n.v30)::float8 AS "units30",
  min(n.primera_venta) AS "firstSale",
  max(n.ultima_venta) AS "lastSale",
  (max(n.ultima_venta)-min(n.primera_venta)+1)::int AS "saleSpanDays",
  sum(n.lineas_venta)::int AS "saleLines",
  bit_count(bit_or(n.tramos_actividad)::bit(4))::int AS "activeQuarters",
  CASE WHEN count(n.stock)=count(*) THEN sum(n.stock)::float8 ELSE NULL END AS stock,
  CASE WHEN count(n.sugeridas)=count(*) THEN sum(n.sugeridas)::float8 ELSE NULL END AS suggested,
  CASE
   WHEN sum(n.v365)>=20 AND max(n.ultima_venta)-min(n.primera_venta)<=6
    AND max(n.ultima_venta)>=current_date-interval '14 days'
    THEN 'pico_reciente'
   WHEN sum(n.v365)>=20 AND max(n.ultima_venta)-min(n.primera_venta)<=6
    AND max(n.ultima_venta)<current_date-interval '14 days'
    THEN 'concentrada'
   WHEN bool_or(n.patron='recurrente') THEN 'recurrente'
   WHEN sum(n.v30)=0 AND bool_or(n.patron='posible_estacional') THEN 'posible_estacional'
   WHEN sum(n.v30)=0 THEN 'sin_actividad'
   ELSE 'intermitente'
  END AS patron,
  CASE
   WHEN sum(n.v365)>=20 AND max(n.ultima_venta)-min(n.primera_venta)<=6 THEN 1
   WHEN bool_or(n.patron='recurrente') THEN 4
   WHEN sum(n.v30)>0 AND bool_or(n.patron='intermitente') THEN 3
   WHEN bool_or(n.patron='pico_reciente') THEN 2
   WHEN bool_or(n.patron='posible_estacional') THEN 1
   ELSE 0
  END AS prioridad
 FROM necesidades n GROUP BY n.grupo
),
filtrados AS MATERIALIZED (
 SELECT g.* FROM grupos g
 WHERE ($5::text='' OR upper(g."articleName") LIKE '%'||$5||'%'
   OR upper(coalesce(g.cn,'')) LIKE '%'||$5||'%'
   OR upper(coalesce(g.dcpf,'')) LIKE '%'||$5||'%'
   OR EXISTS(SELECT 1 FROM clasificados c WHERE c.grupo=g.key AND
    (upper(c.articulo) LIKE '%'||$5||'%'
      OR upper(c.nombre) LIKE '%'||$5||'%'
      OR upper(coalesce(c.cn,'')) LIKE '%'||$5||'%')))
  AND ($8::text='' OR g."articleName" ILIKE '%'||$8||'%' OR g.cn ILIKE '%'||$8||'%')
  AND ($9::text='' OR coalesce(g.stock::text,'') ILIKE '%'||$9||'%')
  AND ($10::text='' OR g."unitsPeriod"::text ILIKE '%'||$10||'%')
  AND ($11::text='' OR g."units3"::text ILIKE '%'||$11||'%')
  AND ($12::text='' OR g."units12"::text ILIKE '%'||$12||'%')
  AND ($13::text='' OR coalesce(g.suggested::text,'') ILIKE '%'||$13||'%')
),
totales AS MATERIALIZED (
 SELECT count(*)::int AS products,
  coalesce(sum("productCount"),0)::int AS "referenceCount",
  coalesce(sum("unitsPeriod"),0)::float8 AS "unitsPeriod",
  coalesce(sum("units3"),0)::float8 AS "units3",
  coalesce(sum("units12"),0)::float8 AS "units12",
  coalesce(sum(stock),0)::float8 AS "stockKnown",
  count(*) FILTER(WHERE stock IS NULL)::int AS "stockMissing",
  coalesce(sum(suggested),0)::float8 AS "suggestedKnown",
  count(*) FILTER(WHERE suggested IS NULL)::int AS "suggestedMissing",
  count(*) FILTER(WHERE patron='concentrada')::int AS "concentratedCount",
  count(*) FILTER(WHERE patron='pico_reciente')::int AS "recentPeakCount",
  count(*) FILTER(WHERE patron='posible_estacional')::int AS "seasonalCount",
  false AS partial FROM filtrados
),
pagina AS MATERIALIZED (
 SELECT g.* FROM filtrados g
 ORDER BY __ORDER__
 LIMIT $6 OFFSET $7
)
SELECT (SELECT to_jsonb(t) FROM totales t) AS summary,
 (SELECT COALESCE(jsonb_agg(
  to_jsonb(g)||jsonb_build_object('pharmacies',(
   SELECT coalesce(jsonb_agg(jsonb_build_object(
    'pharmacyId',n.fid::text,'groupKey',n.grupo,'articleId',(
     SELECT c.articulo FROM clasificados c
     WHERE c.fid=n.fid AND c.grupo=n.grupo ORDER BY c.articulo LIMIT 1),
    'articleName',n.nombre,'cn',n.cn,'stock',n.stock,
    'stockAt',n.fecha_stock,'unitsPeriod',n.periodo,
    'units3',n.v90,'units12',n.v365,'units30',n.v30,
    'suggested',n.sugeridas,'ordered',n.encargadas,
    'daily',n.media_dia,'interval',n.intervalo_dias,
    'lead',0,'safety',0,'coverageDays',n.cobertura_dias,
    'demandPattern',n.patron,
    'firstSale',n.primera_venta,'lastSale',n.ultima_venta,
    'saleSpanDays',(n.ultima_venta-n.primera_venta+1),
    'saleLines',n.lineas_venta,
    'activeQuarters',bit_count(n.tramos_actividad::bit(4)),
    'policyDefault',n.politica_default,
    'confidence',CASE WHEN n.stock IS NULL THEN 'sin_stock'
      WHEN n.fecha_stock IS NULL THEN 'fecha_desconocida'
      WHEN n.fecha_stock<now()-interval '48 hours' THEN 'stock_antiguo'
      ELSE 'calculable' END,
    'options',(
      SELECT coalesce(jsonb_agg(jsonb_build_object(
       'articleId',c.articulo,'articleName',c.nombre,'cn',c.cn,
       'stock',c.stock,'unitsPeriod',c.periodo,
       'units3',c.v90,'units12',c.v365)),'[]'::jsonb)
      FROM clasificados c WHERE c.grupo=n.grupo AND c.fid=n.fid
    )
   ) ORDER BY n.fid),'[]'::jsonb)
   FROM necesidades n WHERE n.grupo=g.key
  )) ORDER BY __ORDER__),'[]'::jsonb)
 FROM pagina g) AS groups
