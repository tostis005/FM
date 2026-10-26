// Refresco secuencial de agregados histórico; nunca modifica datos del ERP.
// Ejecutable después del despliegue con credenciales de API dentro del VPS.
import pg from "pg";
import {createDashboardConsolidationService} from "./dashboardConsolidationService.js";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,
 connectionTimeoutMillis:5000,statement_timeout:90000,query_timeout:95000});
const n=Number(process.env.FM_DASHBOARD_BACKFILL_MONTHS||40);
if(!Number.isSafeInteger(n)||n<1||n>90)throw Error("Meses de backfill no válidos");
const service=createDashboardConsolidationService(pool);
try{
 const days=await service.backfillDays({months:3,maxMs:120000,
  onMonth:r=>console.info("DASHBOARD_DIARIO_MONTH",JSON.stringify(r))});
 console.info("DASHBOARD_DIARIO_BACKFILL",JSON.stringify(days));
 const result=await service.backfill({months:n,maxMs:420000,
  onMonth:r=>console.info("DASHBOARD_CONSOLIDADO_MONTH",JSON.stringify(r))});
 console.info("DASHBOARD_CONSOLIDADO_BACKFILL",JSON.stringify(result));
 if(result.failures||days.failures)process.exitCode=1;
}catch(e){
 console.error("DASHBOARD_CONSOLIDADO_ERROR",e.code||e.name);
 process.exitCode=1;
}finally{await pool.end()}
