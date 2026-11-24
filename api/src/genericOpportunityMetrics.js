import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const DATE=/^20\d{2}-\d{2}-\d{2}$/;
const validDate=d=>DATE.test(d)&&!Number.isNaN(Date.parse(d+"T00:00:00Z"))&&new Date(d+"T00:00:00Z").toISOString().slice(0,10)===d;
export function setupGenericOpportunityMetrics(app,pool,{requireTenantModule}){
 const guard=requireTenantModule("genericos");
 app.get("/api/genericos/ofertas/pedido-datos/:dcpf",...guard,async(req,res,next)=>{
  const ctx=req.context,from=String(req.query.desde||""),to=String(req.query.hasta||""),dcpf=String(req.params.dcpf||"");
  const allowed=(ctx.allowedPharmacyIds||[]).map(Number);
  const ids=[...new Set(req.query.farmacias?String(req.query.farmacias).split(",").map(Number):allowed)];
  if(!SCHEMA.test(ctx.client.schema)||!validDate(from)||!validDate(to)||from>to||
   !/^\d{1,30}$/.test(dcpf)||ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||!allowed.includes(id)))
   return res.status(400).json({error:"Período, conjunto o farmacias inválidos"});
  if(!ids.length)return res.json({items:[]});
  try{
   const schema='"'+ctx.client.schema+'"';
   const {rows:cols}=await pool.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=ANY($2::text[])",[ctx.client.schema,["articulos","fm_ventas_analitica"]]);
   const has=(table,fields)=>fields.every(col=>cols.some(c=>c.table_name===table&&c.column_name===col));
   const mapped=has("articulos",["farmacia_codigo","origen_id","codigo_nacional","sincronizado_en"]);
   const stock=mapped&&has("articulos",["stock_actual"]);
   const sales=has("fm_ventas_analitica",["farmacia_codigo","articulo_id","fecha","unidades"]);
   const prefix="WITH pharmacies AS (SELECT f.id,"+pharmacyDataCodeSQL("f")+" AS code FROM farmetrica.farmacias f WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[])), "+
    "cns AS (SELECT DISTINCT cn FROM farmetrica.nomenclator_presentaciones WHERE generico=true AND dcpf::text=$3), "+
    "mapped AS ("+(mapped?"SELECT DISTINCT ON (f.id,a.origen_id) f.id,a.origen_id::text AS article,btrim(a.codigo_nacional::text) AS cn,"+(stock?"a.stock_actual::float8":"NULL::float8")+" AS stock FROM "+schema+".articulos a JOIN pharmacies f ON upper(btrim(a.farmacia_codigo))=f.code JOIN cns n ON n.cn=btrim(a.codigo_nacional::text) ORDER BY f.id,a.origen_id,a.sincronizado_en DESC NULLS LAST":"SELECT NULL::int AS id,NULL::text AS article,NULL::text AS cn,NULL::float8 AS stock WHERE false")+") ";
   const args=[ctx.client.slug,ids,dcpf];
   const [sr,vr]=await Promise.allSettled([
    stock?pool.query({text:prefix+"SELECT id AS \"pharmacyId\",cn,CASE WHEN count(stock)=count(*) THEN sum(stock)::float8 END AS stock FROM mapped GROUP BY id,cn",values:args,query_timeout:12000}):Promise.resolve({rows:[]}),
    sales?pool.query({text:prefix+", keys AS (SELECT id,article,cn FROM mapped UNION ALL SELECT f.id,n.cn,n.cn FROM pharmacies f CROSS JOIN cns n WHERE NOT EXISTS(SELECT 1 FROM mapped m WHERE m.id=f.id AND m.article=n.cn)) SELECT f.id AS \"pharmacyId\",k.cn,coalesce(sum(v.unidades) FILTER (WHERE v.fecha>=current_date-interval '90 days' AND v.fecha<current_date+interval '1 day'),0)::float8 AS \"units3\",coalesce(sum(v.unidades) FILTER (WHERE v.fecha>=current_date-interval '365 days' AND v.fecha<current_date+interval '1 day'),0)::float8 AS \"units12\",coalesce(sum(v.unidades) FILTER (WHERE v.fecha>=$4::date AND v.fecha<$5::date+interval '1 day'),0)::float8 AS \"unitsPeriod\" FROM keys k JOIN pharmacies f ON f.id=k.id LEFT JOIN "+schema+".fm_ventas_analitica v ON v.farmacia_codigo=f.code AND v.articulo_id=k.article AND v.fecha>=least($4::date,current_date-interval '365 days') AND v.fecha<greatest($5::date,current_date)+interval '1 day' GROUP BY f.id,k.cn",values:[...args,from,to],query_timeout:18000}):Promise.resolve({rows:[]})
   ]);
   const items=new Map();
   for(const x of [...(sr.status==="fulfilled"?sr.value.rows:[]),...(vr.status==="fulfilled"?vr.value.rows:[])]){
    const k=x.pharmacyId+"|"+x.cn;items.set(k,{...items.get(k),...x});
   }
   res.json({items:[...items.values()],stockAvailable:stock&&sr.status==="fulfilled",salesAvailable:sales&&vr.status==="fulfilled"});
  }catch(e){next(e)}
 });
}
