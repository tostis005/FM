import {readPricePolicy} from "./pricePolicy.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {includedPurchaseSupplier} from "./supplierReporting.js";
import {periodReference} from "./genericSavings.js";

const ISO=/^20\d{2}-\d{2}-\d{2}$/;
const DCPF=/^\d{1,30}$/;
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const validDate=d=>ISO.test(d)&&!Number.isNaN(Date.parse(d+"T00:00:00Z"))&&
 new Date(d+"T00:00:00Z").toISOString().slice(0,10)===d;
const trim=x=>String(x??"").trim();
async function hasFields(pool,schema,table,required){
 const {rows}=await pool.query("SELECT column_name FROM information_schema.columns "+
  "WHERE table_schema=$1 AND table_name=$2",[schema,table]);
 const found=new Set(rows.map(x=>x.column_name));
 return required.every(x=>found.has(x));
}
function policyStart(to,policy){
 const months=Math.max(Number(policy.global?.months||6),
  ...(policy.overrides||[]).map(x=>Number(x.months||6)));
 const date=new Date(to+"T00:00:00Z");
 date.setUTCDate(1);
 date.setUTCMonth(date.getUTCMonth()-months);
 return date.toISOString().slice(0,10);
}
export function setupGenericOfferHistory(app,pool,{requireTenantModule}){
 const guard=requireTenantModule("genericos");
 app.get("/api/genericos/ofertas/historico/:dcpf",...guard,async(req,res,next)=>{
  const dcpf=trim(req.params.dcpf),from=trim(req.query.desde),to=trim(req.query.hasta),
   raw=trim(req.query.farmacias),ctx=req.context;
  if(!DCPF.test(dcpf)||!validDate(from)||!validDate(to)||from>to||
   (Date.parse(to)-Date.parse(from))/86400000>367||raw.length>2000||
   !SCHEMA.test(ctx.client.schema))
   return res.status(400).json({error:"Conjunto, período o farmacias inválidos"});
  const allowed=(ctx.allowedPharmacyIds||[]).map(Number);
  const ids=raw?raw.split(",").map(Number):allowed;
  if(ids.some(id=>!Number.isSafeInteger(id)||!allowed.includes(id)))
   return res.status(403).json({error:"No tienes acceso a alguna de las farmacias"});
  const chosen=[...new Set(ids)];
  try{
   const [official,policy,pharmacies]=await Promise.all([
    pool.query("SELECT cn FROM farmetrica.nomenclator_presentaciones "+
     "WHERE dcpf=$1 AND generico=true",[dcpf]),
    readPricePolicy(pool,ctx.client.slug),
    pool.query("SELECT f.id::int AS id,"+pharmacyDataCodeSQL("f")+
     " AS code FROM farmetrica.farmacias f WHERE f.cliente_slug=$1 "+
     "AND f.id=ANY($2::int[])",[ctx.client.slug,chosen])
   ]);
   const cns=official.rows.map(x=>x.cn);
   if(!cns.length)return res.status(404).json({error:"El conjunto no contiene genéricos EFG"});
   const codes=pharmacies.rows.map(x=>x.code);
   if(!codes.length)return res.json({...periodReference({to,policy}),
    from,to,salesAvailable:true,purchasesAvailable:true});
   const schema='"'+ctx.client.schema+'"';
   const [hasArt,hasSales,hasBuys]=await Promise.all([
    hasFields(pool,ctx.client.schema,"articulos",
     ["farmacia_codigo","origen_id","codigo_nacional","sincronizado_en"]),
    hasFields(pool,ctx.client.schema,"fm_ventas_analitica",
     ["farmacia_codigo","articulo_id","fecha","unidades","importe"]),
    hasFields(pool,ctx.client.schema,"fm_recepciones_analitica",
     ["farmacia_codigo","articulo_id","fecha","unidades","coste_unitario","proveedor_id","proveedor_nombre"])
   ]);
   const mapped=hasArt?await pool.query({
    text:"SELECT DISTINCT ON (upper(btrim(a.farmacia_codigo)),a.origen_id) "+
     "upper(btrim(a.farmacia_codigo)) AS code,a.origen_id AS article,"+
     "btrim(a.codigo_nacional) AS cn "+
     "FROM "+schema+".articulos a "+
     "WHERE (btrim(a.codigo_nacional)=ANY($1::text[]) OR a.origen_id=ANY($1::text[])) "+
     "AND upper(btrim(a.farmacia_codigo))=ANY($2::text[]) "+
     "ORDER BY upper(btrim(a.farmacia_codigo)),a.origen_id,a.sincronizado_en DESC NULLS LAST",
    values:[cns,codes],query_timeout:12000}):{rows:[]};
   const validCN=new Set(cns),cnByArticle=new Map();
   for(const row of mapped.rows){
    const cn=validCN.has(row.cn)?row.cn:validCN.has(row.article)?row.article:null;
    if(cn)cnByArticle.set(row.code+"|"+row.article,cn);
   }
   const idsToRead=[...new Set([...cns,...mapped.rows.map(x=>x.article)])];
   const pharmacyByCode=new Map(pharmacies.rows.map(x=>[x.code,Number(x.id)]));
   const matches=row=>validCN.has(cnByArticle.get(row.code+"|"+row.article)||
    (validCN.has(row.article)?row.article:""));
   const salesQuery=hasSales?pool.query({
    text:"SELECT upper(btrim(v.farmacia_codigo)) AS code,v.articulo_id AS article,"+
     "sum(v.unidades)::float8 AS units,sum(v.importe)::float8 AS revenue "+
     "FROM "+schema+".fm_ventas_analitica v "+
     "WHERE v.fecha>=$1::date AND v.fecha<$2::date+interval '1 day' "+
     "AND upper(btrim(v.farmacia_codigo))=ANY($3::text[]) "+
     "AND v.articulo_id=ANY($4::text[]) "+
     "GROUP BY 1,2",
    values:[from,to,codes,idsToRead],query_timeout:20000
   }):Promise.resolve({rows:[]});
   const purchasesQuery=hasBuys?pool.query({
    text:"SELECT upper(btrim(v.farmacia_codigo)) AS code,v.articulo_id AS article,"+
     "v.fecha::date::text AS date,v.coste_unitario::float8 AS price,"+
     "sum(v.unidades)::float8 AS units,count(*)::int AS lines "+
     "FROM "+schema+".fm_recepciones_analitica v "+
     "WHERE v.fecha>=$1::date AND v.fecha<$2::date+interval '1 day' "+
     "AND upper(btrim(v.farmacia_codigo))=ANY($3::text[]) "+
     "AND v.articulo_id=ANY($4::text[]) "+
     "AND v.unidades>0 AND v.coste_unitario>0 "+
     "AND "+includedPurchaseSupplier({tenant:"$5",code:"v.proveedor_id",name:"v.proveedor_nombre"})+
     " GROUP BY 1,2,3,4",
    values:[policyStart(to,policy),to,codes,idsToRead,ctx.client.slug],
    query_timeout:20000
   }):Promise.resolve({rows:[]});
   const [salesResult,purchasesResult]=await Promise.allSettled([salesQuery,purchasesQuery]);
   const salesRows=salesResult.status==="fulfilled"?salesResult.value.rows:[];
   const purchaseRows=purchasesResult.status==="fulfilled"?purchasesResult.value.rows:[];
   const sales=salesRows.filter(matches).map(x=>({
    pharmacyId:pharmacyByCode.get(x.code),units:x.units,revenue:x.revenue
   })).filter(x=>x.pharmacyId!=null);
   const purchases=purchaseRows.filter(matches).map(x=>({
    pharmacyId:pharmacyByCode.get(x.code),date:x.date,price:x.price,
    units:x.units,lines:x.lines
   })).filter(x=>x.pharmacyId!=null);
   const result=periodReference({sales,purchases,policy,to});
   const salesAvailable=hasSales&&salesResult.status==="fulfilled",
    purchasesAvailable=hasBuys&&purchasesResult.status==="fulfilled";
   const warnings=[];
   if(!salesAvailable)warnings.push("No se han podido recuperar las ventas del período.");
   if(!purchasesAvailable)warnings.push("No hay compras normalizadas para calcular el percentil del PUC.");
   return res.json({...result,from,to,dcpf,salesAvailable,purchasesAvailable,
    ...(warnings.length?{warning:warnings.join(" ")}:{})});
  }catch(e){
   if(["57014","53300"].includes(e.code))return res.status(504).json({
    error:"El cálculo de ventas y precios tardó demasiado. Reduce el período o las farmacias."});
   next(e);
  }
 });
}
