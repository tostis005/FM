import {monthlyObjectiveEntry,objectiveTargetsForMonth} from "./promotionMonthlyObjectives.js";
const validCN=cn=>/^\d{6}$/.test(String(cn||""));
const safeTargets=targets=>Object.fromEntries(Object.entries(targets||{})
 .filter(([id,value])=>id&&value!==""&&Number.isSafeInteger(Number(value))&&Number(value)>=0)
 .map(([id,value])=>[String(id),Number(value)]));
export function objectiveDraftSelection(p,active=[],month=""){
 const record=monthlyObjectiveEntry(p,month);
 const targets=safeTargets(record?record.targets:objectiveTargetsForMonth(p,month));
 const chosen=Object.keys(targets).filter(id=>active.some(f=>String(f.id)===id));
 return {
  products:[...new Set((p?.cns||[]).map(String).filter(validCN))].map(cn=>({
   cn,description:String(p?.cnDescriptions?.[cn]||"CN "+cn)
  })),
  pharmacyIds:chosen.length?chosen:
   Object.keys(p?.targets||{}).filter(id=>active.some(f=>String(f.id)===id)).length?
    Object.keys(p.targets).filter(id=>active.some(f=>String(f.id)===id)):
    active.map(f=>String(f.id)),
  targets,
  baseline:record?.objectiveBaseline||p?.objectiveBaseline||"previous",
  rateByPharmacy:record?.objectiveRates||p?.objectiveRates||{},
  customFrom:(record||p)?.objectiveBaseline==="custom"?
   (record||p).objectiveBaselineRange?.from||null:null,
  customTo:(record||p)?.objectiveBaseline==="custom"?
   (record||p).objectiveBaselineRange?.to||null:null
 };
}
export function mergeObjectivesIntoPromotion(p,objectives,now=new Date(),timeZone="Europe/Madrid"){
 if(!p?.id||!Array.isArray(objectives?.cns))throw Error("Promoción no identificada");
 const cns=[...new Set(objectives.cns.map(String).filter(validCN))];
 if(!cns.length)throw Error("Selecciona al menos un CN");
 const targets=safeTargets(objectives.targets);
 if(Object.keys(targets).length!==Object.keys(objectives.targets||{}).length)
  throw Error("Los objetivos deben ser unidades enteras no negativas");
 if(!Object.values(targets).some(v=>v>0))throw Error("Introduce al menos un objetivo positivo");
 const month=objectives.objectiveMonth;
 const updated={...p,cns,
  cnDescriptions:{...(p.cnDescriptions||{}),...(objectives.cnDescriptions||{})},sales:{}};
 if(month){
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw Error("Mes de objetivo inválido");
  // Las farmacias participantes siguen en targets para filtros, visibilidad y tickets.
  updated.targets={...(p.targets||{}),...targets};
  updated.monthlyObjectives={...(p.monthlyObjectives||{}),
   [month]:{targets,objectiveBaseline:objectives.objectiveBaseline,
    objectiveBaselineRange:objectives.objectiveBaselineRange,
    objectiveRates:objectives.objectiveRates}};
 }else{
  // Camino anterior del asistente de creación: intacto.
  Object.assign(updated,{targets,objectiveBaseline:objectives.objectiveBaseline,
   objectiveBaselineRange:objectives.objectiveBaselineRange,
   objectiveRates:objectives.objectiveRates});
 }
 // Guardar objetivos NO publica la promoción ni altera el calendario comercial.
 return updated;
}
export function objectivePromotionIsEditable(p){
 return Boolean(p&&p.id&&p.managerCanEdit!==false&&
  ["Borrador","Activa","Finalizada"].includes(p.status));
}
