// Sólo lectura. Diagnostica TODAS las identidades del maestro y las que
// llegan al preparador. No modifica correspondencias ni movimientos.
import pg from "pg";
import {proposeLaboratoryMerges,canonicalLabName} from "./laboratoryMergeCandidates.js";
import {proposeEvidenceLaboratoryMerges} from "./laboratoryMergeEvidence.js";
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
 const {rows:evidence}=await db.query(`SELECT proveedor_id::text AS supplier,
  farmacia_codigo AS "pharmacyCode",codigo_origen AS "sourceCode",nombre_origen AS "sourceName"
  FROM farmetrica.proveedores_unificados_alias WHERE cliente_slug='ampedia'`);
 const {rows:used}=await db.query(`
  SELECT laboratorio_clave AS key FROM farmetrica.preparador_frecuencia_laboratorio
  WHERE cliente_slug='ampedia' AND laboratorio_clave LIKE 'P:%'
  UNION ALL SELECT laboratorio_clave FROM farmetrica.pedidos_laboratorio_borradores
  WHERE cliente_slug='ampedia' AND laboratorio_clave LIKE 'P:%'
  UNION ALL SELECT 'P:'||laboratorio_id::text FROM farmetrica.preparador_pedidos_realizados
  WHERE cliente_slug='ampedia'`);
 const blocked=new Set(used.map(x=>String(x.key).slice(2)));
 const verified=proposeEvidenceLaboratoryMerges(master,evidence,protectedIds,blocked);
 out.evidenceMergeCandidates=verified.operations.length;
 out.evidenceDuplicateGroups=verified.duplicateGroups;
 out.evidenceBlockedForReview=verified.review.length;
 out.evidenceReviewReasons=Object.fromEntries([...new Set(verified.review.map(x=>x.reason))]
   .map(reason=>[reason,verified.review.filter(x=>x.reason===reason).length]));
 out.evidenceExamples=verified.operations.slice(0,35).map(x=>({
  from:x.fromName,to:x.toName,fromId:x.from,toId:x.to,matchingCodes:x.matchingCodes}));
 out.sharedCodeDifferentNameExamples=[];
 const byCode=new Map(),nameById=new Map(master.map(x=>[x.id,canonicalLabName(x.name)]));
 for(const a of evidence){
  if(!nameById.has(a.supplier))continue;
  const k=String(a.sourceCode).trim().toUpperCase().replace(/^0+(?=\d)/,"");
  if(!k)continue;
  if(!byCode.has(k))byCode.set(k,new Map());
  byCode.get(k).set(a.supplier,nameById.get(a.supplier));
 }
 for(const [code,entities] of byCode){
  if(entities.size>1&&new Set(entities.values()).size>1&&out.sharedCodeDifferentNameExamples.length<20)
   out.sharedCodeDifferentNameExamples.push({code,names:[...new Set(entities.values())].slice(0,4)});
 }

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
