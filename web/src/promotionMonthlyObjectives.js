// Objetivos mensuales independientes de la vigencia comercial de la promoción.
// Los documentos anteriores sin monthlyObjectives se mantienen como objetivos heredados.
import {promotionMonthRange} from "./promotionMonthFilter.js";

const MONTH=/^20\d{2}-(0[1-9]|1[0-2])$/;
const DATE=/^20\d{2}-\d{2}-\d{2}$/;
const keys=map=>Object.keys(map&&typeof map==="object"?map:{});
export function promotionObjectiveMonths(p,now=new Date()){
 const start=String(p?.start||"");
 if(!DATE.test(start))return [];
 const first=start.slice(0,7);
 // Campañas de stock no tienen fin: enseñar hasta tres meses por delante.
 const today=now.toISOString().slice(0,7);
 const upper=DATE.test(p?.closedOn||"")?p.closedOn.slice(0,7):
  DATE.test(p?.end||"")?p.end.slice(0,7):
  new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7))+2,1))
   .toISOString().slice(0,7);
 const result=[];
 let [year,month]=first.split("-").map(Number);
 for(let i=0;i<60;i++){
  const value=String(year)+"-"+String(month).padStart(2,"0");
  if(value>upper)break;
  result.push(value);
  if(++month===13){month=1;year++;}
 }
 return result;
}
export function preferredObjectiveMonth(p,preferred="",now=new Date()){
 const months=promotionObjectiveMonths(p,now);
 if(!months.length)return "";
 if(months.includes(preferred))return preferred;
 const current=now.toISOString().slice(0,7);
 if(months.includes(current))return current;
 const configured=months.find(m=>Object.hasOwn(p?.monthlyObjectives||{},m));
 return configured||months[0];
}
export function objectiveMonthDates(p,month){
 const range=promotionMonthRange(month);
 if(!range||!p?.start||!DATE.test(p.start))return null;
 const start=p.start>range.from?p.start:range.from;
 const end=p.closedOn||p.end;
 const finish=DATE.test(end||"")&&end<range.to?end:range.to;
 return start<=finish?{from:start,to:finish}:null;
}
export function monthlyObjectiveEntry(p,month){
 if(!MONTH.test(month||""))return null;
 return p?.monthlyObjectives?.[month]||null;
}
/** Estado de guardado real del mes. Una propuesta automática nunca cuenta
 * como objetivo configurado, aunque la tabla muestre unidades calculadas. */
export function objectiveMonthSaveState(p,month){
 if(!MONTH.test(month||"")||!promotionObjectiveMonths(p).includes(month))
  return "unconfigured";
 const entry=monthlyObjectiveEntry(p,month);
 if(entry&&entry.targets&&Object.keys(entry.targets).length)return "saved";
 // Las promociones anteriores guardaban objetivos en targets, sin mes.
 // No decir "Sin objetivos": los datos EXISTEN. Tampoco atribuir esas
 // unidades a un mes determinado si la campaña abarca varios meses.
 if(!hasMonthlyObjectives(p)&&keys(p?.targets).length)
  return promotionObjectiveMonths(p).length===1?"saved":"legacy";
 return "unconfigured";
}
export function hasLegacyUnassignedObjectives(p){
 return !hasMonthlyObjectives(p)&&keys(p?.targets).length>0;
}
export function hasMonthlyObjectives(p){
 return keys(p?.monthlyObjectives).length>0;
}
export function objectiveTargetsForMonth(p,month){
 if(!month)return p?.targets||{};
 if(!hasMonthlyObjectives(p))return p?.targets||{}; // Campañas heredadas, sin migración automática.
 return monthlyObjectiveEntry(p,month)?.targets||{};
}
export function objectiveTargetsForPeriod(p,month=""){
 if(month)return objectiveTargetsForMonth(p,month);
 if(!hasMonthlyObjectives(p))return p?.targets||{};
 const totals={};
 for(const entry of Object.values(p.monthlyObjectives||{}))
  for(const [id,value] of Object.entries(entry?.targets||{}))
   totals[id]=(totals[id]||0)+(Number(value)||0);
 return totals;
}
export function hasGoalInMonth(p,month){
 if(!hasMonthlyObjectives(p))return keys(p?.targets).length>0;
 return keys(monthlyObjectiveEntry(p,month)?.targets).length>0;
}
export function monthlyGoalMonths(p){
 return keys(p?.monthlyObjectives).filter(m=>MONTH.test(m)&&hasGoalInMonth(p,m)).sort();
}
export function objectiveHistoryAnchor(month,today){
 // Mantener Mes anterior, mismo mes de hace 1 año y hace 2 años.
 // El simulador existente recibe una fecha dentro del mes del objetivo.
 return MONTH.test(month||"")?month+"-15":today;
}
export function historicPeriodAvailable(p,today){
 // No presentar cero ventas como histórico de un mes todavía sin terminar.
 return Boolean(p?.from&&p?.to&&p.from<=today&&
  (p.id==="custom"?p.to<=today:p.to<today));
}
export function sanitizeMonthlyObjectives(p,allowed){
 const input=p?.monthlyObjectives;
 if(input===undefined)return true;
 if(!input||typeof input!=="object"||Array.isArray(input)||keys(input).length>60)return false;
 const validMonths=new Set(promotionObjectiveMonths(p));
 return Object.entries(input).every(([month,entry])=>
  MONTH.test(month)&&validMonths.has(month)&&entry&&typeof entry==="object"&&
  !Array.isArray(entry)&&entry.targets&&typeof entry.targets==="object"&&
  !Array.isArray(entry.targets)&&keys(entry.targets).length<=500&&
  Object.entries(entry.targets).every(([id,value])=>
   allowed.has(String(id))&&Number.isSafeInteger(Number(value))&&Number(value)>=0)
 );
}
