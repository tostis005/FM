// Auditoría puntual, exclusivamente de lectura, tras desplegar modo última recepción.
// Publica únicamente contadores agregados, sin CN ni identidades locales.
import pg from "pg";
import {latestLaboratoryCN} from "./preparadorLastReceipt.js";
import {listUnifiedSuppliers} from "./unifiedSuppliers.js";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,
 connectionTimeoutMillis:5000,query_timeout:95000,statement_timeout:95000});
const out={mode:"last_valid_receipt",tenant:"ampedia"};
const old=process.env.FM_PREPARADOR_ULTIMA_RECEPCION;
try{
 const {rows:tenants}=await pool.query("SELECT esquema_datos FROM farmetrica.clientes WHERE slug=$1",["ampedia"]);
 const schema=tenants[0]?.esquema_datos;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema||""))throw Error("Esquema inválido");
 const {rows:ph}=await pool.query("SELECT id FROM farmetrica.farmacias WHERE cliente_slug=$1",["ampedia"]);
 const ids=ph.map(f=>Number(f.id));
 const ctx={client:{slug:"ampedia",schema}};
 out.pharmacies=ids.length;
 process.env.FM_PREPARADOR_ULTIMA_RECEPCION="0";
 const before=await listUnifiedSuppliers(pool,ctx,ids,true);
 out.previousLabs=before.length;
 process.env.FM_PREPARADOR_ULTIMA_RECEPCION="1";
 const start=Date.now();
 const now=await listUnifiedSuppliers(pool,ctx,ids,true);
 out.elapsedMs=Date.now()-start;
 const snapshot=await latestLaboratoryCN(pool,ctx,ids);
 out.currentLabs=now.length;
 out.removedFromDropdown=before.length-now.length;
 out.uniqueCN=snapshot.total;
 out.medicationCN=[...snapshot.byLab.values()].reduce((n,rows)=>n+rows.filter(r=>r.tipo==="medicacion").length,0);
 out.parapharmacyCN=snapshot.total-out.medicationCN;
 out.valid=out.currentLabs<=out.previousLabs&&out.uniqueCN>=out.currentLabs;
}catch(e){out.error=e.code||e.name||"ERROR";out.detail=String(e.message||"").slice(0,140)}
finally{
 if(old===undefined)delete process.env.FM_PREPARADOR_ULTIMA_RECEPCION;
 else process.env.FM_PREPARADOR_ULTIMA_RECEPCION=old;
 console.log("PREPARADOR_ULTIMA_RECEPCION_AUDIT",JSON.stringify(out));
 await pool.end();
}
