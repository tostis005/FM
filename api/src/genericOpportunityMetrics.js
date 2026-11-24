import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {classifyAbcd} from "./abcd.js";
import {readPricePolicy,weightedLowPriceReference} from "./pricePolicy.js";
import {includedPurchaseSupplier} from "./supplierReporting.js";
import {describeGenericOfferGroup} from "./genericOfferFacets.js";
import {buildGenericOpportunities} from "./genericOpportunityModel.js";
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const DATE=/^20\d{2}-\d{2}-\d{2}$/;
const validDate=d=>DATE.test(d)&&!Number.isNaN(Date.parse(d+"T00:00:00Z"))&&new Date(d+"T00:00:00Z").toISOString().slice(0,10)===d;
export function setupGenericOpportunityMetrics(app,pool,{requireTenantModule}){
 const guard=requireTenantModule("genericos");
 app.get("/api/genericos/ofertas/oportunidades",...guard,async(req,res,next)=>{
  const ctx=req.context,from=String(req.query.desde||""),to=String(req.query.hasta||""),dcpf=String(req.query.dcpf||"");
  const allowed=(ctx.allowedPharmacyIds||[]).map(Number);
  const ids=[...new Set(req.query.farmacias?String(req.query.farmacias).split(",").map(Number):allowed)];
  if(!SCHEMA.test(ctx.client.schema)||!validDate(from)||!validDate(to)||from>to||
   (Date.parse(to)-Date.parse(from))/86400000>367||(dcpf&&!/^\d{1,30}$/.test(dcpf))||
   ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||!allowed.includes(id)))
   return res.status(400).json({error:"Período, conjunto o farmacias inválidos"});
  try{
   const schema='"'+ctx.client.schema+'"',tenant=ctx.client.slug;
   const [cols,tariffs,policy]=await Promise.all([
    pool.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=ANY($2::text[])",[ctx.client.schema,["articulos","fm_ventas_analitica","fm_recepciones_analitica"]]),
    pool.query({text:"SELECT n.dcpf::text AS dcpf,n.cn,n.nombre AS name,n.principio_activo AS principle,n.descripcion_dcpf AS description,o.laboratorio_fuente AS laboratory,o.neto::float8 AS net,o.puc::float8 AS puc FROM farmetrica.genericos_ofertas_laboratorios o JOIN farmetrica.nomenclator_presentaciones n ON n.cn=o.cn WHERE o.cliente_slug=$1 AND n.generico=true AND nullif(n.dcpf::text,'') IS NOT NULL AND ($2='' OR n.dcpf::text=$2)",values:[tenant,dcpf],query_timeout:12000}),
    readPricePolicy(pool,tenant)
   ]);
   const has=(table,fields)=>fields.every(col=>cols.rows.some(c=>c.table_name===table&&c.column_name===col));
   const mapped=has("articulos",["farmacia_codigo","origen_id","codigo_nacional","sincronizado_en"]);
   const haveSales=mapped&&has("fm_ventas_analitica",["farmacia_codigo","articulo_id","fecha","unidades","importe"]);
   const havePurchases=mapped&&has("fm_recepciones_analitica",["farmacia_codigo","articulo_id","fecha","unidades","coste_unitario","proveedor_id","proveedor_nombre"]);
   const joinPh=" JOIN farmetrica.farmacias f ON f.cliente_slug=$1 AND f.id=ANY($2::int[]) AND v.farmacia_codigo="+pharmacyDataCodeSQL("f");
   const mapJoin=mapped?" LEFT JOIN LATERAL(SELECT CASE WHEN btrim(a.codigo_nacional::text)~'^[0-9]{6,7} FROM "+schema+".articulos a WHERE upper(btrim(a.farmacia_codigo))=b.code AND a.origen_id=b.article ORDER BY a.sincronizado_en DESC NULLS LAST LIMIT 1) a ON true":"";
   const identity=mapped?"a.cn":"NULL::text";
   const articleKeys=async cns=>{
    if(!cns.length)return [];
    if(!mapped)return cns;
    const {rows}=await pool.query({text:"SELECT DISTINCT a.origen_id::text AS article FROM "+schema+".articulos a JOIN farmetrica.farmacias f ON f.cliente_slug=$1 AND f.id=ANY($2::int[]) AND upper(btrim(a.farmacia_codigo))="+pharmacyDataCodeSQL("f")+" WHERE btrim(a.codigo_nacional::text)=ANY($3::text[])",values:[tenant,ids,cns],query_timeout:9000});
    return [...new Set(rows.map(x=>String(x.article)))];
   };
   let detailArticles=[];
   if(dcpf){
    const {rows}=await pool.query("SELECT cn FROM farmetrica.nomenclator_presentaciones WHERE generico=true AND dcpf::text=$1",[dcpf]);
    detailArticles=await articleKeys(rows.map(x=>String(x.cn)));
   }
   const salesSql="WITH b AS MATERIALIZED(SELECT f.id AS pharmacy,upper(btrim(v.farmacia_codigo)) AS code,v.articulo_id::text AS article,"+
    "sum(v.unidades) FILTER(WHERE v.fecha>=$3::date AND v.fecha<$4::date+interval '1 day')::float8 AS units,"+
    "sum(v.importe) FILTER(WHERE v.fecha>=$3::date AND v.fecha<$4::date+interval '1 day')::float8 AS revenue,"+
    "sum(v.unidades) FILTER(WHERE v.fecha>=date_trunc('month',current_date)-interval '11 months' AND v.fecha<current_date+interval '1 day')::float8 AS annual,"+
    "sum(v.unidades) FILTER(WHERE v.fecha>=date_trunc('month',current_date)-interval '2 months' AND v.fecha<current_date+interval '1 day')::float8 AS quarter "+
    "FROM "+schema+".fm_ventas_analitica v"+joinPh+
    " WHERE v.fecha>=least($3::date,date_trunc('month',current_date)-interval '11 months') AND v.fecha<greatest($4::date,current_date)+interval '1 day' "+(dcpf?"AND v.articulo_id=ANY($6::text[]) ":"")+"GROUP BY 1,2,3) "+
    "SELECT b.pharmacy AS \"pharmacyId\",n.cn,n.dcpf::text AS dcpf,n.nombre AS name,n.principio_activo AS principle,n.descripcion_dcpf AS description,coalesce(nullif(n.laboratorio_comercializador,''),nullif(n.laboratorio,''),n.laboratorio_titular,'Laboratorio no identificado') AS laboratory,coalesce(sum(b.units),0)::float8 AS units,coalesce(sum(b.revenue),0)::float8 AS revenue,coalesce(sum(b.annual),0)::float8 AS annual,coalesce(sum(b.quarter),0)::float8 AS quarter FROM b"+mapJoin+" JOIN farmetrica.nomenclator_presentaciones n ON n.cn="+identity+" WHERE n.generico=true AND nullif(n.dcpf::text,'') IS NOT NULL AND ($5='' OR n.dcpf::text=$5) GROUP BY b.pharmacy,n.cn,n.dcpf,n.nombre,n.principio_activo,n.descripcion_dcpf,n.laboratorio_comercializador,n.laboratorio,n.laboratorio_titular";
   // A failed source is not treated as zero sales or zero saving.
   let sales=[],salesAvailable=haveSales,purchasesAvailable=havePurchases,warning=haveSales?"":"No hay fuente de ventas disponible. Solo se muestran las tarifas vigentes.";
   if(haveSales&&ids.length){
    try{sales=(await pool.query({text:salesSql,values:[tenant,ids,from,to,dcpf,...(dcpf?[detailArticles]:[])],query_timeout:25000})).rows}
    catch(e){salesAvailable=false;warning="No se pudieron calcular las oportunidades de venta para todo el catálogo. Reduce el período o las farmacias y actualiza.";}
   }
   const priced=new Set(tariffs.rows.map(x=>String(x.cn)));
   const missing=[...new Set(sales.filter(s=>(Number(s.units)>0||Number(s.annual)>0)&&!priced.has(String(s.cn))).map(s=>String(s.cn)))];
   const references=new Map();
   if(havePurchases&&missing.length&&ids.length){
    const maxMonths=Math.max(Number(policy.global.months),...(policy.overrides||[]).map(x=>Number(x.months)));
    const start=new Date(to+"T00:00:00Z");start.setUTCDate(1);start.setUTCMonth(start.getUTCMonth()-maxMonths);
    const purchaseSql="WITH b AS MATERIALIZED(SELECT f.id AS pharmacy,upper(btrim(v.farmacia_codigo)) AS code,v.articulo_id::text AS article,v.fecha::date::text AS date,v.coste_unitario::float8 AS price,coalesce(v.proveedor_id::text,v.proveedor_nombre,'') AS supplier,sum(v.unidades)::float8 AS units,count(*)::int AS lines FROM "+schema+".fm_recepciones_analitica v"+joinPh+
     " WHERE v.fecha>=$3::date AND v.fecha<$4::date+interval '1 day' AND v.articulo_id=ANY($6::text[]) AND v.unidades>0 AND v.coste_unitario>0 AND "+includedPurchaseSupplier({tenant:"$1",code:"v.proveedor_id",name:"v.proveedor_nombre"})+" GROUP BY 1,2,3,4,5,6) "+
     "SELECT b.*,n.cn FROM b"+mapJoin+" JOIN farmetrica.nomenclator_presentaciones n ON n.cn="+identity+" WHERE n.cn=ANY($5::text[])";
    try{
     const {rows}=await pool.query({text:purchaseSql,values:[tenant,ids,start.toISOString().slice(0,10),to,missing,await articleKeys(missing)],query_timeout:25000});
     const grouped=new Map(),overrides=new Map((policy.overrides||[]).map(x=>[String(x.pharmacyId),x]));
     for(const row of rows){
      const cfg=overrides.get(String(row.pharmacy))||policy.global;
      const since=new Date(to+"T00:00:00Z");since.setUTCMonth(since.getUTCMonth()-Number(cfg.months));
      if(row.date<since.toISOString().slice(0,10))continue;
      const key=JSON.stringify([String(row.pharmacy),String(row.cn),String(row.supplier)]);
      const group=grouped.get(key)||{pharmacy:String(row.pharmacy),cn:String(row.cn),cfg,lines:[],count:0};
      group.lines.push({units:row.units,price:row.price});group.count+=Number(row.lines||0);grouped.set(key,group);
     }
     for(const g of grouped.values()){
      if(g.count<3)continue;
      const net=weightedLowPriceReference(g.lines,g.cfg.percentile),key=g.pharmacy+"|"+g.cn;
      if(net!=null&&(!references.has(key)||net<references.get(key).net))references.set(key,{net,percentile:g.cfg.percentile,months:g.cfg.months});
     }
    }catch(e){purchasesAvailable=false;warning+=(warning?" ":"")+"No se pudieron calcular los PUC históricos sin tarifa. Se muestran sin precio.";}
   }
   if(!havePurchases&&missing.length)warning+=(warning?" ":"")+"No hay fuente de recepciones: los CN vendidos sin tarifa se muestran sin PUC.";
   const items=buildGenericOpportunities({tariffs:tariffs.rows,sales,references,salesAvailable,detail:Boolean(dcpf)});
   const classes=classifyAbcd(items,{identity:x=>x.dcpf,revenue:x=>x.revenue,units:x=>x.salesUnits});
   res.json({items:items.map(x=>describeGenericOfferGroup({...x,abcdClass:salesAvailable&&!dcpf?classes.get("_all|"+x.dcpf)||"D":null})),salesAvailable,purchasesAvailable,warning});
  }catch(e){next(e)}
 });
 app.get("/api/genericos/ofertas/pedido-datos/:dcpf",...guard,async(req,res,next)=>{
  const ctx=req.context,from=String(req.query.desde||""),to=String(req.query.hasta||""),dcpf=String(req.params.dcpf||"");
  const allowed=(ctx.allowedPharmacyIds||[]).map(Number);
  const ids=[...new Set(req.query.farmacias?String(req.query.farmacias).split(",").map(Number):allowed)];
  if(!SCHEMA.test(ctx.client.schema)||!validDate(from)||!validDate(to)||from>to||
   (Date.parse(to)-Date.parse(from))/86400000>367||!/^\d{1,30}$/.test(dcpf)||ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||!allowed.includes(id)))
   return res.status(400).json({error:"Período, conjunto o farmacias inválidos"});
  if(!ids.length)return res.json({items:[]});
  try{
   const schema='"'+ctx.client.schema+'"';
   const {rows:cols}=await pool.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=ANY($2::text[])",[ctx.client.schema,["articulos","fm_ventas_analitica"]]);
   const has=(table,fields)=>fields.every(col=>cols.some(c=>c.table_name===table&&c.column_name===col));
   const mapped=has("articulos",["farmacia_codigo","origen_id","codigo_nacional","sincronizado_en"]);
   const stock=mapped&&has("articulos",["stock_actual"]);
   const sales=mapped&&has("fm_ventas_analitica",["farmacia_codigo","articulo_id","fecha","unidades"]);
   const prefix="WITH pharmacies AS (SELECT f.id,"+pharmacyDataCodeSQL("f")+" AS code FROM farmetrica.farmacias f WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[])), "+
    "cns AS (SELECT DISTINCT cn FROM farmetrica.nomenclator_presentaciones WHERE generico=true AND dcpf::text=$3), "+
    "mapped AS ("+(mapped?"SELECT DISTINCT ON (f.id,a.origen_id) f.id,a.origen_id::text AS article,btrim(a.codigo_nacional::text) AS cn,"+(stock?"a.stock_actual::float8":"NULL::float8")+" AS stock FROM "+schema+".articulos a JOIN pharmacies f ON upper(btrim(a.farmacia_codigo))=f.code ORDER BY f.id,a.origen_id,a.sincronizado_en DESC NULLS LAST":"SELECT NULL::int AS id,NULL::text AS article,NULL::text AS cn,NULL::float8 AS stock WHERE false")+") ";
   const args=[ctx.client.slug,ids,dcpf];
   const [sr,vr]=await Promise.allSettled([
    stock?pool.query({text:prefix+"SELECT id AS \"pharmacyId\",cn,CASE WHEN count(stock)=count(*) THEN sum(stock)::float8 END AS stock FROM mapped JOIN cns USING(cn) GROUP BY id,cn",values:args,query_timeout:12000}):Promise.resolve({rows:[]}),
    sales?pool.query({text:prefix+", keys AS (SELECT id,article,cn FROM mapped JOIN cns USING(cn)) SELECT f.id AS \"pharmacyId\",k.cn,coalesce(sum(v.unidades) FILTER (WHERE v.fecha>=date_trunc('month',current_date)-interval '2 months' AND v.fecha<current_date+interval '1 day'),0)::float8 AS \"units3\",coalesce(sum(v.unidades) FILTER (WHERE v.fecha>=date_trunc('month',current_date)-interval '11 months' AND v.fecha<current_date+interval '1 day'),0)::float8 AS \"units12\",coalesce(sum(v.unidades) FILTER (WHERE v.fecha>=$4::date AND v.fecha<$5::date+interval '1 day'),0)::float8 AS \"unitsPeriod\" FROM keys k JOIN pharmacies f ON f.id=k.id LEFT JOIN "+schema+".fm_ventas_analitica v ON v.farmacia_codigo=f.code AND v.articulo_id=k.article AND v.fecha>=least($4::date,date_trunc('month',current_date)-interval '11 months') AND v.fecha<greatest($5::date,current_date)+interval '1 day' GROUP BY f.id,k.cn",values:[...args,from,to],query_timeout:18000}):Promise.resolve({rows:[]})
   ]);
   const items=new Map();
   for(const x of [...(sr.status==="fulfilled"?sr.value.rows:[]),...(vr.status==="fulfilled"?vr.value.rows:[])]){
    const k=x.pharmacyId+"|"+x.cn;items.set(k,{...items.get(k),...x});
   }
   res.json({items:[...items.values()],stockAvailable:stock&&sr.status==="fulfilled",salesAvailable:sales&&vr.status==="fulfilled"});
  }catch(e){next(e)}
 });
}
 THEN btrim(a.codigo_nacional::text) END AS cn FROM "+schema+".articulos a WHERE upper(btrim(a.farmacia_codigo))=b.code AND a.origen_id=b.article ORDER BY a.sincronizado_en DESC NULLS LAST LIMIT 1) a ON true":"";
   const identity=mapped?"a.cn":"NULL::text";
   const articleKeys=async cns=>{
    if(!cns.length)return [];
    if(!mapped)return cns;
    const {rows}=await pool.query({text:"SELECT DISTINCT a.origen_id::text AS article FROM "+schema+".articulos a JOIN farmetrica.farmacias f ON f.cliente_slug=$1 AND f.id=ANY($2::int[]) AND upper(btrim(a.farmacia_codigo))="+pharmacyDataCodeSQL("f")+" WHERE btrim(a.codigo_nacional::text)=ANY($3::text[])",values:[tenant,ids,cns],query_timeout:9000});
    return [...new Set(rows.map(x=>String(x.article)))];
   };
   let detailArticles=[];
   if(dcpf){
    const {rows}=await pool.query("SELECT cn FROM farmetrica.nomenclator_presentaciones WHERE generico=true AND dcpf::text=$1",[dcpf]);
    detailArticles=await articleKeys(rows.map(x=>String(x.cn)));
   }
   const salesSql="WITH b AS MATERIALIZED(SELECT f.id AS pharmacy,upper(btrim(v.farmacia_codigo)) AS code,v.articulo_id::text AS article,"+
    "sum(v.unidades) FILTER(WHERE v.fecha>=$3::date AND v.fecha<$4::date+interval '1 day')::float8 AS units,"+
    "sum(v.importe) FILTER(WHERE v.fecha>=$3::date AND v.fecha<$4::date+interval '1 day')::float8 AS revenue,"+
    "sum(v.unidades) FILTER(WHERE v.fecha>=date_trunc('month',current_date)-interval '11 months' AND v.fecha<current_date+interval '1 day')::float8 AS annual,"+
    "sum(v.unidades) FILTER(WHERE v.fecha>=date_trunc('month',current_date)-interval '2 months' AND v.fecha<current_date+interval '1 day')::float8 AS quarter "+
    "FROM "+schema+".fm_ventas_analitica v"+joinPh+
    " WHERE v.fecha>=least($3::date,date_trunc('month',current_date)-interval '11 months') AND v.fecha<greatest($4::date,current_date)+interval '1 day' "+(dcpf?"AND v.articulo_id=ANY($6::text[]) ":"")+"GROUP BY 1,2,3) "+
    "SELECT b.pharmacy AS \"pharmacyId\",n.cn,n.dcpf::text AS dcpf,n.nombre AS name,n.principio_activo AS principle,n.descripcion_dcpf AS description,coalesce(nullif(n.laboratorio_comercializador,''),nullif(n.laboratorio,''),n.laboratorio_titular,'Laboratorio no identificado') AS laboratory,coalesce(sum(b.units),0)::float8 AS units,coalesce(sum(b.revenue),0)::float8 AS revenue,coalesce(sum(b.annual),0)::float8 AS annual,coalesce(sum(b.quarter),0)::float8 AS quarter FROM b"+mapJoin+" JOIN farmetrica.nomenclator_presentaciones n ON n.cn="+identity+" WHERE n.generico=true AND nullif(n.dcpf::text,'') IS NOT NULL AND ($5='' OR n.dcpf::text=$5) GROUP BY b.pharmacy,n.cn,n.dcpf,n.nombre,n.principio_activo,n.descripcion_dcpf,n.laboratorio_comercializador,n.laboratorio,n.laboratorio_titular";
   // A failed source is not treated as zero sales or zero saving.
   let sales=[],salesAvailable=haveSales,purchasesAvailable=havePurchases,warning=haveSales?"":"No hay fuente de ventas disponible. Solo se muestran las tarifas vigentes.";
   if(haveSales&&ids.length){
    try{sales=(await pool.query({text:salesSql,values:[tenant,ids,from,to,dcpf,...(dcpf?[detailArticles]:[])],query_timeout:25000})).rows}
    catch(e){salesAvailable=false;warning="No se pudieron calcular las oportunidades de venta para todo el catálogo. Reduce el período o las farmacias y actualiza.";}
   }
   const priced=new Set(tariffs.rows.map(x=>String(x.cn)));
   const missing=[...new Set(sales.filter(s=>(Number(s.units)>0||Number(s.annual)>0)&&!priced.has(String(s.cn))).map(s=>String(s.cn)))];
   const references=new Map();
   if(havePurchases&&missing.length&&ids.length){
    const maxMonths=Math.max(Number(policy.global.months),...(policy.overrides||[]).map(x=>Number(x.months)));
    const start=new Date(to+"T00:00:00Z");start.setUTCDate(1);start.setUTCMonth(start.getUTCMonth()-maxMonths);
    const purchaseSql="WITH b AS MATERIALIZED(SELECT f.id AS pharmacy,upper(btrim(v.farmacia_codigo)) AS code,v.articulo_id::text AS article,v.fecha::date::text AS date,v.coste_unitario::float8 AS price,coalesce(v.proveedor_id::text,v.proveedor_nombre,'') AS supplier,sum(v.unidades)::float8 AS units,count(*)::int AS lines FROM "+schema+".fm_recepciones_analitica v"+joinPh+
     " WHERE v.fecha>=$3::date AND v.fecha<$4::date+interval '1 day' AND v.articulo_id=ANY($6::text[]) AND v.unidades>0 AND v.coste_unitario>0 AND "+includedPurchaseSupplier({tenant:"$1",code:"v.proveedor_id",name:"v.proveedor_nombre"})+" GROUP BY 1,2,3,4,5,6) "+
     "SELECT b.*,n.cn FROM b"+mapJoin+" JOIN farmetrica.nomenclator_presentaciones n ON n.cn="+identity+" WHERE n.cn=ANY($5::text[])";
    try{
     const {rows}=await pool.query({text:purchaseSql,values:[tenant,ids,start.toISOString().slice(0,10),to,missing,await articleKeys(missing)],query_timeout:25000});
     const grouped=new Map(),overrides=new Map((policy.overrides||[]).map(x=>[String(x.pharmacyId),x]));
     for(const row of rows){
      const cfg=overrides.get(String(row.pharmacy))||policy.global;
      const since=new Date(to+"T00:00:00Z");since.setUTCMonth(since.getUTCMonth()-Number(cfg.months));
      if(row.date<since.toISOString().slice(0,10))continue;
      const key=JSON.stringify([String(row.pharmacy),String(row.cn),String(row.supplier)]);
      const group=grouped.get(key)||{pharmacy:String(row.pharmacy),cn:String(row.cn),cfg,lines:[],count:0};
      group.lines.push({units:row.units,price:row.price});group.count+=Number(row.lines||0);grouped.set(key,group);
     }
     for(const g of grouped.values()){
      if(g.count<3)continue;
      const net=weightedLowPriceReference(g.lines,g.cfg.percentile),key=g.pharmacy+"|"+g.cn;
      if(net!=null&&(!references.has(key)||net<references.get(key).net))references.set(key,{net,percentile:g.cfg.percentile,months:g.cfg.months});
     }
    }catch(e){purchasesAvailable=false;warning+=(warning?" ":"")+"No se pudieron calcular los PUC históricos sin tarifa. Se muestran sin precio.";}
   }
   if(!havePurchases&&missing.length)warning+=(warning?" ":"")+"No hay fuente de recepciones: los CN vendidos sin tarifa se muestran sin PUC.";
   const items=buildGenericOpportunities({tariffs:tariffs.rows,sales,references,salesAvailable,detail:Boolean(dcpf)});
   const classes=classifyAbcd(items,{identity:x=>x.dcpf,revenue:x=>x.revenue,units:x=>x.salesUnits});
   res.json({items:items.map(x=>describeGenericOfferGroup({...x,abcdClass:salesAvailable&&!dcpf?classes.get("_all|"+x.dcpf)||"D":null})),salesAvailable,purchasesAvailable,warning});
  }catch(e){next(e)}
 });
 app.get("/api/genericos/ofertas/pedido-datos/:dcpf",...guard,async(req,res,next)=>{
  const ctx=req.context,from=String(req.query.desde||""),to=String(req.query.hasta||""),dcpf=String(req.params.dcpf||"");
  const allowed=(ctx.allowedPharmacyIds||[]).map(Number);
  const ids=[...new Set(req.query.farmacias?String(req.query.farmacias).split(",").map(Number):allowed)];
  if(!SCHEMA.test(ctx.client.schema)||!validDate(from)||!validDate(to)||from>to||
   (Date.parse(to)-Date.parse(from))/86400000>367||!/^\d{1,30}$/.test(dcpf)||ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||!allowed.includes(id)))
   return res.status(400).json({error:"Período, conjunto o farmacias inválidos"});
  if(!ids.length)return res.json({items:[]});
  try{
   const schema='"'+ctx.client.schema+'"';
   const {rows:cols}=await pool.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=ANY($2::text[])",[ctx.client.schema,["articulos","fm_ventas_analitica"]]);
   const has=(table,fields)=>fields.every(col=>cols.some(c=>c.table_name===table&&c.column_name===col));
   const mapped=has("articulos",["farmacia_codigo","origen_id","codigo_nacional","sincronizado_en"]);
   const stock=mapped&&has("articulos",["stock_actual"]);
   const sales=mapped&&has("fm_ventas_analitica",["farmacia_codigo","articulo_id","fecha","unidades"]);
   const prefix="WITH pharmacies AS (SELECT f.id,"+pharmacyDataCodeSQL("f")+" AS code FROM farmetrica.farmacias f WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[])), "+
    "cns AS (SELECT DISTINCT cn FROM farmetrica.nomenclator_presentaciones WHERE generico=true AND dcpf::text=$3), "+
    "mapped AS ("+(mapped?"SELECT DISTINCT ON (f.id,a.origen_id) f.id,a.origen_id::text AS article,btrim(a.codigo_nacional::text) AS cn,"+(stock?"a.stock_actual::float8":"NULL::float8")+" AS stock FROM "+schema+".articulos a JOIN pharmacies f ON upper(btrim(a.farmacia_codigo))=f.code ORDER BY f.id,a.origen_id,a.sincronizado_en DESC NULLS LAST":"SELECT NULL::int AS id,NULL::text AS article,NULL::text AS cn,NULL::float8 AS stock WHERE false")+") ";
   const args=[ctx.client.slug,ids,dcpf];
   const [sr,vr]=await Promise.allSettled([
    stock?pool.query({text:prefix+"SELECT id AS \"pharmacyId\",cn,CASE WHEN count(stock)=count(*) THEN sum(stock)::float8 END AS stock FROM mapped JOIN cns USING(cn) GROUP BY id,cn",values:args,query_timeout:12000}):Promise.resolve({rows:[]}),
    sales?pool.query({text:prefix+", keys AS (SELECT id,article,cn FROM mapped JOIN cns USING(cn)) SELECT f.id AS \"pharmacyId\",k.cn,coalesce(sum(v.unidades) FILTER (WHERE v.fecha>=date_trunc('month',current_date)-interval '2 months' AND v.fecha<current_date+interval '1 day'),0)::float8 AS \"units3\",coalesce(sum(v.unidades) FILTER (WHERE v.fecha>=date_trunc('month',current_date)-interval '11 months' AND v.fecha<current_date+interval '1 day'),0)::float8 AS \"units12\",coalesce(sum(v.unidades) FILTER (WHERE v.fecha>=$4::date AND v.fecha<$5::date+interval '1 day'),0)::float8 AS \"unitsPeriod\" FROM keys k JOIN pharmacies f ON f.id=k.id LEFT JOIN "+schema+".fm_ventas_analitica v ON v.farmacia_codigo=f.code AND v.articulo_id=k.article AND v.fecha>=least($4::date,date_trunc('month',current_date)-interval '11 months') AND v.fecha<greatest($5::date,current_date)+interval '1 day' GROUP BY f.id,k.cn",values:[...args,from,to],query_timeout:18000}):Promise.resolve({rows:[]})
   ]);
   const items=new Map();
   for(const x of [...(sr.status==="fulfilled"?sr.value.rows:[]),...(vr.status==="fulfilled"?vr.value.rows:[])]){
    const k=x.pharmacyId+"|"+x.cn;items.set(k,{...items.get(k),...x});
   }
   res.json({items:[...items.values()],stockAvailable:stock&&sr.status==="fulfilled",salesAvailable:sales&&vr.status==="fulfilled"});
  }catch(e){next(e)}
 });
}
