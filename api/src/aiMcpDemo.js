// MCP demo con datos REALES de PostgreSQL y clave de acceso independiente de OAuth.
// Reutiliza el motor de indicadores del MCP principal. No acepta SQL arbitrario.
import {createHash,randomBytes,timingSafeEqual} from "node:crypto";
import {readAnalytics} from "./aiMcp.js";
import {authorizedIds,normalizedPeriod,periodFromQuestion,pharmacyIdsFromQuestion,
  selectTools,TOOL_CATALOG} from "./assistantAnalytics.js";

const VERSION="2025-06-18";
const SLUG=/^[a-z][a-z0-9_]{1,62}$/;
const TOKEN=/^Bearer (fm_demo_[A-Za-z0-9_-]{43})$/;
const rate=new Map();
const digest=value=>createHash("sha256").update(value).digest("hex");
const rpcError=(id,code,message)=>({jsonrpc:"2.0",id:id??null,error:{code,message}});
const rpcResult=(id,data)=>({jsonrpc:"2.0",id,result:{
  content:[{type:"text",text:JSON.stringify(data)}],structuredContent:data}});
const metadata={modo:"DEMO_REAL",ficticio:false,origen:"PostgreSQL",soloLectura:true};
export const DEMO_MCP_TOOLS=[
  {name:"listar_contexto",description:"Consulta las farmacias del cliente real asignado a la clave de demo.",annotations:{readOnlyHint:true,openWorldHint:false},inputSchema:{type:"object",properties:{},additionalProperties:false}},
  {name:"catalogo_analitico",description:"Catálogo de indicadores disponibles con datos reales.",annotations:{readOnlyHint:true,openWorldHint:false},inputSchema:{type:"object",properties:{},additionalProperties:false}},
  {name:"consultar_indicador",description:"Consulta datos reales de compras, ventas, stock o ahorro con SQL predefinido y solo lectura.",annotations:{readOnlyHint:true,openWorldHint:false},
    inputSchema:{type:"object",properties:{indicador:{type:"string",enum:Object.keys(TOOL_CATALOG)},
      desde:{type:"string",pattern:"^\\d{4}-\\d{2}-\\d{2}$"},
      hasta:{type:"string",pattern:"^\\d{4}-\\d{2}-\\d{2}$"},
      farmacias:{type:"array",items:{type:"integer"},maxItems:50}},
      required:["indicador"],additionalProperties:false}},
  {name:"explorar_pregunta",description:"Interpreta una pregunta en español y ejecuta hasta dos indicadores SQL reales, de solo lectura.",annotations:{readOnlyHint:true,openWorldHint:false},
    inputSchema:{type:"object",properties:{pregunta:{type:"string",minLength:2,maxLength:1000},
      desde:{type:"string",pattern:"^\\d{4}-\\d{2}-\\d{2}$"},
      hasta:{type:"string",pattern:"^\\d{4}-\\d{2}-\\d{2}$"},
      farmacias:{type:"array",items:{type:"integer"},maxItems:50}},
      required:["pregunta"],additionalProperties:false}}
];
export function demoBearerMatches(authorization,secretHash){
  const match=TOKEN.exec(authorization||"");
  if(!match||!(/^[0-9a-f]{64}$/.test(secretHash||"")))return false;
  const given=Buffer.from(digest(match[1]),"hex"),saved=Buffer.from(secretHash,"hex");
  return timingSafeEqual(given,saved);
}
export function generateDemoKey(){return "fm_demo_"+randomBytes(32).toString("base64url");}
function limitOk(key,now=Date.now()){
  const hits=(rate.get(key)||[]).filter(t=>now-t<600000);
  if(hits.length>=100)return false;
  hits.push(now);rate.set(key,hits);
  if(rate.size>100)for(const [k,v] of rate)if(now-v.at(-1)>600000)rate.delete(k);
  return true;
}
function validInput(name,args){
  const tool=DEMO_MCP_TOOLS.find(t=>t.name===name);
  if(!tool||!args||typeof args!=="object"||Array.isArray(args))throw new TypeError("Herramienta o argumentos inválidos");
  if(Object.keys(args).some(k=>!Object.hasOwn(tool.inputSchema.properties,k)))throw new TypeError("Argumentos no admitidos");
  if(args.farmacias!==undefined&&(!Array.isArray(args.farmacias)||args.farmacias.length>50||
      args.farmacias.some(n=>!Number.isSafeInteger(n))))throw new TypeError("Farmacias inválidas");
  if((args.desde===undefined)!==(args.hasta===undefined))throw new TypeError("Indica desde y hasta");
  if(args.desde!==undefined&&(!/^\d{4}-\d{2}-\d{2}$/.test(args.desde)||!/^\d{4}-\d{2}-\d{2}$/.test(args.hasta)))
    throw new TypeError("Fechas inválidas");
  return args;
}
function checkedPeriod(args,question=""){
  const period=args.desde===undefined?periodFromQuestion(question||"últimos 30 días"):
    {from:args.desde,to:args.hasta};
  for(const val of [period.from,period.to]){
    const d=new Date(val+"T00:00:00Z");
    if(!Number.isFinite(d.valueOf())||d.toISOString().slice(0,10)!==val)
      throw new TypeError("Fecha inexistente");
  }
  return normalizedPeriod(period);
}
export async function loadDemoMcpContext(pool,slug){
  if(!SLUG.test(slug||""))throw new Error("Cliente de clave demo inválido");
  const {rows:clients}=await pool.query(
    "SELECT slug,nombre,esquema_datos FROM farmetrica.clientes WHERE slug=$1 AND activo=true",[slug]);
  const c=clients[0];
  if(!c||!SLUG.test(c.esquema_datos))throw new Error("Cliente demo no disponible");
  const {rows:pharmacies}=await pool.query(
    "SELECT id,nombre AS name,ciudad AS city FROM farmetrica.farmacias WHERE cliente_slug=$1 AND activo=true ORDER BY id",[slug]);
  if(!pharmacies.length)throw new Error("Sin farmacias activas");
  return {client:{slug:c.slug,name:c.nombre,schema:c.esquema_datos},
    role:"administrador",modules:{dashboard:true,ventas:true,compras:true,stock:true},
    pharmacies:pharmacies.map(p=>({id:Number(p.id),name:p.name,city:p.city})),
    allowedPharmacyIds:pharmacies.map(p=>Number(p.id))};
}
export async function handlePublicDemoMcp(input,pool,slug,authenticatedContext=null){
  if(!input||typeof input!=="object"||Array.isArray(input)||input.jsonrpc!=="2.0"||
    typeof input.method!=="string")return {http:400,body:rpcError(input?.id,-32600,"Invalid Request")};
  const id=input.id??null;
  if(input.method==="notifications/initialized"||input.method==="notifications/cancelled")return {http:202,body:null};
  if(input.method==="initialize")return {http:200,body:{jsonrpc:"2.0",id,result:{
    protocolVersion:VERSION,capabilities:{tools:{listChanged:false}},
    serverInfo:{name:"Farmetrica Demo Real",version:"0.2.0"}}}};
  if(input.method==="ping")return {http:200,body:{jsonrpc:"2.0",id,result:{}}};
  if(input.method==="tools/list")return {http:200,body:{jsonrpc:"2.0",id,result:{tools:DEMO_MCP_TOOLS.map(t=>({...t,securitySchemes:[{type:"oauth2",scopes:["farmetrica.read"]}]}))}}};
  if(input.method!=="tools/call")return {http:200,body:rpcError(id,-32601,"Method not found")};
  try{
    const name=input.params?.name,args=validInput(name,input.params?.arguments??{});
    const ctx=authenticatedContext??await loadDemoMcpContext(pool,slug);
    let data;
    if(name==="listar_contexto")data={...metadata,cliente:ctx.client.name,
      farmacias:ctx.pharmacies.map(p=>({id:p.id,nombre:p.name,ciudad:p.city})),modulos:ctx.modules};
    else if(name==="catalogo_analitico")data={...metadata,indicadores:TOOL_CATALOG};
    else if(name==="consultar_indicador"){
      if(typeof args.indicador!=="string"||!Object.hasOwn(TOOL_CATALOG,args.indicador))
        throw new TypeError("Indicador desconocido");
      data={...metadata,...await readAnalytics(pool,ctx,args.indicador,checkedPeriod(args),args.farmacias??[])};
    }else{
      if(typeof args.pregunta!=="string"||args.pregunta.trim().length<2||args.pregunta.length>1000)
        throw new TypeError("Pregunta inválida");
      const period=checkedPeriod(args,args.pregunta);
      const ids=authorizedIds(ctx,args.farmacias===undefined?
        pharmacyIdsFromQuestion(args.pregunta,ctx):args.farmacias);
      const names=selectTools(args.pregunta,ctx);
      data={...metadata,pregunta:args.pregunta,periodo:period,
        consultas:await Promise.all(names.map(n=>readAnalytics(pool,ctx,n,period,ids))),
        ...(names.length?{}:{aviso:"No se ha identificado un indicador para esta pregunta."})};
    }
    return {http:200,body:rpcResult(id,data)};
  }catch(e){
    if(e instanceof TypeError||/autorizadas|inválid|desconocid|Período|Farmacias/.test(e.message||""))
      return {http:200,body:{jsonrpc:"2.0",id,result:{isError:true,
        content:[{type:"text",text:"Consulta inválida: "+e.message}]}}};
    return {http:503,body:rpcError(id,-32000,"No se pudo consultar PostgreSQL")};
  }
}
export function setupPublicDemoMcp(app,pool,{requireSuperadmin,authenticateOAuthDemo}){
  const adminBase="/api/admin/ai/mcp-demo";
  const adminAction=(req,res,next)=>{
    // El header personalizado exige CORS preflight a páginas ajenas:
    // junto con la sesión HttpOnly impide que un formulario externo rote la clave.
    if(req.get("x-farmetrica-admin-action")!=="mcp-demo-key")
      return res.status(403).json({error:"Operación no autorizada"});
    next();
  };
  app.get(adminBase,requireSuperadmin,async(_req,res,next)=>{
    try{
      const {rows}=await pool.query(
        "SELECT cliente_slug,creado_en FROM farmetrica.ai_mcp_demo_keys WHERE singleton=true");
      res.json({configured:Boolean(rows.length),clientSlug:rows[0]?.cliente_slug??null,
        createdAt:rows[0]?.creado_en??null});
    }catch(e){next(e)}
  });
  app.post(adminBase,requireSuperadmin,adminAction,async(req,res,next)=>{
    try{
      const slug=req.body?.clientSlug;
      if(typeof slug!=="string"||!SLUG.test(slug))
        return res.status(400).json({error:"Cliente inválido"});
      const {rows:clients}=await pool.query(
        "SELECT slug FROM farmetrica.clientes WHERE slug=$1 AND activo=true",[slug]);
      if(!clients.length)return res.status(400).json({error:"Cliente inactivo o inexistente"});
      const key=generateDemoKey();
      await pool.query(
        "INSERT INTO farmetrica.ai_mcp_demo_keys(singleton,secret_hash,cliente_slug) VALUES(true,$1,$2) "+
        "ON CONFLICT(singleton) DO UPDATE SET secret_hash=EXCLUDED.secret_hash,cliente_slug=EXCLUDED.cliente_slug,creado_en=now()",
        [digest(key),slug]);
      res.json({key,clientSlug:slug,warning:"Esta clave solo se mostrará una vez. La anterior queda revocada."});
    }catch(e){next(e)}
  });
  app.delete(adminBase,requireSuperadmin,adminAction,async(_req,res,next)=>{
    try{
      await pool.query("DELETE FROM farmetrica.ai_mcp_demo_keys WHERE singleton=true");
      res.json({ok:true});
    }catch(e){next(e)}
  });
  app.post("/api/mcp-demo",async(req,res,next)=>{
    try{
      if(Number(req.get("content-length")||0)>16384)return res.status(413).end();
      const authorization=req.get("authorization")||"";
      // Conservamos las claves existentes para clientes técnicos, pero ChatGPT
      // emplea OAuth ligado al usuario, al tenant, al recurso y a sus permisos actuales.
      if(authorization.startsWith("Bearer fm_demo_")){
        const {rows}=await pool.query(
          "SELECT secret_hash,cliente_slug FROM farmetrica.ai_mcp_demo_keys WHERE singleton=true");
        const credential=rows[0];
        if(!credential||!demoBearerMatches(authorization,credential.secret_hash))
          return res.status(401).json({error:"Clave de integración inválida"});
        if(req.body?.method==="tools/call"&&!limitOk(credential.secret_hash))
          return res.status(429).json(rpcError(req.body?.id,-32000,"Demasiadas consultas"));
        const outcome=await handlePublicDemoMcp(req.body,pool,credential.cliente_slug);
        if(!outcome.body)return res.status(outcome.http).end();
        return res.status(outcome.http).json(outcome.body);
      }
      if(typeof authenticateOAuthDemo!=="function")
        return res.status(401).json({error:"OAuth no configurado"});
      // El middleware central revalida cuenta, membresía, farmacias y módulos.
      return authenticateOAuthDemo(req,res,(err)=>{
        if(err)return next(err);
        (async()=>{
          if(req.body?.method==="tools/call"&&!limitOk("oauth:"+req.aiConnection.id))
            return res.status(429).json(rpcError(req.body?.id,-32000,"Demasiadas consultas"));
          const outcome=await handlePublicDemoMcp(req.body,pool,req.context.client.slug,req.context);
          if(!outcome.body)return res.status(outcome.http).end();
          return res.status(outcome.http).json(outcome.body);
        })().catch(next);
      });
    }catch(e){next(e)}
  });
  app.get("/api/mcp-demo",(_req,res)=>res.status(405).set("Allow","POST").end());
  app.delete("/api/mcp-demo",(_req,res)=>res.status(204).end());
}
