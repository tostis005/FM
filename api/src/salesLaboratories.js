import {normalizeLabName,normalizedLabSQL as norm} from "./laboratoryIdentity.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {validSalesDateRange} from "./salesAnalysisPeriod.js";
import {laboratorySavings} from "./salesLaboratoryModel.js";
const validCN=e=>"CASE WHEN btrim(coalesce("+e+"::text,''))~'^[0-9]{6,7}$' THEN btrim("+e+"::text) END";
const official=a=>"coalesce(nullif(btrim("+a+".laboratorio_comercializador),''),nullif(btrim("+a+".laboratorio_titular),''),nullif(btrim("+a+".laboratorio),''))";
const pharmacies="WITH pharmacies AS MATERIALIZED (SELECT f.id,"+pharmacyDataCodeSQL("f")+" AS code FROM farmetrica.farmacias f WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[]))";
function scope(req,res,dates){
 const c=req.context,raw=String(req.query.farmacias||""),allowed=(c.allowedPharmacyIds||[]).map(Number),ids=[...new Set(raw?raw.split(",").map(Number):allowed)],from=String(req.query.desde||""),to=String(req.query.hasta||"");
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(c.client.schema)||raw.length>2000||ids.length>100||ids.some(x=>!Number.isSafeInteger(x)||!allowed.includes(x))||dates&&!validSalesDateRange(from,to)){res.status(400).json({error:"Período o farmacias no autorizados"});return null;}
 const admin=c.role==="superadministrador";
 return {tenant:c.client.slug,schema:'"'+c.client.schema+'"',ids,from,to,canBuy:admin||c.modules?.compras===true&&(!c.sections||c.sections.compras===true||c.sections["compras-recepciones"]===true),canTariff:admin||c.modules?.genericos===true&&(!c.sections||c.sections.genericos===true)};
}
function productQuery(s,buy){
 const cn="coalesce("+validCN("a.codigo_nacional")+","+validCN("(to_jsonb(a)->>'cn_normalizado')")+",origin.cn)";
 const match=expr=>s.canTariff?" OR EXISTS(SELECT 1 FROM farmetrica.genericos_ofertas_laboratorios t WHERE t.cliente_slug=$1 AND t.cn="+expr+" AND "+norm("t.laboratorio_fuente")+"=$3)":"";
 return pharmacies+", official AS MATERIALIZED (SELECT n.cn,n.nombre AS name,n.dcpf,n.generico AS generic FROM farmetrica.nomenclator_presentaciones n WHERE "+norm(official("n"))+"=$3"+match("n.cn")+"), "+
 "local AS MATERIALIZED (SELECT DISTINCT ON(f.code,a.origen_id) f.code,a.origen_id::text AS article,"+cn+" AS cn,a.nombre AS name,a.laboratorio AS laboratory FROM "+s.schema+".articulos a JOIN pharmacies f ON upper(btrim(a.farmacia_codigo))=f.code LEFT JOIN farmetrica.nomenclator_presentaciones origin ON origin.cn="+validCN("a.origen_id")+" ORDER BY f.code,a.origen_id,a.sincronizado_en DESC NULLS LAST), "+
 "keys AS MATERIALIZED (SELECT a.code,a.article,a.cn,coalesce(n.nombre,nullif(btrim(a.name),''),a.article) AS name,n.dcpf,n.generico AS generic FROM local a LEFT JOIN farmetrica.nomenclator_presentaciones n ON n.cn=a.cn WHERE EXISTS(SELECT 1 FROM official o WHERE o.cn=a.cn) OR (n.cn IS NULL AND "+norm("a.laboratory")+"=$3)"+match("a.cn")+" UNION ALL SELECT f.code,o.cn,o.cn,o.name,o.dcpf,o.generic FROM pharmacies f CROSS JOIN official o WHERE NOT EXISTS(SELECT 1 FROM local a WHERE a.code=f.code AND a.article=o.cn)) "+
 "SELECT coalesce(k.cn,'ERP:'||k.code||':'||k.article) AS reference,k.cn,max(k.name) AS name,k.dcpf,k.generic,sum(v.unidades)::float8 AS "+(buy?'"purchaseUnits"':"units")+",sum(v.importe)::float8 AS "+(buy?'"purchaseAmount"':"revenue")+" FROM keys k JOIN "+s.schema+"."+(buy?"fm_recepciones_analitica":"fm_ventas_analitica")+" v ON v.farmacia_codigo=k.code AND v.articulo_id=k.article WHERE v.fecha>=$4::date AND v.fecha<$5::date+interval '1 day' GROUP BY 1,2,4,5";
}
function directQuery(s){
 return pharmacies+", suppliers AS (SELECT p.id FROM farmetrica.proveedores_unificados p WHERE p.cliente_slug=$1 AND p.clase IN ('DIRECTO','VACUNAS','FÓRMULAS') AND ("+norm("p.nombre")+"=$3"+(s.canTariff?" OR EXISTS(SELECT 1 FROM farmetrica.genericos_destinos_laboratorios d WHERE d.cliente_slug=$1 AND d.proveedor_id=p.id AND "+norm("d.laboratorio_fuente")+"=$3)":"")+")) "+
 "SELECT CASE WHEN count(*)>0 OR EXISTS(SELECT 1 FROM suppliers p JOIN farmetrica.proveedores_unificados_alias l ON l.cliente_slug=$1 AND l.proveedor_id=p.id JOIN pharmacies ph ON ph.code=l.farmacia_codigo) THEN coalesce(sum(v.unidades),0)::float8 END AS units,CASE WHEN count(*)>0 OR EXISTS(SELECT 1 FROM suppliers p JOIN farmetrica.proveedores_unificados_alias l ON l.cliente_slug=$1 AND l.proveedor_id=p.id JOIN pharmacies ph ON ph.code=l.farmacia_codigo) THEN coalesce(sum(v.importe),0)::float8 END AS amount FROM "+s.schema+".fm_recepciones_analitica v JOIN pharmacies f ON v.farmacia_codigo=f.code LEFT JOIN farmetrica.proveedores_unificados_alias a ON a.cliente_slug=$1 AND a.farmacia_codigo=f.code AND a.codigo_origen=v.proveedor_id::text WHERE v.fecha>=$4::date AND v.fecha<$5::date+interval '1 day' AND (a.proveedor_id IN (SELECT id FROM suppliers) OR (a.proveedor_id IS NULL AND "+norm("v.proveedor_nombre")+"=$3))";
}
export function setupSalesLaboratories(app,pool,{requireTenantModule}){
 const guard=requireTenantModule("ventas");
 app.get("/api/analytics/ventas/laboratorios",...guard,async(req,res,next)=>{
  const s=scope(req,res,false);if(!s)return;
  try{
   const q=[pool.query({text:pharmacies+" SELECT DISTINCT coalesce("+official("n")+",nullif(btrim(a.laboratorio),'')) AS name FROM "+s.schema+".articulos a JOIN pharmacies f ON upper(btrim(a.farmacia_codigo))=f.code LEFT JOIN farmetrica.nomenclator_presentaciones n ON n.cn=coalesce("+validCN("a.codigo_nacional")+","+validCN("(to_jsonb(a)->>'cn_normalizado')")+") WHERE coalesce("+official("n")+",nullif(btrim(a.laboratorio),'')) IS NOT NULL",values:[s.tenant,s.ids],query_timeout:15000})];
   if(s.canBuy)q.push(pool.query({text:pharmacies+" SELECT DISTINCT p.nombre AS name FROM farmetrica.proveedores_unificados p JOIN farmetrica.proveedores_unificados_alias a ON a.cliente_slug=p.cliente_slug AND a.proveedor_id=p.id JOIN pharmacies f ON upper(btrim(a.farmacia_codigo))=f.code WHERE p.cliente_slug=$1 AND p.clase IN ('DIRECTO','VACUNAS','FÓRMULAS')",values:[s.tenant,s.ids],query_timeout:8000}));
   if(s.canTariff)q.push(pool.query({text:"SELECT DISTINCT laboratorio_fuente AS name FROM farmetrica.genericos_ofertas_laboratorios WHERE cliente_slug=$1",values:[s.tenant],query_timeout:8000}));
   const results=await Promise.allSettled(q),names=new Map();
   for(const r of results)if(r.status==="fulfilled")for(const row of r.value.rows){const key=normalizeLabName(row.name);if(key&&!/\b(COOPERATIVA|MAYORISTA|DISTRIBUIDORA?)\b/.test(key))names.set(key,{key,name:row.name});}
   if(results.every(r=>r.status==="rejected"))return res.status(503).json({error:"No se pudo consultar el catálogo de laboratorios"});
   res.json({items:[...names.values()].sort((a,b)=>a.name.localeCompare(b.name,"es")),partial:results.some(r=>r.status==="rejected")});
  }catch(e){next(e)}
 });
 app.get("/api/analytics/ventas/laboratorios/analisis",...guard,async(req,res,next)=>{
  const s=scope(req,res,true);if(!s)return;
  const lab=normalizeLabName(String(req.query.laboratorio||""));
  if(!lab||lab.length>160)return res.status(400).json({error:"Selecciona un laboratorio válido"});
  try{
   const args=[s.tenant,s.ids,lab,s.from,s.to],jobs=[
    pool.query({text:productQuery(s,false),values:args,query_timeout:35000}),
    s.canBuy?pool.query({text:productQuery(s,true),values:args,query_timeout:35000}):Promise.resolve(null),
    s.canBuy?pool.query({text:directQuery(s),values:args,query_timeout:25000}):Promise.resolve(null),
    s.canTariff?pool.query({text:"SELECT t.laboratorio_fuente AS laboratory,t.cn,coalesce(n.nombre,t.descripcion_excel) AS name,n.dcpf,n.generico AS generic,t.neto::float8 AS net,t.descuento::float8 AS discount FROM farmetrica.genericos_ofertas_laboratorios t LEFT JOIN farmetrica.nomenclator_presentaciones n ON n.cn=t.cn WHERE t.cliente_slug=$1",values:[s.tenant],query_timeout:12000}):Promise.resolve(null)];
   const [sales,buy,direct,tariff]=await Promise.allSettled(jobs),available=x=>x.status==="fulfilled"&&x.value!==null,rows=x=>available(x)?x.value.rows:[];
   const result=laboratorySavings({products:[...rows(sales),...rows(buy)],tariffs:rows(tariff),laboratory:lab,salesAvailable:available(sales),purchasesAvailable:available(buy),tariffsAvailable:available(tariff),direct:rows(direct)[0]||null});
   res.json({...result,from:s.from,to:s.to,laboratory:lab,purchaseAccess:s.canBuy,tariffAccess:s.canTariff,warnings:[!available(sales)?"No se pudieron consultar las ventas.":null,s.canBuy&&!available(buy)?"No se pudieron consultar las compras de productos.":null,s.canBuy&&!available(direct)?"No se pudieron consultar las compras directas.":null,s.canTariff&&!available(tariff)?"No se pudieron consultar las tarifas vigentes.":null].filter(Boolean)});
  }catch(e){next(e)}
 });
}
