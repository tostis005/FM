import {normalizeLabName,normalizedLabSQL as norm} from "./laboratoryIdentity.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {validSalesDateRange} from "./salesAnalysisPeriod.js";
import {laboratorySavings} from "./salesLaboratoryModel.js";
import {hasNativeNormalizedCN} from "./articleSchemaCache.js";
const validCN=e=>"CASE WHEN btrim(coalesce("+e+"::text,''))~'^[0-9]{6,7}$' THEN btrim("+e+"::text) END";
const official=a=>"coalesce(nullif(btrim("+a+".laboratorio_comercializador),''),nullif(btrim("+a+".laboratorio_titular),''),nullif(btrim("+a+".laboratorio),''))";
const pharmacies="WITH pharmacies AS MATERIALIZED (SELECT f.id,"+pharmacyDataCodeSQL("f")+" AS code FROM farmetrica.farmacias f WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[]))";
function scope(req,res,dates){
 const c=req.context,raw=String(req.query.farmacias||""),allowed=(c.allowedPharmacyIds||[]).map(Number),ids=[...new Set(raw?raw.split(",").map(Number):allowed)],from=String(req.query.desde||""),to=String(req.query.hasta||"");
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(c.client.schema)||raw.length>2000||ids.length>100||ids.some(x=>!Number.isSafeInteger(x)||!allowed.includes(x))||dates&&!validSalesDateRange(from,to)){res.status(400).json({error:"Período o farmacias no autorizados"});return null;}
 const admin=c.role==="superadministrador";
 return {tenant:c.client.slug,schema:'"'+c.client.schema+'"',ids,from,to,canBuy:admin||c.modules?.compras===true&&(!c.sections||c.sections.compras===true||c.sections["compras-recepciones"]===true),canTariff:admin||c.modules?.genericos===true&&(!c.sections||c.sections.genericos===true)};
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
const scopeKey=s=>JSON.stringify([s.tenant,s.schema,[...s.ids].sort((a,b)=>a-b),s.canBuy,s.canTariff]);
const cnExpression=(native,a="a")=>"coalesce("+validCN(a+".codigo_nacional")+","+(native?validCN(a+".cn_normalizado"):"NULL::text")+",origin.cn)";
export function laboratoryKeysSQL(s,native){
 const cn=cnExpression(native);
 const tariff=s.canTariff?" UNION SELECT t.cn FROM farmetrica.genericos_ofertas_laboratorios t WHERE t.cliente_slug=$1 AND "+norm("t.laboratorio_fuente")+"=$3":"";
 return pharmacies+", selected_cn AS MATERIALIZED (SELECT n.cn FROM farmetrica.nomenclator_presentaciones n WHERE "+norm(official("n"))+"=$3"+tariff+"), "+
 "local AS MATERIALIZED (SELECT DISTINCT ON(f.code,a.origen_id) f.code,a.origen_id::text AS article,"+cn+" AS cn,a.nombre AS name,a.laboratorio AS laboratory FROM "+s.schema+".articulos a JOIN pharmacies f ON upper(btrim(a.farmacia_codigo))=f.code LEFT JOIN farmetrica.nomenclator_presentaciones origin ON origin.cn="+validCN("a.origen_id")+" WHERE nullif(a.origen_id::text,'') IS NOT NULL ORDER BY f.code,a.origen_id,a.sincronizado_en DESC NULLS LAST), "+
 "selected AS MATERIALIZED (SELECT a.code,a.article,a.cn,coalesce(n.nombre,nullif(btrim(a.name),''),a.article) AS name,n.dcpf,n.generico AS generic FROM local a LEFT JOIN selected_cn sc ON sc.cn=a.cn LEFT JOIN farmetrica.nomenclator_presentaciones n ON n.cn=a.cn WHERE sc.cn IS NOT NULL OR (n.cn IS NULL AND "+norm("a.laboratory")+"=$3)) "+
 "SELECT * FROM selected UNION ALL SELECT f.code,sc.cn,sc.cn,coalesce(n.nombre,sc.cn),n.dcpf,n.generico FROM pharmacies f CROSS JOIN selected_cn sc LEFT JOIN farmetrica.nomenclator_presentaciones n ON n.cn=sc.cn WHERE NOT EXISTS(SELECT 1 FROM local a WHERE a.code=f.code AND a.article=sc.cn)";
}
export function laboratoryMovementSQL(s,buy){
 // Los meses cerrados de Ventas ya contienen unidades e importe por artículo
 // ERP. Reutilizarlos únicamente cuando la farmacia tiene cierre COMPLETO y el
 // mes entero está incluido. Los intervalos parciales y sin cierre van a la
 // vista documental; nunca leer ambos para la misma fecha.
 const prefix=pharmacies+", keys AS MATERIALIZED (SELECT * FROM jsonb_to_recordset($3::jsonb) AS k(code text,article text,cn text,name text,dcpf text,generic boolean)), "+
 "sites AS MATERIALIZED (SELECT DISTINCT p.id,p.code FROM pharmacies p JOIN keys k ON k.code=p.code)";
 const source=s.schema+"."+(buy?"fm_recepciones_analitica":"fm_ventas_analitica");
 const ready=buy?", ready AS (SELECT NULL::int AS id,NULL::date AS month WHERE false)":
 ", ready AS MATERIALIZED (SELECT c.farmacia_id AS id,c.mes AS month FROM farmetrica.ventas_panorama_meses_cerrados c JOIN sites p ON p.id=c.farmacia_id WHERE c.cliente_slug=$1 AND c.mes >= $4::date AND c.mes+interval '1 month' <= $5::date+interval '1 day' AND c.mes < date_trunc('month',timezone('Europe/Madrid',now())))";
 const spans=", months AS (SELECT m::date AS month FROM generate_series(date_trunc('month',$4::date::timestamp),date_trunc('month',$5::date::timestamp),interval '1 month') m), "+
 "missing AS (SELECT p.id,p.code,m.month,m.month-row_number() OVER(PARTITION BY p.id ORDER BY m.month)*interval '1 month' AS island FROM sites p CROSS JOIN months m WHERE NOT EXISTS(SELECT 1 FROM ready r WHERE r.id=p.id AND r.month=m.month)), "+
 "ranges AS MATERIALIZED (SELECT id,code,greatest(min(month),$4::date) AS start_day,least(max(month)+interval '1 month',$5::date+interval '1 day') AS end_day FROM missing GROUP BY id,code,island)";
 // Una agregación por tramo y farmacia, no una consulta correlacionada por
 // cada CN. El planificador puede escoger el índice de artículo o de fecha.
 const raw=", raw AS (SELECT k.code,k.article,sum(v.unidades) AS units,sum(v.importe) AS amount FROM ranges r JOIN keys k ON k.code=r.code JOIN "+source+" v ON v.farmacia_codigo=k.code AND v.articulo_id=k.article AND v.fecha>=r.start_day AND v.fecha<r.end_day GROUP BY k.code,k.article)";
 const cached=buy?"": " UNION ALL SELECT p.code,m.clave,sum(m.unidades),sum(m.importe) FROM ready r JOIN sites p ON p.id=r.id JOIN farmetrica.ventas_panorama_mensual m ON m.cliente_slug=$1 AND m.farmacia_id=r.id AND m.mes=r.month AND m.dimension='articulo' JOIN keys k ON k.code=p.code AND k.article=m.clave GROUP BY p.code,m.clave";
 return prefix+ready+spans+raw+", totals AS (SELECT * FROM raw"+cached+") "+
 "SELECT coalesce(k.cn,'ERP:'||k.code||':'||k.article) AS reference,k.cn,max(k.name) AS name,k.dcpf,k.generic,sum(m.units)::float8 AS "+(buy?'"purchaseUnits"':"units")+",sum(m.amount)::float8 AS "+(buy?'"purchaseAmount"':"revenue")+" FROM totals m JOIN keys k ON k.code=m.code AND k.article=m.article GROUP BY 1,2,4,5";
}
function directQuery(s){
 // Resolver proveedores antes de entrar a las recepciones, no recorrer todo
 // el histórico aplicando regex al nombre de cada línea. Los alias explícitos
 // prevalecen sobre el nombre ERP, incluyendo los de los almacenes autorizados.
 return pharmacies+", suppliers AS MATERIALIZED (SELECT p.id FROM farmetrica.proveedores_unificados p WHERE p.cliente_slug=$1 AND p.clase IN ('DIRECTO','VACUNAS','FÓRMULAS') AND ("+norm("p.nombre")+"=$3"+(s.canTariff?" OR EXISTS(SELECT 1 FROM farmetrica.genericos_destinos_laboratorios d WHERE d.cliente_slug=$1 AND d.proveedor_id=p.id AND "+norm("d.laboratorio_fuente")+"=$3)":"")+")), "+
 "links AS MATERIALIZED (SELECT DISTINCT f.code,a.codigo_origen AS supplier FROM suppliers p JOIN farmetrica.proveedores_unificados_alias a ON a.cliente_slug=$1 AND a.proveedor_id=p.id JOIN pharmacies f ON f.code=a.farmacia_codigo UNION SELECT f.code,p.origen_id::text FROM pharmacies f JOIN "+s.schema+".proveedores p ON upper(btrim(p.farmacia_codigo))=f.code WHERE "+norm("p.nombre")+"=$3 AND NOT EXISTS(SELECT 1 FROM farmetrica.proveedores_unificados_alias a WHERE a.cliente_slug=$1 AND a.farmacia_codigo=f.code AND a.codigo_origen=p.origen_id::text)) "+
 "SELECT CASE WHEN EXISTS(SELECT 1 FROM links) THEN coalesce(sum(m.units),0)::float8 END AS units,CASE WHEN EXISTS(SELECT 1 FROM links) THEN coalesce(sum(m.amount),0)::float8 END AS amount FROM links k JOIN LATERAL (SELECT sum(v.unidades) AS units,sum(v.importe) AS amount FROM "+s.schema+".fm_recepciones_analitica v WHERE v.farmacia_codigo=k.code AND v.proveedor_id=k.supplier AND v.fecha>=$4::date AND v.fecha<$5::date+interval '1 day') m ON true";
}
export function setupSalesLaboratories(app,pool,{requireTenantModule}){
 const guard=requireTenantModule("ventas");
 const keysCache=shortCache(),namesCache=shortCache(120000),salesCache=shortCache(30000,48);
 const readKeys=(s,lab)=>keysCache(scopeKey(s)+"|"+lab,async()=>{
  const native=await hasNativeNormalizedCN(pool,s.schema.replaceAll('"','')).catch(()=>false);
  return (await pool.query({text:laboratoryKeysSQL(s,native),values:[s.tenant,s.ids,lab],query_timeout:18000})).rows;
 });
 const timed=async(label,work)=>{
  const start=Date.now();
  try{const result=await work();console.info("FM_LAB_METRIC",label,"ms",Date.now()-start);return result}
  catch(e){console.warn("FM_LAB_METRIC_ERROR",label,e.code||e.name,"ms",Date.now()-start);throw e}
 };
 const movements=async(s,lab,buy)=>{
  const keys=await timed("keys",()=>readKeys(s,lab));if(!keys.length)return {rows:[]};
  return timed(buy?"purchases":"sales",()=>pool.query({text:laboratoryMovementSQL(s,buy),values:[s.tenant,s.ids,JSON.stringify(keys),s.from,s.to],query_timeout:55000}));
 };
 const salesFor=(s,lab)=>salesCache(JSON.stringify([scopeKey(s),lab,s.from,s.to]),()=>movements(s,lab,false));
 app.get("/api/analytics/ventas/laboratorios",...guard,async(req,res,next)=>{
  const s=scope(req,res,false);if(!s)return;
  try{
   const result=await namesCache(scopeKey(s),async()=>{
   const native=await hasNativeNormalizedCN(pool,s.schema.replaceAll('"','')).catch(()=>false);
   // Reducir a combinaciones únicas CN/laboratorio antes de cruzar AEMPS.
   const cn="coalesce("+validCN("a.codigo_nacional")+","+(native?validCN("a.cn_normalizado"):"NULL::text")+")";
   const q=[pool.query({text:pharmacies+", refs AS MATERIALIZED (SELECT DISTINCT "+cn+" AS cn,nullif(btrim(a.laboratorio),'') AS lab FROM "+s.schema+".articulos a JOIN pharmacies f ON upper(btrim(a.farmacia_codigo))=f.code) SELECT DISTINCT coalesce("+official("n")+",a.lab) AS name FROM refs a LEFT JOIN farmetrica.nomenclator_presentaciones n ON n.cn=a.cn WHERE coalesce("+official("n")+",a.lab) IS NOT NULL",values:[s.tenant,s.ids],query_timeout:15000})];
   if(s.canBuy)q.push(pool.query({text:pharmacies+" SELECT DISTINCT p.nombre AS name FROM farmetrica.proveedores_unificados p JOIN farmetrica.proveedores_unificados_alias a ON a.cliente_slug=p.cliente_slug AND a.proveedor_id=p.id JOIN pharmacies f ON upper(btrim(a.farmacia_codigo))=f.code WHERE p.cliente_slug=$1 AND p.clase IN ('DIRECTO','VACUNAS','FÓRMULAS')",values:[s.tenant,s.ids],query_timeout:8000}));
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
  const lab=normalizeLabName(String(req.query.laboratorio||""));
  if(!lab||lab.length>160)return res.status(400).json({error:"Selecciona un laboratorio válido"});
  try{
   const part=String(req.query.parte||"todo");
   if(!["todo","ventas","ahorro","compras","directas"].includes(part))return res.status(400).json({error:"Sección inválida"});
   const sale=part==="todo"||part==="ventas"||part==="ahorro",savingPart=part==="todo"||part==="ahorro",buyPart=part==="todo"||part==="compras",directPart=part==="todo"||part==="directas";
   const args=[s.tenant,s.ids,lab,s.from,s.to],jobs=[
    sale?salesFor(s,lab):Promise.resolve(null),
    s.canBuy&&buyPart?movements(s,lab,true):Promise.resolve(null),
    s.canBuy&&directPart?pool.query({text:directQuery(s),values:args,query_timeout:25000}):Promise.resolve(null),
    savingPart&&s.canTariff?timed("tariffs",()=>pool.query({text:"SELECT t.laboratorio_fuente AS laboratory,t.cn,coalesce(n.nombre,t.descripcion_excel) AS name,n.dcpf,n.generico AS generic,t.neto::float8 AS net,t.descuento::float8 AS discount FROM farmetrica.genericos_ofertas_laboratorios t LEFT JOIN farmetrica.nomenclator_presentaciones n ON n.cn=t.cn WHERE t.cliente_slug=$1",values:[s.tenant],query_timeout:12000})):Promise.resolve(null)];
   const [sales,buy,direct,tariff]=await Promise.allSettled(jobs),available=x=>x.status==="fulfilled"&&x.value!==null,rows=x=>available(x)?x.value.rows:[];
   const result=laboratorySavings({products:[...rows(sales),...rows(buy)],tariffs:rows(tariff),laboratory:lab,salesAvailable:available(sales),purchasesAvailable:available(buy),tariffsAvailable:available(tariff),direct:rows(direct)[0]||null});
   res.json({...result,from:s.from,to:s.to,laboratory:lab,purchaseAccess:s.canBuy,tariffAccess:s.canTariff,warnings:[sale&&!available(sales)?"No se pudieron consultar las ventas.":null,buyPart&&s.canBuy&&!available(buy)?"No se pudieron consultar las compras de productos.":null,directPart&&s.canBuy&&!available(direct)?"No se pudieron consultar las compras directas.":null,savingPart&&s.canTariff&&!available(tariff)?"No se pudieron consultar las tarifas vigentes.":null].filter(Boolean)});
  }catch(e){next(e)}
 });
}
