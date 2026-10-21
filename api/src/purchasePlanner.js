import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const VALID_DATE=/^\d{4}-\d{2}-\d{2}$/;
const DAY=86400000;
const normalize=x=>String(x??"").trim().toUpperCase();
const validDate=s=>VALID_DATE.test(s)&&!Number.isNaN(Date.parse(s+"T00:00:00Z"))&&new Date(s+"T00:00:00Z").toISOString().slice(0,10)===s;

export function proposePurchase({stock,units3=0,units12=0,ordered=0,interval=7,lead=2,safety=0}){
 if(stock===null||stock===undefined||!Number.isFinite(Number(stock))||Number(stock)<0)
  return {suggested:null,reason:"Existencias no disponibles"};
 if(![units3,units12,ordered,interval,lead,safety].every(x=>Number.isFinite(Number(x))&&Number(x)>=0))
  return {suggested:null,reason:"Datos insuficientes"};
 const daily=Math.max(Number(units3)/90,Number(units12)/365);
 const demand=daily*(Number(interval)+Number(lead));
 return {suggested:Math.max(0,Math.min(999999,Math.ceil(demand+Number(safety)-Number(stock)-Number(ordered)-1e-9))),
  daily:+daily.toFixed(4),demand:+demand.toFixed(2),ordered:Number(ordered),
  formula:"máx(ventas 3m/90, ventas 12m/365) × (intervalo + plazo) + seguridad − stock − pedidos ya preparados"};
}
export function groupPurchaseRows(rows){
 const map=new Map();
 for(const p of rows){
  const cn=normalize(p.cn);
  // Sin CN no es seguro equiparar identificadores internos de farmacias distintas.
  const key=cn?"CN:"+cn:"ERP:"+p.pharmacyId+":"+p.articleId;
  if(!map.has(key))map.set(key,{key,cn:cn||null,articleName:p.articleName||p.articleId,pharmacies:[]});
  map.get(key).pharmacies.push(p);
 }
 return [...map.values()].map(g=>({
  ...g,unitsPeriod:g.pharmacies.reduce((n,p)=>n+Number(p.unitsPeriod||0),0),
  units3:g.pharmacies.reduce((n,p)=>n+Number(p.units3||0),0),
  units12:g.pharmacies.reduce((n,p)=>n+Number(p.units12||0),0),
  stock:g.pharmacies.every(p=>p.stock!==null)?g.pharmacies.reduce((n,p)=>n+Number(p.stock),0):null,
  suggested:g.pharmacies.some(p=>p.suggested===null)?null:g.pharmacies.reduce((n,p)=>n+p.suggested,0)
 })).sort((a,b)=>(b.suggested||0)-(a.suggested||0)||String(a.articleName).localeCompare(b.articleName,"es"));
}
export function setupPurchasePlanner(app,pool,{requireTenant}){
 app.get("/api/analytics/pedidos/propuesta",...requireTenant(),async(req,res,next)=>{
  const ctx=req.context;
  if(ctx.role!=="superadministrador"&&ctx.modules?.compras!==true)
   return res.status(403).json({error:"Compras no habilitado"});
  const schema=ctx.client.schema,today=new Date().toISOString().slice(0,10);
  const from=String(req.query.desde||new Date(Date.now()-30*DAY).toISOString().slice(0,10));
  const to=String(req.query.hasta||today),search=normalize(req.query.buscar||"");
  const raw=String(req.query.farmacias||""),allowed=ctx.pharmacies.map(p=>Number(p.id));
  const ids=raw?raw.split(",").map(Number):allowed;
  if(!SCHEMA.test(schema)||!validDate(from)||!validDate(to)||from>to||
   Date.parse(to)-Date.parse(from)>730*DAY||raw.length>1500||search.length>100||
   ids.some(id=>!Number.isSafeInteger(id)||!allowed.includes(id)))
   return res.status(400).json({error:"Filtros no autorizados o inválidos"});
  const chosen=[...new Set(ids)],MAX=3500;
  if(!chosen.length)return res.json({available:true,groups:[],pharmacies:[],truncated:false});
  try{
   const {rows:fields}=await pool.query(
    "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name IN ('articulos','fm_ventas_analitica')",[schema]);
   const has=(t,c)=>fields.some(f=>f.table_name===t&&f.column_name===c);
   if(!["farmacia_codigo","origen_id","nombre","stock_actual"].every(c=>has("articulos",c))||
    !["farmacia_codigo","articulo_id","fecha","unidades"].every(c=>has("fm_ventas_analitica",c)))
    return res.json({available:false,groups:[],
     reason:"El sincronizador todavía no aporta ventas completas y existencias por artículo"});
   const q='"'+schema+'"';
   const code=has("articulos","codigo_nacional")?"nullif(btrim(a.codigo_nacional),'')":"NULL::text";
   const stamp=has("articulos","sincronizado_en")?"a.sincronizado_en":"NULL::timestamptz";
   const latest=has("articulos","sincronizado_en")?"ORDER BY a.sincronizado_en DESC NULLS LAST":"";
   const join=pharmacyDataCodeSQL("f");
   const sql=[
    "WITH sold AS MATERIALIZED (",
    " SELECT f.id AS fid,v.articulo_id::text AS article,",
    " sum(v.unidades) FILTER(WHERE v.fecha >= $1::date AND v.fecha < $2::date+interval '1 day') AS period,",
    " sum(v.unidades) FILTER(WHERE v.fecha >= current_date-interval '90 days' AND v.fecha < current_date+interval '1 day') AS u3,",
    " sum(v.unidades) FILTER(WHERE v.fecha >= current_date-interval '365 days' AND v.fecha < current_date+interval '1 day') AS u12",
    " FROM "+q+".fm_ventas_analitica v JOIN farmetrica.farmacias f ON f.cliente_slug=$4",
    " AND upper(btrim(v.farmacia_codigo))="+join+" AND f.id=ANY($3::int[])",
    " WHERE v.fecha >= least($1::date,current_date-interval '365 days')",
    " AND v.fecha < greatest($2::date,current_date)+interval '1 day'",
    " AND nullif(btrim(v.articulo_id::text),'') IS NOT NULL GROUP BY f.id,v.articulo_id",
    "), ranked AS (SELECT * FROM sold WHERE ($6::text='' OR article ILIKE '%'||$6||'%' OR EXISTS (",
    " SELECT 1 FROM "+q+".articulos a2 JOIN farmetrica.farmacias f2",
    " ON f2.id=sold.fid AND f2.cliente_slug=$4",
    " WHERE upper(btrim(a2.farmacia_codigo))="+pharmacyDataCodeSQL("f2"),
    " AND upper(btrim(a2.origen_id::text))=upper(btrim(sold.article))",
    " AND (a2.nombre ILIKE '%'||$6||'%'"+(has("articulos","codigo_nacional")?" OR a2.codigo_nacional ILIKE '%'||$6||'%'":"")+")",
    " )))",
    " ORDER BY greatest(coalesce(u3,0),0) DESC,greatest(coalesce(u12,0),0) DESC,fid,article LIMIT $5::int)",
    " SELECT s.fid::text AS \"pharmacyId\",s.article AS \"articleId\",",
    " coalesce(nullif(btrim(a.name),''),s.article) AS \"articleName\",a.cn,",
    " a.stock::float8 AS stock,a.stamp AS \"stockAt\",",
    " coalesce(s.period,0)::float8 AS \"unitsPeriod\",coalesce(s.u3,0)::float8 AS \"units3\",",
    " coalesce(s.u12,0)::float8 AS \"units12\" FROM ranked s",
    " JOIN farmetrica.farmacias f ON f.id=s.fid AND f.cliente_slug=$4",
    " LEFT JOIN LATERAL (SELECT a.nombre AS name,"+code+" AS cn,",
    " a.stock_actual AS stock,"+stamp+" AS stamp FROM "+q+".articulos a",
    " WHERE upper(btrim(a.farmacia_codigo))="+join,
    " AND upper(btrim(a.origen_id::text))=upper(btrim(s.article))",
    " "+latest+" LIMIT 1) a ON true ORDER BY s.fid,s.article"
   ].join(" ");
   const [sales,policies,orders]=await Promise.all([
    pool.query({text:sql,values:[from,to,chosen,ctx.client.slug,MAX+1,search],query_timeout:30000}),
    pool.query("SELECT farmacia_id,intervalo_pedidos,plazo_entrega,stock_seguridad"+
     " FROM farmetrica.op_politicas_reposicion WHERE cliente_slug=$1 AND farmacia_id=ANY($2::int[])",
     [ctx.client.slug,chosen]),
    pool.query("SELECT farmacia_id,lineas FROM farmetrica.op_pedidos"+
     " WHERE cliente_slug=$1 AND farmacia_id=ANY($2::int[]) AND estado IN ('aprobado','exportado')"+
     " ORDER BY actualizado_en DESC LIMIT 1000",[ctx.client.slug,chosen])
   ]);
   const policyMap=new Map(policies.rows.map(p=>[Number(p.farmacia_id),p]));
   const ordered=new Map();
   for(const o of orders.rows)for(const line of Array.isArray(o.lineas)?o.lineas:[]){
    const key=o.farmacia_id+"|"+normalize(line.articulo);
    ordered.set(key,(ordered.get(key)||0)+(line.asignaciones||[]).reduce((n,a)=>n+Number(a.unidades||0),0));
   }
   const rows=sales.rows.slice(0,MAX).map(s=>{
    const policy=policyMap.get(Number(s.pharmacyId));
    const stock=s.stock==null?null:Number(s.stock);
    const calculated=proposePurchase({stock,units3:Math.max(0,Number(s.units3||0)),
     units12:Math.max(0,Number(s.units12||0)),
     ordered:ordered.get(s.pharmacyId+"|"+normalize(s.articleId))||0,
     interval:policy?.intervalo_pedidos??7,lead:policy?.plazo_entrega??2,
     safety:policy?.stock_seguridad??0});
    return {...s,stock,...calculated,policyDefault:!policy,
     interval:policy?.intervalo_pedidos??7,lead:policy?.plazo_entrega??2,
     safety:policy?.stock_seguridad??0,
     confidence:stock===null?"sin_stock":s.stockAt==null?"fecha_desconocida":
      Date.now()-new Date(s.stockAt).getTime()>48*3600000?"stock_antiguo":"calculable"};
   });
   const groups=groupPurchaseRows(rows).filter(g=>!search||
    normalize([g.cn,g.articleName,...g.pharmacies.map(p=>p.articleId)].join(" ")).includes(search));
   res.json({available:true,from,to,groups,limit:MAX,truncated:sales.rows.length>MAX,
    pharmacies:ctx.pharmacies.filter(p=>chosen.includes(Number(p.id))).map(p=>({id:p.id,name:p.name})),
    note:"Propuesta por medias de ventas de 90 y 365 días. Se descuentan stock y pedidos internos aprobados/exportados; estos últimos no se concilian automáticamente con recepciones. Sin política configurada se asumen 7 días entre pedidos, 2 de entrega y 0 unidades de seguridad."});
  }catch(e){next(e)}
 });
}
