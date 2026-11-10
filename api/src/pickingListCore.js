// Picking List PharmaWow: la fuente externa es un snapshot CSV, no una
// contabilidad ni una confirmación de preparación física de pedidos.
export function normalizeSku(value) {
 return String(value??"").replace(/^\uFEFF/,"").trim().replace(/^["']|["']$/g,"");
}
export function skuToCn(value) {
 const sku=normalizeSku(value);
 return /^\d{1,7}$/.test(sku)?sku.padStart(6,"0"):null;
}
export function parseCsvRecords(text,{maxRows=50000}={}){
 if(typeof text!=="string"||text.length>8*1024*1024)
  throw new Error("El CSV supera el límite permitido (8 MB).");
 const stripped=text.replace(/^\uFEFF/,"");
 const firstLine=stripped.split(/\r?\n/,1)[0]||"";
 const sep=[",",";","\\t"].map(sep=>({sep,count:firstLine.split(sep).length-1}))
  .sort((a,b)=>b.count-a.count)[0].sep;
 const rows=[];let field="",cells=[],quoted=false;
 function finishRow(){
  cells.push(field);field="";
  if(cells.some(x=>x!==""))rows.push(cells);
  cells=[];
  if(rows.length>maxRows+1)throw new Error("El fichero tiene demasiadas líneas.");
 }
 for(let i=0;i<stripped.length;i++){
  const ch=stripped[i];
  if(ch==='"'){
   if(quoted&&stripped[i+1]==='"'){field+='"';i++}
   else quoted=!quoted;
  }else if(!quoted&&ch===sep){
   cells.push(field);field="";
  }else if(!quoted&&(ch==="\n"||ch==="\r")){
   if(ch==="\r"&&stripped[i+1]==="\n")i++;
   finishRow();
  }else field+=ch;
 }
 if(quoted)throw new Error("El CSV contiene comillas sin cerrar.");
 if(cells.length||field)finishRow();
 return rows;
}
const key = value=>String(value||"").toLowerCase().normalize("NFD")
 .replace(/[\u0300-\u036f]/g,"").replace(/[\s-]+/g,"_").replace(/[^\w]/g,"");
// Acepta tanto el CSV preparado para Power BI como columnas del CSV estándar
// exportado de Shopify; nunca interpreta una página HTML como pedidos.
const aliases={
 order_id:["order_id","id_pedido","id","order_number","numero_de_pedido"],
 order_name:["order_name","name","nombre_pedido","pedido"],
 quantity:["quantity","lineitem_quantity","line_item_quantity","cantidad","unidades"],
 sku:["sku","lineitem_sku","line_item_sku","product_sku","codigo_nacional","codigo"],
 order_created_at:["order_created_at","created_at","fecha_pedido"],
 order_source_name:["order_source_name","source_name","source","canal"],
 variant_id:["variant_id","lineitem_variant_id"],
 title:["title","product_title","item_name","lineitem_name","line_item_name","producto","descripcion"]
};
export function parsePendingCsvDetailed(text) {
 const raw=parseCsvRecords(text);
 if(!raw.length)throw new Error("El fichero no contiene cabeceras.");
 const headers=raw[0].map(key);
 const column=name=>(aliases[name]||[name]).map(x=>headers.indexOf(x)).find(i=>i>=0)??-1;
 for(const required of ["order_id","quantity","sku"]){
  if(column(required)<0)throw new Error("Falta la columna obligatoria "+required+
   ". Revisa que la ruta apunte al CSV de pedidos pendientes.");
 }
 const get=(row,name)=>column(name)<0?"":String(row[column(name)]??"").trim();
 const lines=[],invalid=[];
 for(let i=1;i<raw.length;i++){
  const row=raw[i],lineNo=i+1;
  const orderId=get(row,"order_id")||get(row,"order_name");
  const sku=normalizeSku(get(row,"sku"));
  const qtyText=get(row,"quantity").replace(",",".");
  // Shopify y algunas exportaciones incluyen filas de envío/descuentos sin
  // SKU y líneas vacías: no deben invalidar los productos preparados.
  if(!orderId&&!sku&&!qtyText)continue;
  const quantity=Number(qtyText);
  if(!sku||!/^\\S/.test(sku)||!orderId||orderId.length>90||
    sku.length>90||!Number.isSafeInteger(quantity)||quantity<=0||quantity>50000){
   invalid.push(lineNo);
   continue;
  }
  const date=get(row,"order_created_at");
  const parsedDate=date&&Number.isFinite(Date.parse(date))?new Date(date).toISOString():null;
  const source=get(row,"order_source_name");
  lines.push({
   orderId,orderName:get(row,"order_name").slice(0,120),
   createdAt:parsedDate,channel:source.slice(0,120),
   quantity,sku,cn:skuToCn(sku),
   variantId:get(row,"variant_id").slice(0,90),
   title:get(row,"title").slice(0,300)
  });
 }
 // Nunca sustituir un snapshot válido por uno vacío si el archivo contiene
 // líneas que no se pueden interpretar. Un CSV solo con cabecera sí significa
 // legítimamente que ya no hay pedidos pendientes.
 if(invalid.length&&lines.length===0)
  throw new Error("Fila "+invalid.slice(0,4).join(", ")+
   ": pedido, SKU o cantidad incorrectos. No se ha sustituido la última lectura.");
 const omitted=invalid.length;
 const warning=omitted?
  "Se han omitido "+omitted+" líneas no preparables del CSV (filas "+
   invalid.slice(0,8).join(", ")+(omitted>8?", …":"")+").":"";
 return {lines,omitted,warning};
}
export function parsePendingCsv(text){return parsePendingCsvDetailed(text).lines;}
const n=value=>Number.isFinite(Number(value))?Math.max(0,Math.trunc(Number(value))):0;

/**
 * Reparto informativo: 1º almacén; 2º cuota proporcional al excedente sobre
 * una unidad de seguridad en cada farmacia, con mayores restos; 3º solo si
 * es imprescindible, utilizar las últimas unidades, priorizando la mayor
 * disponibilidad restante (sin orden fijo de farmacias).
 */
export function allocatePending(units,warehouse,pharmacies,{reserve=1}={}){
 const needed=n(units);
 const storeKnown=warehouse!==null&&warehouse!==undefined&&Number.isFinite(Number(warehouse));
 const sites=pharmacies.map(p=>({...p,
  stock:p.stock===null||p.stock===undefined?null:n(p.stock)}));
 const stockKnown=sites.every(p=>p.stock!==null);
 const empty=Object.fromEntries(sites.map(p=>[p.code,0]));
 if(!storeKnown)return {warehouse:null,bySite:empty,fulfilled:null,remaining:null,
  protectedUnits:0,zeroedSites:[],partial:true};
 const warehouseUnits=Math.min(needed,n(warehouse));
 let remaining=needed-warehouseUnits;
 const bySite={...empty};
 // Una farmacia sin stock sincronizado no se considera automáticamente vacía.
 const candidates=sites.filter(p=>p.stock!==null&&p.stock>0);
 const safeReserve=n(reserve);
 const proportional=(size,capacities)=>{
  const total=capacities.reduce((a,b)=>a+b.cap,0);
  if(total<=0||size<=0)return 0;
  const take=Math.min(size,total);
  let consumed=0;
  const parts=capacities.map(p=>{
   const exact=take*p.cap/total,base=Math.min(p.cap,Math.floor(exact));
   consumed+=base;
   return {...p,exact,frac:exact-Math.floor(exact),qty:base};
  });
  parts.sort((a,b)=>b.frac-a.frac||b.cap-a.cap||a.code.localeCompare(b.code));
  for(const part of parts){
   if(consumed>=take)break;
   if(part.qty<part.cap){part.qty++;consumed++;}
  }
  for(const p of parts)bySite[p.code]+=p.qty;
  return consumed;
 };
 remaining-=proportional(remaining,candidates.map(p=>({
  code:p.code,cap:Math.max(0,p.stock-safeReserve)
 })));
 // Solo agotar alguna farmacia si la demanda no se puede servir de otro modo.
 if(remaining>0){
  const residual=candidates.map(p=>({code:p.code,
   cap:Math.max(0,p.stock-bySite[p.code])}))
    .filter(p=>p.cap>0).sort((a,b)=>b.cap-a.cap||a.code.localeCompare(b.code));
  for(const p of residual){
   if(remaining<=0)break;
   const take=Math.min(remaining,p.cap);
   bySite[p.code]+=take;remaining-=take;
  }
 }
 const fulfilled=needed-remaining;
 return {
  warehouse:warehouseUnits,bySite,fulfilled,
  remaining:stockKnown?remaining:null,protectedUnits:safeReserve,
  zeroedSites:sites.filter(p=>p.stock!==null&&p.stock>0&&bySite[p.code]===p.stock&&bySite[p.code]>0)
   .map(p=>p.code),
  partial:!stockKnown
 };
}
export function validateDropboxCsvUrl(raw){
 let url;
 try{url=new URL(String(raw||"").trim())}catch{throw new Error("Introduce un enlace Dropbox válido.");}
 if(url.protocol!=="https:"||url.hostname!=="www.dropbox.com"||
    !/^\/scl\/fi\/[A-Za-z0-9_-]+\/[^/]+\.csv$/i.test(url.pathname)||
    !url.searchParams.has("rlkey")||url.username||url.password||
    url.hash||url.href.length>1800)
  throw new Error("Solo se aceptan enlaces HTTPS directos a ficheros CSV compartidos de Dropbox.");
 url.searchParams.set("dl","1");
 return url.href;
}
export async function downloadDropboxCsv(raw,{fetchFn=fetch}={}){
 let address=validateDropboxCsvUrl(raw);
 const allowed=host=>host==="www.dropbox.com"||host==="dl.dropbox.com"||
   host==="dl.dropboxusercontent.com"||host.endsWith(".dropboxusercontent.com");
 for(let hop=0;hop<5;hop++){
  const response=await fetchFn(address,{redirect:"manual",signal:AbortSignal.timeout(20000),
   headers:{Accept:"text/csv,text/plain;q=0.9,*/*;q=0.2"}});
  if(response.status>=300&&response.status<400){
   const link=response.headers.get("location");
   if(!link)throw new Error("Dropbox no ha devuelto el fichero CSV.");
   const next=new URL(link,address);
   if(next.protocol!=="https:"||!allowed(next.hostname)||
      next.username||next.password)
    throw new Error("La descarga se ha redirigido a un destino no permitido.");
   address=next.href;continue;
  }
  if(!response.ok)throw new Error("Dropbox no ha permitido descargar el CSV.");
  const limit=8*1024*1024;
  const contentLength=Number(response.headers.get("content-length")||0);
  if(contentLength>limit)throw new Error("El CSV remoto supera los 8 MB.");
  // Leer por streaming, no descargar un fichero arbitrariamente grande.
  const reader=response.body?.getReader();
  if(!reader)throw new Error("La respuesta de Dropbox está vacía.");
  const chunks=[];let bytes=0;
  try{
   while(true){
    const {value,done}=await reader.read();
    if(done)break;
    bytes+=value.length;
    if(bytes>limit)throw new Error("El CSV remoto supera los 8 MB.");
    chunks.push(value);
   }
  }finally{reader.releaseLock();}
  const result=Buffer.concat(chunks,bytes).toString("utf8");
  if(/^\s*<(?:!doctype|html|head)\b/i.test(result))
   throw new Error("Dropbox ha devuelto una página HTML en lugar del CSV.");
  return result;
 }
 throw new Error("Demasiadas redirecciones para descargar el CSV de Dropbox.");
}
