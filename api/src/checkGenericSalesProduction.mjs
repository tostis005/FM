// Comprobación operativa de solo lectura. No publica importes, CN ni farmacia.
import pg from "pg";
import {setupGenericosOfertas} from "./genericosOfertas.js";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000,statement_timeout:30000,query_timeout:35000,options:"-c lock_timeout=3s"});
const routes=new Map(),app={get:(p,...h)=>routes.set(p,h.at(-1)),post:(p,...h)=>routes.set(p,h.at(-1)),put(){},patch(){},delete(){}};
let stage="context";
const output={};
try{
 const {rows:[tenant]}=await pool.query("SELECT esquema_datos AS schema FROM farmetrica.clientes WHERE slug='ampedia' AND activo");
 if(!tenant)throw Error("Cliente no disponible");
 const {rows:sites}=await pool.query("SELECT id FROM farmetrica.farmacias WHERE cliente_slug='ampedia' AND activo AND tipo_establecimiento='farmacia'");
 const context={client:{slug:"ampedia",schema:tenant.schema},role:"gestor",modules:{genericos:true},allowedPharmacyIds:sites.map(x=>Number(x.id))};
 setupGenericosOfertas(app,pool,{requireTenantModule:()=>[]});
 const call=async(path,query={},body={})=>{
  const res={code:200,status(c){this.code=c;return this},json(data){this.data=data;return this}};
  const start=Date.now();
  await routes.get(path)({context,query,body},res,e=>{throw e});
  output[stage]={http:res.code,ms:Date.now()-start};
  if(res.code!==200)throw Error("HTTP "+res.code);
  return res.data;
 };
 stage="molecules";
 const molecules=await call("/api/genericos/ofertas/moleculas");
 output.molecules.count=molecules.items.length;
 if(!molecules.items.length)throw Error("Nomenclátor vacío");
 stage="filters";
 const filters=await call("/api/genericos/ofertas/filtros",{molecula:molecules.items.find(x=>x==="PARACETAMOL")||molecules.items[0]});
 output.filters.groups=filters.items.length;
 if(!filters.items.length)throw Error("Nomenclátor vacío");
 stage="catalog";
 const catalog=await call("/api/genericos/ofertas/catalogo");
 output.catalog.groups=catalog.items.length;
 const groups=catalog.items.filter(x=>String(x.principle).toUpperCase().includes("PARACETAMOL")).slice(0,5);
 const dcpfs=(groups.length?groups:catalog.items.slice(0,5)).map(x=>String(x.dcpf));
 if(!dcpfs.length)throw Error("No hay presentaciones tarifadas");
 const {rows:[dates]}=await pool.query("SELECT (date_trunc('month',current_date)-interval '11 months')::date::text AS desde,current_date::text AS hasta");
 stage="sales";
 const result=await call("/api/genericos/ofertas/ventas",{}, {...dates,dcpfs,farmacias:context.allowedPharmacyIds,detail:true});
 output.sales.available=result.salesAvailable;
 output.sales.complete=result.items?.length===dcpfs.length;
 output.sales.validUnits=result.items?.every(x=>Number.isFinite(x.units)&&Array.isArray(x.pharmacies)&&Array.isArray(x.cns));
 output.sales.consistentDetail=result.items?.every(x=>Math.abs(x.units-x.cns.reduce((sum,c)=>sum+c.units,0))<0.000001);
 output.sales.hasPositiveUnits=result.items?.some(x=>Number(x.units)>0);
 if(!output.sales.available||!output.sales.complete||!output.sales.validUnits||!output.sales.consistentDetail)throw Error("Ventas incompletas o desglose incoherente");
 stage="opportunities";
 const opp=await call("/api/genericos/ofertas/oportunidades",{...dates,farmacias:context.allowedPharmacyIds.join(","),dcpf:dcpfs[0]});
 output.opportunities.available=opp.salesAvailable;
 if(!opp.salesAvailable)throw Error("Oportunidades sin ventas");
 output.ok=true;
}catch(e){output.ok=false;output.stage=stage;output.code=e.code||e.name;process.exitCode=1}
finally{console.log("FM_GENERIC_PRODUCTION_CHECK",JSON.stringify(output));await pool.end()}
