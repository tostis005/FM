import {randomUUID} from "node:crypto";

export const STATES={
 oportunidades:["nueva","en_estudio","en_curso","aplicada_parcialmente","aplicada","descartada","pospuesta"],
 pedidos:["borrador","pendiente_aprobacion","aprobado","exportado","recibido","cancelado"],
 trabajo:["pendiente","en_curso","resuelta","descartada","pospuesta"],
 traspasos:["propuesta","en_revision","aprobada","realizada","descartada"]
};
export const RESOURCES={oportunidades:"op_oportunidades",pedidos:"op_pedidos",trabajo:"op_trabajo",
 traspasos:"op_traspasos",politicas:"op_politicas_reposicion",resultados:"op_resultados_verificados"};
export const MODULE={oportunidades:"acciones",pedidos:"compras",trabajo:"acciones",traspasos:"stock",
 politicas:"reposicion",resultados:"rentabilidad"};
export const IMPACTS=["ahorro_potencial","mejora_margen","capital_liberable","riesgo"];
export const PRIORITIES=["critica","alta","media","baja"];
export const EDITABLE_ROLES=["superadministrador","administrador","gestor","farmacia"];
export const ADMIN_ROLES=["superadministrador","administrador"];
export function ensureValue(v,arr,label){
 if(!arr.includes(v))throw Error(label+" no válido.");
 return v;
}
export function clean(v,max=2000){return String(v??"").trim().slice(0,max)}
export function quantity(v,max=1000000){
 const n=Number(v);
 if(!Number.isSafeInteger(n)||n<0||n>max)throw Error("Cantidad inválida.");
 return n;
}
export function money(v,max=1e12){
 const n=Number(v);
 if(!Number.isFinite(n)||n<0||n>max)throw Error("Importe inválido.");
 return Math.round((n+Number.EPSILON)*100)/100;
}
export function normalizedLines(v){
 if(!Array.isArray(v)||v.length<1||v.length>150)throw Error("El pedido debe incluir de 1 a 150 necesidades.");
 const keys=new Set();
 return v.map(item=>{
  const id=clean(item?.id||randomUUID(),100),articulo=clean(item?.articulo,120),
   nombre=clean(item?.nombre,240),necesidad=quantity(item?.necesidad);
  if(!id||!articulo||!nombre||keys.has(articulo))throw Error("Los artículos deben ser únicos y estar identificados.");
  keys.add(articulo);
  const raw=item?.asignaciones??[];
  if(!Array.isArray(raw)||raw.length>16)throw Error("Reparto de proveedores inválido.");
  const proveedores=new Set();
  const asignaciones=raw.map(a=>{
   const proveedor=clean(a?.proveedor,120),unidades=quantity(a?.unidades);
   const coste=a?.coste===null||a?.coste===undefined||a?.coste===""?null:money(a.coste,1000000);
   if(!proveedor||proveedores.has(proveedor))throw Error("Proveedor duplicado o vacío.");
   proveedores.add(proveedor);
   return {proveedor,unidades,coste};
  });
  if(asignaciones.reduce((a,b)=>a+b.unidades,0)>necesidad)
   throw Error("La cantidad asignada supera la necesidad.");
  return {id,articulo,nombre,necesidad,asignaciones};
 });
}
export function pendingUnits(n){return n.necesidad-n.asignaciones.reduce((a,b)=>a+b.unidades,0)}
export function canTransition(kind,from,to){
 if(from===to)return kind==="pedidos"&&["borrador","pendiente_aprobacion"].includes(from);
 const transitions={
  pedidos:{borrador:["pendiente_aprobacion","cancelado"],pendiente_aprobacion:["borrador","aprobado","cancelado"],
   aprobado:["exportado","cancelado"],exportado:["recibido"],recibido:[],cancelado:[]},
  traspasos:{propuesta:["en_revision","descartada"],en_revision:["aprobada","descartada"],
   aprobada:["realizada","descartada"],realizada:[],descartada:[]}
 };
 if(kind==="oportunidades")return !["aplicada","descartada"].includes(from);
 if(kind==="trabajo")return !["resuelta","descartada"].includes(from);
 return Boolean(transitions[kind]?.[from]?.includes(to));
}
export function csvForPlan(lines){
 const protect=x=>{const str=String(x??"");return '"'+(/^[\\s]*[=+@-]/.test(str)?"'"+str:str).replaceAll('"','""')+'"'};
 const rows=[["Artículo","Descripción","Necesidad","Proveedor","Asignado","Coste unitario","Pendiente"]];
 for(const line of normalizedLines(lines)){
  if(!line.asignaciones.length)rows.push([line.articulo,line.nombre,line.necesidad,"",0,"",pendingUnits(line)]);
  else for(const a of line.asignaciones)rows.push([line.articulo,line.nombre,line.necesidad,
    a.proveedor,a.unidades,a.coste??"",pendingUnits(line)]);
 }
 return "\uFEFF"+rows.map(row=>row.map(protect).join(";")).join("\r\n");
}
