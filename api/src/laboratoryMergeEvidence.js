// Conciliación conservadora con doble evidencia: nombre normalizado
// del mismo tipo de laboratorio Y mismo código ERP en farmacias distintas.
// Un código ERP por sí solo nunca autoriza una fusión; cada farmacia tiene
// su propio catálogo y los códigos podrían haber sido reutilizados.
import {canonicalLabName,safeLaboratoryIdentity} from "./laboratoryMergeCandidates.js";
const normalizeCode=x=>String(x??"").trim().toUpperCase().replace(/^0+(?=\d)/,"");
export function proposeEvidenceLaboratoryMerges(rows,aliases,protectedIds=new Set(),
 blockedIds=new Set()){
 const groups=new Map(),byId=new Map(rows.map(r=>[String(r.id),r]));
 for(const row of rows){
  if(!safeLaboratoryIdentity(row))continue;
  const key=row.class+"|"+canonicalLabName(row.name);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(row);
 }
 const codeMap=new Map(),counts=new Map();
 for(const a of aliases){
  const id=String(a.supplier||a.id);
  const code=normalizeCode(a.sourceCode);
  if(!code||!byId.has(id))continue;
  if(!codeMap.has(id))codeMap.set(id,new Map());
  if(!codeMap.get(id).has(code))codeMap.get(id).set(code,new Set());
  codeMap.get(id).get(code).add(String(a.pharmacyCode||"").trim().toUpperCase());
  counts.set(id,(counts.get(id)||0)+1);
 }
 const operations=[],review=[];
 for(const [key,list] of groups){
  if(list.length<2)continue;
  // Ordenar por mayor presencia en los ERP; identidad de destino estable.
  const sorted=[...list].sort((a,b)=>(counts.get(String(b.id))||0)-
   (counts.get(String(a.id))||0)||Number(a.id)-Number(b.id));
  const dest=sorted[0],destId=String(dest.id);
  for(const source of sorted.slice(1)){
   const id=String(source.id),a=codeMap.get(id)||new Map(),b=codeMap.get(destId)||new Map();
   const sameCode=[...a.keys()].filter(code=>b.has(code)&&
    [...a.get(code)].some(ph=>[...b.get(code)].some(other=>other!==ph)));
   if(protectedIds.has(id)||protectedIds.has(destId)){
    review.push({group:key,from:id,to:destId,reason:"manual",matchingCodes:sameCode});continue;
   }
   if(blockedIds.has(id)||blockedIds.has(destId)){
    review.push({group:key,from:id,to:destId,reason:"configuracion_o_historial",matchingCodes:sameCode});continue;
   }
   if(!sameCode.length){
    review.push({group:key,from:id,to:destId,reason:"sin_codigo_compartido",matchingCodes:[]});continue;
   }
   operations.push({from:id,to:destId,fromName:source.name,toName:dest.name,
    key,matchingCodes:sameCode});
  }
 }
 operations.sort((a,b)=>a.key.localeCompare(b.key,"es")||Number(a.from)-Number(b.from));
 return {operations,review,groups:groups.size,duplicateGroups:[...groups.values()].filter(g=>g.length>1).length};
}
