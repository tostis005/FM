import {randomUUID} from "node:crypto";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

const VALID_ID=/^P:[1-9][0-9]{0,17}$/;
const VALID_DATE=/^\d{4}-\d{2}-\d{2}$/;
const VALID_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const READY=["DIRECTO","VACUNAS","FÓRMULAS"];
export const civilDays=(from,to)=>Math.round((Date.parse(to+"T00:00:00Z")-Date.parse(from+"T00:00:00Z"))/86400000);
export const validOrderDate=date=>VALID_DATE.test(date)&&
 !Number.isNaN(Date.parse(date+"T00:00:00Z"))&&
 new Date(date+"T00:00:00Z").toISOString().slice(0,10)===date;
export function buildAgenda(raw,today){
 const map=new Map();
 for(const r of raw){
  const key="P:"+r.id,days=Number(r.days),last=r.lastOrder||null;
  const next=last?new Date(Date.parse(last+"T00:00:00Z")+days*86400000).toISOString().slice(0,10):null;
  const until=next?civilDays(today,next):null;
  const status=until===null?"sin_fecha":until<0?"vencido":until===0?"hoy":until===1?"manana":"proximo";
  if(!map.has(key))map.set(key,{key,name:r.name,days,pharmacies:[]});
  map.get(key).pharmacies.push({id:Number(r.pharmacyId),name:r.pharmacyName,lastOrder:last,
    nextDue:next,daysUntil:until,status});
 }
 return [...map.values()].map(l=>{
  l.pharmacies.sort((a,b)=>(a.daysUntil??9999)-(b.daysUntil??9999)||a.name.localeCompare(b.name,"es"));
  l.overdue=l.pharmacies.filter(p=>p.status==="vencido").length;
  l.today=l.pharmacies.filter(p=>p.status==="hoy").length;
  l.tomorrow=l.pharmacies.filter(p=>p.status==="manana").length;
  l.withoutDate=l.pharmacies.filter(p=>p.status==="sin_fecha").length;
  l.nextDue=l.pharmacies.find(p=>p.nextDue)?.nextDue||null;
  l.priority=l.overdue?0:l.today?1:l.tomorrow?2:l.withoutDate===l.pharmacies.length?4:3;
  return l;
 }).sort((a,b)=>a.priority-b.priority||(a.nextDue||"9999").localeCompare(b.nextDue||"9999")||a.name.localeCompare(b.name,"es"));
}

