// Enlaces de lectura de 24 horas: al compartirlos, el poseedor puede consultar
// únicamente indicadores predefinidos del cliente elegido por el superadministrador.
import {createHash,randomBytes} from "node:crypto";
import {loadDemoMcpContext,handlePublicDemoMcp} from "./aiMcpDemo.js";
import {TOOL_CATALOG,periodFromQuestion} from "./assistantAnalytics.js";
const PREFIX="/api/consulta-temporal/";
const TOKEN=/^fm_share_[A-Za-z0-9_-]{43}$/;
const SLUG=/^[a-z][a-z0-9_]{1,62}$/;
const hash=s=>createHash("sha256").update(s).digest("hex");
const html=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const expiresAt=t=>new Date(new Date(t).getTime()+86400000).toISOString();
const headers=res=>res.set("Cache-Control","private, no-store, max-age=0")
  .set("Referrer-Policy","no-referrer").set("X-Robots-Tag","noindex, nofollow, noarchive")
  .set("X-Content-Type-Options","nosniff")
  .set("Content-Security-Policy","default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
export const validTemporaryLinkToken=token=>typeof token==="string"&&TOKEN.test(token);
const hitCount=new Map();
function allow(token){
 const now=Date.now(),key=hash(token),recent=(hitCount.get(key)||[]).filter(t=>now-t<600000);
 if(recent.length>=100)return false;
 recent.push(now);hitCount.set(key,recent);
 if(hitCount.size>100)for(const [k,v] of hitCount)if(now-v.at(-1)>600000)hitCount.delete(k);
 return true;
}
function landing(token,ctx){
 const dates=periodFromQuestion("últimos 30 días"),year=periodFromQuestion("últimos 12 meses");
 const link=(text,args)=>'<li><a href="'+html(PREFIX+token+"?"+new URLSearchParams(args))+'">'+html(text)+'</a></li>';
 const options=Object.entries(TOOL_CATALOG).map(([id,m])=>link(m.label,{
  indicador:id,desde:(id==="ahorro_economico"?year:dates).from,
  hasta:(id==="ahorro_economico"?year:dates).to
 })).join("");
 const qs=["¿Cuánto hemos vendido este mes?","¿Cuánto hemos comprado el mes pasado?",
  "¿Cuál es el capital de stock?","¿Qué artículos se han vendido más?","¿Qué ahorro potencial hay este año?"]
  .map(pregunta=>link(pregunta,{pregunta})).join("");
 return '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Farmétrica · consultas reales</title></head>'+
 '<body><h1>Farmétrica · consultas reales por API</h1><p>Cliente: '+html(ctx.client.name)+
 '</p><p>Acceso temporal de solo lectura. Datos reales de PostgreSQL. URL sensible: permite consultar cifras durante 24 horas desde su creación.</p>'+
 '<h2>Indicadores</h2><ul>'+options+'</ul><h2>Preguntas</h2><ul>'+qs+'</ul>'+
 '<p>Parámetros opcionales: desde, hasta (AAAA-MM-DD), farmacias (IDs separados por comas). Máximo 366 días por consulta. Añade formato=json para respuesta JSON.</p></body></html>';
}
export function setupTemporaryAnalyticsLinks(app,pool,{requireSuperadmin}){
 const admin="/api/admin/ai/mcp-demo";
 const canChange=(req,res,next)=>req.get("x-farmetrica-admin-action")==="mcp-demo-key"?
   next():res.status(403).json({error:"Acción no autorizada"});
 app.get(admin,requireSuperadmin,async(_req,res,next)=>{
  try{
   const {rows}=await pool.query("SELECT cliente_slug,creado_en FROM farmetrica.ai_mcp_demo_keys WHERE singleton=true AND creado_en>now()-interval '24 hours'");
   res.json({configured:!!rows[0],clientSlug:rows[0]?.cliente_slug||null,
    expiresAt:rows[0]?expiresAt(rows[0].creado_en):null});
  }catch(e){next(e);}
 });
 app.post(admin,requireSuperadmin,canChange,async(req,res,next)=>{
  try{
   const slug=req.body?.clientSlug;
   if(typeof slug!=="string"||!SLUG.test(slug))return res.status(400).json({error:"Cliente inválido"});
   const {rows}=await pool.query("SELECT slug FROM farmetrica.clientes WHERE slug=$1 AND activo=true",[slug]);
   if(!rows.length)return res.status(400).json({error:"Cliente inactivo"});
   const token="fm_share_"+randomBytes(32).toString("base64url");
   const saved=await pool.query("INSERT INTO farmetrica.ai_mcp_demo_keys(singleton,secret_hash,cliente_slug,creado_en) VALUES(true,$1,$2,now()) ON CONFLICT(singleton) DO UPDATE SET secret_hash=EXCLUDED.secret_hash,cliente_slug=EXCLUDED.cliente_slug,creado_en=now() RETURNING creado_en",[hash(token),slug]);
   headers(res).json({url:"https://farmetrica.com"+PREFIX+token,clientSlug:slug,expiresAt:expiresAt(saved.rows[0].creado_en)});
  }catch(e){next(e);}
 });
 app.delete(admin,requireSuperadmin,canChange,async(_req,res,next)=>{
  try{await pool.query("DELETE FROM farmetrica.ai_mcp_demo_keys WHERE singleton=true");headers(res).json({ok:true});}
  catch(e){next(e);}
 });
 app.get(PREFIX+":token",async(req,res,next)=>{
  try{
   headers(res);
   const token=req.params.token;
   if(!validTemporaryLinkToken(token))return res.status(404).send("Enlace inválido");
   const {rows}=await pool.query("SELECT cliente_slug FROM farmetrica.ai_mcp_demo_keys WHERE singleton=true AND secret_hash=$1 AND creado_en>now()-interval '24 hours'",[hash(token)]);
   if(!rows.length)return res.status(410).send("Enlace caducado o revocado");
   if(!allow(token))return res.status(429).send("Demasiadas consultas");
   const ctx=await loadDemoMcpContext(pool,rows[0].cliente_slug);
   if(req.query.indicador===undefined&&req.query.pregunta===undefined)return res.type("html").send(landing(token,ctx));
   if(req.query.indicador!==undefined&&req.query.pregunta!==undefined)return res.status(400).send("Indica solo un tipo de consulta");
   const args={};
   for(const k of ["desde","hasta"])if(req.query[k]!==undefined)args[k]=req.query[k];
   if(req.query.farmacias!==undefined){
    if(typeof req.query.farmacias!=="string"||!/^[0-9]+(?:,[0-9]+){0,49}$/.test(req.query.farmacias))return res.status(400).send("Farmacias inválidas");
    args.farmacias=req.query.farmacias.split(",").map(Number);
   }
   let name;
   if(req.query.indicador!==undefined){
    if(typeof req.query.indicador!=="string"||!Object.hasOwn(TOOL_CATALOG,req.query.indicador))return res.status(400).send("Indicador inválido");
    name="consultar_indicador";args.indicador=req.query.indicador;
   }else{
    if(typeof req.query.pregunta!=="string"||req.query.pregunta.length>1000||req.query.pregunta.trim().length<2)return res.status(400).send("Pregunta inválida");
    name="explorar_pregunta";args.pregunta=req.query.pregunta;
   }
   const result=await handlePublicDemoMcp({jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args}},pool,ctx.client.slug,ctx);
   const data=result.body?.result?.structuredContent;
   if(!data)return res.status(result.http===503?503:400).send(result.body?.result?.content?.[0]?.text||"Consulta no disponible");
   const output={...data,cliente:ctx.client.name,origen:"PostgreSQL",ficticio:false};
   if(req.query.formato==="json")return res.json(output);
   return res.type("html").send('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Farmétrica · consulta</title></head><body><h1>Resultado real de Farmétrica</h1><pre>'+html(JSON.stringify(output,null,2))+'</pre><a href="'+html(PREFIX+token)+'">Volver al catálogo</a></body></html>');
  }catch(e){next(e);}
 });
}
