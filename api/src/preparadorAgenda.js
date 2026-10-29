import {randomUUID} from "node:crypto";

const VALID_ID=/^P:[1-9][0-9]{0,17}$/;
const VALID_DATE=/^\d{4}-\d{2}-\d{2}$/;
const VALID_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const READY=["DIRECTO","VACUNAS","FÓRMULAS"];
export const civilDays=(from,to)=>Math.round((Date.parse(to+"T00:00:00Z")-Date.parse(from+"T00:00:00Z"))/86400000);
export const validOrderDate=date=>VALID_DATE.test(date)&&
 !Number.isNaN(Date.parse(date+"T00:00:00Z"))&&
 new Date(date+"T00:00:00Z").toISOString().slice(0,10)===date;
// Un pedido tiene un solo vencimiento por laboratorio y por cliente, no
// una fecha distinta para cada farmacia. Los CN se cuentan una sola vez.
// La previsión sin pedidos reales es únicamente visual, no se guarda en DB.
// Distribuimos de forma estable los laboratorios por ciclos de su frecuencia.
// Al avanzar el día, un turno de demostración que no se confirmó se desplaza
// al próximo ciclo: nunca se acumulan vencidos ni se inventa un historial.
// Los laboratorios con un pedido real usan exclusivamente fechas reales.
export function buildAgenda(raw,today){
 const dayNumber=Math.floor(Date.parse(today+"T00:00:00Z")/86400000);
 const groups=new Map();
 for(const row of raw){
  if(row.lastOrder)continue;
  const days=Number(row.days);
  if(!groups.has(days))groups.set(days,[]);
  groups.get(days).push(row);
 }
 const previewOffsets=new Map();
 for(const [days,rows] of groups){
  rows.sort((a,b)=>Number(a.id)-Number(b.id));
  rows.forEach((r,index)=>{
   // Una vez asignada la fase a cada laboratorio, su turno se mueve con el
   // calendario sin persistir pedidos ficticios.
   const offset=((index-dayNumber)%days+days)%days;
   previewOffsets.set(String(r.id),offset);
  });
 }
 return raw.map(r=>{
  const days=Number(r.days),last=r.lastOrder||null,demo=!last;
  const offset=demo?previewOffsets.get(String(r.id))??0:null;
  const next=demo?new Date(Date.parse(today+"T00:00:00Z")+offset*86400000).toISOString().slice(0,10):
   new Date(Date.parse(last+"T00:00:00Z")+days*86400000).toISOString().slice(0,10);
  const until=civilDays(today,next);
  const status=until<0?"vencido":until===0?"hoy":until===1?"manana":"proximo";
  return {key:"P:"+r.id,name:r.name,days,lastOrder:last,nextDue:next,
   daysUntil:until,status,cn:Number(r.cn||0),demo,
   overdue:Number(status==="vencido"),today:Number(status==="hoy"),
   tomorrow:Number(status==="manana"),withoutDate:0,
   priority:status==="vencido"?0:status==="hoy"?1:status==="manana"?2:3};
 }).sort((a,b)=>a.priority-b.priority||(a.nextDue||"9999").localeCompare(b.nextDue||"9999")||
  a.name.localeCompare(b.name,"es"));
}

