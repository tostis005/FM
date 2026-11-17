// Catálogo oficial independiente de las consultas operativas: la pestaña carga
// aun cuando las métricas de venta o compra exceden el tiempo de respuesta.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {classifyAbcd} from "./abcd.js";
import {includedPurchaseSupplier} from "./supplierReporting.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const ISO=/^20\d{2}-\d{2}-\d{2}$/;
const validDate=x=>ISO.test(x)&&!Number.isNaN(Date.parse(x+"T00:00:00Z"))&&
 new Date(x+"T00:00:00Z").toISOString().slice(0,10)===x;
const rounded=(value,digits=4)=>Number(Number(value||0).toFixed(digits));
const availableColumns=async(pool,schema,table)=>{
 const {rows}=await pool.query("SELECT column_name FROM information_schema.columns "+
  "WHERE table_schema=$1 AND table_name=$2",[schema,table]);
 return new Set(rows.map(x=>x.column_name));
};
const has=(cols,fields)=>fields.every(x=>cols.has(x));

export function applyGenericSalesSummary(catalog,rows,{salesAvailable=false,purchasesAvailable=false}={}){
 const groups=new Map(catalog.map(c=>[c.dcpf,{
  ...c,salesUnits:salesAvailable?0:null,revenue:salesAvailable?0:null,
  purchaseUnits:purchasesAvailable?0:null,spent:purchasesAvailable?0:null,
  averagePuc:null,averagePvp:null,bestPuc:null,pvpMarginPct:null,indicativeSavings:null,
  abcdClass:salesAvailable?"D":null
 }]));
 for(const r of rows.sales||[]){
  const g=groups.get(r.dcpf);if(!g)continue;
  g.salesUnits+=Number(r.units||0);g.revenue+=Number(r.revenue||0);
 }
 for(const r of rows.purchases||[]){
  const g=groups.get(r.dcpf);if(!g)continue;
  g.purchaseUnits+=Number(r.units||0);
  g.spent+=Number(r.spend||0);
  if(!g._paid)g._paid={cost:0,units:0};
  g._paid.cost+=Number(r.cost||0);
  g._paid.units+=Number(r.pricedUnits||0);
 }
 const classes=classifyAbcd([...groups.values()],{
  identity:g=>g.dcpf,revenue:g=>g.revenue,units:g=>g.salesUnits
 });
 for(const g of groups.values()){
  if(g._paid?.units>0)g.averagePuc=rounded(g._paid.cost/g._paid.units);
  // Venta media neta por unidad, no el PVP oficial del Nomenclátor.
  if(g.salesUnits>0)g.averagePvp=rounded(g.revenue/g.salesUnits);
  if(g.averagePvp!=null&&g.averagePuc!=null&&g.averagePvp>0)
   g.pvpMarginPct=rounded(100*(g.averagePvp-g.averagePuc)/g.averagePvp,2);
  g.abcdClass=salesAvailable?classes.get("_all|"+g.dcpf)||"D":null;
  delete g._paid;
 }
 return [...groups.values()];
}

