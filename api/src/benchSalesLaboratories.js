// Medición explícita en producción: solo lectura, no imprime datos comerciales.
import pg from "pg";
import {setupSalesLaboratories} from "./salesLaboratories.js";
import {normalizeLabName} from "./laboratoryIdentity.js";
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
 const selector={json(body){this.body=body}};
 await routes.get("/api/analytics/ventas/laboratorios")({context,query:{farmacias:scope.ids.join(",")}},selector,e=>{throw e});
 const choices=selector.body.items;
 for(const laboratorio of ["3M","BIODERMA - NAOS SKIN CARE SPAIN SLU","CINFA","NORMON"]){
  const names=laboratorio.startsWith("BIODERMA")?[laboratorio,"BIODERMA","NAOS SKIN CARE SPAIN SLU"]:[laboratorio];
  const selected=choices.find(x=>names.some(n=>normalizeLabName(x.name)===normalizeLabName(n)));
  if(!selected){console.log("FM_LAB_BENCH",laboratorio,"NOT_IN_PLANNER");process.exitCode=1;continue;}
  for(const parte of ["ventas","ahorro","compras","directas"]){
   const start=Date.now();
   const res={code:200,status(code){this.code=code;return this},json(body){this.body=body;return this}};
   try{
    await route({context,query:{laboratorio:selected.key,parte,farmacias:scope.ids.join(","),desde:scope.desde,hasta:scope.hasta}},res,e=>{throw e});
    const b=res.body||{},ok=res.code===200&&!(b.warnings||[]).some(w=>!w.startsWith("Hay referencias de compras directas fuera del catálogo"))&&(parte==="ventas"?b.salesAvailable===true&&Array.isArray(b.products)&&b.plannerCatalogue===true&&b.catalogReferences>0&&b.products.length>0:parte==="ahorro"?b.salesAvailable===true&&b.tariffsAvailable===true&&(!["CINFA","NORMON"].includes(laboratorio)||b.summary?.comparableProducts>0):parte==="compras"?b.purchasesAvailable===true:true);
    console.log("FM_LAB_BENCH",laboratorio,parte,Date.now()-start,"ms",ok?"OK":"ERROR",parte==="directas"?(b.summary?.directUnattributedReferences>0?"UNATTRIBUTED_PRESENT":"RECONCILED"):parte==="ventas"?(b.products?.length?"PRODUCTS_FOUND":"NO_VERIFIED_PRODUCTS"):parte==="ahorro"?(b.summary?.potentialSaving>0?"SAVINGS_FOUND":b.summary?.comparableProducts>0?"NO_POSITIVE_SAVINGS":"NO_COMPARABLE_GENERICS"):"");
    if(parte==="ahorro")console.log("FM_LAB_COVERAGE",laboratorio,JSON.stringify({hasGenericSales:b.summary?.genericSoldProducts>0,hasOriginTariff:b.summary?.originTariffProducts>0,hasAlternativeTariff:b.summary?.alternativeTariffProducts>0,hasComparable:b.summary?.comparableProducts>0,hasSaving:b.summary?.potentialSaving>0}));
    if(!ok||parte==="ventas"&&Date.now()-start>25000)process.exitCode=1;
   }catch(e){console.log("FM_LAB_BENCH",laboratorio,parte,Date.now()-start,"ms","ERROR",e.code||e.name);process.exitCode=1;}
  }
 }
}catch(e){console.log("FM_LAB_BENCH_ERROR",e.code||e.name);process.exitCode=1}
finally{await pool.end()}
