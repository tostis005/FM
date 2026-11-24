import {normalizeLabName,normalizedLabSQL as norm} from "./laboratoryIdentity.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {validSalesDateRange} from "./salesAnalysisPeriod.js";
import {laboratorySavings} from "./salesLaboratoryModel.js";
import {planGenericSalesSources} from "./genericOfferSalesSources.js";
import {listUnifiedSuppliers,readUnifiedSupplierCN} from "./unifiedSuppliers.js";
import {readCachedLaboratoryOptions} from "./laboratoryOptionCache.js";
import {hasNativeNormalizedCN} from "./articleSchemaCache.js";
// Match supplier codes using the same normalization as the purchasing planner.
export const supplierCodeSQL=e=>"CASE WHEN btrim(coalesce("+e+"::text,'')) ~ '^[0-9]+$' THEN coalesce(nullif(ltrim(btrim("+e+"::text),'0'),''),'0') ELSE upper(btrim(coalesce("+e+"::text,''))) END";
const validCN=e=>"CASE WHEN btrim(coalesce("+e+"::text,''))~'^[0-9]{6,7}$' THEN btrim("+e+"::text) END";
const official=a=>"coalesce(nullif(btrim("+a+".laboratorio_comercializador),''),nullif(btrim("+a+".laboratorio_titular),''),nullif(btrim("+a+".laboratorio),''))";
const pharmacies="WITH pharmacies AS MATERIALIZED (SELECT f.id,"+pharmacyDataCodeSQL("f")+" AS code FROM farmetrica.farmacias f WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[]))";
function scope(req,res,dates){
 const c=req.context,raw=String(req.query.farmacias||""),allowed=(c.allowedPharmacyIds||[]).map(Number),ids=[...new Set(raw?raw.split(",").map(Number):allowed)],from=String(req.query.desde||""),to=String(req.query.hasta||"");
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(c.client.schema)||raw.length>2000||ids.length>100||ids.some(x=>!Number.isSafeInteger(x)||!allowed.includes(x))||dates&&!validSalesDateRange(from,to)){res.status(400).json({error:"Período o farmacias no autorizados"});return null;}
 const admin=c.role==="superadministrador";
 return {tenant:c.client.slug,schema:'"'+c.client.schema+'"',ids,from,to,context:c,commercial:req.query.alcance==="proveedor",canBuy:admin||c.modules?.compras===true&&(!c.sections||c.sections.compras===true||c.sections["compras-recepciones"]===true),canTariff:admin||c.modules?.genericos===true&&(!c.sections||c.sections.genericos===true)};
}
// Caché breve de IDENTIDADES, no de movimientos ni importes. Comparte las
// peticiones concurrentes de ventas y compras; no conserva consultas fallidas.
function shortCache(ttl=90000,limit=64){
 const map=new Map();
 return (key,load)=>{
  const now=Date.now(),entry=map.get(key);
  if(entry&&(entry.pending||entry.expires>now))return entry.promise;
  const next={pending:true,expires:now+ttl};
  next.promise=Promise.resolve().then(load).then(value=>{next.pending=false;next.expires=Date.now()+ttl;return value},e=>{if(map.get(key)===next)map.delete(key);throw e});
  map.delete(key);map.set(key,next);
  for(const [k,v] of map){if(map.size<=limit)break;if(!v.pending)map.delete(k);}
  return next.promise;
 };
}
const scopeKey=s=>JSON.stringify([s.tenant,s.schema,[...s.ids].sort((a,b)=>a-b),s.canBuy,s.canTariff,Boolean(s.context?.client?.demo)]);
const plannerKey=key=>/^P:[1-9][0-9]{0,17}$/.test(key);
// La identidad de producto NO procede de compras, proveedor habitual ni tarifa.
// Un ID ERP nunca se convierte por coincidencia numérica en un CN de AEMPS.
const cnExpression=(a="a")=>validCN(a+".codigo_nacional");
// CN/EAN de la ficha, nunca del ID ERP. Maestro explícito de artículos
// también cubre parafarmacia. Una compra no determina el fabricante.
const productIdentitySQL=s=>pharmacies+", local AS MATERIALIZED (SELECT DISTINCT ON(f.code,a.origen_id) f.code,a.origen_id::text AS article,"+cnExpression()+" AS cn,CASE WHEN btrim(coalesce((to_jsonb(a)->>'ean'),''))~'^[0-9]{8,14}$' THEN btrim((to_jsonb(a)->>'ean')) END AS ean,a.nombre AS name,a.laboratorio AS laboratory FROM "+s.schema+".articulos a JOIN pharmacies f ON upper(btrim(a.farmacia_codigo))=f.code WHERE nullif(a.origen_id::text,'') IS NOT NULL ORDER BY f.code,a.origen_id,a.sincronizado_en DESC NULLS LAST), "+
 "master AS MATERIALIZED (SELECT codigo,array_agg(DISTINCT "+norm("laboratorio_nombre")+") AS labs FROM farmetrica.articulos_laboratorio_maestro WHERE nullif(btrim(laboratorio_nombre),'') IS NOT NULL GROUP BY codigo), "+
 "identified AS MATERIALIZED (SELECT a.*,n.nombre AS official_name,n.dcpf,n.generico AS generic,"+norm(official("n"))+" AS official_lab,"+norm("a.laboratory")+" AS erp_lab,ARRAY(SELECT DISTINCT x FROM unnest(coalesce(mc.labs,ARRAY[]::text[])||coalesce(me.labs,ARRAY[]::text[])) x WHERE x<>'') AS master_labs FROM local a LEFT JOIN farmetrica.nomenclator_presentaciones n ON n.cn=a.cn LEFT JOIN master mc ON mc.codigo=a.cn LEFT JOIN master me ON me.codigo=a.ean), "+
 "resolved AS MATERIALIZED (SELECT a.*,CASE WHEN official_lab<>'' THEN official_lab WHEN cardinality(master_labs)=1 THEN master_labs[1] WHEN cardinality(master_labs)>1 THEN NULL ELSE nullif(erp_lab,'') END AS lab,CASE WHEN official_lab<>'' THEN 'nomenclator' WHEN cardinality(master_labs)=1 THEN 'maestro' WHEN cardinality(master_labs)>1 THEN 'conflicto' WHEN erp_lab<>'' THEN 'erp' ELSE 'sin_identificar' END AS identity_source FROM identified a), "+
 "selected_cn AS MATERIALIZED (SELECT cn,min(lab) AS lab FROM resolved WHERE cn IS NOT NULL GROUP BY cn HAVING count(DISTINCT lab)=1 AND NOT bool_or(identity_source='conflicto')), "+
 "selected_ean AS MATERIALIZED (SELECT ean,min(lab) AS lab FROM resolved WHERE ean IS NOT NULL GROUP BY ean HAVING count(DISTINCT lab)=1 AND NOT bool_or(identity_source='conflicto')) ";
