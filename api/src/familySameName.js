// Una familia global por nombre normalizado y segmento, sin exigir CN comunes.
// Los CN solo desambiguan los grupos SIN_DETERMINAR frente a un segmento conocido.
import {cleanFamilyName} from "./familyMatching.js";
import {dedupFamilySlug} from "./familyDuplicates.js";

const num=x=>Number(x)||0;
const ID=x=>String(x.id);
const segment=x=>String(x.segment||"SIN_DETERMINAR");
const isReference=x=>Boolean(x.referencePharmacy);
const weight=x=>num(x.linked)+num(x.aliases)*10;
export function normalizedFamilyLabel(name){
 return dedupFamilySlug(name);
}
const canonicalOrder=(a,b)=>
 Number(isReference(b))-Number(isReference(a))||
 Number(Boolean(b.customName))-Number(Boolean(a.customName))||
 weight(b)-weight(a)||
 num(a.id)-num(b.id);
const preferredTitle=(items,canonical)=>{
 // Respetar un nombre editado por una persona; los nombres generados
 // automáticamente por fusiones previas pueden corregirse si faltan tildes.
 if(canonical.customName&&!canonical.machineNamed)
  return cleanFamilyName(canonical.name,canonical.id);
 const candidates=[...items.map(x=>x.name),...items.flatMap(x=>x.localNames||[])]
  .filter(x=>normalizedFamilyLabel(x)===normalizedFamilyLabel(canonical.name))
  .map(x=>cleanFamilyName(x,canonical.id));
 const accents=x=>(x.match(/[áéíóúÁÉÍÓÚ]/g)||[]).length;
 candidates.sort((a,b)=>accents(b)-accents(a)||
  b.length-a.length||a.localeCompare(b,"es"));
 return candidates[0]||cleanFamilyName(canonical.name,canonical.id);
}
export function planSameNameMerges(families){
 const eligible=families.filter(f=>f.active!==false).map(f=>({
  ...f,id:ID(f),segment:segment(f),normalized:normalizedFamilyLabel(f.name)
 }));
 const groups=new Map();
 for(const f of eligible){
  if(!f.normalized)continue; // «Otros», «Sin categoría», nombres genéricos.
  const key=f.segment+"|"+f.normalized;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(f);
 }
 // Un nombre puede llegar sin segmento desde Farmatic. Usar los CN
 // disponibles para elegir una única categoría conocida, aunque existan
 // referencias distintas (de parafarmacia y medicación) con el mismo nombre.
 // Si no hay evidencia o es contradictoria, conservar SIN_DETERMINAR.
 const knownByName=new Map();
 for(const key of groups.keys()){
  const [seg,slug]=key.split("|");
  if(seg==="SIN_DETERMINAR")continue;
  if(!knownByName.has(slug))knownByName.set(slug,new Set());
  knownByName.get(slug).add(seg);
 }
 let ambiguousCrossSegment=0;
 const examples=[];
 for(const [key,items] of [...groups]){
  const [seg,slug]=key.split("|");
  if(seg!=="SIN_DETERMINAR")continue;
  const available=knownByName.get(slug)||new Set();
  if(!available.size)continue;
  const unresolved=[];
  for(const f of items){
   const para=num(f.para),med=num(f.med);
   let target=null;
   if(available.size===1){
    const only=[...available][0];
    if((only==="PARAFARMACIA"&&med===0)||
       (only==="MEDICACION"&&para===0))target=only;
   }else if(para>0&&med===0&&available.has("PARAFARMACIA"))
    target="PARAFARMACIA";
   else if(med>0&&para===0&&available.has("MEDICACION"))
    target="MEDICACION";
   if(!target){unresolved.push(f);continue}
   const destination=target+"|"+slug;
   if(groups.has(destination))groups.get(destination).push(f);
   else unresolved.push(f);
  }
  groups.set(key,unresolved);
  ambiguousCrossSegment+=unresolved.length;
  for(const f of unresolved.slice(0,3))
   examples.push({id:f.id,name:f.name,para:num(f.para),med:num(f.med),
    referencedSegments:[...available]});
 }
 const actions=[],nameGroups=[];
 for(const [key,items] of groups){
  if(items.length<=1)continue;
  const ranked=[...items].sort(canonicalOrder),keeper=ranked[0];
  const canonicalName=preferredTitle(items,keeper);
  nameGroups.push({key,slug:keeper.normalized,segment:segment(keeper),
   destinationId:keeper.id,members:items.length,name:canonicalName});
  for(const source of ranked.slice(1)){
   actions.push({
    sourceId:source.id,destinationId:keeper.id,slug:keeper.normalized,
    fromSegment:segment(source),toSegment:segment(keeper),
    sourceName:source.name,destinationName:keeper.name,
    canonicalName,reason:segment(source)===segment(keeper)?
     "mismo_nombre_mismo_segmento":"mismo_nombre_segmento_validado_cn",
    sourceHasManualName:Boolean(source.customName),
    sourceHasReference:Boolean(source.referencePharmacy)
   });
  }
 }
 return {actions,groups:nameGroups,activeFamilies:eligible.length,
  uniqueFamilies:eligible.length-actions.length,ambiguousCrossSegment,
  ambiguousExamples:examples.slice(0,30)};
}
