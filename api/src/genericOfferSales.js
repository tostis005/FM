// Unidades netas vendidas por conjunto DCPF con tarifa, sin cálculos de PUC.
// Usa el mismo universo clínico EFG que el histórico detallado del comparador.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const DATE=/^20\d{2}-\d{2}-\d{2}$/;
const DCPF=/^\d{1,30}$/;
const validDate=d=>DATE.test(d)&&!Number.isNaN(Date.parse(d+"T00:00:00Z"))&&
 new Date(d+"T00:00:00Z").toISOString().slice(0,10)===d;
export function sumGenericOfferSales(targets,mapped,sales){
 const byCN=new Map(targets.map(row=>[String(row.cn),String(row.dcpf)]));
 const byArticle=new Map();
 for(const row of mapped){
  const dcpf=byCN.get(String(row.cn))||byCN.get(String(row.article));
  if(dcpf)byArticle.set(String(row.code)+"|"+String(row.article),dcpf);
 }
 const totals=new Map();
 for(const row of sales){
  const dcpf=byArticle.get(String(row.code)+"|"+String(row.article))||
   byCN.get(String(row.article));
  if(!dcpf)continue;
  totals.set(dcpf,(totals.get(dcpf)||0)+Number(row.units||0));
 }
 return totals;
}
export function setupGenericOfferSales(app,pool,{requireTenantModule}){
 app.post("/api/genericos/ofertas/ventas",...requireTenantModule("genericos"),
  async(req,res,next)=>{
  const ctx=req.context,from=String(req.body?.desde||""),to=String(req.body?.hasta||""),
   raw=req.body?.farmacias,provided=req.body?.dcpfs;
  const allowed=(ctx.allowedPharmacyIds||[]).map(Number);
  const ids=raw===undefined?allowed:raw;
  if(!SCHEMA.test(ctx.client.schema)||!validDate(from)||!validDate(to)||from>to||
   (Date.parse(to)-Date.parse(from))/86400000>367||
   !Array.isArray(ids)||ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||!allowed.includes(id))||
   !Array.isArray(provided)||provided.length>8000||
   provided.some(d=>typeof d!=="string"||!DCPF.test(d)))
   return res.status(400).json({error:"Período, farmacias o presentaciones no válidos"});
  const chosen=[...new Set(ids)],dcpfs=[...new Set(provided)];
  if(!dcpfs.length||!chosen.length)return res.json({salesAvailable:true,items:dcpfs.map(dcpf=>({dcpf,units:0}))});
  try{
   const schema='"'+ctx.client.schema+'"';
   const [pharmacies,targets,columns]=await Promise.all([
    pool.query({text:"SELECT "+pharmacyDataCodeSQL("f")+" AS code "+
     "FROM farmetrica.farmacias f WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[])",
     values:[ctx.client.slug,chosen],query_timeout:6000}),
    pool.query({text:"SELECT n.cn,n.dcpf::text AS dcpf "+
     "FROM farmetrica.nomenclator_presentaciones n "+
     "WHERE n.generico=true AND n.dcpf::text=ANY($1::text[])",
     values:[dcpfs],query_timeout:10000}),
    pool.query({text:"SELECT table_name,column_name FROM information_schema.columns "+
     "WHERE table_schema=$1 AND table_name=ANY($2::text[])",
     values:[ctx.client.schema,["articulos","fm_ventas_analitica"]],query_timeout:5000})
   ]);
   const codes=[...new Set(pharmacies.rows.map(x=>String(x.code)))];
   const has=(table,names)=>{
    const cols=new Set(columns.rows.filter(x=>x.table_name===table).map(x=>x.column_name));
    return names.every(name=>cols.has(name));
   };
   if(!has("fm_ventas_analitica",["farmacia_codigo","articulo_id","fecha","unidades"]))
    return res.json({salesAvailable:false,items:[],warning:"No hay ventas importadas para el período"});
   if(!codes.length||!targets.rows.length)
    return res.json({salesAvailable:true,items:dcpfs.map(dcpf=>({dcpf,units:0}))});
   const cns=[...new Set(targets.rows.map(x=>String(x.cn)))];
   const mapped=has("articulos",["farmacia_codigo","origen_id","codigo_nacional","sincronizado_en"])?
    await pool.query({text:"SELECT DISTINCT ON (upper(btrim(a.farmacia_codigo)),a.origen_id) "+
      "upper(btrim(a.farmacia_codigo)) AS code,a.origen_id::text AS article,"+
      "btrim(a.codigo_nacional::text) AS cn FROM "+schema+".articulos a "+
      "WHERE upper(btrim(a.farmacia_codigo))=ANY($2::text[]) "+
      "AND (btrim(a.codigo_nacional::text)=ANY($1::text[]) "+
      "OR a.origen_id::text=ANY($1::text[])) "+
      "ORDER BY upper(btrim(a.farmacia_codigo)),a.origen_id,a.sincronizado_en DESC NULLS LAST",
     values:[cns,codes],query_timeout:14000}):{rows:[]};
   const articleIds=[...new Set([...cns,...mapped.rows.map(x=>String(x.article))])];
   const sales=await pool.query({
    text:"SELECT upper(btrim(v.farmacia_codigo)) AS code,v.articulo_id::text AS article,"+
     "sum(v.unidades)::float8 AS units FROM "+schema+".fm_ventas_analitica v "+
     "WHERE v.fecha>=$1::date AND v.fecha<$2::date+interval '1 day' "+
     "AND upper(btrim(v.farmacia_codigo))=ANY($3::text[]) "+
     "AND v.articulo_id::text=ANY($4::text[]) GROUP BY 1,2",
    values:[from,to,codes,articleIds],query_timeout:22000
   });
   const totals=sumGenericOfferSales(targets.rows,mapped.rows,sales.rows);
   res.json({salesAvailable:true,items:dcpfs.map(dcpf=>({dcpf,units:totals.get(dcpf)||0}))});
  }catch(e){
   if(["57014","53300"].includes(e.code)||/timeout/i.test(e.message||""))
    return res.status(504).json({error:"No se pudieron calcular las unidades vendidas. Reduce la selección e inténtalo de nuevo."});
   next(e);
  }
 });
}