const resolvedLab="CASE WHEN a.cn IS NOT NULL THEN sc.lab WHEN a.ean IS NOT NULL THEN se.lab ELSE a.lab END";
export function laboratoryKeysSQL(s,native){
 return productIdentitySQL(s)+"SELECT a.code,a.article,a.cn,coalesce(a.official_name,nullif(btrim(a.name),''),a.article) AS name,a.dcpf,a.generic FROM resolved a LEFT JOIN selected_cn sc ON sc.cn=a.cn LEFT JOIN selected_ean se ON se.ean=a.ean WHERE "+resolvedLab+"=$3";
}
export function commercialKeysSQL(s){
 // Cartera comercial independiente: referencias compradas al proveedor
 // dentro del período, sin inferir fabricante ni ahorro.
 return pharmacies+", direct_articles AS MATERIALIZED (SELECT DISTINCT code,article FROM jsonb_to_recordset($3::jsonb) AS d(code text,article text) WHERE nullif(btrim(article),'') IS NOT NULL) SELECT d.code,d.article,a.cn,coalesce(nullif(btrim(a.name),''),d.article) AS name,NULL::text AS dcpf,false AS generic FROM direct_articles d JOIN pharmacies f ON f.code=d.code LEFT JOIN LATERAL (SELECT "+cnExpression()+" AS cn,a.nombre AS name FROM "+s.schema+".articulos a WHERE upper(btrim(a.farmacia_codigo))=d.code AND a.origen_id::text=d.article ORDER BY a.sincronizado_en DESC NULLS LAST LIMIT 1) a ON true";
}
// El universo comercial viene del MISMO catálogo que el preparador.
// Resolver sus referencias en cada farmacia una sola vez. No admitir una
// coincidencia de ID interno cuando existe un CN explícito contradictorio.
export function plannerLaboratoryKeysSQL(s,native){
 const cn=validCN("a.codigo_nacional"),normalized=native?validCN("a.cn_normalizado"):"NULL::text";
 return pharmacies+", refs AS MATERIALIZED (SELECT DISTINCT ON(reference) reference,cn,name FROM jsonb_to_recordset($3::jsonb) AS r(reference text,cn text,name text) ORDER BY reference), "+
 "direct_articles AS MATERIALIZED (SELECT DISTINCT code,article FROM jsonb_to_recordset($4::jsonb) AS d(code text,article text) WHERE nullif(btrim(article),'') IS NOT NULL), "+
 "local AS MATERIALIZED (SELECT DISTINCT ON(f.code,a.origen_id) f.id,f.code,a.origen_id::text AS article,"+cn+" AS explicit_cn,"+normalized+" AS normalized_cn,a.nombre AS name FROM "+s.schema+".articulos a JOIN pharmacies f ON upper(btrim(a.farmacia_codigo))=f.code WHERE nullif(btrim(a.origen_id::text),'') IS NOT NULL ORDER BY f.code,a.origen_id,a.sincronizado_en DESC NULLS LAST), "+
 "mapped AS MATERIALIZED (SELECT a.*,coalesce(a.explicit_cn,a.normalized_cn) AS confirmed_cn,coalesce(a.explicit_cn,a.normalized_cn,CASE WHEN a.article~'^[0-9]{6,7}$' THEN a.article END) AS lookup_cn FROM local a), "+
 "official_generic_cn AS MATERIALIZED (SELECT n.cn,n.nombre AS name FROM farmetrica.nomenclator_presentaciones n WHERE n.generico=true AND nullif(btrim(n.dcpf::text),'') IS NOT NULL AND "+norm(official("n"))+"=$5), "+
 "commercial_cn AS MATERIALIZED (SELECT cn,coalesce(min(name) FILTER(WHERE priority=0),min(name)) AS name FROM (SELECT cn,name,0 AS priority FROM refs WHERE cn IS NOT NULL UNION ALL SELECT a.confirmed_cn,a.name,1 FROM mapped a JOIN direct_articles d ON d.code=a.code AND d.article=a.article WHERE a.confirmed_cn IS NOT NULL UNION ALL SELECT n.cn,n.name,2 FROM official_generic_cn n WHERE EXISTS(SELECT 1 FROM mapped a WHERE a.confirmed_cn=n.cn)) c GROUP BY cn), "+
 "matched AS MATERIALIZED (SELECT a.code,a.article,r.cn,coalesce(nullif(r.name,''),a.name,a.article) AS name,n.dcpf,coalesce(n.generico,false) AS generic,"+official("n")+" AS manufacturer FROM mapped a JOIN commercial_cn r ON r.cn=a.lookup_cn LEFT JOIN farmetrica.nomenclator_presentaciones n ON n.cn=r.cn UNION ALL SELECT a.code,a.article,NULL::text,coalesce(nullif(r.name,''),a.name,a.article),NULL::text,false,NULL::text FROM mapped a JOIN refs r ON r.cn IS NULL AND r.reference='ERP:'||a.id::text||':'||a.article WHERE NOT EXISTS(SELECT 1 FROM commercial_cn known WHERE known.cn=a.lookup_cn) UNION ALL SELECT f.code,r.cn,r.cn,coalesce(r.name,n.nombre,r.cn),n.dcpf,true,"+official("n")+" FROM pharmacies f CROSS JOIN commercial_cn r JOIN farmetrica.nomenclator_presentaciones n ON n.cn=r.cn AND n.generico=true WHERE NOT EXISTS(SELECT 1 FROM local a WHERE a.code=f.code AND a.article=r.cn)) "+
 "SELECT * FROM matched UNION ALL SELECT d.code,d.article,NULL::text,coalesce(nullif(a.name,''),'Artículo ERP '||d.article),NULL::text,false,NULL::text FROM direct_articles d JOIN pharmacies f ON f.code=d.code LEFT JOIN mapped a ON a.code=d.code AND a.article=d.article WHERE NOT EXISTS(SELECT 1 FROM matched m WHERE m.code=d.code AND m.article=d.article)";
}
export function plannerReferences(catalogues){
 const map=new Map();
 for(const catalog of catalogues){
  if(catalog.warning)throw Error("Catálogo del preparador incompleto: "+catalog.warning);
  for(const r of catalog.rows||[]){
   const reference=String(r.referencia||""),cn=/^[0-9]{6,7}$/.test(String(r.cn||""))?String(r.cn):null;
   if(!reference||(!cn&&!/^ERP:[0-9]+:.+/.test(reference)))continue;
   const key=cn||reference;
   if(!map.has(key))map.set(key,{reference:cn||reference,cn,name:r.nombre||reference});
  }
 }
 return [...map.values()];
}

