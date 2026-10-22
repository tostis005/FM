// Enlace temporal autoexplicativo: la IA del cliente lee el modelo, construye el plan
// y el servidor valida/ejecuta SQL parametrizado en lectura. No ejecuta otro modelo de IA.
import {createHash,randomBytes} from "node:crypto";
import {loadDemoMcpContext,handlePublicDemoMcp} from "./aiMcpDemo.js";
import {TOOL_CATALOG,periodFromQuestion} from "./assistantAnalytics.js";
import {semanticCatalogForContext,runSemanticQuery} from "./aiSemanticQuery.js";
import {makeTemporaryModel,temporaryAgentsMarkdown} from "./aiShareContract.js";
const PREFIX="/api/consulta-temporal/";
const TOKEN=/^fm_share_[A-Za-z0-9_-]{43}$/;
const SLUG=/^[a-z][a-z0-9_]{1,62}$/;
const hash=s=>createHash("sha256").update(s).digest("hex");
const html=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const DURATIONS=Object.freeze({"24h":1,"7d":7,"30d":30,"365d":365,"indefinido":null});
export function shareLinkExpiry(created,duration="24h"){
 if(!Object.hasOwn(DURATIONS,duration))throw new TypeError("Duración no autorizada");
 return DURATIONS[duration]===null?null:
  new Date(new Date(created).getTime()+DURATIONS[duration]*86400000).toISOString();
}
const activeSQL="(duracion='indefinido' OR creado_en + "+
 "CASE duracion WHEN '7d' THEN interval '7 days' WHEN '30d' THEN interval '30 days' "+
 "WHEN '365d' THEN interval '365 days' ELSE interval '24 hours' END > now())";
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

