import test from "node:test";
import assert from "node:assert/strict";
import {
  callFarmetricaTool, listFarmetricaTools, validateTemporaryLink,
  FarmetricaBridgeError, UPSTREAM_MCP
} from "./mcp-bridge.mjs";

const token = "fm_share_" + "a".repeat(43);
const url = "https://farmetrica.com/api/consulta-temporal/" + token;
const ok = result => new Response(JSON.stringify({jsonrpc:"2.0",id:1,result}),
  {status:200,headers:{"Content-Type":"application/json"}});

test("descubre exactamente las dos herramientas existentes", async () => {
  const tools = await listFarmetricaTools({fetchImpl:async(target,opts) => {
    assert.equal(target,UPSTREAM_MCP);
    assert.equal(opts.method,"POST");
    assert.equal(opts.cache,"no-store");
    assert.equal(opts.redirect,"error");
    assert.equal(JSON.parse(opts.body).method,"tools/list");
    return ok({tools:[
      {name:"leer_modelo_temporal",inputSchema:{type:"object"}},
      {name:"consultar_datos_temporales",inputSchema:{type:"object"}},
      {name:"herramienta_con_escritura"}
    ]});
  }});
  assert.deepEqual(tools.map(x=>x.name),
    ["leer_modelo_temporal","consultar_datos_temporales"]);
});

test("enlace estricto: evita destino distinto o parámetros y fragmentos", () => {
  assert.equal(validateTemporaryLink(url),url);
  for(const bad of [
    "http://farmetrica.com/api/consulta-temporal/"+token,
    "https://farmetrica.com.evil.test/api/consulta-temporal/"+token,
    url+"?formato=json",url+"#token",
    "https://farmetrica.com/api/consulta-temporal/mcp",
    "invalid",url.replace("fm_share_","fm_xhare_")
  ])assert.throws(()=>validateTemporaryLink(bad),
    error=>error instanceof FarmetricaBridgeError && error.code==="INVALID_LINK");
});

test("modelo se sanea para no devolver enlaces de navegación con credenciales", async()=>{
  const result = await callFarmetricaTool("leer_modelo_temporal",{url},{
    fetchImpl:async(_target,opts)=>{
      const body=JSON.parse(opts.body);
      assert.equal(body.params.arguments.url,url);
      return ok({structuredContent:{
        contrato:"farmetrica.analytics.readonly.v1",
        cliente:"Ejemplo",
        llamada:{modelo_json:url+"?modelo=json",raiz:url},
        fuentes:{ventas:{metricas:["importe"]}}
      }});
    }
  });
  assert.equal(result.isError,false);
  assert.equal(result.structuredContent.llamada,undefined);
  assert.ok(!JSON.stringify(result).includes(token));
  assert.equal(result.structuredContent.contrato,"farmetrica.analytics.readonly.v1");
});

test("dos períodos consecutivos generan dos POST distintos sin caché", async()=>{
  const calls=[];
  const fetchImpl=async(_target,opts)=>{
    const body=JSON.parse(opts.body);
    calls.push({body,cache:opts.cache,redirect:opts.redirect});
    const consulta=body.params.arguments.consulta;
    return ok({structuredContent:{
      origen:"PostgreSQL",
      periodo:{desde:consulta.desde,hasta:consulta.hasta},
      filas:[{farmacia:"Farmacia fixture",importe:consulta.desde.endsWith("22")?22:21}]
    }});
  };
  const q=desde=>({fuente:"ventas",agrupar:["farmacia"],metricas:["importe"],
    desde,hasta:desde,limite:100});
  const r1=await callFarmetricaTool("consultar_datos_temporales",
    {url,consulta:q("2026-10-22")},{fetchImpl});
  const r2=await callFarmetricaTool("consultar_datos_temporales",
    {url,consulta:q("2026-10-21")},{fetchImpl});
  assert.equal(r1.structuredContent.filas[0].importe,22);
  assert.equal(r2.structuredContent.filas[0].importe,21);
  assert.equal(calls.length,2);
  assert.equal(calls[0].body.params.arguments.consulta.desde,"2026-10-22");
  assert.equal(calls[1].body.params.arguments.consulta.desde,"2026-10-21");
  assert.ok(calls.every(c=>c.cache==="no-store" && c.redirect==="error"));
});

test("sin filas es un resultado válido, distinto a conexión fallida",async()=>{
  const empty=await callFarmetricaTool("consultar_datos_temporales",
    {url,consulta:{fuente:"ventas",metricas:["importe"],periodo:"hoy"}},{
      fetchImpl:async()=>ok({structuredContent:{origen:"PostgreSQL",filas:[]}})
    });
  assert.equal(empty.isError,false);
  assert.deepEqual(empty.structuredContent.filas,[]);
  await assert.rejects(callFarmetricaTool("leer_modelo_temporal",{url},
    {fetchImpl:async()=>{throw Error("connection reset " + token);}}),
    error=>error.code==="CONNECTION_FAILED" && !error.message.includes(token));
});

test("los errores de negocio no se convierten en cero ni respuesta vacía",async()=>{
  const result=await callFarmetricaTool("consultar_datos_temporales",
    {url,consulta:{fuente:"ventas",metricas:["importe"],periodo:"hoy"}},{
      fetchImpl:async()=>ok({isError:true,content:[{type:"text",text:"Enlace temporal caducado"}]})
    });
  assert.equal(result.isError,true);
  assert.equal(result.structuredContent,undefined);
});