// Consulta con valores concretos: PostgreSQL estima cardinalidades de
// farmacia, artículo y fechas directamente en vez de unir rangos dinámicos
// y jsonb_to_recordset con todas las líneas documentales.
export function laboratoryMovementSQL(s,buy){
 const source=s.schema+"."+(buy?"fm_recepciones_analitica":"fm_ventas_analitica");
 return "SELECT v.farmacia_codigo AS code,v.articulo_id::text AS article,sum(v.unidades)::float8 AS units,sum(v.importe)::float8 AS amount FROM "+source+" v WHERE v.farmacia_codigo=$1 AND v.articulo_id=ANY($2::text[]) AND v.fecha>=$3::date AND v.fecha<$4::date+interval '1 day' GROUP BY 1,2";
}
export function mergeLaboratoryMovements(keys,rows,buy){
 const index=new Map(keys.map(k=>[JSON.stringify([k.code,k.article]),k])),out=new Map();
 for(const row of rows){
  const k=index.get(JSON.stringify([row.code,row.article]));if(!k)continue;
  const reference=k.cn||"ERP:"+k.code+":"+k.article;
  const existing=out.get(reference)||{reference,cn:k.cn,name:k.name,dcpf:k.dcpf,generic:k.generic,units:0,amount:0};
  if(k.generic===true){existing.generic=true;existing.dcpf=k.dcpf;if(k.manufacturer!=null)existing.manufacturer=k.manufacturer;}
  if(!buy&&k.cn){existing.verifiedGenericUnits=(existing.verifiedGenericUnits||0)+(k.generic===true?Number(row.units||0):0);}
  existing.units+=Number(row.units||0);existing.amount+=Number(row.amount||0);out.set(reference,existing);
 }
 return [...out.values()].map(({units,amount,...r})=>buy?{...r,purchaseUnits:units,purchaseAmount:amount}:{...r,units,revenue:amount});
}
const monthSlices=(from,to)=>{
 const result=[];
 let start=from;
 while(start<=to){
  const next=new Date(start.slice(0,7)+"-01T00:00:00Z");next.setUTCMonth(next.getUTCMonth()+1);
  const end=new Date(next.getTime()-86400000).toISOString().slice(0,10);
  result.push({from:start,to:end<to?end:to});start=next.toISOString().slice(0,10);
 }
 return result;
};
async function readLaboratoryMovements(pool,s,keys,buy){
 const byCode=new Map();
 for(const k of keys){const list=byCode.get(k.code)||new Set();list.add(k.article);byCode.set(k.code,list);}
 if(!byCode.size)return [];
 // El estado de cierres se lee aparte. En instalaciones anteriores sin las
 // dos tablas, la lectura documental sigue funcionando, sin falsos ceros.
 const {rows:sites}=await pool.query({text:pharmacies+" SELECT id,code,to_char(clock_timestamp() AT TIME ZONE 'Europe/Madrid','YYYY-MM-DD') AS today,to_regclass('farmetrica.ventas_panorama_meses_cerrados') IS NOT NULL AND to_regclass('farmetrica.ventas_panorama_mensual') IS NOT NULL AS cache_available FROM pharmacies",values:[s.tenant,s.ids],query_timeout:5000});
 const farms=sites.filter(x=>byCode.has(x.code)),today=sites[0]?.today;
 if(!farms.length)return [];
 const cache= !buy&&sites[0].cache_available===true;
 const closures=cache?(await pool.query({text:"SELECT farmacia_id,mes::text AS mes FROM farmetrica.ventas_panorama_meses_cerrados WHERE cliente_slug=$1 AND farmacia_id=ANY($2::int[]) AND mes>=$3::date AND mes<=$4::date",values:[s.tenant,s.ids,s.from,s.to],query_timeout:5000})).rows:[];
 const plan=planGenericSalesSources(s.from,s.to,today,farms,closures);
 const rows=[],codeById=new Map(farms.map(p=>[Number(p.id),p.code]));
 if(plan.cached.length){
  const valid=new Set(plan.cached.map(p=>p.id+"|"+p.month));
  const months=[...new Set(plan.cached.map(p=>p.month))],articles=[...new Set(keys.map(k=>k.article))];
  const result=await pool.query({text:"SELECT farmacia_id,mes::text AS mes,clave AS article,unidades::float8 AS units,importe::float8 AS amount FROM farmetrica.ventas_panorama_mensual WHERE cliente_slug=$1 AND farmacia_id=ANY($2::int[]) AND mes=ANY($3::date[]) AND dimension='articulo' AND clave=ANY($4::text[])",values:[s.tenant,s.ids,months,articles],query_timeout:12000});
  for(const r of result.rows){const code=codeById.get(Number(r.farmacia_id));if(code&&valid.has(r.farmacia_id+"|"+r.mes)&&byCode.get(code)?.has(r.article))rows.push({...r,code});}
 }
 const jobs=plan.raw.flatMap(r=>r.codes.map(code=>({code,from:r.from,to:r.to})));
 const read=async(job)=>{
  const sql=laboratoryMovementSQL(s,buy),articles=[...byCode.get(job.code)];
  const run=async(from,to)=>{const result=await pool.query({text:sql,values:[job.code,articles,from,to],query_timeout:35000});rows.push(...result.rows);};
  try{await run(job.from,job.to)}
  catch(e){
   const chunks=monthSlices(job.from,job.to);
   if(chunks.length<=1||!(e.code==="57014"||/timeout|query read timeout/i.test(e.message||"")))throw e;
   // El timeout de la API es 30s por sentencia. Si un tramo amplio no
   // termina, volver a intentar únicamente ese tramo, por mes natural.
   for(const chunk of chunks)await run(chunk.from,chunk.to);
  }
 };
 // Máximo dos lectores por petición. Nunca lanzar una consulta por CN.
 // Esperar ambos lectores aunque uno falle para evitar trabajo huérfano.
 let next=0;
 const workers=await Promise.allSettled(Array.from({length:Math.min(2,jobs.length)},async()=>{while(next<jobs.length){const job=jobs[next++];await read(job);}}));
 const failed=workers.find(r=>r.status==="rejected");if(failed)throw failed.reason;
 return mergeLaboratoryMovements(keys,rows,buy);
}
function directQuery(s,byId=false){
 // Resolver proveedores antes de entrar a las recepciones, no recorrer todo
 // el histórico aplicando regex al nombre de cada línea. Los alias explícitos
 // prevalecen sobre el nombre ERP, incluyendo los de los almacenes autorizados.
 if(byId)return pharmacies+", suppliers AS MATERIALIZED (SELECT p.id FROM farmetrica.proveedores_unificados p WHERE p.cliente_slug=$1 AND p.activo AND p.clase IN ('DIRECTO','VACUNAS','FÓRMULAS') AND p.id=$3::bigint), links AS MATERIALIZED (SELECT DISTINCT f.code,"+supplierCodeSQL("a.codigo_origen")+" AS supplier FROM suppliers p JOIN farmetrica.proveedores_unificados_alias a ON a.cliente_slug=$1 AND a.proveedor_id=p.id JOIN pharmacies f ON f.code=upper(btrim(a.farmacia_codigo))) SELECT k.code,m.article,sum(m.units)::float8 AS units,sum(m.amount)::float8 AS amount FROM links k JOIN LATERAL (SELECT v.articulo_id::text AS article,sum(v.unidades) AS units,sum(v.importe) AS amount FROM "+s.schema+".fm_recepciones_analitica v WHERE v.farmacia_codigo=k.code AND k.supplier<>'' AND ("+supplierCodeSQL("v.proveedor_id")+")=k.supplier AND v.fecha>=$4::date AND v.fecha<$5::date+interval '1 day' GROUP BY 1) m ON true GROUP BY 1,2 UNION ALL SELECT NULL::text,NULL::text,0::float8,0::float8 WHERE EXISTS(SELECT 1 FROM links)";
 return pharmacies+", suppliers AS MATERIALIZED (SELECT p.id FROM farmetrica.proveedores_unificados p WHERE p.cliente_slug=$1 AND p.clase IN ('DIRECTO','VACUNAS','FÓRMULAS','SIN_CLASIFICAR') AND ("+norm("p.nombre")+"=$3"+(s.canTariff?" OR EXISTS(SELECT 1 FROM farmetrica.genericos_destinos_laboratorios d WHERE d.cliente_slug=$1 AND d.proveedor_id=p.id AND "+norm("d.laboratorio_fuente")+"=$3)":"")+")), "+
 "links AS MATERIALIZED (SELECT DISTINCT f.code,"+supplierCodeSQL("a.codigo_origen")+" AS supplier FROM suppliers p JOIN farmetrica.proveedores_unificados_alias a ON a.cliente_slug=$1 AND a.proveedor_id=p.id JOIN pharmacies f ON f.code=upper(btrim(a.farmacia_codigo)) UNION SELECT f.code,"+supplierCodeSQL("p.origen_id")+" FROM pharmacies f JOIN "+s.schema+".proveedores p ON upper(btrim(p.farmacia_codigo))=f.code WHERE "+norm("p.nombre")+"=$3 AND NOT EXISTS(SELECT 1 FROM farmetrica.proveedores_unificados_alias a WHERE a.cliente_slug=$1 AND upper(btrim(a.farmacia_codigo))=f.code AND ("+supplierCodeSQL("a.codigo_origen")+")=("+supplierCodeSQL("p.origen_id")+"))) "+
 "SELECT k.code,m.article,sum(m.units)::float8 AS units,sum(m.amount)::float8 AS amount FROM links k JOIN LATERAL (SELECT v.articulo_id::text AS article,sum(v.unidades) AS units,sum(v.importe) AS amount FROM "+s.schema+".fm_recepciones_analitica v WHERE v.farmacia_codigo=k.code AND k.supplier<>'' AND ("+supplierCodeSQL("v.proveedor_id")+")=k.supplier AND v.fecha>=$4::date AND v.fecha<$5::date+interval '1 day' GROUP BY 1) m ON true GROUP BY 1,2 UNION ALL SELECT NULL::text,NULL::text,0::float8,0::float8 WHERE EXISTS(SELECT 1 FROM links)";
}
export function summarizeDirectLaboratory(rows,keys=null){
 if(!rows.length)return null;
 const valid=keys===null?null:new Set(keys.map(k=>JSON.stringify([k.code,k.article])));
 return rows.reduce((out,r)=>{
  const units=Number(r.units||0),amount=Number(r.amount||0),unmatched=r.code&&(!String(r.article??"").trim()||valid&&!valid.has(JSON.stringify([r.code,r.article])));
  out.units+=units;out.amount+=amount;
  if(unmatched){out.unidentified+=Math.abs(amount);if(valid){out.unattributedUnits+=units;out.unattributedAmount+=amount;out.unattributedReferences++;}}
  return out;
 },{units:0,amount:0,unidentified:0,unattributedUnits:valid?0:null,unattributedAmount:valid?0:null,unattributedReferences:valid?0:null});
}
export function setupSalesLaboratories(app,pool,{requireTenantModule,plannerList=listUnifiedSuppliers,plannerCatalogue=readUnifiedSupplierCN,nativeCN=hasNativeNormalizedCN}){
 const guard=requireTenantModule("ventas");
 const keysCache=shortCache(),namesCache=shortCache(120000),salesCache=shortCache(30000,48),directCache=shortCache(90000,48);
 const plannerOptions=s=>readCachedLaboratoryOptions(pool,s.tenant,s.ids,()=>plannerList(pool,s.context,s.ids,true),"unified");
 const periodKey=(s,lab)=>JSON.stringify([scopeKey(s),lab,s.from,s.to]);
 const directFor=(s,lab)=>directCache(periodKey(s,lab),()=>timed("direct",()=>pool.query({text:directQuery(s,plannerKey(lab)),values:[s.tenant,s.ids,plannerKey(lab)?lab.slice(2):lab,s.from,s.to],query_timeout:35000})));
 const verifiedKeys=(s,lab)=>keysCache(scopeKey(s)+"|"+lab,async()=>{
  return (await pool.query({text:laboratoryKeysSQL(s,false),values:[s.tenant,s.ids,lab],query_timeout:18000})).rows;
 });
 const sharedKeys=(s,lab)=>keysCache(periodKey(s,lab)+"|catalogue",async()=>{
  const catalogs=await Promise.all(["medicacion","parafarmacia"].map(type=>plannerCatalogue(pool,s.context,{key:lab,pharmacies:s.ids,type,search:""})));
  const refs=plannerReferences(catalogs);
  const receipts=s.canBuy?await directFor(s,lab):{rows:[]};
  const directRefs=receipts.rows.filter(r=>r.code&&String(r.article??"").trim()).map(({code,article})=>({code,article}));
  const selected=(await plannerOptions(s)).find(p=>p.key===lab);
  const native=await nativeCN(pool,s.context.client.schema).catch(()=>false);
  return (await pool.query({text:plannerLaboratoryKeysSQL(s,native),values:[s.tenant,s.ids,JSON.stringify(refs),JSON.stringify(directRefs),normalizeLabName(selected?.name)],query_timeout:18000})).rows;
 });
 const readKeys=(s,lab)=>plannerKey(lab)?sharedKeys(s,lab):s.commercial?keysCache(periodKey(s,lab)+"|proveedor",async()=>{
  const direct=await directFor(s,lab),refs=direct.rows.filter(r=>r.code&&String(r.article??"").trim()).map(({code,article})=>({code,article}));
  if(!refs.length)return [];
  return (await pool.query({text:commercialKeysSQL(s),values:[s.tenant,s.ids,JSON.stringify(refs)],query_timeout:15000})).rows;
 }):verifiedKeys(s,lab);
 const timed=async(label,work)=>{
  const start=Date.now();
  try{const result=await work();console.info("FM_LAB_METRIC",label,"ms",Date.now()-start);return result}
  catch(e){console.warn("FM_LAB_METRIC_ERROR",label,e.code||e.name,/timeout|canceling statement/i.test(e.message||"")?"timeout":"query-error","ms",Date.now()-start);throw e}
 };
 const movements=async(s,lab,buy)=>{
  const keys=await timed("keys",()=>readKeys(s,lab));
  const rows=keys.length?await timed(buy?"purchases":"sales",()=>readLaboratoryMovements(pool,s,keys,buy)):[];
  if(buy&&plannerKey(lab)){
   const direct=await directFor(s,lab);
   for(const r of direct.rows.filter(r=>r.code&&!String(r.article??"").trim()))rows.push({reference:"AJUSTE:"+r.code,cn:null,name:"Compra sin código de artículo ("+r.code+")",generic:false,purchaseUnits:Number(r.units||0),purchaseAmount:Number(r.amount||0)});
  }
  return {rows,catalogReferences:new Set(keys.map(k=>k.cn||JSON.stringify([k.code,k.article]))).size};
 };
 const salesFor=(s,lab)=>salesCache(JSON.stringify([scopeKey(s),lab,s.from,s.to,s.commercial]),()=>movements(s,lab,false));
 app.get("/api/analytics/ventas/laboratorios",...guard,async(req,res,next)=>{
  const s=scope(req,res,false);if(!s)return;
  try{
   if(req.query.modo!=="identidad"){const items=await plannerOptions(s);return res.json({items:items.map(({key,name})=>({key,name})),partial:false});}
   const result=await namesCache(scopeKey(s),async()=>{
   // El selector usa la misma identidad verificable que el informe.
   const q=[pool.query({text:productIdentitySQL(s)+" SELECT DISTINCT "+resolvedLab+" AS name FROM resolved a LEFT JOIN selected_cn sc ON sc.cn=a.cn LEFT JOIN selected_ean se ON se.ean=a.ean WHERE "+resolvedLab+" IS NOT NULL",values:[s.tenant,s.ids],query_timeout:18000})];
   if(s.canBuy)q.push(pool.query({text:pharmacies+" SELECT DISTINCT p.nombre AS name FROM farmetrica.proveedores_unificados p JOIN farmetrica.proveedores_unificados_alias a ON a.cliente_slug=p.cliente_slug AND a.proveedor_id=p.id JOIN pharmacies f ON upper(btrim(a.farmacia_codigo))=f.code WHERE p.cliente_slug=$1 AND p.clase IN ('DIRECTO','VACUNAS','FÓRMULAS','SIN_CLASIFICAR')",values:[s.tenant,s.ids],query_timeout:8000}));
   if(s.canTariff)q.push(pool.query({text:"SELECT DISTINCT laboratorio_fuente AS name FROM farmetrica.genericos_ofertas_laboratorios WHERE cliente_slug=$1",values:[s.tenant],query_timeout:8000}));
   const results=await Promise.allSettled(q),names=new Map();
   for(const r of results)if(r.status==="fulfilled")for(const row of r.value.rows){const key=normalizeLabName(row.name);if(key&&!/\b(COOPERATIVA|MAYORISTA|DISTRIBUIDORA?)\b/.test(key))names.set(key,{key,name:row.name});}
   if(results.every(r=>r.status==="rejected"))throw Error("No se pudo consultar el catálogo de laboratorios");
   return {items:[...names.values()].sort((a,b)=>a.name.localeCompare(b.name,"es")),partial:results.some(r=>r.status==="rejected")};
   });
   res.json(result);
  }catch(e){next(e)}
 });
 app.get("/api/analytics/ventas/laboratorios/analisis",...guard,async(req,res,next)=>{
  const s=scope(req,res,true);if(!s)return;
  const rawLab=String(req.query.laboratorio||""),lab=plannerKey(rawLab)?rawLab:normalizeLabName(rawLab);
  if(!lab||lab.length>160)return res.status(400).json({error:"Selecciona un laboratorio válido"});
  try{
   const selected=plannerKey(lab)?(await plannerOptions(s)).find(p=>p.key===lab):null;
   if(plannerKey(lab)&&!selected)return res.status(400).json({error:"Laboratorio no disponible en el preparador"});
   if(s.commercial&&!s.canBuy)return res.status(403).json({error:"La cartera del proveedor requiere permiso de Compras"});
   const part=String(req.query.parte||"todo");
   if(!["todo","ventas","ahorro","compras","directas","compras-completas"].includes(part))return res.status(400).json({error:"Sección inválida"});
   const sale=part==="todo"||part==="ventas"||part==="ahorro",savingPart=part==="todo"||part==="ahorro",buyPart=part==="todo"||part==="compras"||part==="compras-completas",directPart=part==="todo"||part==="directas"||part==="compras-completas";
   const args=[s.tenant,s.ids,lab,s.from,s.to],jobs=[
    sale?salesFor(s,lab):Promise.resolve(null),
    s.canBuy&&buyPart?movements(s,lab,true):Promise.resolve(null),
    s.canBuy&&directPart?directFor(s,lab):Promise.resolve(null),
    savingPart&&s.canTariff&&!s.commercial?timed("tariffs",()=>pool.query({text:"SELECT t.laboratorio_fuente AS laboratory,t.cn,coalesce(n.nombre,t.descripcion_excel) AS name,n.dcpf::text AS dcpf,n.generico AS generic,"+official("n")+" AS manufacturer,t.neto::float8 AS net,t.descuento::float8 AS discount,d.proveedor_id::text AS \"supplierId\" FROM farmetrica.genericos_ofertas_laboratorios t LEFT JOIN farmetrica.nomenclator_presentaciones n ON n.cn=t.cn LEFT JOIN farmetrica.genericos_destinos_laboratorios d ON d.cliente_slug=t.cliente_slug AND d.laboratorio_fuente=t.laboratorio_fuente WHERE t.cliente_slug=$1",values:[s.tenant],query_timeout:12000})):Promise.resolve(null)];
   const [sales,buy,direct,tariff]=await Promise.allSettled(jobs),available=x=>x.status==="fulfilled"&&x.value!==null,rows=x=>available(x)?x.value.rows:[];
   const directKeys=available(direct)&&rows(direct).length?await (plannerKey(lab)?sharedKeys(s,lab):verifiedKeys(s,lab)).catch(()=>null):null;
   const directSummary=summarizeDirectLaboratory(rows(direct),directKeys);
   const tariffs=rows(tariff).map(t=>selected&&t.supplierId===lab.slice(2)?{...t,laboratory:selected.name}:t);
   const result=laboratorySavings({products:[...rows(sales),...rows(buy)],tariffs,laboratory:selected?.name||lab,supplierId:selected?lab.slice(2):null,salesAvailable:available(sales),purchasesAvailable:available(buy),tariffsAvailable:available(tariff),direct:directSummary});
   res.json({...result,plannerCatalogue:Boolean(selected),catalogReferences:sales.value?.catalogReferences??buy.value?.catalogReferences??null,from:s.from,to:s.to,laboratory:lab,purchaseAccess:s.canBuy,directAvailable:available(direct)&&directSummary!==null,directStatus:!s.canBuy?"forbidden":!directPart?"not_requested":!available(direct)?"error":directSummary===null?"unmapped":"available",tariffAccess:s.canTariff&&!s.commercial,commercial:s.commercial,warnings:[!selected&&!s.commercial&&directSummary?.unattributedReferences>0?(selected?"Hay referencias de compras directas fuera del catálogo del preparador. Se mantienen solo en compras al proveedor.":"Hay referencias de compras directas sin pertenencia verificada al laboratorio. Se mantienen solo en compras al proveedor."):null,available(direct)&&rows(direct).length&&directKeys===null?"No se pudo contrastar la identidad de los artículos comprados directamente.":null,sale&&!available(sales)?"No se pudieron consultar las ventas.":null,buyPart&&s.canBuy&&!available(buy)?"No se pudieron consultar las compras de productos.":null,directPart&&s.canBuy&&!available(direct)?"No se pudieron consultar las compras directas.":null,savingPart&&s.canTariff&&!s.commercial&&!available(tariff)?"No se pudieron consultar las tarifas vigentes.":null].filter(Boolean)});
  }catch(e){next(e)}
 });
}
