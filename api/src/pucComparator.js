// Comparador paginado y filtrado en PostgreSQL: solo artículos comprados en ambos canales.
import {getFilters} from "./realReports.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {includedPurchaseSupplier,purchaseSupplierChannelSQL} from "./supplierReporting.js";
import {nameArticleRows} from "./articleNames.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const PAGE_SIZES=new Set([10,25,50,100]);
const ORDERS={
 article:'article',pharmacy:'pharmacy_id',
 coopPuc:'"coopPuc"',labPuc:'"labPuc"',
 difference:'"difference"',differencePct:'"differencePct"',
 cheaper:'"cheaper"',potentialSaving:'"potentialSaving"'
};
const FIELDS=new Set(Object.keys(ORDERS));
function readOptions(req,res){
 const f=getFilters({...req,query:{...req.query,modulo:"dashboard",
  orden:undefined,direccion:undefined}},res);
 if(!f)return null;
 const page=Number(req.query.pagina||1),size=Number(req.query.tamano||25);
 const sort=String(req.query.orden||"potentialSaving");
 const direction=String(req.query.direccion||"desc").toLowerCase();
 if(!SCHEMA.test(req.context.client.schema)||f.search||f.families.length||
  !Number.isSafeInteger(page)||page<1||page>100000||
  !PAGE_SIZES.has(size)||!Object.hasOwn(ORDERS,sort)||
  !["asc","desc"].includes(direction))
  return res.status(400).json({error:"Opciones del comparador inválidas"}),null;
 let filters={};
 try{filters=req.query.columnas?JSON.parse(String(req.query.columnas)):{}}
 catch{return res.status(400).json({error:"Filtros inválidos"}),null}
 if(!filters||typeof filters!=="object"||Array.isArray(filters)||
  String(req.query.columnas||"").length>3000||
  Object.entries(filters).some(([key,value])=>!FIELDS.has(key)||
   (key==="pharmacy"||key==="cheaper"?
    !Array.isArray(value)||value.length>50||value.some(v=>typeof v!=="string"||v.length>100):
    typeof value!=="string"||value.length>100)))
  return res.status(400).json({error:"Filtros de columna inválidos"}),null;
 return {f,page,size,sort,direction,filters};
}
export function setupPucComparator(app,pool,{requireTenant}){
 app.get("/api/analytics/dashboard/comparador-puc",...requireTenant(),async(req,res,next)=>{
  if(req.context.role!=="superadministrador"&&!req.context.modules.dashboard)
   return res.status(403).json({error:"Inicio no habilitado"});
  const options=readOptions(req,res);if(!options)return;
  const {f,page,size,sort,direction,filters}=options;
  const empty={available:true,rows:[],total:0,page,pageSize:size};
  if(!f.ids.length)return res.json(empty);
  try{
   const schema=req.context.client.schema,q='"'+schema+'"';
   const {rows:metadata}=await pool.query(
    "SELECT table_name,column_name FROM information_schema.columns"+
    " WHERE table_schema=$1 AND table_name IN ('fm_recepciones_analitica','articulos')",[schema]);
   const has=(table,...cols)=>cols.every(key=>metadata.some(r=>r.table_name===table&&r.column_name===key));
   const normalized=has("fm_recepciones_analitica","farmacia_codigo","fecha","articulo_id","proveedor_id","unidades","coste_unitario");
   const legacy=!normalized&&has("fm_recepciones_analitica","farmacia_id","fecha","producto_id","proveedor_id","unidades","puc");
   if(!normalized&&!legacy)return res.json({...empty,available:false,
    reason:"No hay líneas de compra con artículo y PUC disponibles"});
   const article=legacy?"t.producto_id":"t.articulo_id",cost=legacy?"t.puc":"t.coste_unitario";
   const join=legacy?" JOIN farmetrica.farmacias f ON f.id=t.farmacia_id AND f.cliente_slug=$4":
    " JOIN farmetrica.farmacias f ON f.cliente_slug=$4"+
    " AND upper(btrim(t.farmacia_codigo))="+pharmacyDataCodeSQL("f");
   const ignored=includedPurchaseSupplier({tenant:"$4",code:"t.proveedor_id",
    name:has("fm_recepciones_analitica","proveedor_nombre")?"t.proveedor_nombre":null});
   const values=[f.from,f.to,f.ids,req.context.client.slug];
   const arg=value=>{values.push(value);return "$"+values.length};
   const where=[];
   if(filters.article?.trim()){
    const p=arg("%"+filters.article.trim()+"%");
    let condition="(article ILIKE "+p;
    if(has("articulos","farmacia_codigo","origen_id","nombre","codigo_nacional"))
     condition+=" OR EXISTS (SELECT 1 FROM "+q+".articulos a"+
      " JOIN farmetrica.farmacias f2 ON f2.id=calculated.pharmacy_id::int"+
      " AND f2.cliente_slug=$4"+
      " WHERE upper(btrim(a.farmacia_codigo))="+pharmacyDataCodeSQL("f2")+
      " AND upper(btrim(a.origen_id))=upper(btrim(calculated.article))"+
      " AND (a.nombre ILIKE "+p+" OR a.codigo_nacional ILIKE "+p+"))";
    where.push(condition+")");
   }
   if(filters.pharmacy?.length){
    const allowed=req.context.pharmacies.filter(p=>f.ids.includes(Number(p.id))&&filters.pharmacy.includes(p.name));
    if(!allowed.length)return res.json(empty);
    where.push("pharmacy_id=ANY("+arg(allowed.map(p=>String(p.id)))+"::text[])");
   }
   if(filters.cheaper?.length)
    where.push('"cheaper"=ANY('+arg(filters.cheaper.filter(v=>["Laboratorio","Cooperativa","Igual"].includes(v)))+"::text[])");
   for(const key of ["coopPuc","labPuc","difference","differencePct","potentialSaving"]){
    if(filters[key]?.trim())
     where.push("round("+ORDERS[key]+"::numeric,3)::text ILIKE "+arg("%"+filters[key].trim()+"%"));
   }
   const limit=arg(size),offset=arg((page-1)*size);
   const sql="WITH classified AS ("+
    " SELECT f.id::text AS pharmacy_id,btrim("+article+"::text) AS article,"+
    " t.unidades::numeric AS units,"+cost+"::numeric AS puc,"+
    " "+purchaseSupplierChannelSQL("pm")+" AS channel"+
    " FROM "+q+".fm_recepciones_analitica t"+join+
    " LEFT JOIN farmetrica.proveedores_maestro pm"+
    " ON pm.cliente_slug=$4 AND upper(btrim(pm.codigo_origen))=upper(btrim(t.proveedor_id::text))"+
    " WHERE t.fecha >= $1::date AND t.fecha < $2::date+interval '1 day'"+
    " AND f.id=ANY($3::int[]) AND t.unidades>0 AND "+cost+">0"+
    " AND nullif(btrim("+article+"::text),'') IS NOT NULL"+
    " AND "+ignored+"),"+
    " grouped AS (SELECT pharmacy_id,article,channel,"+
    " sum(units*puc)/nullif(sum(units),0) AS puc,sum(units) AS units"+
    " FROM classified GROUP BY pharmacy_id,article,channel),"+
    " paired AS (SELECT pharmacy_id,article,"+
    " max(puc) FILTER(WHERE channel='cooperativa') AS coop_puc,"+
    " max(puc) FILTER(WHERE channel='laboratorio') AS lab_puc,"+
    " max(units) FILTER(WHERE channel='cooperativa') AS coop_units,"+
    " max(units) FILTER(WHERE channel='laboratorio') AS lab_units"+
    " FROM grouped GROUP BY pharmacy_id,article HAVING count(DISTINCT channel)=2),"+
    " calculated AS (SELECT pharmacy_id,article,"+
    " coop_puc::float8 AS \"coopPuc\",lab_puc::float8 AS \"labPuc\","+
    " (coop_puc-lab_puc)::float8 AS \"difference\","+
    " CASE WHEN greatest(coop_puc,lab_puc)>0 THEN (100*abs(coop_puc-lab_puc)/greatest(coop_puc,lab_puc))::float8 END AS \"differencePct\","+
    " CASE WHEN coop_puc>lab_puc THEN 'Laboratorio' WHEN coop_puc<lab_puc THEN 'Cooperativa' ELSE 'Igual' END AS \"cheaper\","+
    " (abs(coop_puc-lab_puc)*CASE WHEN coop_puc>lab_puc THEN coop_units ELSE lab_units END)::float8 AS \"potentialSaving\""+
    " FROM paired),"+
    " filtered AS (SELECT * FROM calculated"+(where.length?" WHERE "+where.join(" AND "):"")+"),"+
    " totals AS (SELECT count(*)::int AS total FROM filtered),"+
    " page AS (SELECT * FROM filtered ORDER BY "+ORDERS[sort]+" "+direction.toUpperCase()+
    " NULLS LAST,pharmacy_id,article LIMIT "+limit+"::int OFFSET "+offset+"::int)"+
    " SELECT totals.total,page.pharmacy_id AS \"pharmacyId\",page.article AS \"articleId\","+
    " page.\"coopPuc\",page.\"labPuc\",page.\"difference\",page.\"differencePct\","+
    " page.\"cheaper\",page.\"potentialSaving\" FROM totals LEFT JOIN page ON true";
   const {rows}=await pool.query({text:sql,values,query_timeout:30000});
   const total=Number(rows[0]?.total||0);
   const valid=rows.filter(row=>row.articleId!=null);
   const named=await nameArticleRows(pool,req.context,valid);
   res.json({available:true,total,page,pageSize:size,rows:named});
  }catch(e){next(e)}
 });
}
