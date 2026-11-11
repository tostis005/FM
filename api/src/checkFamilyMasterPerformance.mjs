// Auditoría de producción del maestro: no lee fichas de artículo ni códigos CN.
import pg from "pg";
import {setupFamilyMaster} from "./familyMaster.js";
if(!process.env.DATABASE_URL)throw Error("DATABASE_URL ausente");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,
 connectionTimeoutMillis:8000,query_timeout:10000,statement_timeout:10000});
const routes=new Map();
const app={get(path,...stack){routes.set(path,stack.at(-1))},
 put(){},post(){}};
setupFamilyMaster(app,pool,{requireTenantManager:()=>[]});
const ctx={client:{slug:"ampedia",schema:"ampedia"},pharmacies:[]};
async function invoke(path,query={},id){
 let code=200,body=null,error=null;
 const started=Date.now(),handler=routes.get(path);
 if(!handler)throw Error("Ruta no registrada: "+path);
 await handler({context:ctx,query,params:{id}},{
  status(n){code=n;return this},
  json(value){body=value;return this}
 },e=>{error=e});
 if(error)throw error;
 if(code!==200||!body)throw Error("Petición sin respuesta correcta");
 return {body,elapsedMs:Date.now()-started};
}
try{
 const main=await invoke("/api/tenant/familias-globales");
 const {items,summary}=main.body;
 if(!Array.isArray(items)||items.length<10||items.length>150)
  throw Error("La pantalla principal debe mostrar solo familias globales consolidadas");
 const detail=await invoke("/api/tenant/familias-globales/:id/origenes",{},items[0].id);
 if(!Array.isArray(detail.body.items))throw Error("No se recuperan nombres locales");
 console.log("FAMILIAS_MAESTRO_RAPIDO",JSON.stringify({
  familiasMostradas:items.length,medicacion:summary.medicacion,
  parafarmacia:summary.parafarmacia,pendientesSeparadas:summary.pendientes,
  consultaInicialMs:main.elapsedMs,nombresLocalesMs:detail.elapsedMs,
  nombresLocalesMuestra:detail.body.items.length
 }));
 if(main.elapsedMs>9000)throw Error("La carga de familias sigue siendo demasiado lenta");
}finally{await pool.end()}
