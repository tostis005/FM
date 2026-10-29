import {nameAffinity} from "./laboratoryNameMatching.js";

// Pares revisados sobre el maestro real y fuentes del fabricante.
// No incluye distribuidores generales, servicios ni marcas distintas.
export const ADDITIONAL_LABORATORY_PAIRS=[
 ["1765","305","ALDO UNION","ALDO UNION","DIRECTO",true],
 ["1813","305","ALDO-UNION SL","ALDO UNION","DIRECTO",false],
 ["1415","1272","ASAC PHARM INMUNOLOGY","ASAC PHARM INMUNOLOGY","DIRECTO",true],
 ["1473","1272","ASAC PHARM INMUNOLOGY","ASAC PHARM INMUNOLOGY","DIRECTO",true],
 ["1465","1279","BIODERMA - NAOS SKIN CARE SPAIN SLU","BIODERMA - NAOS SKIN CARE SPAIN SLU","DIRECTO",true],
 ["1680","1279","BIODERMA - NAOS SKIN CARE SPAIN SLU","BIODERMA - NAOS SKIN CARE SPAIN SLU","DIRECTO",true],
 ["1700","1279","BIODERMA - NAOS SKIN CARE SPAIN SLU","BIODERMA - NAOS SKIN CARE SPAIN SLU","DIRECTO",true],
 ["1877","1279","BIODERMA - NAOS SKIN CARE SPAIN SLU","BIODERMA - NAOS SKIN CARE SPAIN SLU","DIRECTO",true],
 ["1416","1279","BIODERMA- NAOS SKIN CARE SPAIN SLU","BIODERMA - NAOS SKIN CARE SPAIN SLU","DIRECTO",true],
 ["1348","1261","DRASANVI SL","DRASANVI SL","DIRECTO",true],
 ["1834","1111","BRISTOL MYERS","BRISTOL MYERS","DIRECTO",true],
 ["1612","404","BAUSCH&LOMB","BAUSCH&LOMB","DIRECTO",true],
 ["1326","1076","DIATER LABORATORIO","DIATER LABORATORIO","VACUNAS",true],
 ["1797","1076","DIATER LABORATORIO","DIATER LABORATORIO","VACUNAS",true],
 ["1861","1076","DIATER LABORATORIO","DIATER LABORATORIO","VACUNAS",true],
 ["1342","1078","ALLERGY THERAPEUTICS IBERICA","ALLERGY THERAPEUTICS IBERICA","VACUNAS",true],
 ["1856","762","ALLERGY THERAPEUTICS IBERICA","ALLERGY THERAPEUTICS IBERICA","DIRECTO",true],
];
const n=s=>String(s||"").normalize("NFKC").trim().toUpperCase();
const code=s=>String(s||"").trim().toUpperCase().replace(/^0+(?=\d)/,"");
export function planAdditionalVerifiedLaboratoryAliases(master,aliases,manual=new Set(),blocked=new Set()){
 const byId=new Map(master.map(p=>[String(p.id),p]));
 const byAlias=new Map();
 for(const a of aliases){
  const id=String(a.supplier);
  if(!byAlias.has(id))byAlias.set(id,[]);
  byAlias.get(id).push(a);
 }
 const operations=[],review=[];
 for(const [from,to,fromName,toName,targetClass,requireCode] of ADDITIONAL_LABORATORY_PAIRS){
  const source=byId.get(from),target=byId.get(to);
  if(!source||!target||source.active===false||target.active===false||
   source.class!=="SIN_CLASIFICAR"||target.class!==targetClass||
   n(source.name)!==n(fromName)||n(target.name)!==n(toName)||
   nameAffinity(source.name,target.name)?.confidence!==99)
   throw Error("Cambió la identidad verificada "+from+"/"+to+"; abortar lote");
  if(manual.has(from)||manual.has(to)||blocked.has(from)||blocked.has(to)){
   review.push({from,to,reason:"asociacion_manual_o_pedido"});continue;
  }
  const a=byAlias.get(from)||[],b=byAlias.get(to)||[];
  if(!a.length||!b.length){review.push({from,to,reason:"origen_o_destino_sin_alias"});continue}
  const sourceShop=new Set(a.map(x=>String(x.pharmacyCode||"").trim().toUpperCase()));
  if(b.some(x=>sourceShop.has(String(x.pharmacyCode||"").trim().toUpperCase()))){
   review.push({from,to,reason:"coexistencia_en_farmacia"});continue;
  }
  const cross=a.some(x=>b.some(y=>code(x.sourceCode)&&code(x.sourceCode)===code(y.sourceCode)&&
   String(x.pharmacyCode).toUpperCase()!==String(y.pharmacyCode).toUpperCase()));
  if(requireCode&&!cross){review.push({from,to,reason:"codigo_erp_no_corroborado"});continue}
  operations.push({from,to,fromName:source.name,toName:target.name,key:"verified:"+to,
   codeVerified:cross});
 }
 return {operations,review};
}
