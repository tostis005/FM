// Escala visual de actividad: poco movimiento en amarillo verdoso,
// actividad media en amarillo/naranja y mayor afluencia en rojo.
export const HEAT_STOPS=["#c5df76","#e8e76c","#f4c34b","#e98131","#bf3025"];
export const HEAT_DAYS=["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];
export function heatColor(rank){
 const pos=Math.max(0,Math.min(1,Number(rank)||0))*(HEAT_STOPS.length-1);
 const start=Math.floor(pos),end=Math.min(start+1,HEAT_STOPS.length-1),fraction=pos-start;
 const one=HEAT_STOPS[start],two=HEAT_STOPS[end];
 const channel=i=>Math.round(parseInt(one.slice(i,i+2),16)*(1-fraction)+
  parseInt(two.slice(i,i+2),16)*fraction).toString(16).padStart(2,"0");
 return "#"+channel(1)+channel(3)+channel(5);
}
// Mantener la jornada 09:00–22:00 como referencia y añadir cualquier hora
// de fuera de ese horario que realmente haya registrado operaciones.
export function heatmapHours(cells=[]){
 const active=new Set(cells.filter(c=>Number(c.tickets)>0).map(c=>Number(c.hour)));
 return Array.from({length:24},(_,hour)=>({
  hour,label:String(hour).padStart(2,"0")+":00–"+
   String((hour+1)%24).padStart(2,"0")+":00"
 })).filter(h=>(h.hour>=9&&h.hour<=21)||active.has(h.hour));
}
// Las consultas de históricos largos se dividen por años y deben fusionarse
// sumando tickets del mismo día de la semana y la misma hora.
export function mergeSalesHeatmap(parts=[]){
 const counts=new Map();
 for(const part of parts){
  for(const cell of part.cells||[]){
   const weekday=Number(cell.weekday),hour=Number(cell.hour),
    tickets=Number(cell.tickets),units=Number(cell.units||0);
   if(!Number.isInteger(weekday)||weekday<1||weekday>7||
    !Number.isInteger(hour)||hour<0||hour>23||
    !Number.isSafeInteger(tickets)||tickets<0||!Number.isFinite(units))continue;
   const key=weekday+"|"+hour;
   const previous=counts.get(key)||{tickets:0,units:0};
   counts.set(key,{tickets:previous.tickets+tickets,units:previous.units+units});
  }
 }
 const cells=[...counts].map(([key,values])=>{
  const [weekday,hour]=key.split("|").map(Number);
  return {weekday,hour,...values};
 }).sort((a,b)=>a.hour-b.hour||a.weekday-b.weekday);
 return {cells,total:cells.reduce((sum,cell)=>sum+cell.tickets,0),
  totalUnits:cells.reduce((sum,cell)=>sum+cell.units,0)};
}
