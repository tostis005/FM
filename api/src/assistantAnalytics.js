// Catálogo de consultas SQL de solo lectura. La IA nunca genera SQL ejecutable.
import { pharmacyDataCodeSQL } from "./pharmacyCodes.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
export const TOOL_NAMES=["ventas_resumen","compras_resumen","stock_capital","ventas_articulos"];
export const TOOL_CATALOG=Object.freeze({
 ventas_resumen:{module:"ventas",label:"Ventas del período"},
 compras_resumen:{module:"compras",label:"Compras del período"},
 stock_capital:{module:"stock",label:"Capital en existencias (estimación)"},
 ventas_articulos:{module:"ventas",label:"Artículos más vendidos"}
});
export function quoteSchema(schema){
 if(!SCHEMA.test(schema||""))throw Error("Esquema no autorizado");
 return '"'+schema+'"';
}
export function isoDay(date){return date.toISOString().slice(0,10);}
function madridToday(now=new Date()){
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Madrid",day:"2-digit",month:"2-digit",year:"numeric"}).formatToParts(now);
 const field=key=>parts.find(x=>x.type===key)?.value;
 return [field("year"),field("month"),field("day")].join("-");
}
function shifted(date,amount){
 const d=new Date(date+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+amount);return isoDay(d);
}
export function periodFromQuestion(question="",now=new Date()){
 const today=madridToday(now),q=String(question).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 const y=Number(today.slice(0,4)),m=Number(today.slice(5,7));
 const first=(year,month)=>[year,String(month).padStart(2,"0"),"01"].join("-");
 if(/mes pasado|mes anterior/.test(q))return {from:first(m===1?y-1:y,m===1?12:m-1),to:shifted(first(y,m),-1),label:"mes pasado"};
 if(/este mes|mes actual/.test(q))return {from:first(y,m),to:today,label:"mes actual"};
 if(/ayer/.test(q))return {from:shifted(today,-1),to:shifted(today,-1),label:"ayer"};
 if(/\bhoy\b/.test(q))return {from:today,to:today,label:"hoy"};
 if(/este ano|ano actual/.test(q))return {from:first(y,1),to:today,label:"año actual"};
 if(/ultim[oa]s? (?:siete|7) dias/.test(q))return {from:shifted(today,-6),to:today,label:"últimos 7 días"};
 if(/ultim[oa]s? (?:noventa|90) dias|ultim[oa]s? tres meses/.test(q))return {from:shifted(today,-89),to:today,label:"últimos 90 días"};
 return {from:shifted(today,-29),to:today,label:"últimos 30 días"};
}
export function selectTools(question,context){
 const q=String(question).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 const can=key=>context.role==="superadministrador"||context.modules?.[key]===true||(key==="ventas"&&context.modules?.dashboard===true);
 const found=[];
 if(/stock|inmoviliz|sobrestock|existencia|almacen/.test(q))found.push("stock_capital");
 if(/compr|proveedor|recepcion|coste de adquisicion/.test(q))found.push("compras_resumen");
 if(/producto|articulo|referencia|generico|rotaci|mas vendido|ranking|top /.test(q))found.push("ventas_articulos");
 if(/venta|factur|ingres|margen|rentab|beneficio|compar|evoluc|tendenc/.test(q))found.push("ventas_resumen");
 return [...new Set(found)].filter(name=>can(TOOL_CATALOG[name].module)).slice(0,2);
}
export function authorizedIds(context,requested=[]){
 const allowed=context.allowedPharmacyIds.map(Number);
 if(!Array.isArray(requested)||requested.length>50||requested.some(x=>!Number.isInteger(x)||!allowed.includes(x)))
  throw Error("Farmacias no autorizadas");
 return requested.length?[...new Set(requested)]:[...new Set(allowed)];
}
export function normalizedPeriod(period){
 if(!period||!DATE.test(period.from)||!DATE.test(period.to)||period.from>period.to||
    !Number.isFinite(Date.parse(period.from))||!Number.isFinite(Date.parse(period.to))||
    Date.parse(period.to)-Date.parse(period.from)>366*86400000)throw Error("Período inválido");
 return period;
}
export async function runAssistantTool(db,context,name,period,ids=[]){
 if(!TOOL_CATALOG[name])throw Error("Herramienta desconocida");
 const module=TOOL_CATALOG[name].module;
 if(context.role!=="superadministrador"&&!context.modules?.[module]&&!(module==="ventas"&&context.modules?.dashboard))
  return {tool:name,available:false,reason:"Módulo no autorizado"};
 const schema=quoteSchema(context.client.schema),permitted=authorizedIds(context,ids),dates=normalizedPeriod(period);
 if(!permitted.length)return {tool:name,available:true,period:dates,pharmacies:0,rows:[]};
 const join="JOIN farmetrica.farmacias f ON f.cliente_slug=$4 AND upper(btrim(t.farmacia_codigo))="+pharmacyDataCodeSQL("f");
 const where="f.id=ANY($3::int[]) AND t.fecha >= $1::date AND t.fecha < ($2::date+interval '1 day')";
 const params=[dates.from,dates.to,permitted,context.client.slug];
 let sql;
 if(name==="ventas_resumen")sql="SELECT f.nombre AS farmacia,count(*)::int AS movimientos,sum(t.unidades)::float8 AS unidades,sum(t.importe)::float8 AS importe FROM "+schema+".ventas t "+join+" WHERE "+where+" GROUP BY f.id,f.nombre ORDER BY f.nombre";
 else if(name==="compras_resumen")sql="SELECT f.nombre AS farmacia,count(*)::int AS recepciones_lineas,count(*) FILTER(WHERE t.articulo_id IS NOT NULL)::int AS lineas_con_articulo,sum(t.unidades)::float8 AS unidades,sum(t.importe)::float8 AS importe FROM "+schema+".compras t "+join+" WHERE "+where+" GROUP BY f.id,f.nombre ORDER BY f.nombre";
 else if(name==="ventas_articulos")sql="SELECT coalesce(nullif(a.nombre,''),t.articulo_id,'Sin referencia') AS articulo,coalesce(nullif(a.codigo_nacional,''),'') AS cn,sum(t.unidades)::float8 AS unidades,sum(t.importe)::float8 AS importe FROM "+schema+".ventas t "+join+" LEFT JOIN "+schema+".articulos a ON upper(btrim(a.farmacia_codigo))=upper(btrim(t.farmacia_codigo)) AND a.origen_id=t.articulo_id WHERE "+where+" AND nullif(trim(t.articulo_id),'') IS NOT NULL GROUP BY a.nombre,a.codigo_nacional,t.articulo_id ORDER BY sum(t.importe) DESC NULLS LAST LIMIT 15";
 else if(name==="stock_capital")sql="SELECT f.nombre AS farmacia,count(*) FILTER(WHERE t.stock_actual>0)::int AS referencias_con_stock,sum(greatest(t.stock_actual,0)*t.pmc) FILTER(WHERE t.stock_actual>0 AND t.pmc>0)::float8 AS capital_estimado,count(*) FILTER(WHERE t.stock_actual>0 AND (t.pmc IS NULL OR t.pmc<=0))::int AS referencias_sin_coste,max(t.sincronizado_en) AS actualizado_en FROM "+schema+".articulos t JOIN farmetrica.farmacias f ON f.cliente_slug=$4 AND upper(btrim(t.farmacia_codigo))="+pharmacyDataCodeSQL("f")+" WHERE f.id=ANY($3::int[]) GROUP BY f.id,f.nombre ORDER BY f.nombre";
 try{
  const {rows}=await db.query(sql,params);
  return {tool:name,label:TOOL_CATALOG[name].label,period:name==="stock_capital"?"instantánea actual":dates,
    pharmacies:permitted.length,available:true,rows};
 }catch(error){
  if(["42P01","42703"].includes(error.code))return {tool:name,available:false,reason:"Tabla o campo pendiente de sincronización"};
  throw error;
 }
}
