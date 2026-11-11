// La identidad de familia pertenece a farmacia + código, nunca al código aislado.
const norm = x => String(x ?? "").trim();
export const familyKey=(pharmacy,code)=>norm(pharmacy).toUpperCase()+"|"+norm(code);
export const referenceKey=(segment,code)=>"REF:"+segment+":"+norm(code);
export const provisionalKey=(pharmacy,code)=>"LOCAL:"+familyKey(pharmacy,code);
export function cleanFamilyName(value,code){
 let name=norm(value).replace(/\s+/g," ");
 // Farmatic puede anteponer el año de implantación (p. ej. 2022).
 for(let i=0;i<3;i++){
  const next=name.replace(/^(?:familia\s*[:#-]?\s*)?20\d{2}\s*[-–—./_: ]+\s*/iu,"");
  if(next===name||!next||!/\p{L}/u.test(next))break;
  name=next;
 }
 name=name.replace(/^[-–—./_: ]+|[-–—./_: ]+$/g,"");
 if(!name||/^20\d{2}$/u.test(name)||/^familia\s*[0-9]+$/iu.test(name))
  return "Familia "+norm(code);
 return name.toLocaleLowerCase("es").replace(/(^|[ \-/(])(\p{L})/gu,(_m,a,b)=>a+b.toLocaleUpperCase("es"))
  .replace(/\bOtc\b/g,"OTC").replace(/\bSpf\b/g,"SPF")
  .replace(/Dermocosmetica/gi,"Dermocosmética").replace(/Cosmetica/gi,"Cosmética")
  .replace(/Parafarmacia/gi,"Parafarmacia");
}
export function selectFamilyDestination(source,votes,refs,{minimum=3,ratio=0.95}={}){
 const ph=norm(source.pharmacyCode).toUpperCase(),code=norm(source.code);
 const k=familyKey(ph,code),reference=refs.get(k);
 if(reference)return {key:reference.key,method:"referencia",matches:reference.count,confidence:1};
 const evidence=(votes.get(k)||[]).filter(v=>refs.has(familyKey(v.referencePharmacy,v.referenceCode)));
 const total=evidence.reduce((sum,v)=>sum+v.count,0);
 const ranked=[...evidence].sort((a,b)=>b.count-a.count||String(a.referenceCode).localeCompare(String(b.referenceCode)));
 const first=ranked[0];
 if(first&&first.count>=minimum&&first.count/total>=ratio&&
  (!ranked[1]||first.count>ranked[1].count)){
  const ref=refs.get(familyKey(first.referencePharmacy,first.referenceCode));
  return {key:ref.key,method:"coincidencia_cn",matches:first.count,confidence:first.count/total};
 }
 return {key:provisionalKey(ph,code),method:"sin_referencia",matches:total,confidence:total?first.count/total:null};
}


// El nombre compartido es evidencia secundaria: jamás se basa sólo en ID de ERP.
export function familyNameSlug(name,code){
 const label=cleanFamilyName(name,code);
 if(!name||/^familia\s+\S+$/iu.test(label)||/^(otros?|varios?|sin clasificar|sin asignar|general|resto|otros productos)$/iu.test(label))
  return "";
 const slug=label.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toLocaleLowerCase("es").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
 return slug.length>=4?slug:"";
}
export function selectNamedDestination(source,referenceNames,sharedNames,votes,refs){
 const slug=familyNameSlug(source.name,source.code);
 if(!slug)return null;
 const segment=source.segment||"SIN_DETERMINAR",key=slug+"|"+segment;
 const refKeys=referenceNames.get(slug)||new Set();
 // No cruzar categorías con evidencia CN contradictoria.
 const evidence=(votes.get(familyKey(source.pharmacyCode,source.code))||[])
  .filter(v=>refs.has(familyKey(v.referencePharmacy,v.referenceCode)));
 const supported=new Set(evidence.map(v=>refs.get(familyKey(v.referencePharmacy,v.referenceCode)).key));
 if(supported.size>1)return null;
 if(refKeys.size===1){
  const destination=[...refKeys][0];
  const matchedRef=[...refs.values()].find(r=>r.key===destination);
  if((segment==="SIN_DETERMINAR"||segment===matchedRef?.segment)&&
   (!supported.size||supported.has(destination)))
   return {key:destination,method:"coincidencia_nombre",matches:evidence.reduce((n,v)=>n+v.count,0),confidence:0.95};
 }
 // Las etiquetas genéricas, las mixtas y los nombres que colisionan con dos
 // referencias nunca se unifican automáticamente.
 if(refKeys.size===0&&["PARAFARMACIA","MEDICACION"].includes(segment)
  &&(sharedNames.get(key)?.size||0)>=2&&supported.size===0)
  return {key:"NAME:"+segment+":"+slug,method:"nombre_compartido",matches:0,confidence:0.8};
 return null;
}
