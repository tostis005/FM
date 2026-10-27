// Auditoría de solo lectura: recuento de opciones reales en el selector del preparador.
import pg from "pg";
import {readFile} from "node:fs/promises";
import {listUnifiedSuppliers} from "./unifiedSuppliers.js";
const db=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,query_timeout:150000});
try{
 const {rows:ts}=await db.query("SELECT esquema_datos FROM farmetrica.clientes WHERE slug='ampedia'");
 const schema=ts[0]?.esquema_datos;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema||""))throw Error("Esquema inválido");
 const {rows:p}=await db.query("SELECT id FROM farmetrica.farmacias WHERE cliente_slug='ampedia'");
 const scope=p.map(x=>Number(x.id));
 const labs=await listUnifiedSuppliers(db,{client:{schema,slug:"ampedia"}},scope,true);
 const {rows:raw}=await db.query("SELECT count(*)::int AS total FROM farmetrica.proveedores_unificados WHERE cliente_slug=$1",["ampedia"]);
 const sql=await readFile(new URL("./auditPreparadorRecepciones.sql",import.meta.url),"utf8");
 const ids=labs.map(l=>l.id);
 const codes=[...new Set(labs.flatMap(l=>l.origins.map(o=>String(o.pharmacyCode).toUpperCase())))];
 const {rows:counts}=await db.query({text:sql,values:[ids,codes],query_timeout:150000});
 console.log("PREPARADOR_AUDIT",JSON.stringify({pharmacies:scope.length,
  dropdown:labs.length,allSuppliers:raw[0].total,...counts[0]}));
}catch(e){console.log("PREPARADOR_AUDIT",JSON.stringify({error:e.code||e.message}))}
finally{await db.end()}
