// Una sola lectura de ventas para horarios, vendedores y tickets completos.
// Primero agregar líneas por documento; después reutilizar cada ticket para
// tres visuales con GROUPING SETS. Importes siempre numéricos hasta el final.
import {validSalesDateRange} from "./salesAnalysisPeriod.js";
import {nameCommercialRows} from "./commercialNames.js";
import {summarizeSalesTickets} from "./salesOverview.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const numeric=value=>Number.isFinite(Number(value))?Number(value):0;
export function buildSalesActivitySQL(schema){
 if(!SCHEMA.test(schema))throw Error("Esquema de ventas inválido");
 const q='"'+schema+'"';
 return [
  "WITH documents AS MATERIALIZED (",
  " SELECT v.farmacia_codigo AS code,",
  " v.sistema_origen AS sale_source,v.documento_id AS sale_document_id,",
  " min(v.vendedor_id::text) AS seller_id,",
  " extract(isodow FROM min(v.fecha))::int AS weekday,",
  " extract(hour FROM min(v.fecha))::int AS hour,",
  " sum(v.importe) AS amount,sum(v.unidades) AS units,",
  " sum(CASE WHEN nullif(btrim(v.articulo_id),'') IS NOT NULL",
  " THEN v.unidades ELSE 0 END) AS product_units,",
  " count(*)::bigint AS lines",
  " FROM "+q+".fm_ventas_analitica v",
  " WHERE v.farmacia_codigo=ANY($3::text[])",
  " AND v.fecha >= $1::date AND v.fecha < $2::date+interval '1 day'",
  " GROUP BY 1,2,3",
  ") SELECT CASE WHEN GROUPING(weekday)=0 THEN 'horario'",
  " WHEN GROUPING(seller_id)=0 THEN 'vendedor' ELSE 'farmacia' END AS kind,",
  " code,seller_id AS \"sellerId\",weekday,hour,",
  " sum(amount)::float8 AS sales,sum(units)::float8 AS units,",
  " sum(product_units)::float8 AS \"productUnits\",sum(lines)::bigint AS lines,",
  " CASE WHEN GROUPING(weekday)=1 AND GROUPING(seller_id)=1",
  " THEN count(*)::bigint ELSE NULL::bigint END AS tickets",
  " FROM documents",
  " GROUP BY GROUPING SETS ((code),(code,seller_id),(weekday,hour))",
  " ORDER BY kind,code,weekday,hour"
 ].join("\n");
}
export function summarizeSalesActivityRows(rows,pharmacies,ids,namedSellers=[]){
 const chosen=(pharmacies||[]).filter(p=>ids.includes(Number(p.id)));
 const labels=new Map(chosen.map(p=>[String(p.id),p.name]));
 const sellers=new Map(),cells=[],ticketRows=[];
 for(const row of rows||[]){
  if(row.kind==="horario"){
   cells.push({weekday:numeric(row.weekday),hour:numeric(row.hour),
    sales:numeric(row.sales),lines:numeric(row.lines)});
  }else if(row.kind==="farmacia"){
   ticketRows.push({code:row.code,tickets:row.tickets,sales:row.sales,units:row.productUnits});
  }
 }
 for(const row of namedSellers){
  const pharmacyId=String(row.pharmacyId),sellerId=row.sellerId;
  const key=pharmacyId+"|"+String(sellerId||"");
  const label=sellerId==null||!String(sellerId).trim()?
   "Sin vendedor":row.sellerName||String(sellerId);
  const name=ids.length>1?label+" · "+(labels.get(pharmacyId)||"Farmacia "+pharmacyId):label;
  const previous=sellers.get(key)||{name,pharmacyId,sellerId,sales:0,units:0};
  previous.sales+=numeric(row.sales);previous.units+=numeric(row.units);
  sellers.set(key,previous);
 }
 const sellerRows=[...sellers.values()].sort((a,b)=>b.sales-a.sales);
 return {
  tickets:summarizeSalesTickets(ticketRows,chosen,ids),
  horarios:{cells,total:cells.reduce((n,r)=>n+r.sales,0)},
  vendedores:{sellers:sellerRows,total:sellerRows.reduce((n,r)=>n+r.sales,0)}
 };
}
export function setupSalesActivity(app,pool,{requireTenant}){
 app.get("/api/analytics/ventas/actividad",...requireTenant(),async(req,res,next)=>{
  try{
   const ctx=req.context||{};
   if(ctx.role!=="superadministrador"&&!ctx.modules?.ventas&&!ctx.modules?.dashboard)
    return res.status(403).json({error:"Módulo de ventas no habilitado"});
   const from=String(req.query.desde||""),to=String(req.query.hasta||"");
   const raw=String(req.query.farmacias||"");
   if(!validSalesDateRange(from,to)||raw.length>2000||
    (raw&&raw.split(",").some(id=>!/^[1-9]\d{0,8}$/.test(id))))
    return res.status(400).json({error:"Período o farmacias no válidos"});
   const allowed=(ctx.allowedPharmacyIds||[]).map(Number);
   const requested=raw?raw.split(",").map(Number):allowed;
   if(requested.some(id=>!allowed.includes(id)))
    return res.status(403).json({error:"Farmacia no autorizada"});
   const ids=[...new Set(requested)];
   const chosen=(ctx.pharmacies||[]).filter(p=>ids.includes(Number(p.id)));
   const byId=new Map(chosen.map(p=>[
    Number(p.id),String(p.databaseCode||p.sourceCode||"").trim().toUpperCase()
   ]));
   if(ids.some(id=>!byId.get(id)))
    return res.status(503).json({error:"Falta correspondencia ERP de una farmacia"});
   if(!ids.length)return res.json(summarizeSalesActivityRows([],[],[],[]));
   const codes=[...new Set(ids.map(id=>byId.get(id)))];
   const {rows}=await pool.query({text:buildSalesActivitySQL(ctx.client.schema),
    values:[from,to,codes],query_timeout:35000});
   const idByCode=new Map(chosen.map(p=>[
    String(p.databaseCode||p.sourceCode||"").trim().toUpperCase(),String(p.id)
   ]));
   const sellers=(rows||[]).filter(r=>r.kind==="vendedor").map(r=>({
    pharmacyId:idByCode.get(String(r.code||"").trim().toUpperCase()),
    sellerId:r.sellerId,sales:numeric(r.sales),units:numeric(r.units)
   })).filter(r=>r.pharmacyId);
   const named=await nameCommercialRows(pool,ctx,sellers);
   res.json(summarizeSalesActivityRows(rows,chosen,ids,named));
  }catch(error){next(error)}
 });
}
