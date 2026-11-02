// Desglose ligero de un DCPF: CN y movimientos reales, sin percentiles ni políticas.
import {includedPurchaseSupplier} from "./supplierReporting.js";
const VALID=/^[a-z][a-z0-9_]{1,62}$/;
const trim=x=>String(x??"").trim();
const upper=x=>trim(x).toUpperCase();
const n=x=>Number(x)||0;
const timeout=10000;
export async function loadGenericArticleDetail(pool,req,res,f,{legacy=false}={}){
 const dcpf=trim(req.params.dcpf),schema=req.context.client.schema;
 if(!/^\d{1,30}$/.test(dcpf))return res.status(400).json({error:"Conjunto inválido"});
 if(!VALID.test(schema))return res.status(400).json({error:"Esquema no válido"});
 const t='"'+schema+'"';
 const selected=new Set(f.ids.map(Number));
 const codes=[...new Set((req.context.pharmacies||[]).filter(p=>selected.has(Number(p.id)))
  .map(p=>upper(p.databaseCode||p.sourceCode)).filter(Boolean))];
 const {rows:products}=await pool.query({
  text:"SELECT cn,nombre,laboratorio,laboratorio_codigo,generico FROM farmetrica.nomenclator_presentaciones WHERE dcpf=$1 ORDER BY generico DESC,nombre,cn",
  values:[dcpf],query_timeout:timeout
 });
 if(!products.some(p=>p.generico))return res.status(404).json({error:"Conjunto genérico desconocido"});
 const data=new Map(products.map(p=>[trim(p.cn),{
  cn:trim(p.cn),nombre:p.nombre,laboratorio:p.laboratorio||p.laboratorio_codigo||null,
  soldUnits:0,soldAmount:0,buyUnits:0,buyAmount:null,puc:null
 }]));
 if(!codes.length)return res.json({products:[...data.values()],salesAvailable:false,
  purchasesAvailable:false,view:"articles"});
 const {rows:columns}=await pool.query({
  text:"SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=ANY($2::text[])",
  values:[schema,["articulos","productos","fm_ventas_analitica","fm_recepciones_analitica"]],
  query_timeout:timeout
 });
 const cols=new Map();
 for(const r of columns){
  if(!cols.has(r.table_name))cols.set(r.table_name,new Set());
  cols.get(r.table_name).add(r.column_name);
 }
 const has=(table,...names)=>names.every(x=>cols.get(table)?.has(x));
 const salesAvailable=has("fm_ventas_analitica","farmacia_codigo","articulo_id","fecha","unidades","importe");
 const purchasesAvailable=has("fm_recepciones_analitica","farmacia_codigo","articulo_id","fecha","unidades","coste_unitario");
 const mappingAvailable=legacy?has("productos","id","cn"):
  has("articulos","farmacia_codigo","origen_id","codigo_nacional","sincronizado_en");
 const nationalCodes=products.map(p=>trim(p.cn)).filter(Boolean);
 let mappings=[];
 if(mappingAvailable){
  const sql=legacy?
   "SELECT id::text AS origen_id,cn::text AS cn FROM "+t+".productos WHERE cn::text=ANY($1::text[])":
   "SELECT DISTINCT ON (upper(btrim(a.farmacia_codigo)),a.origen_id) upper(btrim(a.farmacia_codigo)) AS code,a.origen_id,n.cn "+
   "FROM "+t+".articulos a JOIN farmetrica.nomenclator_presentaciones n "+
   "ON n.cn=coalesce(nullif(btrim(a.codigo_nacional),''),CASE WHEN a.origen_id ~ '^[0-9]{6,7}$' THEN a.origen_id END) "+
   "WHERE n.dcpf=$1 AND upper(btrim(a.farmacia_codigo))=ANY($2::text[]) "+
   "ORDER BY upper(btrim(a.farmacia_codigo)),a.origen_id,a.sincronizado_en DESC NULLS LAST";
  ({rows:mappings}=await pool.query({text:sql,
   values:legacy?[nationalCodes]:[dcpf,codes],query_timeout:timeout}));
 }
 const mapped=new Map(),ids=new Set(nationalCodes);
 for(const row of mappings){
  if(!data.has(trim(row.cn)))continue;
  mapped.set((legacy?"*":upper(row.code))+"|"+trim(row.origen_id),trim(row.cn));
  ids.add(trim(row.origen_id));
 }
 const findCN=(code,id)=>mapped.get(upper(code)+"|"+trim(id))||
  mapped.get("*|"+trim(id))||(data.has(trim(id))?trim(id):null);
 const params=[f.from,f.to,codes,[...ids]];
 const where="upper(btrim(v.farmacia_codigo))=ANY($3::text[]) "+
  "AND v.articulo_id=ANY($4::text[]) "+
  "AND v.fecha >= $1::date AND v.fecha < $2::date+interval '1 day'";
 const jobs=[
  salesAvailable?pool.query({text:
   "SELECT upper(btrim(v.farmacia_codigo)) AS code,v.articulo_id,"+
   "sum(v.unidades)::float8 AS units,sum(v.importe)::float8 AS revenue "+
   "FROM "+t+".fm_ventas_analitica v WHERE "+where+" GROUP BY 1,2",
   values:params,query_timeout:timeout}):Promise.resolve({rows:[]}),
  purchasesAvailable?pool.query({text:
   "SELECT upper(btrim(v.farmacia_codigo)) AS code,v.articulo_id,"+
   "sum(v.unidades) FILTER(WHERE v.unidades>0)::float8 AS units,"+
   "sum(v.importe)::float8 AS spend,count(*)::int AS rows_count,"+
   "count(v.importe)::int AS amount_rows,"+
   "sum(v.unidades*v.coste_unitario) FILTER(WHERE v.unidades>0 AND v.coste_unitario>0)::float8 AS cost,"+
   "sum(v.unidades) FILTER(WHERE v.unidades>0 AND v.coste_unitario>0)::float8 AS priced_units "+
   "FROM "+t+".fm_recepciones_analitica v WHERE "+where+" AND "+
   includedPurchaseSupplier({tenant:"$5",code:"v.proveedor_id",
    name:cols.get("fm_recepciones_analitica")?.has("proveedor_nombre")?"v.proveedor_nombre":null})+
   " GROUP BY 1,2",values:[...params,req.context.client.slug],
   query_timeout:timeout}):Promise.resolve({rows:[]})
 ];
 const [sales,purchases]=await Promise.all(jobs);
 for(const r of sales.rows){
  const cn=findCN(r.code,r.articulo_id);
  if(cn){const row=data.get(cn);row.soldUnits+=n(r.units);row.soldAmount+=n(r.revenue)}
 }
 const amounts=new Map();
 for(const r of purchases.rows){
  const cn=findCN(r.code,r.articulo_id);if(!cn)continue;
  const a=amounts.get(cn)||{units:0,amount:0,cost:0,pricedUnits:0,rows:0,amountRows:0};
  a.units+=n(r.units);a.amount+=n(r.spend);a.cost+=n(r.cost);
  a.pricedUnits+=n(r.priced_units);a.rows+=n(r.rows_count);a.amountRows+=n(r.amount_rows);
  amounts.set(cn,a);
 }
 for(const [cn,a] of amounts){
  const row=data.get(cn);row.buyUnits=a.units;
  row.buyAmount=a.rows===a.amountRows?a.amount:null;
  row.puc=a.pricedUnits>0?a.cost/a.pricedUnits:null;
 }
 return res.json({products:[...data.values()],salesAvailable,purchasesAvailable,view:"articles"});
}
