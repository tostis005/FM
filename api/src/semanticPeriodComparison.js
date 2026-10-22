// Comparaciones auditables entre períodos relativos de Farmétrica.
// Una sola regla para todas las IA. No se infieren períodos no mencionados.
export const COMPARISON_VERSION="farmetrica.comparison.v1";
const norm=s=>String(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
 .replace(/\s+/g," ").trim();
const iso=(y,m,d)=>[y,String(m).padStart(2,"0"),String(d).padStart(2,"0")].join("-");
const lastDay=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();
const addDays=(date,offset)=>{
 const d=new Date(date+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+offset);
 return d.toISOString().slice(0,10);
};
const todayMadrid=now=>{
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Madrid",year:"numeric",
  month:"2-digit",day:"2-digit"}).formatToParts(now);
 const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 return p.year+"-"+p.month+"-"+p.day;
};
const monthComparison=now=>{
 const day=todayMadrid(now),[y,m,d]=day.split("-").map(Number);
 const previous=m===1?{y:y-1,m:12}:{y,m:m-1};
 // Mismo número de días para no comparar un mes incompleto con otro completo.
 const n=Math.min(d,lastDay(previous.y,previous.m));
 return {actual:{desde:iso(y,m,1),hasta:iso(y,m,n)},
  anterior:{desde:iso(previous.y,previous.m,1),hasta:iso(previous.y,previous.m,n)}};
};
const yearComparison=now=>{
 const day=todayMadrid(now),[y,m,d]=day.split("-").map(Number);
 const currentDay=Math.min(d,lastDay(y-1,m));
 return {actual:{desde:iso(y,1,1),hasta:iso(y,m,currentDay)},
  anterior:{desde:iso(y-1,1,1),hasta:iso(y-1,m,currentDay)}};
};
const weekComparison=now=>{
 const day=todayMadrid(now),dow=new Date(day+"T12:00:00Z").getUTCDay();
 const first=addDays(day,-((dow+6)%7));
 return {actual:{desde:first,hasta:day},
  anterior:{desde:addDays(first,-7),hasta:addDays(day,-7)}};
};
const dayComparison=now=>{
 const day=todayMadrid(now),prev=addDays(day,-1);
 return {actual:{desde:day,hasta:day},anterior:{desde:prev,hasta:prev}};
};
const TRIGGER=/\b(respecto|frente al?|versus|vs|compara|comparar|comparadas?|comparados?|comparacion|variacion|diferencia|crecimiento|evolucion|aumentad[oa]s?|aumentaron|mejorado)\b/g;
const PERIODS=[
 {label:"mes",match:/\b(mes pasado|mes anterior)\b/,remove:/\b(este mes|mes actual|mes pasado|mes anterior)\b/g,now:"este mes",calc:monthComparison},
 {label:"anio",match:/\b(ano pasado|anio pasado)\b/,remove:/\b(este ano|este anio|ano actual|anio actual|ano pasado|anio pasado)\b/g,now:"este año",calc:yearComparison},
 {label:"semana",match:/\bsemana pasada\b/,remove:/\b(esta semana|semana actual|semana pasada)\b/g,now:"esta semana",calc:weekComparison},
 {label:"dia",match:/\bayer\b/,remove:/\b(hoy|ayer)\b/g,now:"hoy",calc:dayComparison}
];
const unsupported=msg=>({estado:"no_disponible",mensaje:msg});
// Devuelve null si NO es una comparación; de otro modo dos períodos concretos o un error.
export function parsePeriodComparison(question,{now=new Date()}={}){
 const q=norm(question);
 if(!new RegExp(TRIGGER.source).test(q))return null;
 const candidates=PERIODS.filter(x=>x.match.test(q));
 if(candidates.length!==1)return unsupported("Indica qué dos períodos quieres comparar, por ejemplo este mes respecto al mes pasado.");
 const slot=candidates[0];
 // Ni cambiar automáticamente las fechas de una consulta ambigua ni ofrecer una falsa comparación.
 const without=q.replace(slot.remove," ");
 if(/\b(20\d{2}|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|desde|hasta|entre|ultimos|historico)\b/.test(without))
  return unsupported("Para esta comparación indica solo períodos relativos compatibles; no mezcles fechas distintas.");
 if(/\b(este mes|mes actual|mes pasado|mes anterior|esta semana|semana pasada|este ano|este anio|ano pasado|anio pasado|ayer|hoy)\b/.test(without))
  return unsupported("La comparación mezcla períodos incompatibles.");
 const stripped=without.replace(TRIGGER," ").replace(/\b(con(?:tra)?|al|el|la|los|las|que|como|ha|han|su|sus)\b/g," ").replace(/\s+/g," ").trim();
 if(stripped.length<3)return unsupported("Indica también qué dato o dimensión quieres comparar.");
 return {version:COMPARISON_VERSION,modo:"comparacion",
  tipo:slot.label,preguntaBase:stripped+" "+slot.now,...slot.calc(now)};
}
