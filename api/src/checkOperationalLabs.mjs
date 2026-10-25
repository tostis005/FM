// Diagnóstico agregado y de solo lectura tras desplegar el filtro operativo.
// No publica proveedores, artículos, CN, farmacia individual ni datos de ventas.
import pg from "pg";
import {listOperationalLaboratoryOptions} from "./laboratoryCatalog.js";
const db=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,
 connectionTimeoutMillis:5000,statement_timeout:30000,query_timeout:35000});
const started=Date.now(),out={};
try{
 const {rows:tenants}=await db.query("SELECT esquema_datos FROM farmetrica.clientes WHERE slug='ampedia'");
 const schema=tenants[0]?.esquema_datos;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema||""))throw Error("Tenant no disponible");
 const {rows:pharmacies}=await db.query(
  "SELECT id FROM farmetrica.farmacias WHERE cliente_slug='ampedia' ORDER BY id");
 const ctx={client:{slug:"ampedia",schema},pharmacies};
 out.pharmacies=pharmacies.length;
 const labs=await listOperationalLaboratoryOptions(db,ctx,pharmacies.map(x=>Number(x.id)));
 out.laboratories=labs.length;
 out.includesCinfa=labs.some(l=>l.key==="N:CINFA");
 out.hasCNorReceipt=labs.every(l=>l.hasMedication||l.hasParapharmacy);
}catch(e){out.error=e.code||e.name||"Error";out.detail=String(e.message||"").slice(0,150)}
finally{out.elapsedMs=Date.now()-started;console.log("PREPARADOR_LABS_PROD",JSON.stringify(out));await db.end()}
