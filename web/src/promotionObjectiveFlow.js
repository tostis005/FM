import {effectivePromotionStatus} from "./promotionLifecycle.js";

const validCN=cn=>/^\d{6}$/.test(String(cn||""));
const safeTargets=targets=>Object.fromEntries(Object.entries(targets||{})
 .filter(([id,value])=>id&&value!==""&&Number.isSafeInteger(Number(value))&&Number(value)>=0)
 .map(([id,value])=>[String(id),Number(value)]));
export function objectiveDraftSelection(p,active=[]){
 const targets=safeTargets(p?.targets);
 const chosen=Object.keys(targets).filter(id=>active.some(f=>String(f.id)===id));
 return {
  products:[...new Set((p?.cns||[]).map(String).filter(validCN))].map(cn=>({
   cn,description:String(p?.cnDescriptions?.[cn]||"CN "+cn)
  })),
  pharmacyIds:chosen.length?chosen:active.map(f=>String(f.id)),
  targets,baseline:p?.objectiveBaseline||"previous",
  rateByPharmacy:p?.objectiveRates||{},
  customFrom:p?.objectiveBaseline==="custom"?p.objectiveBaselineRange?.from||null:null,
  customTo:p?.objectiveBaseline==="custom"?p.objectiveBaselineRange?.to||null:null
 };
}
export function mergeObjectivesIntoPromotion(p,objectives,now=new Date(),timeZone="Europe/Madrid"){
 if(!p?.id||!Array.isArray(objectives?.cns))throw Error("Promoción no identificada");
 const cns=[...new Set(objectives.cns.map(String).filter(validCN))];
 if(!cns.length)throw Error("Selecciona al menos un CN");
 const targets=safeTargets(objectives.targets);
 if(!Object.values(targets).some(v=>v>0))throw Error("Introduce al menos un objetivo positivo");
 if(Object.keys(targets).length!==Object.keys(objectives.targets||{}).length)
  throw Error("Los objetivos deben ser unidades enteras no negativas");
 const updated={...p,cns,targets,
  cnDescriptions:{...(p.cnDescriptions||{}),...(objectives.cnDescriptions||{})},
  objectiveBaseline:objectives.objectiveBaseline,
  objectiveBaselineRange:objectives.objectiveBaselineRange,
  objectiveRates:objectives.objectiveRates,
  sales:{}};
 // Sólo las campañas de Excel en borrador pasan automáticamente a activas
 // al añadir objetivos válidos. No cambiar un cierre manual ni las fechas.
 if(/^Excel(?:\s|:|$)/i.test(String(p.source||""))&&p.status==="Borrador"){
  updated.statusSource="automatic";
  updated.status=effectivePromotionStatus(updated,now,timeZone);
 }
 return updated;
}
export function objectivePromotionIsEditable(p){
 return Boolean(p&&p.id&&p.status==="Borrador"&&p.managerCanEdit!==false);
}
