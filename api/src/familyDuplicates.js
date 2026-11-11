import {cleanFamilyName} from "./familyMatching.js";

// Sólo se neutralizan las tildes vocálicas. «Año» y «ano» no son equivalentes.
export function dedupFamilySlug(name){
 const clean=cleanFamilyName(name,"").trim();
 if(!name||/^Familia\s*(?:\d+)?$/i.test(clean))return "";
 const lower=clean.toLocaleLowerCase("es").replace(/ñ/g,"\u0001")
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\u0001/g,"ñ");
 const slug=lower.replace(/[^a-z0-9ñ]+/g," ").trim().replace(/\s+/g," ");
 if(slug.length<5||/^(otros?|varios?|general|resto|sin clasificar|sin asignar|sin familia|sin categoria|a revisar|especialidades|genericos|miscelanea|familia \d+)$/.test(slug))
  return "";
 return slug;
}
function field(row,...names){
 for(const key of names)if(row?.[key]!==undefined&&row[key]!==null)return row[key];
 return "";
}
export function groupFamilyDuplicates(families,aliasRows){
 const candidatesById=new Map(families.map(f=>[String(f.id),f]));
 const aliasMap=new Map();
 for(const a of aliasRows){
  const id=String(field(a,"familyId","familia_id"));
  if(!candidatesById.has(id))continue;
  if(!aliasMap.has(id))aliasMap.set(id,[]);
  aliasMap.get(id).push(a);
 }
 const indexes=new Map();
 for(const f of families){
  const id=String(f.id),segment=field(f,"segment","segmento");
  const primary=dedupFamilySlug(field(f,"name","nombre"));
  // Los nombres locales sirven para descubrir candidatos; nunca por sí solos
  // para autorizar una fusión, porque una familia CN puede contener aliases mixtos.
  const names=new Set(primary?[primary]:[]);
  for(const origin of aliasMap.get(id)||[]){
   const value=dedupFamilySlug(field(origin,"sourceName","nombre_origen"));
   if(value)names.add(value);
  }
  for(const slug of names){
   const key=slug+"|"+segment;
   if(!indexes.has(key))indexes.set(key,new Map());
   indexes.get(key).set(id,{id,segment,primary,match:slug,
    fromPrimary:primary===slug});
  }
 }
 const pairs=new Map();
 for(const [key,items] of indexes){
  if(items.size<2)continue;
  const entries=[...items.values()].sort((a,b)=>Number(a.id)-Number(b.id));
  for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
   const a=entries[i],b=entries[j],id=a.id+"|"+b.id;
   const proof=a.fromPrimary&&b.fromPrimary?"nombre_global":"nombre_local";
   const previous=pairs.get(id);
   if(!previous||proof==="nombre_global")pairs.set(id,{id,a:a.id,b:b.id,
    normalized:a.match,segment:a.segment,proof});
  }
 }
 return [...pairs.values()].map(p=>({...p,left:candidatesById.get(p.a),
  right:candidatesById.get(p.b)}));
}
export function scoreFamilyPair(pair,cnById,linkTotals){
 const fa=pair.left,fb=pair.right,
  a=cnById.get(String(fa.id))||new Set(),b=cnById.get(String(fb.id))||new Set();
 const min=a.size<=b.size?a:b,max=a.size<=b.size?b:a;
 let shared=0;const samples=[];
 for(const cn of min)if(max.has(cn)){shared++;if(samples.length<4)samples.push(cn)}
 const smaller=Math.min(a.size,b.size);
 const ratio=smaller?shared/smaller:0;
 const refs=[fa,fb].filter(f=>field(f,"referencePharmacy","referencia_farmacia"));
 const bothManual=!!field(fa,"customName","nombre_manual")||!!field(fb,"customName","nombre_manual");
 const sameSegment=field(fa,"segment","segmento")===
  field(fb,"segment","segmento");
 const exact=pair.proof==="nombre_global";
 // Si Farmatic no clasificó el segmento, sólo la evidencia de productos
 // equivalentes y una composición homogénea permite deduplicar SIN asignar
 // artificialmente medicación o parafarmacia.
 const productMix=cns=>{
  if(!cns.size)return null;
  return [...cns].filter(cn=>Number(cn)<400000).length/cns.size;
 };
 const paraA=productMix(a),paraB=productMix(b);
 const consistentDomain=paraA!=null&&paraB!=null&&
  ((paraA>=0.95&&paraB>=0.95)||(paraA<=0.05&&paraB<=0.05));
 const unclassified=pair.segment==="SIN_DETERMINAR";
 const sufficient=unclassified?
  exact&&shared>=10&&ratio>=0.70&&consistentDomain:
  exact?shared>=3&&ratio>=0.2:shared>=6&&ratio>=0.35;
 // Dos referencias distintas o cualquier etiqueta ajustada manualmente
 // siempre exigen una revisión explícita adicional.
 const safe=sameSegment&&refs.length<=1&&!bothManual&&sufficient;
 const rank=f=>[
  !!field(f,"referencePharmacy","referencia_farmacia")?1:0,
  Number(linkTotals.get(String(f.id))||0),
  Number(f.id)
 ];
 const [rA,rB]=[rank(fa),rank(fb)];
 const aWins=rA[0]!==rB[0]?rA[0]>rB[0]:
  rA[1]!==rB[1]?rA[1]>rB[1]:rA[2]<rB[2];
 const destination=aWins?fa:fb,source=aWins?fb:fa;
 return {...pair,shared,smaller,ratio:Number(ratio.toFixed(3)),samples,
  countA:a.size,countB:b.size,sourceId:String(source.id),destinationId:String(destination.id),
  safe,paraFractionA:paraA==null?null:Number(paraA.toFixed(3)),
  paraFractionB:paraB==null?null:Number(paraB.toFixed(3)),
  reason:!sameSegment?"segmentos_distintos":refs.length>1?"doble_referencia":
   bothManual?"nombre_editado":!sufficient?"sin_solapamiento_suficiente":"evidencia_cn",
  accentedVariants:field(fa,"name","nombre")!==field(fb,"name","nombre")};
}
export function planFamilyMerges(scored){
 const usedSources=new Set(),usedTargets=new Set(),actions=[];
 for(const p of scored.filter(x=>x.safe).sort((a,b)=>{
  const destSize=x=>x.destinationId===x.a?x.countA:x.countB;
  return destSize(b)-destSize(a)||b.shared-a.shared||b.ratio-a.ratio;
 })){
  if(usedSources.has(p.sourceId)||usedSources.has(p.destinationId)||
   usedTargets.has(p.sourceId))continue;
  actions.push(p);usedSources.add(p.sourceId);usedTargets.add(p.destinationId);
 }
 return actions;
}
