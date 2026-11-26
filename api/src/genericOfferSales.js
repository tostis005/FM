// Unidades netas vendidas por conjunto DCPF con tarifa, sin cálculos de PUC.
// Usa el mismo universo clínico EFG que el histórico detallado del comparador.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {planGenericSalesSources} from "./genericOfferSalesSources.js";

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
// Desglose por CN y farmacia del mismo universo de ventas que la tabla
// principal. Una unidad se asigna exactamente a un CN aunque existan
// múltiples líneas de oferta comercial para ese medicamento.
export function breakdownGenericOfferSales(targets,mapped,sales,pharmacies=[]){
 const cnToDcpf=new Map(targets.map(row=>[String(row.cn),String(row.dcpf)]));
 const codeToPharmacy=new Map(pharmacies.map(p=>[String(p.code),String(p.id)]));
 const cnByArticle=new Map();
 for(const row of mapped){
  const cn=String(row.cn);
  if(cnToDcpf.has(cn))cnByArticle.set(String(row.code)+"|"+String(row.article),cn);
 }
 const summary=new Map();
 for(const s of sales){
  const cn=cnByArticle.get(String(s.code)+"|"+String(s.article))||
   (cnToDcpf.has(String(s.article))?String(s.article):null);
  const group=cnToDcpf.get(cn);
  const pharmacyId=codeToPharmacy.get(String(s.code));
  if(!group||!pharmacyId)continue;
  if(!summary.has(group))summary.set(group,{units:0,revenue:0,cns:new Map(),pharmacies:new Map(),pharmacyRevenues:new Map()});
  const item=summary.get(group),units=Number(s.units||0),revenue=Number(s.revenue||0);
  item.units+=units;item.revenue+=revenue;
  item.cns.set(cn,(item.cns.get(cn)||0)+units);
  item.pharmacies.set(pharmacyId,(item.pharmacies.get(pharmacyId)||0)+units);
  item.pharmacyRevenues.set(pharmacyId,(item.pharmacyRevenues.get(pharmacyId)||0)+revenue);
 }
 return summary;
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
  const chosen=[...new Set(ids)],dcpfs=[...new Set(provided)],detail=req.body?.detail===true;
  if(!dcpfs.length||!chosen.length)return res.json({salesAvailable:true,items:dcpfs.map(dcpf=>({dcpf,units:0}))});
  try{
   const schema='"'+ctx.client.schema+'"';
   const [pharmacies,targets,columns]=await Promise.all([
    pool.query({text:"SELECT f.id::int AS id,"+pharmacyDataCodeSQL("f")+" AS code "+
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
   const codeById=new Map(pharmacies.rows.map(x=>[Number(x.id),String(x.code)]));
   const has=(table,names)=>{
    const cols=new Set(columns.rows.filter(x=>x.table_name===table).map(x=>x.column_name));
    return names.every(name=>cols.has(name));
   };
   if(!has("fm_ventas_analitica",["farmacia_codigo","articulo_id","fecha","unidades","importe"]))
    return res.json({salesAvailable:false,items:[],warning:"No hay ventas importadas para el período"});
   if(!codes.length||!targets.rows.length)
    return res.json({salesAvailable:true,items:dcpfs.map(dcpf=>({dcpf,units:0}))});
   const cns=[...new Set(targets.rows.map(x=>String(x.cn)))];
   // El índice de artículos por CN/farmacia no puede utilizarse de forma
   // eficiente con el OR anterior sobre origen_id. Los IDs que son un CN
   // se siguen resolviendo directamente en sumGenericOfferSales.
   const mapped=has("articulos",["farmacia_codigo","origen_id","codigo_nacional","sincronizado_en"])?
    await pool.query({text:"SELECT DISTINCT ON (upper(btrim(a.farmacia_codigo)),a.origen_id) "+
      "upper(btrim(a.farmacia_codigo)) AS code,a.origen_id::text AS article,"+
      "btrim(a.codigo_nacional::text) AS cn FROM "+schema+".articulos a "+
      "WHERE upper(btrim(a.farmacia_codigo))=ANY($2::text[]) "+
      "AND btrim(a.codigo_nacional::text)=ANY($1::text[]) "+
      "ORDER BY upper(btrim(a.farmacia_codigo)),a.origen_id,a.sincronizado_en DESC NULLS LAST",
     values:[cns,codes],query_timeout:11000}):{rows:[]};
   const articleIds=[...new Set([...cns,...mapped.rows.map(x=>String(x.article))])];
   // Aprovechar cierres mensuales de Ventas: 12 meses dejan de exigir
   // recorrer todo el histórico cuando ya existe un cierre por farmacia.
   const {rows:[clock]}=await pool.query({
    text:"SELECT to_char(clock_timestamp() AT TIME ZONE 'Europe/Madrid','YYYY-MM-DD') AS today",
    query_timeout:2500
   });
   const {rows:closures}=await pool.query({text:
    "SELECT farmacia_id,mes::text AS mes FROM farmetrica.ventas_panorama_meses_cerrados "+
    "WHERE cliente_slug=$1 AND farmacia_id=ANY($2::int[]) "+
    "AND mes>=$3::date AND mes<=$4::date",
    values:[ctx.client.slug,chosen,from,to],query_timeout:6000
   });
   const plan=planGenericSalesSources(from,to,clock.today,pharmacies.rows,closures);
   const allSales=[];
   if(plan.cached.length){
    const months=[...new Set(plan.cached.map(row=>row.month))];
    const {rows:cached}=await pool.query({
     text:"SELECT farmacia_id,mes::text AS mes,clave AS article,"+
      "sum(unidades)::float8 AS units,sum(importe)::float8 AS revenue "+
      "FROM farmetrica.ventas_panorama_mensual "+
      "WHERE cliente_slug=$1 AND farmacia_id=ANY($2::int[]) "+
      "AND mes=ANY($3::date[]) AND dimension='articulo' "+
      "AND clave=ANY($4::text[]) GROUP BY farmacia_id,mes,clave",
     values:[ctx.client.slug,chosen,months,articleIds],query_timeout:9500
    });
    const cachedKeys=new Set(plan.cached.map(row=>String(row.id)+"|"+row.month));
    for(const row of cached){
     if(!cachedKeys.has(String(row.farmacia_id)+"|"+row.mes))continue;
     const code=codeById.get(Number(row.farmacia_id));
     if(code)allSales.push({code,article:row.article,units:row.units,revenue:row.revenue});
    }
   }
   // Un tramo largo sin cierre puede superar el límite de PostgreSQL.
   // Reintentar únicamente el tramo fallido, por farmacia y mes, sin
   // repetir los cierres ya leídos ni convertir fallos en ceros.
   const isTimeout=e=>["57014","53300","55P03"].includes(e.code)||/timeout/i.test(e.message||"");
   const readRaw=async segment=>{
    const {rows:raw}=await pool.query({
     text:"SELECT v.farmacia_codigo AS code,v.articulo_id::text AS article,"+
      "sum(v.unidades)::float8 AS units,sum(v.importe)::float8 AS revenue FROM "+schema+".fm_ventas_analitica v "+
      "WHERE v.fecha>=$1::date AND v.fecha<$2::date+interval '1 day' "+
      "AND v.farmacia_codigo=ANY($3::text[]) "+
      "AND v.articulo_id=ANY($4::text[]) GROUP BY 1,2",
     values:[segment.from,segment.to,segment.codes,articleIds],query_timeout:16000
    });
    return raw;
   };
   for(const segment of plan.raw){
    try{allSales.push(...await readRaw(segment))}
    catch(e){
     if(!isTimeout(e))throw e;
     for(const code of segment.codes){
      let start=segment.from;
      while(start<=segment.to){
       const next=new Date(start.slice(0,7)+"-01T00:00:00Z");next.setUTCMonth(next.getUTCMonth()+1);
       const end=new Date(next.getTime()-86400000).toISOString().slice(0,10);
       allSales.push(...await readRaw({from:start,to:end<segment.to?end:segment.to,codes:[code]}));
       start=next.toISOString().slice(0,10);
      }
     }
    }
   }
   const totals=sumGenericOfferSales(targets.rows,mapped.rows,allSales);
   const breakdown=detail?breakdownGenericOfferSales(targets.rows,mapped.rows,
    allSales,pharmacies.rows):null;
   res.json({salesAvailable:true,items:dcpfs.map(dcpf=>{
    const base={dcpf,units:totals.get(dcpf)||0};
    if(!detail)return base;
    const group=breakdown.get(dcpf);
    return {...base,revenue:group?.revenue||0,
     cns:[...(group?.cns||new Map())].map(([cn,units])=>({cn,units})),
     pharmacies:[...(group?.pharmacies||new Map())].map(([pharmacyId,units])=>
      ({pharmacyId,units,revenue:group.pharmacyRevenues.get(pharmacyId)||0}))};
   })});
  }catch(e){
   console.warn("FM_GENERIC_SALES_ERROR",e.code||e.name,/timeout|canceling statement/i.test(e.message||"")?"timeout":"query-error","DCPF",dcpfs.length,"farmacias",chosen.length);
   if(["57014","53300","55P03"].includes(e.code)||/timeout/i.test(e.message||""))
    return res.status(504).json({error:"No se pudieron calcular las unidades vendidas. Reduce la selección e inténtalo de nuevo."});
   next(e);
  }
 });
}
