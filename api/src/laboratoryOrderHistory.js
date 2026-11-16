import {randomUUID} from "node:crypto";
import {normalizeLaboratoryKey} from "./laboratoryCatalog.js";
import {normalizeDraftItems,pharmacyScope,validPlannerDate} from "./laboratoryOrderPlanner.js";

const VALID_LAB=/^P:[1-9][0-9]{0,17}$/;
const VALID_ID=/^[1-9][0-9]{0,17}$/;
const TYPES=new Set(["parafarmacia","medicacion"]);
const SOURCES=new Set(["preparador","excel"]);
const READY=["DIRECTO","VACUNAS","FÓRMULAS"];

function canSee(req){
 return req.context.role==="superadministrador"||req.context.modules?.compras===true;
}
function canRecord(req){
 return canSee(req)&&["administrador","gestor","superadministrador"].includes(req.context.role);
}
function canSeeOrder(req,order){
 if(!order)return false;
 const allowed=new Set((req.context.pharmacies||[]).map(p=>String(p.id)));
 return String(order.farmaciasClave||"").split(",").every(id=>allowed.has(id));
}
export function orderUnits(items,type){
 return items.reduce((sum,line)=>sum+(type==="parafarmacia"?
  Number(line.units||0):Object.values(line.unitsByPharmacy||{})
   .reduce((n,quantity)=>n+Number(quantity||0),0)),0);
}

