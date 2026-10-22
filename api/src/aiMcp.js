// Entrada MCP stateless para ChatGPT. Reutiliza los cálculos y permisos de Farmétrica.
// Solo lectura: no acepta SQL, nombres de tablas, esquemas ni credenciales del cliente.
import {createHash, randomBytes, timingSafeEqual} from "node:crypto";
import express from "express";
import {authorizedIds, normalizedPeriod, periodFromQuestion, pharmacyIdsFromQuestion, selectTools, TOOL_CATALOG, runAssistantTool} from "./assistantAnalytics.js";

const READ_SCOPE="farmetrica.read";
const MCP_VERSION="2025-06-18";
const CODE_LIFE_MS=5*60*1000;
const ACCESS_LIFE_MS=60*60*1000;
const REFRESH_LIFE_MS=30*24*60*60*1000;
const REQ_LIMIT=40;
const counters=new Map();
const sha=value=>createHash("sha256").update(value).digest("hex");
const opaque=()=>randomBytes(32).toString("base64url");
const safeText=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const oauthError=(res,status,code)=>res.status(status).json({error:code});
const jsonRpcError=(id,code,message)=>({jsonrpc:"2.0",id:id??null,error:{code,message}});
const ENABLED=()=>process.env.AI_MCP_ENABLED==="true";
const mcpOrigin=()=>{
  const value=process.env.AI_MCP_PUBLIC_ORIGIN||process.env.PUBLIC_APP_ORIGIN||"";
  try {
    const url=new URL(value);
    return url.protocol==="https:"&&!url.username&&!url.password&&url.pathname==="/"&&!url.search&&!url.hash?url.origin:null;
  } catch{return null;}
};
const URLS=()=>{const origin=mcpOrigin();return origin?{
  origin,resource:origin+"/api/mcp",issuer:origin,authorize:origin+"/api/ai/oauth/authorize",
  token:origin+"/api/ai/oauth/token",revoke:origin+"/api/ai/oauth/revoke"
}:null;};

export function validChatGPTClient(clientId,redirectUri){
  // El redirect no se obtiene de una cabecera Host ni de parámetros arbitrarios.
  if(typeof clientId!=="string"||typeof redirectUri!=="string")return false;
  if(clientId==="https://chatgpt.com/oauth/client.json")
    return redirectUri==="https://chatgpt.com/connector_platform_oauth_redirect";
  const match=/^https:\/\/chatgpt\.com\/oauth\/([a-zA-Z0-9_-]{8,128})\/client\.json$/.exec(clientId);
  return Boolean(match&&redirectUri==="https://chatgpt.com/connector/oauth/"+match[1]);
}
export function validPkce(verifier,challenge){
  if(typeof verifier!=="string"||!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))return false;
  const actual=createHash("sha256").update(verifier).digest("base64url");
  return actual.length===challenge.length&&timingSafeEqual(Buffer.from(actual),Buffer.from(challenge));
}
export function validAuthorizeRequest(body,urls){
  if(!urls||!body||body.response_type!=="code"||
    !validChatGPTClient(body.client_id,body.redirect_uri)||
    body.code_challenge_method!=="S256"||
    typeof body.code_challenge!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(body.code_challenge)||
    body.resource!==urls.resource||
    typeof body.state!=="string"||body.state.length>1024)return false;
  const scopes=String(body.scope||"").split(/\s+/).filter(Boolean);
  return scopes.includes(READ_SCOPE)&&scopes.every(x=>[READ_SCOPE,"offline_access"].includes(x));
}
const tenantChoices=user=>(user?.tenants||[]).filter(t=>t.active).map(t=>t.slug);
function retryOk(key,now=Date.now()){
  const hits=(counters.get(key)||[]).filter(t=>now-t<10*60*1000);
  if(hits.length>=REQ_LIMIT)return false;
  hits.push(now);counters.set(key,hits);
  if(counters.size>3000)for(const [k,v] of counters)if(now-v.at(-1)>10*60*1000)counters.delete(k);
  return true;
}
export async function readAnalytics(pool,context,name,period,ids){
  if(!Object.hasOwn(TOOL_CATALOG,name))throw new TypeError("Indicador desconocido");
  const dates=normalizedPeriod(period);
  const permitted=authorizedIds(context,ids);
  const db=await pool.connect();
  let begun=false;
  try {
    await db.query("BEGIN TRANSACTION READ ONLY");begun=true;
    await db.query(name==="ahorro_economico"?"SET LOCAL statement_timeout='25000ms'":"SET LOCAL statement_timeout='6000ms'");
    await db.query("SET LOCAL lock_timeout='1000ms'");
    return await runAssistantTool(db,context,name,dates,permitted);
  } finally {
    if(begun)try{await db.query("ROLLBACK");}catch{}
    db.release();
  }
}

