// Resolución de nombres ERP por cliente y FARMACIA.
// Los códigos de vendedor/proveedor se repiten entre farmacias; nunca unir
// solo por ID ni por nombre. Aceptar catálogo aún no sincronizado sin fallar.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {normalizeLabName} from "./laboratoryIdentity.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const normalize=value=>String(value??"").trim().toUpperCase();
const label=value=>String(value??"").trim();
const composite=(id,code)=>String(id)+"|"+normalize(code);
const canonicalCode=value=>{const code=normalize(value);return /^\d+$/.test(code)?code.replace(/^0+(?=\d)/,""):code};
const mappingKey=(id,code)=>String(id)+"|"+canonicalCode(code);
const keysOf=items=>[...new Set(items.map(normalize).filter(Boolean))].slice(0,2000);

export async function loadCommercialNames(pool,context,entries=[]){
 const {client,allowedPharmacyIds}=context||{};
 if(!client||!SCHEMA.test(client.schema)||!SCHEMA.test(client.slug))
  throw Error("Contexto de cliente no autorizado");
 const allowed=new Set((allowedPharmacyIds||[]).map(Number));
 const suppliers=new Map(),sellers=new Map(),master=new Map(),mapped=new Map(),globalMapped=new Map();
 const supplierCodes=keysOf(entries.filter(x=>allowed.has(Number(x.pharmacyId))).map(x=>x.supplierCode));
 const sellerCodes=keysOf(entries.filter(x=>allowed.has(Number(x.pharmacyId))).map(x=>x.sellerId));
 const pharmacyIds=[...new Set(entries.filter(x=>allowed.has(Number(x.pharmacyId)))
  .map(x=>Number(x.pharmacyId)))];
 const fallback=code=>label(code)||"—";
 if(!pharmacyIds.length||!supplierCodes.length&&!sellerCodes.length)
  return {supplier:(id,code)=>fallback(code),seller:(id,code)=>fallback(code),
   supplierKnown:()=>false,sellerKnown:()=>false};

 const {rows:columns}=await pool.query(
  "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name IN ('proveedores','vendedores')",
  [client.schema]);
 const available=(table,...names)=>names.every(name=>columns.some(r=>r.table_name===table&&r.column_name===name));
 const schema='"'+client.schema+'"';
 // Los primeros clientes FM utilizaban un catálogo proveedores(id,nombre)
 // sin farmacia_codigo. Sólo es seguro resolverlo si el tenant tiene UNA farmacia.
 // De otro modo el mismo ID puede identificar empresas diferentes.
 if(supplierCodes.length&&!available("proveedores","farmacia_codigo","origen_id","nombre")&&
     available("proveedores","id","nombre")){
  const {rows:pharmacyCount}=await pool.query(
   "SELECT count(*)::int AS total FROM farmetrica.farmacias WHERE cliente_slug=$1",[client.slug]);
  if(Number(pharmacyCount[0]?.total)===1){
   const {rows:legacy}=await pool.query(`
    SELECT upper(btrim(id::text)) AS code,btrim(nombre::text) AS name
    FROM ${schema}.proveedores
    WHERE upper(btrim(id::text))=ANY($1::text[])
      AND nullif(btrim(nombre::text),'') IS NOT NULL`,[supplierCodes]);
   for(const row of legacy)master.set(normalize(row.code),label(row.name));
  }
 }
 async function fill(table,codes,destination){
  if(!codes.length||!available(table,"farmacia_codigo","origen_id","nombre"))return;
  const order=available(table,"sincronizado_en")?"m.sincronizado_en DESC NULLS LAST,":"";
  const {rows}=await pool.query(`
   SELECT DISTINCT ON (f.id,upper(btrim(m.origen_id::text)))
    f.id::text AS "pharmacyId",upper(btrim(m.origen_id::text)) AS code,
    btrim(m.nombre::text) AS name
   FROM ${schema}."${table}" m
   JOIN farmetrica.farmacias f ON f.cliente_slug=$1
    AND upper(btrim(m.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
   WHERE f.id=ANY($2::int[]) AND upper(btrim(m.origen_id::text))=ANY($3::text[])
    AND nullif(btrim(m.nombre::text),'') IS NOT NULL
   ORDER BY f.id,upper(btrim(m.origen_id::text)),${order}m.nombre`,
   [client.slug,pharmacyIds,codes]);
  for(const row of rows)destination.set(composite(row.pharmacyId,row.code),label(row.name));
 }
 // Las tres consultas son independientes y agrupadas; nunca N+1.
 await Promise.all([
  fill("proveedores",supplierCodes,suppliers),
  fill("vendedores",sellerCodes,sellers),
  supplierCodes.length?pool.query(`
    SELECT upper(btrim(codigo_origen)) AS code,btrim(nombre) AS name,
      laboratorio_clave AS key,cooperativa,ignorar_informes
    FROM farmetrica.proveedores_maestro WHERE cliente_slug=$1
      AND upper(btrim(codigo_origen))=ANY($2::text[])
      AND nullif(btrim(nombre),'') IS NOT NULL`,[client.slug,supplierCodes]
  ).then(({rows})=>{for(const row of rows){
   master.set(normalize(row.code),label(row.name));
   if(row.key&&!row.cooperativa&&!row.ignorar_informes)
    globalMapped.set(canonicalCode(row.code),{name:row.name,key:row.key});
  }}):Promise.resolve(),
  supplierCodes.length?pool.query(`
   SELECT m.farmacia_id::text AS "pharmacyId",m.codigo_proveedor AS code,
    m.laboratorio_clave AS key,own.nombre AS custom_name
   FROM farmetrica.proveedores_laboratorios m
   LEFT JOIN farmetrica.laboratorios_personalizados own
     ON own.cliente_slug=m.cliente_slug AND own.laboratorio_clave=m.laboratorio_clave
   WHERE m.cliente_slug=$1 AND m.farmacia_id=ANY($2::int[])`,
   [client.slug,pharmacyIds]).then(({rows})=>{
    for(const row of rows){
     const name=row.custom_name|| (row.key?.startsWith("N:")?row.key.slice(2):null);
     if(name)mapped.set(mappingKey(row.pharmacyId,row.code),name);
    }
   }):Promise.resolve()
 ]);
 const standardizedSupplier=(id,code)=>{
  const localName=suppliers.get(composite(id,code));
  const exact=mapped.get(mappingKey(id,code));
  if(exact)return exact;
  const global=globalMapped.get(canonicalCode(code));
  // Una equivalencia global solo aplica si también coincide el nombre
  // del proveedor real en ESTA farmacia.
  if(global&&localName&&normalizeLabName(global.name)===normalizeLabName(localName)
   &&global.key.startsWith("N:"))return global.key.slice(2);
  return localName||master.get(normalize(code))||fallback(code);
 };
 const supplierKnown=(id,code)=>Boolean(mapped.has(mappingKey(id,code))||
   suppliers.has(composite(id,code))||master.has(normalize(code)));
 const sellerKnown=(id,code)=>sellers.has(composite(id,code));
 return {
  supplier:standardizedSupplier,
  seller:(id,code)=>sellers.get(composite(id,code))||fallback(code),
  supplierKnown,sellerKnown
 };
}