export function setupGenericosVentasFast(app,pool,{requireTenantModule}){
 const guard=requireTenantModule("genericos");
 app.get("/api/genericos/ventas/catalogo",...guard,async(req,res,next)=>{
  try{
   const [version,catalog]=await Promise.all([
    pool.query("SELECT sha256,fecha_fuente,importado_en,total_presentaciones,total_genericos "+
     "FROM farmetrica.nomenclator_versiones WHERE activo=true LIMIT 1"),
    pool.query({
     text:"SELECT n.dcpf AS dcpf,min(coalesce(nullif(n.principio_activo,''),n.nombre)) AS principle,"+
      "min(n.nombre) FILTER(WHERE n.generico) AS name,"+
      "max(nullif(n.descripcion_dcpf,'')) AS \"officialDescription\","+
      "count(*)::int AS \"skuCount\",count(*) FILTER(WHERE n.generico)::int AS \"genericCount\" "+
      "FROM farmetrica.nomenclator_presentaciones n "+
      "GROUP BY n.dcpf HAVING bool_or(n.generico) "+
      "ORDER BY min(coalesce(n.principio_activo,n.nombre)),n.dcpf LIMIT 12000",
     query_timeout:12000
    })
   ]);
   res.json({version:version.rows[0]||null,items:catalog.rows,total:catalog.rows.length});
  }catch(e){next(e)}
 });
 app.get("/api/genericos/ventas/metricas",...guard,async(req,res,next)=>{
  const from=String(req.query.desde||""),to=String(req.query.hasta||""),
   raw=String(req.query.farmacias||""),ctx=req.context;
  if(!validDate(from)||!validDate(to)||from>to||
   (Date.parse(to)-Date.parse(from))/86400000>367||raw.length>2000||
   !SCHEMA.test(ctx.client.schema))
   return res.status(400).json({error:"Período o filtros inválidos"});
  const allowed=(ctx.allowedPharmacyIds||[]).map(Number);
  const ids=raw?raw.split(",").map(Number):allowed;
  if(ids.some(x=>!Number.isSafeInteger(x)||!allowed.includes(x)))
   return res.status(403).json({error:"Farmacias no autorizadas"});
  if(ids.length===0)return res.json({sales:[],purchases:[],
   salesAvailable:true,purchasesAvailable:true});
  try{
   const schema='"'+ctx.client.schema+'"';
   const [art,sales,purchases]=await Promise.all([
    availableColumns(pool,ctx.client.schema,"articulos"),
    availableColumns(pool,ctx.client.schema,"fm_ventas_analitica"),
    availableColumns(pool,ctx.client.schema,"fm_recepciones_analitica")
   ]);
   const haveArt=has(art,["farmacia_codigo","origen_id","codigo_nacional","sincronizado_en"]),
    haveSales=has(sales,["farmacia_codigo","articulo_id","fecha","unidades","importe"]),
    havePurchases=has(purchases,["farmacia_codigo","articulo_id","fecha","unidades","coste_unitario","importe","proveedor_id","proveedor_nombre"]);
   const mapping=haveArt?"LEFT JOIN LATERAL("+
      "SELECT nullif(btrim(a.codigo_nacional),'') AS cn "+
      "FROM "+schema+".articulos a "+
      "WHERE upper(btrim(a.farmacia_codigo))=b.code "+
      "AND a.origen_id=b.article "+
      "ORDER BY a.sincronizado_en DESC NULLS LAST LIMIT 1"+
      ") a ON true":"";
   const identity=haveArt?"coalesce(a.cn,btrim(b.article))":"btrim(b.article)";
   const aggregate=table=>{
    const result=table==="fm_ventas_analitica"?
     "sum(b.units)::float8 AS units,sum(b.amount)::float8 AS revenue":
     "sum(b.units)::float8 AS units,sum(b.amount)::float8 AS spend,"+
     "sum(b.paid_cost)::float8 AS cost,sum(b.paid_units)::float8 AS \"pricedUnits\"";
    const buy=table==="fm_recepciones_analitica";
    const cost=buy?",sum(v.unidades*v.coste_unitario) FILTER(WHERE v.unidades>0 AND v.coste_unitario>0)::float8 AS paid_cost,"+
     "sum(v.unidades) FILTER(WHERE v.unidades>0 AND v.coste_unitario>0)::float8 AS paid_units":"";
    const supplier=buy?" AND "+includedPurchaseSupplier({
     tenant:"$4",code:"v.proveedor_id",name:"v.proveedor_nombre"}):"";
    return "WITH b AS MATERIALIZED("+
     "SELECT upper(btrim(v.farmacia_codigo)) AS code,v.articulo_id AS article,"+
     "sum(v.unidades)::float8 AS units,sum(v.importe)::float8 AS amount"+cost+
     " FROM "+schema+"."+table+" v "+
     "JOIN farmetrica.farmacias f ON f.cliente_slug=$4 "+
     "AND upper(btrim(v.farmacia_codigo))="+pharmacyDataCodeSQL("f")+
     " WHERE f.id=ANY($3::int[]) AND v.fecha>=$1::date "+
     "AND v.fecha<$2::date+interval '1 day'"+supplier+
     " GROUP BY 1,2) "+
     "SELECT n.dcpf,"+result+" FROM b "+mapping+
     " JOIN farmetrica.nomenclator_presentaciones n ON n.cn="+identity+
     " GROUP BY n.dcpf";
   };
   const args=[from,to,[...new Set(ids)],ctx.client.slug];
   const promises=[
    haveSales?pool.query({text:aggregate("fm_ventas_analitica"),
      values:args,query_timeout:22000}):Promise.resolve({rows:[]}),
    havePurchases?pool.query({text:aggregate("fm_recepciones_analitica"),
      values:args,query_timeout:22000}):Promise.resolve({rows:[]})
   ];
   const [sr,pr]=await Promise.allSettled(promises);
   res.json({
    sales:sr.status==="fulfilled"?sr.value.rows:[],
    purchases:pr.status==="fulfilled"?pr.value.rows:[],
    salesAvailable:haveSales&&sr.status==="fulfilled",
    purchasesAvailable:havePurchases&&pr.status==="fulfilled",
    salesError:sr.status==="rejected"?"No se han podido recuperar las ventas. Reintenta con menos farmacias o un período más corto.":null,
    purchasesError:pr.status==="rejected"?"Las compras todavía no están disponibles para este período.":null
   });
  }catch(e){next(e)}
 });
}