function shareCatalog(token,ctx){
 const today=periodFromQuestion("hoy");
 const month=periodFromQuestion("este mes");
 const previous=periodFromQuestion("mes pasado");
 const dates=periodFromQuestion("últimos 30 días");
 const year=periodFromQuestion("últimos 12 meses");
 const url=options=>PREFIX+encodeURIComponent(token)+"?"+new URLSearchParams(options).toString();
 const semantic=semanticCatalogForContext(ctx);
 const semanticLinks=semantic.ejemplos.map(entry=>({
  titulo:entry.titulo,
  url:url({consulta:JSON.stringify(entry.consulta),formato:"json"})
 }));
 const entradas=[
  {titulo:"Ventas de hoy por farmacia",url:url({indicador:"ventas_resumen",desde:today.from,hasta:today.to})},
  {titulo:"Compras de hoy por farmacia",url:url({indicador:"compras_resumen",desde:today.from,hasta:today.to})},
  {titulo:"Ventas de este mes por farmacia",url:url({indicador:"ventas_resumen",desde:month.from,hasta:month.to})},
  {titulo:"Compras del mes pasado por farmacia",url:url({indicador:"compras_resumen",desde:previous.from,hasta:previous.to})},
  ...Object.entries(TOOL_CATALOG).map(([indicador,info])=>({
   titulo:info.label,
   url:url({indicador,desde:(indicador==="ahorro_economico"?year:dates).from,
     hasta:(indicador==="ahorro_economico"?year:dates).to})
  })),
  // Los ejemplos guiados utilizan un único plan JSON; no rutas por cada pregunta.
 ];
 return {
  api:"Farmétrica - consultas temporales de lectura",
  cliente:ctx.client.name,
  origen:"PostgreSQL",
  ficticio:false,
  soloLectura:true,
  farmacias:ctx.pharmacies.map(p=>({id:Number(p.id),nombre:p.name,ciudad:p.city})),
  indicadores:TOOL_CATALOG,
  consultas:[...semanticLinks,...entradas],
  consultas_semanticas:semantic,
  modelo_json:PREFIX+token+"?modelo=json",
  modelo_agents:PREFIX+token+"/AGENTS.md",
  ayuda_ia:"Lee modelo_agents o modelo_json. ChatGPT interpreta tu pregunta, construye una consulta permitida y utiliza el mismo enlace mediante ?consulta=JSON_CODIFICADO&formato=json o ?fuente=...&agrupar=...&metricas=... . No hay IA en el servidor, rutas por pregunta ni SQL libre.",
  formato:"Para obtener JSON agrega formato=json a cualquier URL de consulta.",
  parametros:"indicador o pregunta, desde y hasta en AAAA-MM-DD, farmacias=ID,ID o farmacia=nombre exacto.",
  alcance:"Consultas semánticas por períodos arbitrarios o histórico, con límite de 100 filas y tiempo máximo de ejecución; SQL libre deshabilitado."
 };
}
function landing(token,ctx){
 const catalog=shareCatalog(token,ctx);
 const model=makeTemporaryModel(ctx,"https://farmetrica.com"+PREFIX+token);
 const instructions=temporaryAgentsMarkdown(model);
 const link=item=>'<li><a href="'+html(item.url)+'">'+html(item.titulo)+'</a></li>';
 const pharmacies=catalog.farmacias.map(p=>'<li>'+html(p.nombre)+' (ID '+p.id+')</li>').join("");
 return '<!doctype html><html lang="es"><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width, initial-scale=1">'+
  '<title>Farmétrica · consultas reales</title></head>'+
  '<body style="font:16px system-ui;max-width:850px;margin:30px auto;padding:16px">'+
  '<h1>Farmétrica · consultas reales por API</h1>'+
  '<p>Cliente: <strong>'+html(ctx.client.name)+'</strong></p>'+
  '<p>Datos reales de PostgreSQL. Acceso temporal de solo lectura que permite consultar indicadores reales '+
  'durante la vigencia elegida al generarlo y puede revocarse desde Farmétrica.</p>'+
  '<h2>Modelo para ChatGPT (fuente de verdad)</h2>'+
  '<p>Este servidor no tiene un segundo modelo de IA. ChatGPT lee el contrato de datos, '+
  'decide qué consultar, y el servidor ejecuta exclusivamente SELECT autorizados.</p>'+
  '<ul><li><a href="'+html(catalog.modelo_agents)+'">AGENTS.md: instrucciones, tablas, conexiones y cálculos</a></li>'+
  '<li><a href="'+html(catalog.modelo_json)+'">Contrato JSON con esquema exacto de consulta</a></li></ul>'+
  '<h2>Ejemplos de la única API genérica</h2><ul>'+catalog.consultas.map(link).join("")+'</ul>'+
  '<h2>Farmacias incluidas</h2><ul>'+pharmacies+'</ul>'+
  '<p>Para filtrar, añade <code>farmacia=nombre</code> o <code>farmacias=ID,ID</code> a un enlace '+
  'de consulta. Fechas: <code>desde=AAAA-MM-DD</code> y <code>hasta=AAAA-MM-DD</code>.</p>'+
  '<p>Para un catálogo legible por máquinas, abre <a href="'+html(PREFIX+token+"?formato=json")+
  '">Catálogo JSON</a>. Para el resultado de una consulta, añade <code>formato=json</code>.</p>'+
  '<p>ChatGPT transforma preguntas libres en combinaciones permitidas de campos. '+
  'Envía el plan por <code>consulta=</code> o los campos mediante parámetros GET. '+
  'No hay un segundo modelo de IA ni se admite SQL arbitrario.</p>'+
  '<h2>AGENTS.md integrado en este mismo punto de entrada</h2>'+
  '<pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+html(instructions)+'</pre></body></html>';
}
export function setupTemporaryAnalyticsLinks(app,pool,{requireSuperadmin}){
 const admin="/api/admin/ai/mcp-demo";
 const canChange=(req,res,next)=>req.get("x-farmetrica-admin-action")==="mcp-demo-key"?
   next():res.status(403).json({error:"Acción no autorizada"});
 app.get(admin,requireSuperadmin,async(_req,res,next)=>{
  try{
   const {rows}=await pool.query("SELECT cliente_slug,creado_en,duracion FROM farmetrica.ai_mcp_demo_keys WHERE singleton=true AND "+activeSQL);
   res.json({configured:!!rows[0],clientSlug:rows[0]?.cliente_slug||null,
    duracion:rows[0]?.duracion||null,
    expiresAt:rows[0]?shareLinkExpiry(rows[0].creado_en,rows[0].duracion):null});
  }catch(e){next(e);}
 });
 app.post(admin,requireSuperadmin,canChange,async(req,res,next)=>{
  try{
   const slug=req.body?.clientSlug;
   const duracion=req.body?.duracion??"24h";
   if(!Object.hasOwn(DURATIONS,duracion))return res.status(400).json({error:"Duración inválida"});
   if(typeof slug!=="string"||!SLUG.test(slug))return res.status(400).json({error:"Cliente inválido"});
   const {rows}=await pool.query("SELECT slug FROM farmetrica.clientes WHERE slug=$1 AND activo=true",[slug]);
   if(!rows.length)return res.status(400).json({error:"Cliente inactivo"});
   const token="fm_share_"+randomBytes(32).toString("base64url");
   const saved=await pool.query("INSERT INTO farmetrica.ai_mcp_demo_keys(singleton,secret_hash,cliente_slug,creado_en,duracion) VALUES(true,$1,$2,now(),$3) ON CONFLICT(singleton) DO UPDATE SET secret_hash=EXCLUDED.secret_hash,cliente_slug=EXCLUDED.cliente_slug,creado_en=now(),duracion=EXCLUDED.duracion RETURNING creado_en",[hash(token),slug,duracion]);
   headers(res).json({url:"https://farmetrica.com"+PREFIX+token,clientSlug:slug,duracion,
    expiresAt:shareLinkExpiry(saved.rows[0].creado_en,duracion)});
  }catch(e){next(e);}
 });
 app.delete(admin,requireSuperadmin,canChange,async(_req,res,next)=>{
  try{await pool.query("DELETE FROM farmetrica.ai_mcp_demo_keys WHERE singleton=true");headers(res).json({ok:true});}
  catch(e){next(e);}
 });
 app.get([PREFIX+":token",PREFIX+":token/AGENTS.md"],async(req,res,next)=>{
  try{
   headers(res);
   const token=req.params.token;
   if(!validTemporaryLinkToken(token))return res.status(404).send("Enlace inválido");
   const {rows}=await pool.query("SELECT cliente_slug FROM farmetrica.ai_mcp_demo_keys WHERE singleton=true AND secret_hash=$1 AND "+activeSQL,[hash(token)]);
   if(!rows.length)return res.status(410).send("Enlace caducado o revocado");
   if(!allow(token))return res.status(429).send("Demasiadas consultas");
   const ctx=await loadDemoMcpContext(pool,rows[0].cliente_slug);
   if(req.path.endsWith("/AGENTS.md")||req.query.modelo!==undefined){
    if(req.query.modelo!==undefined&&!["agents","json"].includes(req.query.modelo))
     return res.status(400).json({error:"Modelo inválido"});
    const model=makeTemporaryModel(ctx,"https://farmetrica.com"+PREFIX+token);
    if(req.path.endsWith("/AGENTS.md")||req.query.modelo==="agents")
     return res.type("text/markdown; charset=utf-8").send(temporaryAgentsMarkdown(model));
    return res.json(model);
   }
   if(req.query.consulta!==undefined||req.query.fuente!==undefined){
    if(req.query.indicador!==undefined||req.query.pregunta!==undefined||
       (req.query.consulta!==undefined&&req.query.fuente!==undefined))
     return res.status(400).json({error:"Selecciona consulta estructurada, consulta simple, indicador o pregunta"});
    let plan;
    if(req.query.consulta!==undefined){
     if(typeof req.query.consulta!=="string"||req.query.consulta.length>6000)
      return res.status(400).json({error:"Consulta demasiado larga"});
     try{plan=JSON.parse(req.query.consulta)}catch{
      return res.status(400).json({error:"La consulta debe ser JSON válido"});
     }
    }else{
     const fields=["fuente","agrupar","metricas","periodo","desde","hasta","farmacias",
      "farmacia","producto","vendedor","proveedor","estado_stock","dias_max",
      "ordenar","direccion","limite","formato"];
     if(Object.keys(req.query).some(k=>!fields.includes(k)))
      return res.status(400).json({error:"Parámetro no permitido; consulta el modelo JSON"});
     if(typeof req.query.fuente!=="string")return res.status(400).json({error:"Fuente inválida"});
     plan={fuente:req.query.fuente};
     for(const k of ["agrupar","metricas"]){
      if(req.query[k]!==undefined){
       if(typeof req.query[k]!=="string"||req.query[k].length>150)
        return res.status(400).json({error:"Dimensiones o métricas inválidas"});
       plan[k]=req.query[k].split(",");
      }
     }
     for(const k of ["periodo","desde","hasta","producto","vendedor","proveedor","estado_stock"]){
      if(req.query[k]!==undefined){
       if(typeof req.query[k]!=="string"||req.query[k].length>100)
        return res.status(400).json({error:"Filtro inválido"});
       plan[k]=req.query[k];
      }
     }
     for(const [field,key] of [["limite","limite"],["dias_max","dias_max"]]){
      if(req.query[field]!==undefined){
       if(typeof req.query[field]!=="string"||!/^[1-9][0-9]{0,3}$/.test(req.query[field]))
        return res.status(400).json({error:"Límite inválido"});
       plan[key]=Number(req.query[field]);
      }
     }
     if(req.query.ordenar!==undefined||req.query.direccion!==undefined){
      if(typeof req.query.ordenar!=="string"||typeof req.query.direccion!=="string")
       return res.status(400).json({error:"Ordenación incompleta"});
      plan.ordenar={campo:req.query.ordenar,direccion:req.query.direccion};
     }
     if(req.query.farmacias!==undefined&&req.query.farmacia!==undefined)
      return res.status(400).json({error:"Usa farmacia o farmacias"});
     if(req.query.farmacias!==undefined){
      if(typeof req.query.farmacias!=="string"||!/^[1-9][0-9]{0,6}(?:,[1-9][0-9]{0,6}){0,49}$/.test(req.query.farmacias))
       return res.status(400).json({error:"IDs de farmacia inválidos"});
      plan.farmacias=req.query.farmacias.split(",").map(Number);
     }
     if(req.query.farmacia!==undefined){
      if(typeof req.query.farmacia!=="string"||req.query.farmacia.length>150)
       return res.status(400).json({error:"Nombre de farmacia inválido"});
      const normalize=x=>String(x).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
      const matches=ctx.pharmacies.filter(p=>normalize(p.name)===normalize(req.query.farmacia));
      if(matches.length!==1)return res.status(400).json({error:"Nombre de farmacia no identificado o ambiguo"});
      plan.farmacias=[Number(matches[0].id)];
     }
    }
    try{
     const output={...await runSemanticQuery(pool,ctx,plan),cliente:ctx.client.name};
     if(req.query.formato==="json")return res.json(output);
     return res.type("html").send('<!doctype html><html lang="es"><head><meta charset="utf-8">'+
      '<title>Farmétrica · consulta semántica</title></head><body>'+
      '<h1>Consulta real de Farmétrica</h1><pre>'+html(JSON.stringify(output,null,2))+'</pre>'+
      '<p><a href="'+html(PREFIX+token)+'">Volver al catálogo</a></p></body></html>');
    }catch(e){
     if(e instanceof TypeError||e.status===400)return res.status(400).json({error:e.message});
     if(["57014","55P03"].includes(e.code))return res.status(503).json({
      error:"Consulta demasiado pesada; reduce período, agrupaciones o filtros"});
     throw e;
    }
   }
   if(req.query.indicador===undefined&&req.query.pregunta===undefined){
    if(req.query.formato==="json")return res.json(shareCatalog(token,ctx));
    return res.type("html").send(landing(token,ctx));
   }
   if(req.query.indicador!==undefined&&req.query.pregunta!==undefined)return res.status(400).send("Indica solo un tipo de consulta");
   const args={};
   for(const k of ["desde","hasta"])if(req.query[k]!==undefined)args[k]=req.query[k];
   if(req.query.farmacias!==undefined&&req.query.farmacia!==undefined)
    return res.status(400).send("Utiliza farmacia o farmacias, no ambos");
   if(req.query.farmacias!==undefined){
    if(typeof req.query.farmacias!=="string"||!/^[0-9]+(?:,[0-9]+){0,49}$/.test(req.query.farmacias))return res.status(400).send("Farmacias inválidas");
    args.farmacias=req.query.farmacias.split(",").map(Number);
   }
   if(req.query.farmacia!==undefined){
    if(typeof req.query.farmacia!=="string"||req.query.farmacia.length>150)
     return res.status(400).send("Nombre de farmacia inválido");
    const normalize=value=>String(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase();
    const matches=ctx.pharmacies.filter(p=>normalize(p.name)===normalize(req.query.farmacia));
    if(matches.length!==1)return res.status(400).send("Farmacia desconocida o ambigua. Consulta el catálogo.");
    args.farmacias=[Number(matches[0].id)];
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
