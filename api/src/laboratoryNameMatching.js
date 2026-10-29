import {canonicalLabName,safeLaboratoryIdentity} from "./laboratoryMergeCandidates.js";

// Agrupar únicamente variantes de la MISMA denominación. No hacemos
// equivalentes una marca y la empresa fabricante, ni un proveedor y su distribuidor.
const GENERIC=/\b(?:LABORATORIOS|LABORATORIO|LABS|LAB|FARMACEUTICA|FARMACEUTICAS|FARMACEUTICO|FARMACEUTICOS|S A U|S L U|S A|S L|SA|SL)\b/g;
const DIFFERENT_BUSINESS=/\b(?:COOPERATIVA|MAYORISTA|DISTRIBUIDOR|DISTRIBUIDORA|DISTRIBUCION|LOGISTICA|FARMACIA|INTERNO)\b/;
export const nameRoot=value=>{
 let v=canonicalLabName(value);
 v=v.replace(GENERIC," ").replace(/PH/g,"F")
  .replace(/\bESPANA\b$/," ").replace(/\bIBERICA\b$/," ")
  .replace(/\s+/g," ").trim();
 // Los espacios no modifican la identidad de la marca.
 return v;
};
const digits=s=>/^\d+$/.test(s);
function levenshteinBounded(a,b,max=2){
 if(Math.abs(a.length-b.length)>max)return max+1;
 let last=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
  const next=[i];
  for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,last[j]+1,last[j-1]+(a[i-1]===b[j-1]?0:1));
  last=next;
  if(Math.min(...last)>max)return max+1;
 }
 return last[b.length];
}
export function nameAffinity(a,b){
 const rawA=canonicalLabName(a),rawB=canonicalLabName(b);
 const n1=nameRoot(a),n2=nameRoot(b);
 if(!n1||!n2||digits(n1)||digits(n2))return null;
 if(DIFFERENT_BUSINESS.test(rawA)||DIFFERENT_BUSINESS.test(rawB))return null;
 const flat1=n1.replace(/\s/g,""),flat2=n2.replace(/\s/g,"");
 if(flat1===flat2&&flat1.length>=5)return {reason:"mismo_nombre_normalizado",confidence:99};
 const l=Math.max(flat1.length,flat2.length),d=levenshteinBounded(flat1,flat2,2);
 // Una letra claramente errónea (ALMIRAL / ALMIRALL) se revisa.
 if(l>=8&&d===1)return {reason:"diferencia_una_letra",confidence:94};
 if(l>=11&&d===2)return {reason:"diferencia_dos_letras",confidence:82};
 // Ni la mera inclusión (LOREAL / LOREAL VICHY) ni compartir una palabra
 // (PIERRE FABRE / PIERRE F IBERICA KLORANE) autorizan una unificación.
 const short=flat1.length<=flat2.length?flat1:flat2;
 const long=flat1.length>flat2.length?flat1:flat2;
 if(short.length>=5&&long.includes(short)&&short.length/long.length>=.55)
  return {reason:"nombre_ampliado",confidence:68};
 const terms1=new Set(n1.split(" ").filter(t=>t.length>=3));
 const terms2=new Set(n2.split(" ").filter(t=>t.length>=3));
 const shared=[...terms1].filter(t=>terms2.has(t));
 if(shared.length>=2&&shared.join("").length>=9)
  return {reason:"palabras_comunes",confidence:58};
 return null;
}
export function advancedLaboratoryCandidates(rows,aliases=[],protectedIds=new Set(),blockedIds=new Set()){
 const labs=rows.filter(safeLaboratoryIdentity);
 const info=new Map(labs.map(p=>[String(p.id),{
  ...p,alias:[],manual:protectedIds.has(String(p.id)),history:blockedIds.has(String(p.id))
 }]));
 for(const a of aliases){const p=info.get(String(a.supplier));if(p)p.alias.push(a)}
 const options=[];
 for(let i=0;i<labs.length;i++)for(let j=i+1;j<labs.length;j++){
  const a=labs[i],b=labs[j];
  if(a.class!==b.class)continue;
  const score=nameAffinity(a.name,b.name);
  if(!score)continue;
  const aa=info.get(String(a.id)),bb=info.get(String(b.id));
  const codes1=new Map(aa.alias.map(o=>[String(o.sourceCode).trim().replace(/^0+(?=\d)/,""),o.pharmacyCode]));
  const common=bb.alias.filter(o=>{
   const code=String(o.sourceCode).trim().replace(/^0+(?=\d)/,"");
   return codes1.has(code)&&codes1.get(code)!==o.pharmacyCode;
  }).map(o=>String(o.sourceCode));
  const protects=aa.manual||bb.manual||aa.history||bb.history;
  const names=[a.name,b.name];
  options.push({
   a:String(a.id),b:String(b.id),names,types:[a.class,b.class],
   reason:score.reason,confidence:score.confidence,
   codeEvidence:[...new Set(common)],manual:aa.manual||bb.manual,
   history:aa.history||bb.history,
   aliases:[aa.alias.length,bb.alias.length],
   origins:[aa.alias.map(x=>x.pharmacyCode+":"+x.sourceCode),bb.alias.map(x=>x.pharmacyCode+":"+x.sourceCode)],
   groupKeys:[a.origin||"",b.origin||""],eligible:!protects
  });
 }
 options.sort((x,y)=>y.confidence-x.confidence||y.codeEvidence.length-x.codeEvidence.length||
  x.names[0].localeCompare(y.names[0],"es"));
 return {total:labs.length,candidates:options};
}
