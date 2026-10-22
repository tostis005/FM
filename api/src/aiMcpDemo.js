// MCP publico SOLO para demostraciones con datos 100 % inventados.
// NO consulta PostgreSQL, servicios internos, OAuth ni datos de clientes reales.
const VERSION="2025-06-18";
const PHARMACIES=Object.freeze([
  {id:90001,nombre:"Farmacia Ejemplo Norte",ciudad:"Ciudad Ficticia"},
  {id:90002,nombre:"Farmacia Ejemplo Centro",ciudad:"Ciudad Ficticia"},
  {id:90003,nombre:"Farmacia Ejemplo Sur",ciudad:"Ciudad Ficticia"}
]);
const INDICATORS=Object.freeze({
  ventas_resumen:{modulo:"ventas",etiqueta:"Ventas de ejemplo"},
  compras_resumen:{modulo:"compras",etiqueta:"Compras de ejemplo"},
  stock_capital:{modulo:"stock",etiqueta:"Stock de ejemplo"},
  ventas_articulos:{modulo:"ventas",etiqueta:"Artículos de ejemplo"},
  ahorro_economico:{modulo:"compras",etiqueta:"Oportunidad estimada de ejemplo"}
});
const META={modo:"DEMO",ficticio:true,aviso:"DATOS SINTÉTICOS. No corresponden a ninguna farmacia real ni proceden de PostgreSQL."};
const DATE=/^\d{4}-\d{2}-\d{2}$/;
function period(from,to){
  const d=from||"2026-10-01",h=to||"2026-10-22";
  if(!DATE.test(d)||!DATE.test(h))throw new TypeError("Fechas inválidas");
  const left=new Date(d+"T00:00:00Z"),right=new Date(h+"T00:00:00Z");
  if(Number.isNaN(left.valueOf())||Number.isNaN(right.valueOf())||
    left.toISOString().slice(0,10)!==d||right.toISOString().slice(0,10)!==h)
    throw new TypeError("Fecha no existente");
  const days=Math.round((right-left)/86400000)+1;
  if(days<1||days>366)throw new TypeError("El período debe tener entre 1 y 366 días");
  return {desde:d,hasta:h,dias:days};
}
function demoIds(ids){
  if(ids===undefined)return PHARMACIES.map(p=>p.id);
  if(!Array.isArray(ids)||ids.length>3||ids.some(n=>!Number.isInteger(n)||!PHARMACIES.some(p=>p.id===n)))
    throw new TypeError("Solo se aceptan IDs ficticios del catálogo demo");
  return ids.length?[...new Set(ids)]:PHARMACIES.map(p=>p.id);
}
function summary(name,arguments_={}){
  const {desde,hasta,dias}=period(arguments_.desde,arguments_.hasta);
  const ids=demoIds(arguments_.farmacias);
  if(!Object.hasOwn(INDICATORS,name))throw new TypeError("Indicador inexistente");
  const factor=dias/30;
  const selected=PHARMACIES.filter(p=>ids.includes(p.id));
  const items=selected.map((p,i)=>{
    const base=(p.id-90000)*10000;
    const euro=(n)=>Math.round(n*factor*100)/100;
    if(name==="ventas_resumen")return {farmacia:p.nombre,ventas_eur:euro(40000+base),tickets:Math.round((1100+i*180)*factor)};
    if(name==="compras_resumen")return {farmacia:p.nombre,compras_eur:euro(25000+base*.8),unidades:Math.round((2300+i*240)*factor)};
    if(name==="stock_capital")return {farmacia:p.nombre,capital_estimado_eur:Math.round(39000+base*1.1)};
    if(name==="ventas_articulos")return {farmacia:p.nombre,articulos:[{nombre:"Producto de prueba A",unidades:Math.round(130*factor)},{nombre:"Producto de prueba B",unidades:Math.round(95*factor)}]};
    return {farmacia:p.nombre,diferencial_historico_puc_eur:euro(600+i*110),nota:"No representa ahorro real ni garantizado"};
  });
  return {...META,indicador:name,periodo:{desde,hasta,dias},farmacias:items,moneda:"EUR"};
}
const demoTools=[
  {name:"listar_contexto",description:"DEMO SIN LOGIN: tres farmacias completamente ficticias. Jamás devuelve datos reales.",annotations:{readOnlyHint:true,openWorldHint:false},inputSchema:{type:"object",properties:{},additionalProperties:false}},
  {name:"catalogo_analitico",description:"DEMO SIN LOGIN: catálogo con indicadores sintéticos.",annotations:{readOnlyHint:true,openWorldHint:false},inputSchema:{type:"object",properties:{},additionalProperties:false}},
  {name:"consultar_indicador",description:"DEMO: consulta cifras inventadas para probar ChatGPT, sin acceso a BD.",annotations:{readOnlyHint:true,openWorldHint:false},
    inputSchema:{type:"object",properties:{indicador:{type:"string",enum:Object.keys(INDICATORS)},desde:{type:"string"},hasta:{type:"string"},farmacias:{type:"array",items:{type:"integer"}}},required:["indicador"],additionalProperties:false}},
  {name:"explorar_pregunta",description:"DEMO: simula una consulta por lenguaje natural sin consultar datos reales.",annotations:{readOnlyHint:true,openWorldHint:false},
    inputSchema:{type:"object",properties:{pregunta:{type:"string",minLength:2,maxLength:300},desde:{type:"string"},hasta:{type:"string"},farmacias:{type:"array",items:{type:"integer"}}},required:["pregunta"],additionalProperties:false}}
];
const error=(id,code,message)=>({jsonrpc:"2.0",id,error:{code,message}});
const result=(id,data)=>({jsonrpc:"2.0",id,result:{content:[{type:"text",text:JSON.stringify(data)}],structuredContent:data}});
export function handlePublicDemoMcp(input){
  if(!input||typeof input!=="object"||Array.isArray(input)||input.jsonrpc!=="2.0"||
     typeof input.method!=="string")return {http:400,body:error(input?.id??null,-32600,"Invalid Request")};
  const id=input.id??null;
  if(input.method==="notifications/initialized"||input.method==="notifications/cancelled")return {http:202,body:null};
  if(input.method==="initialize")return {http:200,body:{jsonrpc:"2.0",id,result:{protocolVersion:VERSION,
    capabilities:{tools:{listChanged:false}},serverInfo:{name:"Farmetrica Demo Ficticia",version:"0.1.0"}}}};
  if(input.method==="ping")return {http:200,body:{jsonrpc:"2.0",id,result:{}}};
  if(input.method==="tools/list")return {http:200,body:{jsonrpc:"2.0",id,result:{tools:demoTools}}};
  if(input.method!=="tools/call")return {http:200,body:error(id,-32601,"Method not found")};
  const name=input.params?.name,args=input.params?.arguments??{};
  if(!demoTools.some(t=>t.name===name)||!args||typeof args!=="object"||Array.isArray(args))
    return {http:200,body:error(id,-32602,"Invalid params")};
  try{
    if(Object.keys(args).some(k=>!(demoTools.find(x=>x.name===name).inputSchema.properties[k])))
      throw new TypeError("Argumentos no admitidos");
    if(name==="listar_contexto")return {http:200,body:result(id,{...META,cliente:"Organización DEMO",farmacias:PHARMACIES,modulos:["compras","ventas","stock"]})};
    if(name==="catalogo_analitico")return {http:200,body:result(id,{...META,indicadores:INDICATORS})};
    if(name==="consultar_indicador")return {http:200,body:result(id,summary(args.indicador,args))};
    if(typeof args.pregunta!=="string"||args.pregunta.trim().length<2||args.pregunta.length>300)throw new TypeError("Pregunta inválida");
    const q=args.pregunta.toLowerCase();
    const indicator=/stock|existenc|inmoviliz/.test(q)?"stock_capital":
      /ahorr|optimiza|diferencia/.test(q)?"ahorro_economico":
      /compr|proveedor/.test(q)?"compras_resumen":
      /art[ií]cul|producto|m[aá]s vendid/.test(q)?"ventas_articulos":"ventas_resumen";
    return {http:200,body:result(id,{...summary(indicator,args),pregunta:args.pregunta})};
  }catch(e){
    if(e instanceof TypeError)return {http:200,body:{jsonrpc:"2.0",id,result:{isError:true,
      content:[{type:"text",text:"Consulta demo inválida: "+e.message}]}}};
    throw e;
  }
}
export function setupPublicDemoMcp(app){
  // Falso entorno sin conexion a BD. No se montan endpoints OAuth ni rutas reales.
  app.post("/api/mcp-demo",(req,res)=>{
    // Carga limitada de la petición además del límite general de Express.
    if(Number(req.get("content-length")||0)>16384)return res.status(413).end();
    const outcome=handlePublicDemoMcp(req.body);
    if(!outcome.body)return res.status(outcome.http).end();
    return res.status(outcome.http).json(outcome.body);
  });
  app.get("/api/mcp-demo",(_req,res)=>res.status(405).set("Allow","POST").end());
}