export function setupPreparadorAgenda(app,pool,{requireTenant}){
 const auth=requireTenant();
 const allowed=req=>new Set((req.context.pharmacies||[]).map(p=>Number(p.id)));
 const canRead=req=>req.context.role==="superadministrador"||req.context.modules?.compras===true;
 const canWrite=req=>canRead(req)&&["superadministrador","administrador","gestor"].includes(req.context.role);
 const chosen=(req,value)=>{
  const valid=allowed(req),raw=typeof value==="string"?value.split(","):value;
  const ids=raw===undefined?[...valid]:raw;
  if(!Array.isArray(ids)||ids.length>100||ids.some(id=>!Number.isSafeInteger(Number(id))||!valid.has(Number(id))))
   return null;
  return [...new Set(ids.map(Number))].sort((a,b)=>a-b);
 };
 const clientSlug=req=>req.context.client.slug;
 const idFromKey=value=>VALID_ID.test(String(value||""))?String(value).slice(2):null;
 const error=(res,status,message)=>res.status(status).json({error:message});
 const fail=(next,e)=>next(e);

 app.get("/api/analytics/pedidos/agenda",...auth,async(req,res,next)=>{
  if(!canRead(req))return error(res,403,"Compras no habilitado");
  const ids=chosen(req,req.query.farmacias);
  if(!ids)return error(res,400,"Farmacias no autorizadas");
  if(!ids.length)return res.json({today:null,items:[]});
  try{
   const {rows}=await pool.query({text:`
    SELECT p.id::text,p.nombre AS name,fr.intervalo_dias AS days,
     f.id AS "pharmacyId",f.nombre AS "pharmacyName",
     last_order.fecha::text AS "lastOrder",
     (now() AT TIME ZONE 'Europe/Madrid')::date::text AS today
    FROM farmetrica.preparador_frecuencia_laboratorio fr
    JOIN farmetrica.proveedores_unificados p
     ON p.cliente_slug=fr.cliente_slug AND fr.laboratorio_clave='P:'||p.id::text
    JOIN farmetrica.farmacias f ON f.cliente_slug=p.cliente_slug
     AND f.id=ANY($2::int[]) AND f.activo=true
    LEFT JOIN LATERAL (
     SELECT e.fecha FROM farmetrica.preparador_pedidos_realizados e
     WHERE e.cliente_slug=p.cliente_slug AND e.laboratorio_id=p.id
      AND e.farmacia_id=f.id AND e.anulado_en IS NULL
     ORDER BY e.fecha DESC,e.confirmado_en DESC LIMIT 1
    ) last_order ON true
    WHERE fr.cliente_slug=$1 AND fr.intervalo_dias BETWEEN 1 AND 365
     AND p.activo=true AND p.clase=ANY($3::text[])
     AND EXISTS(
      SELECT 1 FROM farmetrica.proveedores_unificados_alias a
      WHERE a.cliente_slug=p.cliente_slug AND a.proveedor_id=p.id
       AND upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
     )
    ORDER BY p.nombre,f.nombre`,values:[clientSlug(req),ids,READY],query_timeout:7000});
   const today=rows[0]?.today||null;
   res.json({today,items:buildAgenda(rows,today)});
  }catch(e){fail(next,e)}
 });
 app.get("/api/analytics/pedidos/agenda/historial",...auth,async(req,res,next)=>{
  if(!canRead(req))return error(res,403,"Compras no habilitado");
  const labId=idFromKey(req.query.laboratorio),ids=chosen(req,req.query.farmacias);
  if(!labId||!ids)return error(res,400,"Laboratorio o farmacias inválidos");
  try{
   const {rows}=await pool.query({text:`
    SELECT e.grupo_id::text AS "groupId",e.fecha::text AS date,
     e.tipo AS type,e.confirmado_por AS actor,e.confirmado_en AS "confirmedAt",
     e.anulado_en AS "cancelledAt",array_agg(e.farmacia_id ORDER BY e.farmacia_id) AS "pharmacyIds"
    FROM farmetrica.preparador_pedidos_realizados e
    WHERE e.cliente_slug=$1 AND e.laboratorio_id=$2
     AND e.farmacia_id=ANY($3::int[])
     AND NOT EXISTS (
      SELECT 1 FROM farmetrica.preparador_pedidos_realizados other
      WHERE other.cliente_slug=e.cliente_slug AND other.grupo_id=e.grupo_id
       AND NOT (other.farmacia_id=ANY($3::int[]))
     )
    GROUP BY e.grupo_id,e.fecha,e.tipo,e.confirmado_por,e.confirmado_en,e.anulado_en
    ORDER BY e.confirmado_en DESC LIMIT 60`,values:[clientSlug(req),labId,ids],query_timeout:5000});
   res.json({items:rows});
  }catch(e){fail(next,e)}
 });
 app.post("/api/analytics/pedidos/agenda/realizados",...auth,async(req,res,next)=>{
  if(!canWrite(req))return error(res,403,"No tienes permiso para confirmar pedidos");
  const labId=idFromKey(req.body?.laboratorio),ids=chosen(req,req.body?.farmacias);
  const date=String(req.body?.fecha||""),type=String(req.body?.tipo||"pedido");
  if(!labId||!ids?.length||!validOrderDate(date)||!["pedido","fecha_inicial"].includes(type))
   return error(res,400,"Revisa laboratorio, farmacias y fecha");
  const db=await pool.connect();
  try{
   await db.query("BEGIN");
   const group=randomUUID();
   const result=await db.query(`
    INSERT INTO farmetrica.preparador_pedidos_realizados
     (cliente_slug,laboratorio_id,farmacia_id,grupo_id,fecha,tipo,confirmado_por)
    SELECT $1,p.id,f.id,$4::uuid,$5::date,$6,$7
    FROM farmetrica.proveedores_unificados p
    JOIN farmetrica.farmacias f ON f.cliente_slug=p.cliente_slug
     AND f.id=ANY($3::int[]) AND f.activo=true
    WHERE p.cliente_slug=$1 AND p.id=$2 AND p.activo=true AND p.clase=ANY($8::text[])
     AND EXISTS(
      SELECT 1 FROM farmetrica.proveedores_unificados_alias a
      WHERE a.cliente_slug=p.cliente_slug AND a.proveedor_id=p.id
       AND upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
     )
     AND $5::date<=(now() AT TIME ZONE 'Europe/Madrid')::date
    RETURNING farmacia_id`,
    [clientSlug(req),labId,ids,group,date,type,req.user?.email||"usuario",READY]);
   if(result.rows.length!==ids.length){
    await db.query("ROLLBACK");
    return error(res,400,"El laboratorio no está vinculado a todas las farmacias indicadas o la fecha es futura");
   }
   await db.query("COMMIT");
   res.status(201).json({saved:true,groupId:group,date,pharmacyIds:ids});
  }catch(e){await db.query("ROLLBACK").catch(()=>{});fail(next,e)}
  finally{db.release()}
 });
 app.delete("/api/analytics/pedidos/agenda/realizados/:group",...auth,async(req,res,next)=>{
  if(!canWrite(req))return error(res,403,"No tienes permiso para anular confirmaciones");
  const group=String(req.params.group||"");
  if(!VALID_UUID.test(group))return error(res,400,"Confirmación inválida");
  const db=await pool.connect();
  try{
   await db.query("BEGIN");
   const {rows}=await db.query(`SELECT farmacia_id,anulado_en FROM farmetrica.preparador_pedidos_realizados
    WHERE cliente_slug=$1 AND grupo_id=$2 FOR UPDATE`,[clientSlug(req),group]);
   if(!rows.length){await db.query("ROLLBACK");return error(res,404,"Confirmación no encontrada")}
   if(rows.some(r=>!allowed(req).has(Number(r.farmacia_id)))){
    await db.query("ROLLBACK");return error(res,403,"No tienes permiso para todas las farmacias del pedido");
   }
   if(rows.every(r=>r.anulado_en)){await db.query("ROLLBACK");return error(res,409,"La confirmación ya está anulada")}
   await db.query(`UPDATE farmetrica.preparador_pedidos_realizados
    SET anulado_en=now(),anulado_por=$3
    WHERE cliente_slug=$1 AND grupo_id=$2 AND anulado_en IS NULL`,
    [clientSlug(req),group,req.user?.email||"usuario"]);
   await db.query("COMMIT");res.json({cancelled:true});
  }catch(e){await db.query("ROLLBACK").catch(()=>{});fail(next,e)}
  finally{db.release()}
 });
}
