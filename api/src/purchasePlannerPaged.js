import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

// Paginación real en PostgreSQL. No materializar 49.000 artículos en memoria Node.
// Los artículos sin identificador común permanecen separados por farmacia.
const SORT={articleName:'"articleName"',unitsPeriod:'"unitsPeriod"',units3:'"units3"',
 units12:'"units12"',stock:"stock",suggested:"suggested"};
export async function readPurchasePlannerPage(pool,ctx,{from,to,chosen,search,sort,direction,page,pageSize,columnFilters}){
 const schema=ctx.client.schema;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema))throw Error("Esquema inválido");
 const q='"'+schema+'"',source=pharmacyDataCodeSQL("f");
 const filterColumns={articleName:'"articleName"',unitsPeriod:'"unitsPeriod"',
  units3:'"units3"',units12:'"units12"',stock:"stock",suggested:"suggested"};
 const active=Object.entries(columnFilters||{}).filter(([,v])=>v);
 const filter=active.map(([k],i)=>
  "coalesce("+filterColumns[k]+"::text,'') ILIKE '%'||$"+(8+i)+"||'%'").join(" AND ")||"true";
 const order=SORT[sort]||SORT.suggested,dir=direction==="asc"?"ASC":"DESC";
 const sql=[
 "WITH sold AS MATERIALIZED (",
 "SELECT f.id AS fid,upper(btrim(v.farmacia_codigo)) AS code,v.articulo_id::text AS article,",
 "coalesce(sum(v.unidades) FILTER(WHERE v.fecha >= $1::date AND v.fecha<$2::date+interval '1 day'),0)::float8 AS period,",
 "coalesce(sum(v.unidades) FILTER(WHERE v.fecha>=current_date-interval '90 days' AND v.fecha<current_date+interval '1 day'),0)::float8 AS u3,",
 "coalesce(sum(v.unidades) FILTER(WHERE v.fecha>=current_date-interval '365 days' AND v.fecha<current_date+interval '1 day'),0)::float8 AS u12",
 "FROM "+q+".fm_ventas_analitica v JOIN farmetrica.farmacias f ON f.cliente_slug=$4",
 "AND f.id=ANY($3::int[]) AND upper(btrim(v.farmacia_codigo))="+source,
 "WHERE v.fecha>=least($1::date,current_date-interval '365 days')",
 "AND v.fecha<greatest($2::date,current_date)+interval '1 day'",
 "AND nullif(btrim(v.articulo_id::text),'') IS NOT NULL",
 "GROUP BY f.id,upper(btrim(v.farmacia_codigo)),v.articulo_id",
 "), selected AS MATERIALIZED (",
 "SELECT s.*,coalesce(nullif(btrim(a.nombre),''),s.article) AS name,",
 "nullif(btrim(a.codigo_nacional),'') AS cn,a.stock_actual::float8 AS stock,a.sincronizado_en AS stock_at",
 "FROM sold s LEFT JOIN LATERAL (SELECT nombre,codigo_nacional,stock_actual,sincronizado_en",
 "FROM "+q+".articulos a WHERE a.farmacia_codigo=s.code AND a.origen_id=s.article",
 "ORDER BY a.sincronizado_en DESC NULLS LAST LIMIT 1) a ON true",
 "WHERE ($5::text='' OR s.article ILIKE '%'||$5||'%'",
 "OR a.nombre ILIKE '%'||$5||'%' OR a.codigo_nacional ILIKE '%'||$5||'%')",
 "), pending AS MATERIALIZED (",
 "SELECT o.farmacia_id,upper(btrim(n.line->>'articulo')) AS article,",
 "sum(coalesce((a.alloc->>'unidades')::float8,0))::float8 AS ordered",
 "FROM farmetrica.op_pedidos o",
 "CROSS JOIN LATERAL jsonb_array_elements(o.lineas) AS n(line)",
 "CROSS JOIN LATERAL jsonb_array_elements(coalesce(n.line->'asignaciones','[]'::jsonb)) AS a(alloc)",
 "WHERE o.cliente_slug=$4 AND o.farmacia_id=ANY($3::int[])",
 "AND o.estado IN ('borrador','pendiente_aprobacion','aprobado','exportado')",
 "GROUP BY o.farmacia_id,upper(btrim(n.line->>'articulo'))",
 "), prepared AS MATERIALIZED (",
 "SELECT s.fid,s.article AS \"articleId\",s.name AS \"articleName\",s.cn,s.stock,s.stock_at AS \"stockAt\",",
 "s.period AS \"unitsPeriod\",s.u3 AS \"units3\",s.u12 AS \"units12\",",
 "coalesce(p.ordered,0)::float8 AS ordered,",
 "coalesce(pol.intervalo_pedidos,7)::float8 AS interval,",
 "coalesce(pol.plazo_entrega,2)::float8 AS lead,",
 "coalesce(pol.stock_seguridad,0)::float8 AS safety,",
 "(pol.farmacia_id IS NULL) AS \"policyDefault\",",
 "greatest(0,s.u3/90.0,s.u12/365.0)::float8 AS daily,",
 "CASE WHEN s.stock IS NULL OR s.stock<0 THEN NULL::float8 ELSE",
 "greatest(0,least(999999,ceil(greatest(0,s.u3/90.0,s.u12/365.0)*",
 "(coalesce(pol.intervalo_pedidos,7)+coalesce(pol.plazo_entrega,2))+",
 "coalesce(pol.stock_seguridad,0)-s.stock-coalesce(p.ordered,0)-1e-9)))::float8 END AS suggested",
 "FROM selected s LEFT JOIN pending p ON p.farmacia_id=s.fid AND p.article=upper(btrim(s.article))",
 "LEFT JOIN farmetrica.op_politicas_reposicion pol ON pol.cliente_slug=$4 AND pol.farmacia_id=s.fid",
 "), visible AS MATERIALIZED (SELECT * FROM prepared WHERE "+filter+"),",
 "totals AS (SELECT count(*)::int AS products,",
 "coalesce(sum(\"unitsPeriod\"),0)::float8 AS \"unitsPeriod\",",
 "coalesce(sum(\"units3\"),0)::float8 AS \"units3\",",
 "coalesce(sum(\"units12\"),0)::float8 AS \"units12\",",
 "coalesce(sum(stock),0)::float8 AS \"stockKnown\",",
 "count(*) FILTER(WHERE stock IS NULL)::int AS \"stockMissing\",",
 "coalesce(sum(suggested),0)::float8 AS \"suggestedKnown\",",
 "count(*) FILTER(WHERE suggested IS NULL)::int AS \"suggestedMissing\" FROM visible),",
 "paged AS (SELECT * FROM visible ORDER BY "+order+" "+dir+" NULLS LAST,fid,\"articleId\"",
 "LIMIT $6 OFFSET $7)",
 "SELECT (SELECT to_jsonb(t) FROM totals t) AS summary,",
 "(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY "+order+" "+dir+" NULLS LAST,p.fid,p.\"articleId\"),'[]'::jsonb) FROM paged p) AS rows"
 ].join(" ");
 const values=[from,to,chosen,ctx.client.slug,search,pageSize,(page-1)*pageSize,
  ...active.map(([,v])=>v)];
 const response=await pool.query({text:sql,values,query_timeout:30000});
 const data=response.rows[0]||{},summary=data.summary||{},rows=data.rows||[];
 const groups=rows.map(p=>{
  const key=p.cn?"CN:"+String(p.cn).trim().toUpperCase():"ERP:"+p.fid+":"+p.articleId;
  const pharmacy={pharmacyId:String(p.fid),articleId:p.articleId,articleName:p.articleName,
   cn:p.cn,stock:p.stock,stockAt:p.stockAt,unitsPeriod:p.unitsPeriod,units3:p.units3,
   units12:p.units12,suggested:p.suggested,ordered:p.ordered,daily:p.daily,
   interval:p.interval,lead:p.lead,safety:p.safety,policyDefault:p.policyDefault,
   groupKey:key,options:[{articleId:p.articleId,articleName:p.articleName,cn:p.cn,
    stock:p.stock,unitsPeriod:p.unitsPeriod,units3:p.units3,units12:p.units12}],
   confidence:p.stock==null?"sin_stock":p.stockAt==null?"fecha_desconocida":
    Date.now()-new Date(p.stockAt).getTime()>48*3600000?"stock_antiguo":"calculable"};
  return {key,kind:"articulo",dcpf:null,cn:p.cn,articleName:p.articleName,stock:p.stock,
   unitsPeriod:p.unitsPeriod,units3:p.units3,units12:p.units12,suggested:p.suggested,
   productCount:1,pharmacies:[pharmacy]};
 });
 return {available:true,from,to,groups,page,pageSize,totalGroups:Number(summary.products||0),
  summary:{...summary,referenceCount:summary.products||0,partial:false},
  pharmacies:ctx.pharmacies.filter(p=>chosen.includes(Number(p.id))).map(p=>({id:p.id,name:p.name})),
  truncated:false,commitmentsAvailable:true,note:
  "Propuesta por farmacia con ventas y stock verificables, descontando las unidades ya preparadas. Sin CN verificado, los códigos ERP no se agrupan entre farmacias. No se envían pedidos automáticamente."};
}