function toolDefinitions(){
  const ids={type:"array",items:{type:"integer"},maxItems:50,description:"IDs de farmacias que aparecen en listar_contexto; omitir para todas las autorizadas."};
  const period={type:"string",pattern:"^\\d{4}-\\d{2}-\\d{2}$"};
  const securitySchemes=[{type:"oauth2",scopes:[READ_SCOPE]}];
  return [
    {name:"listar_contexto",securitySchemes,description:"Lista únicamente las farmacias y módulos a los que tiene acceso el usuario conectado. Úsala antes de filtrar por farmacias.",annotations:{readOnlyHint:true,openWorldHint:false},inputSchema:{type:"object",properties:{},additionalProperties:false}},
    {name:"catalogo_analitico",securitySchemes,description:"Indica qué métricas están implementadas, requisitos de permisos y límites. Nunca prometas análisis sin herramienta.",annotations:{readOnlyHint:true,openWorldHint:false},inputSchema:{type:"object",properties:{},additionalProperties:false}},
    {name:"consultar_indicador",securitySchemes,description:"Consulta una métrica verificable de Farmétrica. SQL predefinido, fechas <=366 días y farmacias autorizadas. Especifica fechas; no infieras que importe es margen.",annotations:{readOnlyHint:true,openWorldHint:false},
      inputSchema:{type:"object",properties:{indicador:{type:"string",enum:Object.keys(TOOL_CATALOG)},desde:period,hasta:period,farmacias:ids},required:["indicador","desde","hasta"],additionalProperties:false}},
    {name:"explorar_pregunta",securitySchemes,description:"Selecciona hasta dos herramientas analíticas para una pregunta en español y devuelve sus datos verificados; no redacta respuesta con LLM. Para precisión preferir consultar_indicador.",annotations:{readOnlyHint:true,openWorldHint:false},
      inputSchema:{type:"object",properties:{pregunta:{type:"string",minLength:2,maxLength:1000},desde:period,hasta:period,farmacias:ids},required:["pregunta"],additionalProperties:false}}
  ];
}
export const MCP_TOOLS=toolDefinitions();

function renderConsent(req,body,user){
  const slugs=tenantChoices(user);
  const hidden=["response_type","client_id","redirect_uri","state","scope","resource","code_challenge","code_challenge_method"]
    .map(k=>'<input type="hidden" name="'+k+'" value="'+safeText(body[k])+'">').join("");
  const options=slugs.map(s=>'<option value="'+safeText(s)+'">'+safeText(s)+'</option>').join("");
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Conectar Farmétrica a ChatGPT</title></head><body style="font:16px system-ui;max-width:560px;margin:10vh auto;padding:20px">'+
    '<h1>Conectar Farmétrica con ChatGPT</h1><p>Sesión: '+safeText(user.email)+
    '</p><p>ChatGPT podrá consultar datos de lectura de las farmacias que tengas autorizadas. No podrá modificar datos. Puedes revocar permisos desde Farmétrica.</p>'+
    '<form method="post" action="/api/ai/oauth/authorize">'+hidden+
    '<label>Cliente <select name="tenant" required>'+options+'</select></label>'+
    '<p><button type="submit" name="confirm" value="yes" style="padding:12px">Autorizar consultas</button></p></form>'+
    '<p><small>Las consultas compartidas con ChatGPT están sujetas a sus ajustes de privacidad.</small></p></body></html>';
}
function tokenResponse(row,access,refresh){
  return {access_token:access,token_type:"Bearer",expires_in:Math.floor(ACCESS_LIFE_MS/1000),
    scope:row.scope, ...(refresh?{refresh_token:refresh}:{})};
}

