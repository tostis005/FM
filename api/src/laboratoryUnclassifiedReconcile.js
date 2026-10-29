import {nameAffinity} from "./laboratoryNameMatching.js";
const LAB_TYPES=new Set(["DIRECTO","VACUNAS","FÓRMULAS"]);
const norm=x=>String(x??"").trim().toUpperCase().replace(/^0+(?=\d)/,"");
/**
 * Reasignar únicamente alias ERP aún SIN_CLASIFICAR a un laboratorio
 * ya reconocido, sin crear grupos nuevos ni cambiar asociaciones existentes.
 *
 * Requiere identidad prácticamente exacta, laboratorio con CN en el snapshot
 * de últimas recepciones y destino unívoco por nombre/códigos. No inferir
 * identidad solo por el código local ni por pertenecer al mismo grupo.
 */
export function planUnclassifiedLaboratoryAliases(master,aliases,activeLabIds=new Set(),
 manualIds=new Set(),blockedIds=new Set(),excludedIds=new Set()){
 const active=master.filter(p=>p.active!==false),byId=new Map(active.map(p=>[String(p.id),p]));
 const bySupplier=new Map();
 for(const a of aliases){
  const id=String(a.supplier);
  if(!bySupplier.has(id))bySupplier.set(id,[]);
  bySupplier.get(id).push(a);
 }
 const targets=active.filter(p=>LAB_TYPES.has(p.class)&&activeLabIds.has(String(p.id)));
 const sources=active.filter(p=>p.class==="SIN_CLASIFICAR");
 const operations=[],review=[],status={sources:sources.length,targets:targets.length,
  noExactMatch:0,manualOrHistory:0,sourceWithoutAlias:0,ambiguous:0,pharmacyConflict:0,excluded:0,merged:0};
 for(const source of sources){
  const id=String(source.id),sa=bySupplier.get(id)||[];
  if(excludedIds.has(id)){status.excluded++;continue}
  if(!sa.length){status.sourceWithoutAlias++;continue}
  const matches=targets.map(target=>{
   const score=nameAffinity(source.name,target.name);
   if(!score||score.confidence!==99)return null;
   const ta=bySupplier.get(String(target.id))||[];
   const sameCodes=sa.filter(s=>ta.some(t=>norm(s.sourceCode)===norm(t.sourceCode)&&
    String(s.pharmacyCode).toUpperCase()!==String(t.pharmacyCode).toUpperCase()));
   return {target,ta,codeEvidence:sameCodes.length};
  }).filter(Boolean);
  if(!matches.length){status.noExactMatch++;continue}
  if(manualIds.has(id)||blockedIds.has(id)||matches.some(m=>
   manualIds.has(String(m.target.id))||blockedIds.has(String(m.target.id)))){
   status.manualOrHistory++;review.push({source:id,name:source.name,reason:"manual_o_historial"});continue
  }
  // Cuando la misma denominación tiene varios destinos, una coincidencia
  // de código en otras farmacias puede distinguirlos. Nunca escoger por ID.
  const withCodes=matches.filter(m=>m.codeEvidence>0);
  const options=withCodes.length===1?withCodes:matches.length===1?matches:[];
  if(options.length!==1){status.ambiguous++;review.push({
   source:id,name:source.name,reason:"varios_laboratorios",
   targets:matches.map(m=>({id:String(m.target.id),name:m.target.name,codes:m.codeEvidence}))});continue}
  const winner=options[0],dest=String(winner.target.id);
  // Dos códigos de proveedor de la MISMA farmacia podrían reflejar
  // relaciones comerciales distintas: revisión humana obligatoria.
  const shops=new Set(winner.ta.map(a=>String(a.pharmacyCode).trim().toUpperCase()));
  if(sa.some(a=>shops.has(String(a.pharmacyCode).trim().toUpperCase()))){
   status.pharmacyConflict++;review.push({source:id,dest,name:source.name,reason:"mismo_erp_distinto_codigo"});continue
  }
  operations.push({from:id,to:dest,fromName:source.name,toName:winner.target.name,
   key:"ERP:"+id,kind:"SIN_CLASIFICAR",sameCode: winner.codeEvidence>0});
  status.merged++;
 }
 return {operations,review,status};
}
