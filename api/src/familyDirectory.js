// Un listado por denominación, aunque su clasificación tenga varias ramas.
// Agrupar la presentación NO fusiona medicación, parafarmacia ni vínculos ERP.
import {cleanFamilyName,familyNameSlug} from "./familyMatching.js";

const collator=new Intl.Collator("es",{sensitivity:"base",numeric:true,ignorePunctuation:true});
const normalizeText=value=>String(value||"").trim().toLocaleLowerCase("es")
 .replace(/ñ/g,"\u0001").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
 .replace(/\u0001/g,"ñ").replace(/\s+/g," ");
const identity=name=>familyNameSlug(name,"")||"etiqueta:"+normalizeText(name)
 .replace(/[^a-z0-9ñ]+/g," ").trim();
const isConfirmed=f=>Boolean(f.referencePharmacy||f.customName);
const memberRank=(a,b)=>Number(isConfirmed(b))-Number(isConfirmed(a))||
 Number(Boolean(b.referencePharmacy))-Number(Boolean(a.referencePharmacy))||
 Number(a.id)-Number(b.id);
const memberOrder=(a,b)=>{
 const priority={MEDICACION:0,PARAFARMACIA:1,SIN_DETERMINAR:2};
 return (priority[a.segment]??3)-(priority[b.segment]??3)||
 memberRank(a,b);
};
const titleFor=members=>{
 const candidates=members.map(m=>({
  label:cleanFamilyName(m.name,m.id),manual:Boolean(m.customName),
  reference:Boolean(m.referencePharmacy)
 }));
 const accents=name=>(name.match(/[áéíóúÁÉÍÓÚ]/g)||[]).length;
 candidates.sort((a,b)=>Number(b.manual)-Number(a.manual)||
  accents(b.label)-accents(a.label)||
  b.label.length-a.label.length||
  Number(b.reference)-Number(a.reference)||
  collator.compare(a.label,b.label));
 return candidates[0]?.label||"Sin nombre";
};

export function groupFamilyDirectory(records=[]){
 const grouped=new Map();
 for(const record of records){
  const name=String(record.name||"").trim(),key=identity(name)||"id:"+record.id;
  if(!grouped.has(key))grouped.set(key,[]);
  grouped.get(key).push(record);
 }
 return [...grouped].map(([key,all])=>{
  const members=[...all].sort(memberOrder);
  const preferred=[...members].sort(memberRank)[0];
  return {id:String(preferred.id),name:titleFor(members),key,
   members,segments:[...new Set(members.map(m=>m.segment))],
   confirmed:members.some(isConfirmed),
   // Compatibilidad de datos con los controles que manejan una sola familia.
   segment:preferred.segment,
   referencePharmacy:preferred.referencePharmacy,
   referenceCode:preferred.referenceCode,
   customName:preferred.customName
  };
 }).sort((a,b)=>collator.compare(a.name,b.name)||a.key.localeCompare(b.key,"es")||
  Number(a.id)-Number(b.id));
}
export function selectFamilyDirectory(records,{
 view="maestro",search="",page=1,pageSize=30
}={}){
 const groups=groupFamilyDirectory(records);
 const masters=groups.filter(g=>g.confirmed);
 const pendings=groups.filter(g=>!g.confirmed);
 const entries=view==="maestro"?masters:pendings;
 const needle=normalizeText(search),normalizedNeedle=familyNameSlug(search,"");
 const matching=needle?entries.filter(g=>normalizeText(g.name).includes(needle)||
  Boolean(normalizedNeedle&&g.key.includes(normalizedNeedle))||
  g.members.some(m=>normalizeText(m.name).includes(needle)||
   normalizeText(m.referenceCode).includes(needle))):entries;
 const selected=view==="pendientes"?matching.slice((page-1)*pageSize,page*pageSize):matching;
 return {
  groups:selected,
  summary:{maestros:masters.length,
   medicacion:masters.filter(g=>g.segments.includes("MEDICACION")).length,
   parafarmacia:masters.filter(g=>g.segments.includes("PARAFARMACIA")).length,
   pendientes:pendings.length},
  total:matching.length,
  pageSize:view==="pendientes"?pageSize:null
 };
}