export function setupAIMcp(app,pool,{sessionUser,resolveAccess,resolveTenant,requireUser}){
  const urlEncoded=express.urlencoded({extended:false,limit:"16kb"});
  const active=(_req,res,next)=>ENABLED()&&URLS()?next():res.status(404).json({error:"Conector MCP desactivado"});
  const authenticate=async(req,res,next)=>{
    try{
      const urls=URLS(),bearer=/^Bearer ([A-Za-z0-9_-]{30,128})$/.exec(req.get("authorization")||"");
      if(!bearer)return res.status(401).set("WWW-Authenticate",'Bearer resource_metadata="'+urls.origin+'/.well-known/oauth-protected-resource/api/mcp"').json({error:"Autenticación requerida"});
      const {rows}=await pool.query("SELECT * FROM farmetrica.ai_oauth_conexiones WHERE access_hash=$1 AND revocado_en IS NULL AND access_caduca_en>now() LIMIT 1",[sha(bearer[1])]);
      const connection=rows[0];
      if(!connection||connection.resource!==urls.resource||!connection.scope.split(" ").includes(READ_SCOPE))return res.status(401).json({error:"Token inválido"});
      const user=await resolveAccess(connection.email,connection.metodo_acceso);
      if(!user)return res.status(403).json({error:"Cuenta desactivada o sin permisos"});
      // Recalcular tenant y farmacias EN CADA LLAMADA: nunca confiar en alcances del token antiguos.
      const ctx=await resolveTenant({user,get:key=>key==="x-farmetrica-cliente"?connection.cliente_slug:"",query:{}});
      if(!ctx||ctx.client.slug!==connection.cliente_slug)return res.status(403).json({error:"Acceso al cliente retirado"});
      req.user=user;req.context=ctx;req.aiConnection=connection;
      next();
    }catch(e){next(e);}
  };
  app.get(["/.well-known/oauth-protected-resource","/.well-known/oauth-protected-resource/api/mcp"],active,(_req,res)=>{
    const urls=URLS();res.json({resource:urls.resource,authorization_servers:[urls.issuer],scopes_supported:[READ_SCOPE,"offline_access"],bearer_methods_supported:["header"]});
  });
  app.get(["/.well-known/oauth-authorization-server","/.well-known/oauth-authorization-server/api"],active,(_req,res)=>{
    const urls=URLS();res.json({issuer:urls.issuer,authorization_endpoint:urls.authorize,
      token_endpoint:urls.token,revocation_endpoint:urls.revoke,
      response_types_supported:["code"],grant_types_supported:["authorization_code","refresh_token"],
      token_endpoint_auth_methods_supported:["none"],code_challenge_methods_supported:["S256"],
      scopes_supported:[READ_SCOPE,"offline_access"],code_challenge_methods_supported:["S256"],
      client_id_metadata_document_supported:true});
  });
  app.get("/api/ai/oauth/authorize",active,async(req,res,next)=>{
    try{
      const urls=URLS();
      if(!validAuthorizeRequest(req.query,urls))return res.status(400).send("Solicitud OAuth inválida");
      const user=await sessionUser(req);
      if(!user)return res.redirect(302,"/login?next="+encodeURIComponent(req.originalUrl));
      if(!tenantChoices(user).length)return res.status(403).send("No tienes ningún cliente autorizado");
      res.type("html").send(renderConsent(req,req.query,user));
    }catch(e){next(e);}
  });
  app.post("/api/ai/oauth/authorize",active,urlEncoded,async(req,res,next)=>{
    try{
      const urls=URLS(),body=req.body;
      if(!validAuthorizeRequest(body,urls)||body.confirm!=="yes")return res.status(400).send("Autorización inválida");
      const user=await sessionUser(req);
      if(!user)return res.status(401).send("Vuelve a iniciar sesión en Farmétrica");
      if(typeof body.tenant!=="string"||!tenantChoices(user).includes(body.tenant))return res.status(403).send("Cliente no autorizado");
      const code=opaque();
      await pool.query("INSERT INTO farmetrica.ai_oauth_codigos(code_hash,email,metodo_acceso,cliente_slug,client_id,redirect_uri,challenge,scope,resource,caduca_en) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '5 minutes')",
        [sha(code),user.email,user.source,body.tenant,body.client_id,body.redirect_uri,body.code_challenge,body.scope,body.resource]);
      const back=new URL(body.redirect_uri);
      back.searchParams.set("code",code);back.searchParams.set("state",body.state);
      res.redirect(302,back.toString());
    }catch(e){next(e);}
  });
  app.post("/api/ai/oauth/token",active,urlEncoded,async(req,res,next)=>{
    try{
      const urls=URLS(),body=req.body||{};
      if(!validChatGPTClient(body.client_id,body.redirect_uri||"https://chatgpt.com/connector_platform_oauth_redirect")&&body.grant_type==="authorization_code")
        return oauthError(res,400,"invalid_client");
      if(body.resource!==urls.resource)return oauthError(res,400,"invalid_target");
      if(body.grant_type==="authorization_code"){
        if(typeof body.code!=="string"||body.code.length>128)return oauthError(res,400,"invalid_grant");
        const {rows}=await pool.query("DELETE FROM farmetrica.ai_oauth_codigos WHERE code_hash=$1 AND caduca_en>now() RETURNING *",[sha(body.code)]);
        const code=rows[0];
        if(!code||code.client_id!==body.client_id||code.redirect_uri!==body.redirect_uri||
           code.resource!==body.resource||!validPkce(body.code_verifier,code.challenge))
          return oauthError(res,400,"invalid_grant");
        const user=await resolveAccess(code.email,code.metodo_acceso);
        const ctx=user&&await resolveTenant({user,get:k=>k==="x-farmetrica-cliente"?code.cliente_slug:"",query:{}});
        if(!ctx||ctx.client.slug!==code.cliente_slug)return oauthError(res,400,"access_denied");
        const access=opaque(),refresh=code.scope.split(" ").includes("offline_access")?opaque():null;
        await pool.query("INSERT INTO farmetrica.ai_oauth_conexiones(email,metodo_acceso,cliente_slug,client_id,resource,scope,access_hash,refresh_hash,access_caduca_en,refresh_caduca_en) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '1 hour',now()+interval '30 days')",
          [code.email,code.metodo_acceso,code.cliente_slug,code.client_id,code.resource,code.scope,sha(access),refresh?sha(refresh):null]);
        return res.json(tokenResponse(code,access,refresh));
      }
      if(body.grant_type==="refresh_token"){
        if(typeof body.refresh_token!=="string"||body.refresh_token.length>128)return oauthError(res,400,"invalid_grant");
        const db=await pool.connect();
        try{
          await db.query("BEGIN");
          const {rows}=await db.query("SELECT * FROM farmetrica.ai_oauth_conexiones WHERE refresh_hash=$1 AND client_id=$2 AND resource=$3 AND revocado_en IS NULL AND refresh_caduca_en>now() FOR UPDATE",
            [sha(body.refresh_token),body.client_id,body.resource]);
          const link=rows[0];
          if(!link){await db.query("ROLLBACK");return oauthError(res,400,"invalid_grant");}
          const user=await resolveAccess(link.email,link.metodo_acceso);
          const ctx=user&&await resolveTenant({user,get:k=>k==="x-farmetrica-cliente"?link.cliente_slug:"",query:{}});
          if(!ctx||ctx.client.slug!==link.cliente_slug){await db.query("ROLLBACK");return oauthError(res,400,"access_denied");}
          const access=opaque(),refresh=opaque();
          await db.query("UPDATE farmetrica.ai_oauth_conexiones SET access_hash=$2,refresh_hash=$3,access_caduca_en=now()+interval '1 hour',ultimo_uso_en=now() WHERE id=$1",
            [link.id,sha(access),sha(refresh)]);
          await db.query("COMMIT");
          return res.json(tokenResponse(link,access,refresh));
        }catch(e){try{await db.query("ROLLBACK");}catch{}throw e;}finally{db.release();}
      }
      return oauthError(res,400,"unsupported_grant_type");
    }catch(e){next(e);}
  });
  app.post("/api/ai/oauth/revoke",active,urlEncoded,async(req,res,next)=>{
    try{
      const token=req.body?.token;
      if(typeof token==="string"&&token.length<=128)await pool.query("UPDATE farmetrica.ai_oauth_conexiones SET revocado_en=now() WHERE access_hash=$1 OR refresh_hash=$1",[sha(token)]);
      // La revocación OAuth es idempotente y no revela si existía el token.
      res.status(200).end();
    }catch(e){next(e);}
  });
  // Pantalla futura/administración: lista y revoca únicamente conexiones del usuario actual.
  app.get("/api/ai/conexiones",active,requireUser,async(req,res,next)=>{
    try{
      const {rows}=await pool.query("SELECT id,cliente_slug AS cliente,creado_en,ultimo_uso_en,revocado_en FROM farmetrica.ai_oauth_conexiones WHERE email=$1 ORDER BY creado_en DESC LIMIT 100",[req.user.email]);
      res.json({conexiones:rows});
    }catch(e){next(e);}
  });
  app.post("/api/ai/conexiones/:id/revocar",active,requireUser,async(req,res,next)=>{
    try{
      if(!/^[1-9]\d{0,17}$/.test(req.params.id))return res.status(400).json({error:"Identificador inválido"});
      await pool.query("UPDATE farmetrica.ai_oauth_conexiones SET revocado_en=now() WHERE id=$1 AND email=$2",[req.params.id,req.user.email]);
      res.json({ok:true});
    }catch(e){next(e);}
  });

  app.post("/api/mcp",active,authenticate,async(req,res,next)=>{
    const input=req.body,id=input?.id??null;
    if(!input||input.jsonrpc!=="2.0"||typeof input.method!=="string"||Array.isArray(input))
      return res.status(400).json(jsonRpcError(id,-32600,"Invalid Request"));
    try {
      if(input.method==="notifications/initialized"||input.method==="notifications/cancelled")return res.status(202).end();
      if(input.method==="initialize")return res.json({jsonrpc:"2.0",id,result:{
        protocolVersion:MCP_VERSION,capabilities:{tools:{listChanged:false}},serverInfo:{name:"Farmetrica",version:"0.1.0"}}});
      if(input.method==="ping")return res.json({jsonrpc:"2.0",id,result:{}});
      if(input.method==="tools/list")return res.json({jsonrpc:"2.0",id,result:{tools:MCP_TOOLS}});
      if(input.method!=="tools/call")return res.json(jsonRpcError(id,-32601,"Method not found"));
      const name=input.params?.name,args=input.params?.arguments||{};
      if(!MCP_TOOLS.some(t=>t.name===name)||!args||typeof args!=="object"||Array.isArray(args))
        return res.json(jsonRpcError(id,-32602,"Herramienta o argumentos inválidos"));
      if(!retryOk(req.aiConnection.id+":"+req.user.email))return res.status(429).json(jsonRpcError(id,-32000,"Demasiadas consultas"));
      const ctx=req.context;
      let data;
      if(name==="listar_contexto")data={cliente:ctx.client.name,rol:ctx.role,
        farmacias:ctx.pharmacies.map(p=>({id:Number(p.id),nombre:p.name,ciudad:p.city})),
        modulos:ctx.modules};
      else if(name==="catalogo_analitico")data={indicadores:TOOL_CATALOG,
        advertencias:["No se calculan márgenes reales sin costes contrastables.","El diferencial de PUC histórico no es ahorro garantizado.","Las cifras pueden depender de la cobertura de sincronización.","No hay acceso a datos de pacientes ni SQL arbitrario."]};
      else if(name==="consultar_indicador"){
        if(typeof args.indicador!=="string"||typeof args.desde!=="string"||typeof args.hasta!=="string")throw new TypeError("Indicador o fechas inválidas");
        data=await readAnalytics(pool,ctx,args.indicador,{from:args.desde,to:args.hasta},
          args.farmacias===undefined?[]:args.farmacias);
      }else {
        if(typeof args.pregunta!=="string"||args.pregunta.trim().length<2||args.pregunta.length>1000)
          throw new TypeError("Pregunta inválida");
        const period=(args.desde!==undefined||args.hasta!==undefined)?
          {from:args.desde,to:args.hasta}:periodFromQuestion(args.pregunta);
        normalizedPeriod(period);
        const ids=authorizedIds(ctx,args.farmacias===undefined?pharmacyIdsFromQuestion(args.pregunta,ctx):args.farmacias);
        const names=selectTools(args.pregunta,ctx);
        data={periodo:period,consultas:names.length?
          await Promise.all(names.map(n=>readAnalytics(pool,ctx,n,period,ids))):[],
          ...(names.length?{}:{aviso:"No hay una herramienta autorizada para esta pregunta; consulta catalogo_analitico."})};
      }
      pool.query("INSERT INTO farmetrica.ai_oauth_auditoria(conexion_id,cliente_slug,herramienta) VALUES($1,$2,$3)",[req.aiConnection.id,ctx.client.slug,name]).catch(()=>{});
      res.json({jsonrpc:"2.0",id,result:{content:[{type:"text",text:JSON.stringify(data)}],structuredContent:data}});
    }catch(e){
      if(e instanceof TypeError||/autorizadas|inválid|desconocid|Período|Farmacias/.test(e.message||""))
        return res.json({jsonrpc:"2.0",id,result:{isError:true,content:[{type:"text",text:"Consulta no válida o farmacia no autorizada."}]}});
      next(e);
    }
  });
  app.get("/api/mcp",active,(_req,res)=>res.status(405).set("Allow","POST").end());
  app.delete("/api/mcp",active,(_req,res)=>res.status(204).end());
}
