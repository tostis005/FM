import {lookup} from "node:dns/promises";
import {request} from "node:https";
import {isIP} from "node:net";

// Only public IPv4 destinations are fetched. DNS is resolved once and pinned
// into the TLS request; redirects, private networks and oversized JSON are denied.
export function publicIPv4(address){
  if(isIP(address)!==4)return false;
  const [a,b,c]=address.split(".").map(Number);
  return !(a===0||a===10||a===127||a>=224||
    (a===100&&b>=64&&b<=127)||(a===169&&b===254)||
    (a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===2))||
    (a===198&&(b===18||b===19||(b===51&&c===100)))||
    (a===203&&b===0&&c===113));
}
export function validRedirect(value){
  if(typeof value!=="string"||value.length>2048)return false;
  try{
    const u=new URL(value);
    if(u.username||u.password||u.hash)return false;
    const host=u.hostname.replace(/^\[|\]$/g,"");
    if(u.protocol==="http:")return ["127.0.0.1","::1"].includes(host);
    return u.protocol==="https:"&&
      (isIP(host)?publicIPv4(host):host.includes(".")&&!host.endsWith(".localhost")&&!host.endsWith(".local"));
  }catch{return false;}
}
export function clientMetadata(body,clientId){
  if(!body||typeof body!=="object"||Array.isArray(body))return null;
  if(clientId&&(body.client_id!==clientId||typeof body.client_name!=="string"||!body.client_name.trim()))return null;
  if(!Array.isArray(body.redirect_uris)||!body.redirect_uris.length||
    body.redirect_uris.length>10||!body.redirect_uris.every(validRedirect))return null;
  // Some published clients prefer private_key_jwt but explicitly support none.
  const supportsNone=clientId&&Array.isArray(body.token_endpoint_auth_methods_supported)&&
    body.token_endpoint_auth_methods_supported.includes("none");
  if(body.token_endpoint_auth_method!==undefined&&body.token_endpoint_auth_method!=="none"&&!supportsNone)return null;
  const grants=body.grant_types??["authorization_code"];
  const responses=body.response_types??["code"];
  if(!Array.isArray(grants)||!grants.includes("authorization_code")||
    grants.length>20||!grants.every(x=>typeof x==="string"&&x.length<200&&(clientId||["authorization_code","refresh_token"].includes(x)))||
    !Array.isArray(responses)||responses.length!==1||responses[0]!=="code")return null;
  const scope=body.scope??"farmetrica.read offline_access";
  if(typeof scope!=="string"||!scope.split(/\s+/).includes("farmetrica.read")||
    !scope.split(/\s+/).filter(Boolean).every(x=>["farmetrica.read","offline_access"].includes(x)))return null;
  if(body.client_name!==undefined&&(typeof body.client_name!=="string"||body.client_name.length>200))return null;
  return {client_name:body.client_name||"Cliente MCP",redirect_uris:[...new Set(body.redirect_uris)],
    token_endpoint_auth_method:"none",grant_types:grants.filter(x=>["authorization_code","refresh_token"].includes(x)),response_types:responses,scope};
}
export async function fetchClientMetadata(clientId){
  if(typeof clientId!=="string"||clientId.length>2048)return null;
  let url;
  try{url=new URL(clientId);}catch{return null;}
  if(url.protocol!=="https:"||url.username||url.password||url.hash||url.search||
    url.pathname==="/"||(url.port&&url.port!=="443")||isIP(url.hostname))return null;
  try{
    // The deadline covers DNS, TLS, headers and body, not only socket inactivity.
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),5000);
    try{
      const records=await Promise.race([
        lookup(url.hostname,{all:true,family:4}),
        new Promise((_,reject)=>controller.signal.addEventListener("abort",()=>reject(Error("timeout")),{once:true}))
      ]);
      if(!records.length||records.some(r=>!publicIPv4(r.address)))return null;
      const body=await new Promise((resolve,reject)=>{
        const req=request(url,{signal:controller.signal,agent:false,
          headers:{Accept:"application/json"},
          lookup:(_host,options,cb)=>options.all?cb(null,[records[0]]):cb(null,records[0].address,4)
        },res=>{
          if(res.statusCode!==200||!/^application\/(?:json|oauth-client-metadata\+json)(?:;|$)/i.test(res.headers["content-type"]||"")){
            req.destroy(Error("invalid metadata response"));return;
          }
          let size=0;const chunks=[];
          res.on("data",chunk=>{size+=chunk.length;if(size>32768)req.destroy(Error("metadata too large"));else chunks.push(chunk);});
          res.on("error",reject);
          res.on("end",()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));}catch(e){reject(e);}});
        });
        req.on("error",reject);req.end();
      });
      return clientMetadata(body,clientId);
    }finally{clearTimeout(timer);}
  }catch{return null;}
}
export async function resolveOAuthClient(pool,clientId){
  if(typeof clientId!=="string")return null;
  if(clientId.startsWith("https://"))return fetchClientMetadata(clientId);
  if(!/^mcp_[A-Za-z0-9_-]{43}$/.test(clientId))return null;
  const {rows}=await pool.query("SELECT metadata FROM farmetrica.ai_oauth_clientes WHERE client_id=$1",[clientId]);
  return rows[0]?.metadata||null;
}
