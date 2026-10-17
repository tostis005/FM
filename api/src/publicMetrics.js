import {notificationConfig} from "./leadNotifications.js";
// Medición sin cookies ni identificación de visitantes: solo recuentos diarios por ruta.
const PUBLIC_PATH=/^\/(?:$|solicitar-demo\/$|soluciones\/$|integraciones\/$|blog\/$|soluciones\/[a-z0-9-]{1,110}\/$|integraciones\/[a-z0-9-]{1,110}\/$|blog\/[a-z0-9-]{1,110}\/$)/;
export function normalizePageview(body){
 if(!body||typeof body!=="object"||Array.isArray(body)||body.tipo!=="vista"||
  typeof body.ruta!=="string"||body.ruta.length>160||!PUBLIC_PATH.test(body.ruta))
   return null;
 return body.ruta;
}
export function createViewLimiter(now=()=>Date.now()){
 const buckets=new Map();
 return ip=>{
  const timestamp=now();
  if(buckets.size>3000){
    for(const [k,b] of buckets)if(timestamp-b.start>=60000)buckets.delete(k);
    while(buckets.size>3000)buckets.delete(buckets.keys().next().value);
  }
  const old=buckets.get(ip);
  if(!old||timestamp-old.start>=60000){buckets.set(ip,{start:timestamp,count:1});return true;}
  if(old.count>=30)return false;
  old.count++;return true;
 };
}
export function setupPublicMetrics(app,pool,{requireSuperadmin}){
 const accept=createViewLimiter();
 app.post("/api/public/metricas",async(req,res,next)=>{
  if(!req.is("application/json"))return res.sendStatus(415);
  const path=normalizePageview(req.body);
  if(!path)return res.sendStatus(400);
  // La IP solo se conserva hasta un minuto en memoria para controlar abusos.
  const ip=String(req.get("x-real-ip")||req.ip||"unknown").slice(0,70);
  if(!accept(ip))return res.sendStatus(204);
  try{
   await pool.query(
    "INSERT INTO farmetrica.visitas_publicas(dia,ruta,visitas) VALUES(current_date,$1,1) ON CONFLICT(dia,ruta) DO UPDATE SET visitas=farmetrica.visitas_publicas.visitas+1",
    [path]);
   return res.sendStatus(204);
  }catch(err){next(err);}
 });
 app.get("/api/admin/metricas-web",requireSuperadmin,async(_req,res,next)=>{
  try{
   const [top,days,leads,totals]=await Promise.all([
    pool.query("SELECT ruta,SUM(visitas)::integer AS visitas FROM farmetrica.visitas_publicas WHERE dia>=current_date-29 GROUP BY ruta ORDER BY visitas DESC LIMIT 12"),
    pool.query("SELECT dia::text AS dia,SUM(visitas)::integer AS visitas FROM farmetrica.visitas_publicas WHERE dia>=current_date-29 GROUP BY dia ORDER BY dia"),
    pool.query("SELECT origen,COUNT(*)::integer AS solicitudes FROM farmetrica.solicitudes_demo WHERE creado_en>=now()-interval '30 days' GROUP BY origen ORDER BY solicitudes DESC LIMIT 12"),
    pool.query("SELECT COUNT(*)::integer AS solicitudes FROM farmetrica.solicitudes_demo WHERE creado_en>=now()-interval '30 days'")
   ]);
   const settings=notificationConfig();
   res.json({periodoDias:30,paginas:top.rows,dias:days.rows,solicitudesPorOrigen:leads.rows,
    totalSolicitudes:totals.rows[0]?.solicitudes||0,
    avisoCorreo:{comercial:Boolean(settings.commercial.length),privacidad:Boolean(settings.privacy.length)}});
  }catch(err){next(err);}
 });
}