export function setupPreparadorAgenda(app,pool,{requireTenant}){
 const auth=requireTenant();
 const allowed=req=>new Set((req.context.pharmacies||[]).map(p=>Number(p.id)));
 const canRead=req=>req.context.role==="superadministrador"||req.context.modules?.compras===true;
 const canWrite=req=>canRead(req)&&["superadministrador","administrador","gestor"].includes(req.context.role);
 const clientSlug=req=>req.context.client.slug;
 const idFromKey=value=>VALID_ID.test(String(value||""))?String(value).slice(2):null;
 const error=(res,status,message)=>res.status(status).json({error:message});
 const fail=(next,e)=>next(e);

 app.get("/api/analytics/pedidos/agenda",...auth,async(req,res,next)=>{
  if(!canRead(req))return error(res,403,"Compras no habilitado");
  try{
   const {rows}=await pool.query({text:`
    SELECT p.id::text,p.nombre AS name,fr.intervalo_dias AS days,
     last_order.fecha::text AS "lastOrder",
     (now() AT TIME ZONE 'Europe/Madrid')::date::text AS today,
     (SELECT count(*)::int FROM farmetrica.preparador_ultima_recepcion_cache c
      WHERE c.cliente_slug=p.cliente_slug AND c.lab_id=p.id) AS cn
    FROM farmetrica.preparador_frecuencia_laboratorio fr
    JOIN farmetrica.proveedores_unificados p
     ON p.cliente_slug=fr.cliente_slug AND fr.laboratorio_clave='P:'||p.id::text
    LEFT JOIN LATERAL (
     SELECT fecha FROM farmetrica.preparador_pedidos_globales g
     WHERE g.cliente_slug=p.cliente_slug AND g.laboratorio_id=p.id
      AND g.anulado_en IS NULL
     ORDER BY fecha DESC,confirmado_en DESC LIMIT 1
    ) global_order ON true
    LEFT JOIN LATERAL (
     SELECT max(e.fecha) AS fecha FROM farmetrica.preparador_pedidos_realizados e
     WHERE e.cliente_slug=p.cliente_slug AND e.laboratorio_id=p.id
      AND e.anulado_en IS NULL
    ) previous_order ON global_order.fecha IS NULL
    LEFT JOIN LATERAL (
     SELECT coalesce(global_order.fecha,previous_order.fecha) AS fecha
    ) last_order ON true
    WHERE fr.cliente_slug=$1 AND fr.intervalo_dias BETWEEN 1 AND 365
     AND p.activo AND p.clase=ANY($2::text[])
     AND EXISTS(SELECT 1 FROM farmetrica.preparador_ultima_recepcion_cache c
      WHERE c.cliente_slug=p.cliente_slug AND c.lab_id=p.id)
    ORDER BY p.nombre`,values:[clientSlug(req),READY],query_timeout:7000});
   const today=rows[0]?.today||
    new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Madrid",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
   res.json({today,items:buildAgenda(rows,today)});
  }catch(e){fail(next,e)}
 });
 app.get("/api/analytics/pedidos/agenda/historial",...auth,async(req,res,next)=>{
  if(!canRead(req))return error(res,403,"Compras no habilitado");
  const labId=idFromKey(req.query.laboratorio);
  if(!labId)return error(res,400,"Laboratorio inválido");
  try{
   const {rows}=await pool.query({text:`
    SELECT * FROM (
     SELECT grupo_id::text AS "groupId",fecha::text AS date,
      tipo AS type,confirmado_por AS actor,confirmado_en AS "confirmedAt",
      anulado_en AS "cancelledAt",'global' AS scope
     FROM farmetrica.preparador_pedidos_globales
     WHERE cliente_slug=$1 AND laboratorio_id=$2
     UNION ALL
     SELECT e.grupo_id::text,e.fecha::text,e.tipo,e.confirmado_por,
      e.confirmado_en,e.anulado_en,'anterior' AS scope
     FROM farmetrica.preparador_pedidos_realizados e
     WHERE e.cliente_slug=$1 AND e.laboratorio_id=$2
     GROUP BY e.grupo_id,e.fecha,e.tipo,e.confirmado_por,e.confirmado_en,e.anulado_en
    ) history ORDER BY "confirmedAt" DESC LIMIT 60`,
    values:[clientSlug(req),labId],query_timeout:5000});
   res.json({items:rows});
  }catch(e){fail(next,e)}
 });
 app.post("/api/analytics/pedidos/agenda/realizados",...auth,async(req,res,next)=>{
  if(!canWrite(req))return error(res,403,"No tienes permiso para confirmar pedidos");
  const labId=idFromKey(req.body?.laboratorio);
  const date=String(req.body?.fecha||""),type=String(req.body?.tipo||"pedido");
  if(!labId||!validOrderDate(date)||!["pedido","fecha_inicial"].includes(type))
   return error(res,400,"Revisa laboratorio y fecha");
  try{
   const group=randomUUID();
   const {rows}=await pool.query(`
    INSERT INTO farmetrica.preparador_pedidos_globales
     (cliente_slug,laboratorio_id,grupo_id,fecha,tipo,confirmado_por)
    SELECT $1,p.id,$3::uuid,$4::date,$5,$6
    FROM farmetrica.proveedores_unificados p
    WHERE p.cliente_slug=$1 AND p.id=$2 AND p.activo AND p.clase=ANY($7::text[])
     AND $4::date<=(now() AT TIME ZONE 'Europe/Madrid')::date
    RETURNING grupo_id::text AS "groupId"`,
    [clientSlug(req),labId,group,date,type,req.user?.email||"usuario",READY]);
   if(!rows.length)return error(res,400,"Laboratorio inactivo o fecha futura");
   res.status(201).json({saved:true,groupId:group,date,scope:"global"});
  }catch(e){fail(next,e)}
 });
 app.delete("/api/analytics/pedidos/agenda/realizados/:group",...auth,async(req,res,next)=>{
  if(!canWrite(req))return error(res,403,"No tienes permiso para anular confirmaciones");
  const group=String(req.params.group||"");
  if(!VALID_UUID.test(group))return error(res,400,"Confirmación inválida");
  const db=await pool.connect();
  try{
   await db.query("BEGIN");
   const {rows}=await db.query(`UPDATE farmetrica.preparador_pedidos_globales
    SET anulado_en=now(),anulado_por=$3
    WHERE cliente_slug=$1 AND grupo_id=$2 AND anulado_en IS NULL
    RETURNING id`,[clientSlug(req),group,req.user?.email||"usuario"]);
   if(!rows.length){
    // Historial anterior: conservar la posibilidad de anular íntegramente
    // un grupo legado (nunca solo una farmacia).
    const legacy=await db.query(`UPDATE farmetrica.preparador_pedidos_realizados
     SET anulado_en=now(),anulado_por=$3
     WHERE cliente_slug=$1 AND grupo_id=$2 AND anulado_en IS NULL
      AND NOT EXISTS (
       SELECT 1 FROM farmetrica.preparador_pedidos_realizados e
       WHERE e.cliente_slug=$1 AND e.grupo_id=$2 AND e.farmacia_id<>ALL($4::int[]))
     RETURNING id`,[clientSlug(req),group,req.user?.email||"usuario",[...allowed(req)]]);
    if(!legacy.rowCount){await db.query("ROLLBACK");return error(res,404,"Confirmación no encontrada o sin permisos")}
   }
   await db.query("COMMIT");res.json({cancelled:true});
  }catch(e){await db.query("ROLLBACK").catch(()=>{});fail(next,e)}
  finally{db.release()}
 });
}
