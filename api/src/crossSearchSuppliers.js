// El buscador transversal usa exactamente las identidades de laboratorio
// seleccionables en el preparador: proveedor unificado vinculado al código
// Farmatic de cada farmacia. NUNCA usar Nomenclátor ni a.laboratorio.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {readArticleSupplierField} from "./supplierMasterCatalogue.js";
import {hasNativeNormalizedCN} from "./articleSchemaCache.js";
import {resolveDemoSourceScope} from "./demoDataScope.js";

const CN=/^[0-9]{6,7}$/;
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const normalizeCode=expr=>`CASE WHEN btrim(coalesce(${expr}::text,'')) ~ '^[0-9]+$'
 THEN coalesce(nullif(ltrim(btrim(${expr}::text),'0'),''),'0')
 ELSE upper(btrim(coalesce(${expr}::text,''))) END`;
const eligible=`p.activo AND p.clase IN ('DIRECTO','VACUNAS','FÓRMULAS')
 AND upper(p.nombre) !~ '(COOPERATIVA|COOP\\.?|MAYORISTA|DISTRIBUIDOR)'
 AND upper(p.nombre) !~ '(^|[^A-Z])FARMACIAS?([^A-Z]|$)'`;

export function displayCrossSupplierName(value){
 const name=String(value??"").trim();
 if(!name||/^(?:NO\s+PROCEDE|NO\s+APLICA|SIN\s+PROVEEDOR|N\/?A|N\/?D|[-—])$/i.test(name)||
  /^[A-Z]\d{4,}$/i.test(name))return null;
 return name;
}
export function mergeCrossSupplierSources(rows,snapshot=[],habitual=[]){
 const winning=new Map(snapshot.map(x=>[String(x.cn),displayCrossSupplierName(x.proveedor)]));
 const candidate=new Map();
 for(const row of habitual){
  const key=String(row.referencia||"");
  if(!candidate.has(key))candidate.set(key,new Map());
  candidate.get(key).set(String(row.id),displayCrossSupplierName(row.proveedor));
 }
 const habitualFor=key=>{
  const matches=candidate.get(String(key));
  // Un mismo CN puede figurar con habituales diferentes en varias farmacias:
  // no elegir uno arbitrariamente.
  return matches?.size===1?[...matches.values()][0]:null;
 };
 return rows.map(row=>{
  const key=String(row.cn||row.referencia||"");
  const proveedor=winning.has(key)?winning.get(key):habitualFor(key);
  return {...row,proveedor:proveedor||null};
 });
}

export async function resolveCrossSearchSuppliers(pool,ctx,{rows,pharmacies}){
 if(!Array.isArray(rows)||!rows.length)return rows;
 if(!SCHEMA.test(ctx.client.schema))throw Error("Esquema no autorizado");
 const selected=[...new Set(pharmacies.map(Number))];
 const cns=[...new Set(rows.map(r=>String(r.cn||"")).filter(x=>CN.test(x)))];
 const refs=new Set(rows.map(r=>String(r.referencia)));
 let snapshot=[];
 try{
  const scope=ctx.client.demo?await resolveDemoSourceScope(pool,ctx,selected):null;
  if(!ctx.client.demo||scope){
   const slug=scope?.slug||ctx.client.slug,ids=scope?.ids||selected;
   const {rows:found}=await pool.query({text:`
    SELECT cache.cn,p.nombre AS proveedor
    FROM farmetrica.preparador_ultima_recepcion_cache cache
    JOIN farmetrica.proveedores_unificados original
     ON original.cliente_slug=cache.cliente_slug AND original.id=cache.lab_id
    JOIN farmetrica.proveedores_unificados p
     ON p.cliente_slug=$2 AND p.clave_unificada=original.clave_unificada
    WHERE cache.cliente_slug=$1 AND cache.cn=ANY($4::text[])
     AND (cache.pharmacy_ids && $3::int[]
      OR cache.pharmacy_ids && ARRAY(
       SELECT f.id FROM farmetrica.farmacias f
       WHERE f.cliente_slug=$1 AND f.cliente_slug='ampedia'
        AND f.tipo_establecimiento='almacen'
        AND upper(btrim(f.codigo_origen))='ALMACEN'))
     AND ${eligible}`,
    values:[slug,ctx.client.slug,ids,cns],query_timeout:7000});
   snapshot=found;
  }
 }catch(error){
  console.warn("PREPARADOR_PROVEEDOR_ULTIMA_RECEPCION",error.code||error.name||"QUERY_ERROR");
 }
 const winning=new Set(snapshot.map(x=>String(x.cn)));
 const unresolved=rows.filter(r=>!winning.has(String(r.cn||"")));
 if(!unresolved.length)return mergeCrossSupplierSources(rows,snapshot);
 let habitual=[];
 try{
  const [field,nativeCN]=await Promise.all([
   readArticleSupplierField(pool,ctx.client.schema),
   hasNativeNormalizedCN(pool,ctx.client.schema).catch(()=>false)
  ]);
  if(field){
   const schema='"'+ctx.client.schema+'"',normalized=nativeCN?
    "a.cn_normalizado":"to_jsonb(a)->>'cn_normalizado'";
   const valid=expr=>`CASE WHEN btrim(coalesce(${expr}::text,'')) ~ '^[0-9]{6,7}$'
    THEN btrim(${expr}::text) END`;
   const cn=`coalesce(${valid("a.codigo_nacional")},${valid(normalized)},
    ${valid("a.origen_id")})`;
   const missingCN=[...new Set(unresolved.map(r=>String(r.cn||"")).filter(x=>CN.test(x)))];
   const missingERP=unresolved.map(r=>String(r.referencia)).filter(x=>/^ERP:\d+:[A-Za-z0-9._:-]{1,90}$/.test(x));
   const {rows:found}=await pool.query({text:`
    WITH chosen AS MATERIALIZED (
     SELECT f.id,${pharmacyDataCodeSQL("f")} AS code
     FROM farmetrica.farmacias f WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[])
    ), matched AS MATERIALIZED (
     SELECT ${cn} AS cn,('ERP:'||f.id::text||':'||a.origen_id::text) AS erp,
      f.code,${normalizeCode("a."+field)} AS supplier
     FROM "${ctx.client.schema}".articulos a
     JOIN chosen f ON upper(btrim(a.farmacia_codigo))=f.code
     WHERE btrim(a.codigo_nacional::text)=ANY($3::text[])
      OR btrim(coalesce(${normalized}::text,''))=ANY($3::text[])
      OR a.origen_id::text=ANY($3::text[])
      OR ('ERP:'||f.id::text||':'||a.origen_id::text)=ANY($4::text[])
    )
    SELECT coalesce(m.cn,m.erp) AS referencia,
     p.id::text AS id,p.nombre AS proveedor
    FROM matched m
    JOIN farmetrica.proveedores_unificados_alias alias
     ON alias.cliente_slug=$1 AND upper(btrim(alias.farmacia_codigo))=m.code
      AND ${normalizeCode("alias.codigo_origen")}=m.supplier
    JOIN farmetrica.proveedores_unificados p
     ON p.id=alias.proveedor_id AND p.cliente_slug=$1 AND ${eligible}
    WHERE coalesce(m.cn,m.erp)=ANY($5::text[])
    GROUP BY 1,2,3`,
    values:[ctx.client.slug,selected,missingCN,missingERP,[...refs]],query_timeout:15000});
   habitual=found;
  }
 }catch(error){
  console.warn("PREPARADOR_PROVEEDOR_HABITUAL",error.code||error.name||"QUERY_ERROR");
 }
 return mergeCrossSupplierSources(rows,snapshot,habitual);
}