export async function nameCommercialRows(pool,context,rows,{
 supplierCode="supplierCode",sellerCode="sellerId",pharmacy="pharmacyId"
}={}){
 if(!rows?.length)return rows||[];
 const names=await loadCommercialNames(pool,context,rows.map(row=>({
  pharmacyId:row[pharmacy],supplierCode:row[supplierCode],sellerId:row[sellerCode]
 })));
 return rows.map(row=>{
  const next={...row},id=row[pharmacy];
  if(row[supplierCode]!==undefined&&row[supplierCode]!==null)
   next.supplierName=names.supplier(id,row[supplierCode]);
  if(row[sellerCode]!==undefined&&row[sellerCode]!==null)
   next.sellerName=names.seller(id,row[sellerCode]);
  return next;
 });
}

export async function listCommercialSuppliers(pool,context,pharmacyId){
 const {client,allowedPharmacyIds}=context||{};
 if(!client||!SCHEMA.test(client.schema)||!SCHEMA.test(client.slug))
  throw Error("Contexto de cliente no autorizado");
 if(!Number.isSafeInteger(Number(pharmacyId))||
   !(allowedPharmacyIds||[]).map(Number).includes(Number(pharmacyId)))
  throw Object.assign(Error("Farmacia no autorizada"),{status:403});
 const {rows:master}=await pool.query(`
  SELECT upper(btrim(codigo_origen)) AS code,btrim(nombre) AS name
  FROM farmetrica.proveedores_maestro WHERE cliente_slug=$1
   AND nullif(btrim(codigo_origen),'') IS NOT NULL
   AND nullif(btrim(nombre),'') IS NOT NULL`,[client.slug]);
 const map=new Map(master.map(r=>[normalize(r.code),label(r.name)]));
 const {rows:columns}=await pool.query(
  "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='proveedores'",[client.schema]);
 const names=new Set(columns.map(x=>x.column_name));
 if(["farmacia_codigo","origen_id","nombre"].every(x=>names.has(x))){
  const schema='"'+client.schema+'"';
  const order=names.has("sincronizado_en")?"m.sincronizado_en DESC NULLS LAST,":"";
  const {rows}=await pool.query(`
   SELECT DISTINCT ON (upper(btrim(m.origen_id::text)))
    upper(btrim(m.origen_id::text)) AS code,btrim(m.nombre) AS name
   FROM ${schema}.proveedores m
   JOIN farmetrica.farmacias f ON f.cliente_slug=$1 AND f.id=$2
    AND upper(btrim(m.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
   WHERE nullif(btrim(m.origen_id::text),'') IS NOT NULL
    AND nullif(btrim(m.nombre),'') IS NOT NULL
   ORDER BY upper(btrim(m.origen_id::text)),${order}m.nombre`,
   [client.slug,Number(pharmacyId)]);
  for(const row of rows)map.set(normalize(row.code),label(row.name));
 }
 return [...map].map(([code,name])=>({code,name}))
  .sort((a,b)=>a.name.localeCompare(b.name,"es")||a.code.localeCompare(b.code,"es"));
}
