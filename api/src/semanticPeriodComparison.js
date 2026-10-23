// Comparaciones auditables entre períodos relativos de Farmétrica.
// Una sola regla para todas las IA. No se infieren períodos no mencionados.
export const COMPARISON_VERSION="farmetrica.comparison.v2";
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

const MON={enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,
 septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12};
const MONTH_NAMES=Object.keys(MON).join("|");
const validateDate=(y,m,d)=>{
 if(y<2000||y>2100||m<1||m>12||d<1||d>lastDay(y,m))return null;
 return iso(y,m,d);
};
const explicitError=()=>unsupported("Indica dos períodos completos y válidos, por ejemplo enero de 2026 frente a febrero de 2026.");
const daySpan=period=>(Date.parse(period.hasta+"T00:00:00Z")-
 Date.parse(period.desde+"T00:00:00Z"))/86400000+1;
// Fechas explícitas delimitadas en texto; rechaza ambigüedad en vez de
// cambiar silenciosamente año, mes o el sentido de la comparación.
function parseExplicitComparison(q){
 const candidates=[];
 let rest=q;
 const capture=(regex,toRange)=>{
  rest=rest.replace(regex,(text,...args)=>{
   const info=toRange(args);
   candidates.push({marker:"__p"+candidates.length+"__",range:info,text});
   return "__p"+(candidates.length-1)+"__";
  });
 };
 // Intervalo con mes/año en ambos extremos.
 capture(new RegExp("\\b(?:desde\\s+(?:el\\s+)?|del\\s+)(\\d{1,2})\\s+de\\s+("+MONTH_NAMES+
  ")\\s+(?:de|del)\\s+(20\\d{2})\\s+(?:hasta\\s+(?:el\\s+)?|al\\s+(?:el\\s+)?)(\\d{1,2})\\s+de\\s+("+MONTH_NAMES+
  ")\\s+(?:de|del)\\s+(20\\d{2})\\b","g"),a=>({
  desde:validateDate(Number(a[2]),MON[a[1]],Number(a[0])),
  hasta:validateDate(Number(a[5]),MON[a[4]],Number(a[3]))
 }));
 // Intervalo corto dentro de un mismo mes.
 capture(new RegExp("\\b(?:del\\s+|entre\\s+(?:el\\s+)?)(\\d{1,2})\\s+(?:al\\s+(?:el\\s+)?|y\\s+(?:el\\s+)?)(\\d{1,2})\\s+de\\s+("+MONTH_NAMES+
  ")\\s+(?:de|del)\\s+(20\\d{2})\\b","g"),a=>({
  desde:validateDate(Number(a[3]),MON[a[2]],Number(a[0])),
  hasta:validateDate(Number(a[3]),MON[a[2]],Number(a[1]))
 }));
 // Intervalo 01/10/2026 al 15/10/2026.
 capture(/\b(?:del\s+|desde\s+)?(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\s+(?:al|hasta)\s+(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/g,a=>({
  desde:validateDate(Number(a[2]),Number(a[1]),Number(a[0])),
  hasta:validateDate(Number(a[5]),Number(a[4]),Number(a[3]))
 }));
 // Días sueltos con fecha completa.
 capture(new RegExp("\\b(\\d{1,2})\\s+de\\s+("+MONTH_NAMES+
  ")\\s+(?:de|del)\\s+(20\\d{2})\\b","g"),a=>{
  const date=validateDate(Number(a[2]),MON[a[1]],Number(a[0]));
  return {desde:date,hasta:date};
 });
 capture(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/g,a=>{
  const date=validateDate(Number(a[2]),Number(a[1]),Number(a[0]));
  return {desde:date,hasta:date};
 });
 // Mes/año exacto.
 capture(new RegExp("\\b("+MONTH_NAMES+")\\s+(?:de\\s+|del\\s+)?(20\\d{2})\\b","g"),a=>{
  const y=Number(a[1]),m=MON[a[0]];
  return {desde:validateDate(y,m,1),hasta:validateDate(y,m,lastDay(y,m))};
 });
 // Año completo; el mes/año ya sustituido no aporta años duplicados.
 capture(/\b(20\d{2})\b/g,a=>({
  desde:validateDate(Number(a[0]),1,1),hasta:validateDate(Number(a[0]),12,31)
 }));
 if(!candidates.length)return null;
 if(candidates.length!==2)return explicitError();
 const ordered=[...rest.matchAll(/__p(\d+)__/g)].map(m=>Number(m[1]));
 if(ordered.length!==2)return explicitError();
 const [left,right]=ordered.map(i=>candidates[i].range);
 if([left,right].some(p=>!p.desde||!p.hasta||p.desde>p.hasta))return explicitError();
 const indices=[...rest.matchAll(/__p\d+__/g)];
 const middle=rest.slice(indices[0].index+indices[0][0].length,indices[1].index);
 if(!/\b(frente\s+a|respecto\s+a|versus|vs|contra|con|y)\b/.test(middle))
  return unsupported("Indica qué período comparas frente a cuál, separándolos por 'frente a', 'con' o 'vs'.");
 // Debe ser imposible que quede una tercera referencia temporal sin parsear.
 const leftover=rest.replace(/__p\d+__/g," ");
 if(/\b(20\d{2}|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|hoy|ayer|mes\s+pasado|este\s+mes|ano\s+pasado|este\s+ano)\b/.test(leftover))
  return unsupported("La comparación mezcla fechas o períodos incompatibles.");
 const questionBase=leftover.replace(TRIGGER," ").replace(/\b(frente\s+a|respecto\s+a|versus|vs|con|contra|y|el|la|los|las|del|de|al|que|ha|han|su|sus)\b/g," ")
  .replace(/\s+/g," ").trim();
 if(questionBase.length<3)return unsupported("Indica qué dato de Farmétrica deseas comparar.");
 return {version:COMPARISON_VERSION,modo:"comparacion",tipo:"explicita",
  preguntaBase:questionBase+" hoy",actual:left,anterior:right,
  dias_actual:daySpan(left),dias_anterior:daySpan(right)};
}

// Devuelve null si NO es una comparación; de otro modo dos períodos concretos o un error.
export function parsePeriodComparison(question,{now=new Date()}={}){
 const q=norm(question);
 if(!new RegExp(TRIGGER.source).test(q))return null;
 const explicit=parseExplicitComparison(q);
 if(explicit)return explicit;
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
