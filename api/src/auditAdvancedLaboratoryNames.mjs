// Auditoría SOLO LECTURA; las diferencias de nombre se revisan antes de unir.
// Se muestra el código por farmacia para comprobar que el mismo número no
// identifique a varias empresas distintas.
import pg from "pg";
import {advancedLaboratoryCandidates,nameAffinity} from "./laboratoryNameMatching.js";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000,query_timeout:90000,statement_timeout:90000});
const slug="ampedia",out={tenant:slug,readonly:true};
try{
 const {rows:all}=await pool.query(`SELECT id::text, nombre AS name,clase AS class,
  activo AS active,clave_unificada AS origin
  FROM farmetrica.proveedores_unificados WHERE cliente_slug=$1`,[slug]);
 const {rows:aliases}=await pool.query(`SELECT proveedor_id::text AS supplier,
  farmacia_codigo AS "pharmacyCode",codigo_origen AS "sourceCode",nombre_origen AS "sourceName",
  procedencia AS provenance
  FROM farmetrica.proveedores_unificados_alias WHERE cliente_slug=$1`,[slug]);
 const protectedIds=new Set(aliases.filter(a=>a.provenance==="manual").map(a=>a.supplier));
 const {rows:used}=await pool.query(`
 SELECT laboratorio_clave AS key FROM farmetrica.preparador_frecuencia_laboratorio WHERE cliente_slug=$1
 UNION ALL SELECT laboratorio_clave FROM farmetrica.pedidos_laboratorio_borradores WHERE cliente_slug=$1
 UNION ALL SELECT 'P:'||laboratorio_id::text FROM farmetrica.preparador_pedidos_realizados WHERE cliente_slug=$1`,[slug]);
 const blocked=new Set(used.map(r=>String(r.key).replace(/^P:/,"")));
 const {total,candidates}=advancedLaboratoryCandidates(all,aliases,protectedIds,blocked);
 const histogram={};
 for(const a of all){const key=(a.active?"activo_":"inactivo_")+a.class;histogram[key]=(histogram[key]||0)+1}
 out.suppliers=all.length;out.aliases=aliases.length;out.laboratories=total;out.classification=histogram;
 out.protectedLaboratories=protectedIds.size;out.configuredLaboratories=blocked.size;
 out.candidatePairs=candidates.length;
 out.reasonCounts=Object.fromEntries([...new Set(candidates.map(p=>p.reason))].map(reason=>[reason,candidates.filter(c=>c.reason===reason).length]));
 out.top=candidates.slice(0,155);
 const classes=new Set(["DIRECTO","VACUNAS","FÓRMULAS"]);
 const targets=all.filter(x=>x.active&&classes.has(x.class));
 const unclassified=all.filter(x=>x.active&&x.class==="SIN_CLASIFICAR");
 const byId=new Map();
 for(const a of aliases){
  if(!byId.has(a.supplier))byId.set(a.supplier,[]);
  byId.get(a.supplier).push(a);
 }
 const cross=[];
 for(const p of unclassified){
  for(const t of targets){
   const match=nameAffinity(p.name,t.name);
   if(!match||match.confidence<80)continue;
   cross.push({from:p.id,fromName:p.name,to:t.id,toName:t.name,
    reason:match.reason,confidence:match.confidence,
    fromAliases:(byId.get(p.id)||[]).map(a=>a.pharmacyCode+":"+a.sourceCode),
    toAliases:(byId.get(t.id)||[]).map(a=>a.pharmacyCode+":"+a.sourceCode),
    targetClass:t.class,fromOrigin:p.origin,toOrigin:t.origin,
    manual:protectedIds.has(p.id)||protectedIds.has(t.id),
    history:blocked.has(p.id)||blocked.has(t.id)});
  }
 }
 cross.sort((a,b)=>b.confidence-a.confidence||a.fromName.localeCompare(b.fromName,"es"));
 out.unclassifiedWithAliases=unclassified.filter(p=>(byId.get(p.id)||[]).length>0).length;
 out.unclassifiedNoAliases=unclassified.length-out.unclassifiedWithAliases;
 out.crossClassCandidatePairs=cross.length;
 out.crossClassExamples=cross.slice(0,500);

 // Códigos ERP sin asociación al maestro (no se pueden buscar aquí sin examinar ERP).
 // Los alias presentes sí están asociados, aunque la identidad final pueda ser distinta.
 out.unlinkedERP="requiere_comparacion_con_tablas_operativas";
}catch(error){out.error=error.code||error.name;out.detail=String(error.message).slice(0,250)}
finally{console.log("FM_LAB_NAME_AUDIT",JSON.stringify(out));await pool.end()}
if(out.error)process.exitCode=1;
