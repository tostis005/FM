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
 if(!name||/^familia\s*\d*$/iu.test(label))return "";
 // La identidad es compartida por importación, maestro y fusiones:
 // mayúsculas, tildes vocálicas, puntuación, años y acrónimos equivalentes.
 // Conservar ñ: «año» no es «ano».
 let slug=label.replace(/^familia\s*[:#\-–—]\s*/iu,"")
  .toLocaleLowerCase("es").replace(/ñ/g,"\u0001")
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\u0001/g,"ñ")
  .replace(/[&+]/g," y ")
  .replace(/[^a-z0-9ñ]+/g," ").trim().replace(/\s+/g," ");
 // Variaciones descriptivas o abreviaturas inequívocas de Farmatic.
 slug=slug.replace(/\bdermo cosmetica\b/g,"dermocosmetica")
  .replace(/\binfanti\b/g,"infantil")
  .replace(/^higiene y cosmetica\b/g,"higiene cosmetica")
  .replace(/^o t c$/g,"otc");
 if(slug.length<3||/^(otros?|otros productos|varios?|general|resto|sin clasificar|sin asignar|sin familia|sin categoria|a revisar|articulos inactivos|miscelanea|familia \d+)$/.test(slug))
  return "";
 return slug;
}
export function selectNamedDestination(source,referenceNames,sharedNames,votes,refs){
 const slug=familyNameSlug(source.name,source.code);
 if(!slug)return null;
 const segment=source.segment||"SIN_DETERMINAR";
 const refKeys=referenceNames.get(slug)||new Set();
 // No reemplazar una referencia respaldada por varios destinos CN
 // contradictorios con una coincidencia textual.
 const evidence=(votes.get(familyKey(source.pharmacyCode,source.code))||[])
  .filter(v=>refs.has(familyKey(v.referencePharmacy,v.referenceCode)));
 const supported=new Set(evidence.map(v=>refs.get(familyKey(v.referencePharmacy,v.referenceCode)).key));
 if(supported.size>1)return null;
 const candidates=[...refKeys].map(key=>[...refs.values()].find(r=>r.key===key))
  .filter(Boolean);
 // Si Farmatic no clasificó la familia, el CN descarta segmentos
 // contradictorios; las fichas sin CN no bloquean una etiqueta inequívoca.
 const para=Number(source.para||0),med=Number(source.med||0);
 const compatible=target=>
  segment===target||
  segment==="SIN_DETERMINAR"&&(
   target==="PARAFARMACIA"?med===0:target==="MEDICACION"?para===0:false);
 const matches=candidates.filter(r=>compatible(r.segment)&&
  (!supported.size||supported.has(r.key)));
 if(matches.length===1){
  return {key:matches[0].key,method:"coincidencia_nombre",
   matches:evidence.reduce((n,v)=>n+v.count,0),confidence:0.95};
 }
 // La misma denominación sin CN coincidentes sigue siendo una familia
 // global por segmento; no crear una provisional distinta por farmacia.
 // Un segmento desconocido solo se resuelve contra una referencia
 // cuando no existe contradicción medicación/parafarmacia.
 if(["PARAFARMACIA","MEDICACION","SIN_DETERMINAR"].includes(segment))
  return {key:"NAME:"+segment+":"+slug,method:"nombre_compartido",
   matches:0,confidence:0.8};
 return null;
}
