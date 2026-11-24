// Medición explícita en producción: solo lectura, no imprime datos comerciales.
import pg from "pg";
import {setupSalesLaboratories} from "./salesLaboratories.js";
if(process.env.FM_BENCHMARK_READONLY!=="1")throw Error("Solo benchmarking explícito");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000,
 statement_timeout:30000,query_timeout:35000,
 options:"-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=4000"});
try{
 const {rows:[scope]}=await pool.query("SELECT array_agg(id ORDER BY id) AS ids,to_char(date_trunc('month',timezone('Europe/Madrid',now()))-interval '5 months','YYYY-MM-DD') AS desde,to_char(timezone('Europe/Madrid',now()),'YYYY-MM-DD') AS hasta FROM farmetrica.farmacias WHERE cliente_slug='ampedia' AND activo=true AND coalesce(tipo_establecimiento,'farmacia')='farmacia'");
 if(!scope?.ids?.length)throw Error("No hay farmacias de prueba");
 const routes=new Map();
 setupSalesLaboratories({get:(path,...handlers)=>routes.set(path,handlers.at(-1))},pool,{requireTenantModule:()=>[]});
 const context={role:"gestor",client:{slug:"ampedia",schema:"ampedia"},allowedPharmacyIds:scope.ids,modules:{ventas:true,compras:true,genericos:true},sections:{ventas:true,compras:true,genericos:true}};
 const route=routes.get("/api/analytics/ventas/laboratorios/analisis");
 for(const laboratorio of ["3M","BIODERMA - NAOS SKIN CARE SPAIN SLU","CINFA","NORMON"]){
  for(const parte of ["ventas","ahorro","compras","directas"]){
   const start=Date.now();
   const res={code:200,status(code){this.code=code;return this},json(body){this.body=body;return this}};
   try{
    await route({context,query:{laboratorio,parte,farmacias:scope.ids.join(","),desde:scope.desde,hasta:scope.hasta}},res,e=>{throw e});
    const b=res.body||{},ok=res.code===200&&!(b.warnings||[]).some(w=>!w.startsWith("Hay referencias de compras directas sin pertenencia verificada"))&&(parte==="ventas"?b.salesAvailable===true&&Array.isArray(b.products)&&(["3M","BIODERMA - NAOS SKIN CARE SPAIN SLU"].includes(laboratorio)||b.products.length>0):parte==="ahorro"?b.salesAvailable===true&&b.tariffsAvailable===true:parte==="compras"?b.purchasesAvailable===true:true);
    console.log("FM_LAB_BENCH",laboratorio,parte,Date.now()-start,"ms",ok?"OK":"ERROR",parte==="directas"&&b.summary?.directUnattributedReferences>0?"UNATTRIBUTED_PRESENT":parte==="ventas"?(b.products?.length?"PRODUCTS_FOUND":"NO_VERIFIED_PRODUCTS"):"");
    if(!ok||parte==="ventas"&&Date.now()-start>25000)process.exitCode=1;
   }catch(e){console.log("FM_LAB_BENCH",laboratorio,parte,Date.now()-start,"ms","ERROR",e.code||e.name);process.exitCode=1;}
  }
 }
}catch(e){console.log("FM_LAB_BENCH_ERROR",e.code||e.name);process.exitCode=1}
finally{await pool.end()}
