const ISO=value=>/^20\d{2}-\d{2}-\d{2}$/.test(value||"");
export const first=(year,month)=>new Date(Date.UTC(year,month,1)).toISOString().slice(0,10);
const last=(year,month)=>new Date(Date.UTC(year,month+1,0)).toISOString().slice(0,10);
const DATE_LIMIT_DAYS=366;

export function simulatorPeriods(today,customFrom,customTo){
 const year=Number(today.slice(0,4)),month=Number(today.slice(5,7))-1;
 return [
  {id:"previous",label:"Mes anterior",from:first(year,month-1),to:last(year,month-1)},
  {id:"year",label:"Mismo mes hace 1 año",from:first(year-1,month-1),to:last(year-1,month-1)},
  {id:"twoYears",label:"Mismo mes hace 2 años",from:first(year-2,month-1),to:last(year-2,month-1)},
  {id:"custom",label:"Período seleccionado",from:customFrom,to:customTo}
 ];
}
export function validSimulatorPeriod(from,to){
 if(!ISO(from)||!ISO(to))return false;
 const start=Date.parse(from+"T00:00:00Z"),end=Date.parse(to+"T00:00:00Z");
 return Number.isFinite(start)&&Number.isFinite(end)&&end>=start&&
  (end-start)<=DATE_LIMIT_DAYS*86400000&&
  new Date(start).toISOString().slice(0,10)===from&&
  new Date(end).toISOString().slice(0,10)===to;
}
export function simulatorTarget(base,percent){
 const units=Number(base),rate=Number(percent);
 return Number.isFinite(units)&&Number.isFinite(rate)?
  Math.max(0,Math.ceil(units*(100+rate)/100-1e-9)):0;
}
