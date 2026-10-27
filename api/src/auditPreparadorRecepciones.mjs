// Auditoría de solo lectura: recuento de opciones reales en el selector del preparador.
import pg from "pg";
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
 console.log("PREPARADOR_AUDIT",JSON.stringify({pharmacies:scope.length,dropdown:labs.length,allSuppliers:raw[0].total}));
}catch(e){console.log("PREPARADOR_AUDIT",JSON.stringify({error:e.code||e.message}))}
finally{await db.end()}
