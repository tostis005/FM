// Resolución de nombres ERP por cliente y FARMACIA.
// Los códigos de vendedor/proveedor se repiten entre farmacias; nunca unir
// solo por ID ni por nombre. Aceptar catálogo aún no sincronizado sin fallar.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const normalize=value=>String(value??"").trim().toUpperCase();
const label=value=>String(value??"").trim();
const composite=(id,code)=>String(id)+"|"+normalize(code);
const keysOf=items=>[...new Set(items.map(normalize).filter(Boolean))].slice(0,2000);

export async function loadCommercialNames(pool,context,entries=[]){
 const {client,allowedPharmacyIds}=context||{};
 if(!client||!SCHEMA.test(client.schema)||!SCHEMA.test(client.slug))
  throw Error("Contexto de cliente no autorizado");
 const allowed=new Set((allowedPharmacyIds||[]).map(Number));
 const suppliers=new Map(),sellers=new Map(),master=new Map();
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
    SELECT upper(btrim(codigo_origen)) AS code,btrim(nombre) AS name
    FROM farmetrica.proveedores_maestro WHERE cliente_slug=$1
      AND upper(btrim(codigo_origen))=ANY($2::text[])
      AND nullif(btrim(nombre),'') IS NOT NULL`,[client.slug,supplierCodes]
  ).then(({rows})=>{for(const row of rows)master.set(normalize(row.code),label(row.name))}):Promise.resolve()
 ]);
 const supplierKnown=(id,code)=>suppliers.has(composite(id,code))||master.has(normalize(code));
 const sellerKnown=(id,code)=>sellers.has(composite(id,code));
 return {
  supplier:(id,code)=>suppliers.get(composite(id,code))||master.get(normalize(code))||fallback(code),
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
