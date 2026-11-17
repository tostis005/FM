// Referencias históricas de compra por farmacia para el simulador.
// Las ventas se leen por el endpoint optimizado /ofertas/ventas (cierres mensuales);
// nunca bloquear el detalle del comparador con un segundo escaneo de ventas.
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
function policyStart(to,policy){
 const months=Math.max(Number(policy.global?.months||6),
  ...(policy.overrides||[]).map(x=>Number(x.months||6)));
 const date=new Date(to+"T00:00:00Z");
 date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()-months);
 return date.toISOString().slice(0,10);
}
export function setupGenericOfferHistory(app,pool,{requireTenantModule}){
 app.get("/api/genericos/ofertas/historico/:dcpf",
  ...requireTenantModule("genericos"),async(req,res,next)=>{
  const dcpf=trim(req.params.dcpf),from=trim(req.query.desde),
   to=trim(req.query.hasta),raw=trim(req.query.farmacias),ctx=req.context;
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
    pool.query({text:"SELECT cn FROM farmetrica.nomenclator_presentaciones "+
     "WHERE dcpf=$1 AND generico=true",values:[dcpf],query_timeout:6500}),
    readPricePolicy(pool,ctx.client.slug),
    pool.query({text:"SELECT f.id::int AS id,"+pharmacyDataCodeSQL("f")+
     " AS code FROM farmetrica.farmacias f WHERE f.cliente_slug=$1 "+
     "AND f.id=ANY($2::int[])",values:[ctx.client.slug,chosen],query_timeout:5000})
   ]);
   const cns=official.rows.map(x=>String(x.cn));
   if(!cns.length)return res.status(404).json({error:"El conjunto no contiene genéricos EFG"});
   const codes=pharmacies.rows.map(x=>String(x.code));
   const blank=warning=>res.json({
    ...periodReference({to,policy}),from,to,dcpf,
    salesAvailable:false,purchasesAvailable:false,warning
   });
   if(!codes.length)return blank("No hay farmacias con código ERP para consultar compras.");
   const schema='"'+ctx.client.schema+'"';
   const columns=await pool.query({text:
    "SELECT table_name,column_name FROM information_schema.columns "+
    "WHERE table_schema=$1 AND table_name=ANY($2::text[])",
    values:[ctx.client.schema,["articulos","fm_recepciones_analitica"]],
    query_timeout:3500
   });
   const has=(table,names)=>{
    const actual=new Set(columns.rows.filter(x=>x.table_name===table).map(x=>x.column_name));
    return names.every(col=>actual.has(col));
   };
   if(!has("fm_recepciones_analitica",
    ["farmacia_codigo","articulo_id","fecha","unidades","coste_unitario",
     "proveedor_id","proveedor_nombre"]))
    return blank("Todavía no hay recepciones válidas para calcular el precio de referencia.");
   // Buscar solo CN indexados del maestro. Los IDs ERP idénticos al CN se
   // resuelven directamente sin OR sobre origen_id, que forzaba un escaneo caro.
   const mapped=has("articulos",["farmacia_codigo","origen_id","codigo_nacional","sincronizado_en"])?
    await pool.query({text:
     "SELECT DISTINCT ON (upper(btrim(a.farmacia_codigo)),a.origen_id) "+
     "upper(btrim(a.farmacia_codigo)) AS code,a.origen_id::text AS article,"+
     "btrim(a.codigo_nacional::text) AS cn "+
     "FROM "+schema+".articulos a "+
     "WHERE upper(btrim(a.farmacia_codigo))=ANY($2::text[]) "+
     "AND btrim(a.codigo_nacional::text)=ANY($1::text[]) "+
     "ORDER BY upper(btrim(a.farmacia_codigo)),a.origen_id,a.sincronizado_en DESC NULLS LAST",
     values:[cns,codes],query_timeout:8500}):{rows:[]};
   const idsToRead=[...new Set([...cns,...mapped.rows.map(x=>String(x.article))])];
   const validCN=new Set(cns),cnByArticle=new Map();
   for(const row of mapped.rows)
    if(validCN.has(String(row.cn)))
     cnByArticle.set(String(row.code)+"|"+String(row.article),String(row.cn));
   const pharmacyByCode=new Map(pharmacies.rows.map(x=>[String(x.code),Number(x.id)]));
   const {rows}=await pool.query({
    text:"SELECT v.farmacia_codigo AS code,v.articulo_id::text AS article,"+
     "v.fecha::date::text AS date,v.coste_unitario::float8 AS price,"+
     "sum(v.unidades)::float8 AS units,count(*)::int AS lines "+
     "FROM "+schema+".fm_recepciones_analitica v "+
     "WHERE v.fecha>=$1::date AND v.fecha<$2::date+interval '1 day' "+
     "AND v.farmacia_codigo=ANY($3::text[]) "+
     "AND v.articulo_id=ANY($4::text[]) "+
     "AND v.unidades>0 AND v.coste_unitario>0 "+
     "AND "+includedPurchaseSupplier({tenant:"$5",code:"v.proveedor_id",name:"v.proveedor_nombre"})+
     " GROUP BY 1,2,3,4",
    values:[policyStart(to,policy),to,codes,idsToRead,ctx.client.slug],
    query_timeout:12500
   });
   const purchases=rows.filter(x=>validCN.has(cnByArticle.get(x.code+"|"+x.article)||
    (validCN.has(x.article)?x.article:""))).map(x=>({
    pharmacyId:pharmacyByCode.get(x.code),date:x.date,price:x.price,units:x.units,lines:x.lines
   })).filter(x=>x.pharmacyId!=null);
   const result=periodReference({purchases,policy,to});
   res.json({...result,from,to,dcpf,salesAvailable:false,purchasesAvailable:true});
  }catch(e){
   // Que una consulta de PUC agote el tiempo nunca impide ver las ventas
   // por laboratorio ni preparar una propuesta: se muestra la carencia real.
   if(["57014","53300"].includes(e.code)||/timeout/i.test(e.message||"")){
    console.warn("GENERICO_REFERENCIA_LENTA",JSON.stringify({code:e.code||"TIMEOUT"}));
    return res.json({dcpf,from,to,pharmacies:[],purchasesAvailable:false,
     salesAvailable:false,warning:"Precio de referencia no disponible por límite de consulta. Las ventas y el pedido siguen operativos."});
   }
   next(e);
  }
 });
}
