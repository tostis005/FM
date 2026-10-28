// Sólo lectura. Diagnostica TODAS las identidades del maestro y las que
// llegan al preparador. No modifica correspondencias ni movimientos.
import pg from "pg";
import {proposeLaboratoryMerges,canonicalLabName} from "./laboratoryMergeCandidates.js";
import {latestLaboratoryCN} from "./preparadorLastReceipt.js";
import {listUnifiedSuppliers} from "./unifiedSuppliers.js";
const db=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,
 connectionTimeoutMillis:5000,query_timeout:115000,statement_timeout:115000});
const out={tenant:"ampedia",readonly:true};
try{
 const {rows:t}=await db.query("SELECT esquema_datos FROM farmetrica.clientes WHERE slug='ampedia'");
 const schema=t[0]?.esquema_datos;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema||""))throw Error("Esquema desconocido");
 const {rows:ph}=await db.query("SELECT id FROM farmetrica.farmacias WHERE cliente_slug='ampedia'");
 const ids=ph.map(x=>Number(x.id));
 const {rows:master}=await db.query(`SELECT id::text, nombre AS name, clase AS class,
  activo AS active, clave_unificada AS origin
  FROM farmetrica.proveedores_unificados WHERE cliente_slug='ampedia'`);
 const {rows:aliases}=await db.query(`SELECT proveedor_id::text AS id,count(*)::int AS total,
  count(*) FILTER(WHERE procedencia='manual')::int AS manual
  FROM farmetrica.proveedores_unificados_alias WHERE cliente_slug='ampedia'
  GROUP BY proveedor_id`);
 const sizes=new Map(aliases.map(x=>[x.id,x.total]));
 const protectedIds=new Set(aliases.filter(x=>x.manual>0).map(x=>x.id));
 const proposed=proposeLaboratoryMerges(master,sizes,protectedIds);
 const ctx={client:{slug:"ampedia",schema}};
 const current=await listUnifiedSuppliers(db,ctx,ids,true);
 const currentIds=new Set(current.map(x=>String(x.id)));
 const snapshot=await latestLaboratoryCN(db,ctx,ids);
 const visible=proposed.operations.filter(x=>currentIds.has(x.from)||currentIds.has(x.to));
 const affected=new Set(visible.flatMap(x=>[x.to,x.from]).filter(id=>currentIds.has(id)));
 out.masterSuppliers=master.length;
 out.pharmacies=ids.length;
 out.dropdownBefore=current.length;
 out.currentCN=snapshot.total;
 out.strongGroups=proposed.groupCount;
 out.autoMergeCandidates=proposed.operations.length;
 out.affectedVisibleLaboratories=affected.size;
 out.duplicatesVisibleCandidates=visible.length;
 out.manualGroupsForReview=proposed.review.length;
 out.examples=visible.slice(0,65).map(x=>({from:x.fromName,to:x.toName,sourceId:x.from,targetId:x.to}));
 out.otherCandidates=proposed.operations.filter(x=>!currentIds.has(x.from)&&!currentIds.has(x.to)).slice(0,20)
  .map(x=>({from:x.fromName,to:x.toName}));
 out.manualExamples=proposed.review.slice(0,25);
 out.activeWithoutCN=current.filter(x=>!snapshot.byLab.has(x.id)).length;
 const rawMap=new Map();
 for(const lab of current){
  const n=canonicalLabName(lab.name);
  if(!n)continue;
  if(!rawMap.has(n))rawMap.set(n,[]);
  rawMap.get(n).push(lab.name);
 }
 out.visibleExactNameDuplicates=[...rawMap.values()].filter(x=>x.length>1).slice(0,40);
}catch(e){out.error=e.code||e.name||"Error";out.detail=String(e.message||"").slice(0,220)}
finally{console.log("FM_AUDITORIA_LAB_UNIFICADOS",JSON.stringify(out));await db.end()}