export function setupLaboratoryOrderHistory(app,pool,{requireTenant}){
 const auth=requireTenant();
 app.get("/api/analytics/pedidos/historial",...auth,async(req,res,next)=>{
  if(!canSee(req))return res.status(403).json({error:"Compras no habilitado"});
  try{
   const {rows}=await pool.query({
    text:'SELECT h.id::text,laboratorio_clave AS "laboratorio",'+
     'laboratorio_nombre AS "laboratorioNombre",h.tipo,'+
     'farmacias_clave AS "farmaciasClave",fecha_pedido::text AS "fecha",'+
     'origen,archivo_nombre AS "archivoNombre",realizado_por AS "realizadoPor",'+
     'registrado_en AS "registradoEn",total_referencias AS "referencias",'+
     'total_unidades AS "unidades" '+
     'FROM farmetrica.pedidos_laboratorio_historial h '+
     'JOIN farmetrica.preparador_pedidos_globales g ON g.cliente_slug=h.cliente_slug '+
     'AND g.grupo_id=h.grupo_agenda AND g.anulado_en IS NULL '+
     'WHERE h.cliente_slug=$1 ORDER BY h.fecha_pedido DESC,h.id DESC LIMIT 500',
    values:[req.context.client.slug],query_timeout:5000
   });
   res.json({items:rows.filter(row=>canSeeOrder(req,row))});
  }catch(error){next(error)}
 });
 app.get("/api/analytics/pedidos/historial/:id",...auth,async(req,res,next)=>{
  if(!canSee(req))return res.status(403).json({error:"Compras no habilitado"});
  if(!VALID_ID.test(String(req.params.id||"")))
   return res.status(400).json({error:"Pedido inválido"});
  try{
   const {rows}=await pool.query({
    text:'SELECT h.id::text,laboratorio_clave AS "laboratorio",'+
     'laboratorio_nombre AS "laboratorioNombre",h.tipo,'+
     'farmacias_clave AS "farmaciasClave",fecha_pedido::text AS "fecha",'+
     'origen,archivo_nombre AS "archivoNombre",realizado_por AS "realizadoPor",'+
     'registrado_en AS "registradoEn",desde::text,hasta::text,'+
     'lineas,comentario_global AS "comentarioGlobal" '+
     'FROM farmetrica.pedidos_laboratorio_historial h '+
     'JOIN farmetrica.preparador_pedidos_globales g ON g.cliente_slug=h.cliente_slug '+
     'AND g.grupo_id=h.grupo_agenda AND g.anulado_en IS NULL '+
     'WHERE h.cliente_slug=$1 AND h.id=$2::bigint',
    values:[req.context.client.slug,req.params.id],query_timeout:5000
   });
   const record=rows[0];
   if(!canSeeOrder(req,record))return res.status(404).json({error:"Pedido no encontrado"});
   res.json(record);
  }catch(error){next(error)}
 });
 app.post("/api/analytics/pedidos/historial",...auth,async(req,res,next)=>{
  if(!canRecord(req))return res.status(403).json({error:"No tienes permiso para registrar pedidos"});
  const lab=normalizeLaboratoryKey(req.body?.laboratorio);
  const type=String(req.body?.tipo||""),date=String(req.body?.fecha||""),
   origin=String(req.body?.origen||"preparador"),
   from=req.body?.desde==null?null:String(req.body.desde),
   to=req.body?.hasta==null?null:String(req.body.hasta),
   comment=req.body?.comentarioGlobal??"",
   filename=req.body?.archivoNombre??null;
  const raw=req.body?.farmacias;
  const pharmacies=Array.isArray(raw)?raw.map(Number):null;
  const allowed=new Set((req.context.pharmacies||[]).map(p=>Number(p.id)));
  const validScope=pharmacies?.length>0&&pharmacies.length<=100&&
   pharmacies.every(id=>Number.isSafeInteger(id)&&allowed.has(id));
  const unique=validScope?[...new Set(pharmacies)]:[];
  const items=validScope&&TYPES.has(type)?normalizeDraftItems(req.body?.lineas,type,unique):null;
  const total=items?orderUnits(items,type):0;
  if(!VALID_LAB.test(lab)||!validScope||!TYPES.has(type)||
   !validPlannerDate(date)||!SOURCES.has(origin)||
   (from!==null&&!validPlannerDate(from))||(to!==null&&!validPlannerDate(to))||
   (from&&to&&from>to)||!items?.length||!Number.isSafeInteger(total)||total<=0||
   typeof comment!=="string"||comment.length>3000||
   (filename!==null&&(typeof filename!=="string"||filename.length>180||
    !/\.xlsx$/i.test(filename)))||(origin==="excel"&&!filename))
   return res.status(400).json({error:"Revisa fecha, laboratorio, cantidades o archivo del pedido"});
  const actor=String(req.user?.email||"").trim().toLowerCase();
  if(!actor)return res.status(401).json({error:"No se ha identificado el usuario autenticado"});
  const client=await pool.connect();
  try{
   await client.query("BEGIN");
   const {rows:labs}=await client.query(
    'SELECT nombre FROM farmetrica.proveedores_unificados '+
    'WHERE cliente_slug=$1 AND id=$2::bigint AND activo AND clase=ANY($3::text[])',
    [req.context.client.slug,lab.slice(2),READY]);
   if(!labs.length){
    await client.query("ROLLBACK");
    return res.status(400).json({error:"Laboratorio no disponible"});
   }
   const group=randomUUID();
   const {rows:agenda}=await client.query(
    'INSERT INTO farmetrica.preparador_pedidos_globales '+
    '(cliente_slug,laboratorio_id,grupo_id,fecha,tipo,confirmado_por) '+
    "SELECT $1,$2::bigint,$3::uuid,$4::date,'pedido',$5 "+
    "WHERE $4::date<=(now() AT TIME ZONE 'Europe/Madrid')::date "+
    'RETURNING grupo_id',
    [req.context.client.slug,lab.slice(2),group,date,actor]);
   if(!agenda.length){
    await client.query("ROLLBACK");
    return res.status(400).json({error:"La fecha del pedido no puede ser futura"});
   }
   const {rows:archived}=await client.query(
    'INSERT INTO farmetrica.pedidos_laboratorio_historial '+
    '(cliente_slug,laboratorio_clave,laboratorio_nombre,tipo,farmacias_clave,'+
    'fecha_pedido,origen,archivo_nombre,realizado_por,grupo_agenda,'+
    'desde,hasta,lineas,comentario_global,total_referencias,total_unidades) '+
    'VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10::uuid,'+
    '$11::date,$12::date,$13::jsonb,$14,$15,$16) RETURNING id::text',
    [req.context.client.slug,lab,labs[0].nombre,type,pharmacyScope(unique),
     date,origin,filename,actor,group,from,to,
     JSON.stringify(items),comment.trim(),items.length,total]);
   // Confirmar mueve el borrador al historial sin borrar borradores de otros
   // laboratorios. Importar un Excel no modifica borradores existentes.
   if(origin==="preparador")await client.query(
    'DELETE FROM farmetrica.pedidos_laboratorio_borradores '+
    'WHERE cliente_slug=$1 AND laboratorio_clave=$2 AND tipo=$3 AND farmacias_clave=$4',
    [req.context.client.slug,lab,type,pharmacyScope(unique)]);
   await client.query("COMMIT");
   res.status(201).json({saved:true,id:archived[0].id,fecha:date,realizadoPor:actor});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});next(error)}
  finally{client.release()}
 });
}
