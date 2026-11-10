// Picking List PharmaWow: la fuente externa es un snapshot CSV, no una
// contabilidad ni una confirmación de preparación física de pedidos.
export function normalizeSku(value) {
 return String(value??"").replace(/^\uFEFF/,"").trim().replace(/^["']|["']$/g,"").replace(/^(\d+)\.0+$/, "$1");
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
 // Las comas entrecomilladas no cuentan como delimitadores.
 const delimiters=[",",";","\t"],counts=Object.fromEntries([",",";","\t"].map(d=>[d,0]));
 let inside=false;
 for(let i=0;i<firstLine.length;i++){
  if(firstLine[i]==='"'){
   if(inside&&firstLine[i+1]==='"'){i++;continue;}
   inside=!inside;
  }else if(!inside&&Object.hasOwn(counts,firstLine[i]))counts[firstLine[i]]++;
 }
 const sep=delimiters.sort((a,b)=>counts[b]-counts[a])[0];
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
export function parsePendingCsv(text) {
 const raw=parseCsvRecords(text);
 if(!raw.length)throw new Error("El fichero no contiene cabeceras.");
 const headers=raw[0].map(key);
 const col=(...names)=>names.map(x=>headers.indexOf(x)).find(x=>x>=0)??-1;
 const fields={
  order:col("order_id","id_pedido","pedido_id","id_orden","order_number","numero_pedido","numero_de_pedido","order","name","pedido"),
  orderName:col("order_name","nombre_pedido","nombre_del_pedido","numero_pedido","order_number","name"),
  quantity:col("quantity","lineitem_quantity","line_item_quantity","line_items_quantity",
   "pending_quantity","remaining_quantity","fulfillable_quantity","cantidad","unidades","cantidad_pendiente","unidades_pendientes"),
  sku:col("sku","lineitem_sku","line_item_sku","line_items_sku","codigo_nacional","codigo",
   "product_sku","variant_sku","referencia","ean","codigo_ean"),
  date:col("order_created_at","created_at","fecha_pedido","fecha_de_pedido","created"),
  channel:col("order_source_name","source_name","source","canal","origen","origen_pedido","sales_channel"),
  title:col("title","product_title","item_name","lineitem_name","line_item_name","product_name",
   "descripcion","description","producto","nombre_producto"),
  variant:col("variant_id","variant","id_variante")
 };
 for(const [name,label] of [["order","order_id / nombre del pedido"],["quantity","quantity / cantidad"],
  ["sku","sku / código de producto"]]){
  if(fields[name]<0)throw new Error("Falta la columna obligatoria "+label+
   ". Cabeceras encontradas: "+headers.slice(0,14).join(", ")+".");
 }
 const get=(row,name)=>fields[name]<0?"":String(row[fields[name]]??"").trim();
 const lines=[],skipped=[];
 for(let i=1;i<raw.length;i++){
  const row=raw[i],lineNumber=i+1;
  const orderId=get(row,"order")||get(row,"orderName");
  const sku=normalizeSku(get(row,"sku"));
  const quantityText=get(row,"quantity").replace(",",".");
  if(!orderId&&!sku&&!quantityText)continue;
  const quantity=Number(quantityText);
  // Una línea Shopify con cantidad pendiente cero no es un error ni un pedido a preparar.
  // Si todas las líneas tienen cero, el snapshot válido debe quedar vacío.
  if(quantityText&&Number.isSafeInteger(quantity)&&quantity===0)continue;
  if(!orderId||orderId.length>90||!sku||sku.length>90||
   !quantityText||!Number.isSafeInteger(quantity)||quantity<=0||quantity>50000){
   const cause=!orderId?"pedido sin identificador":!sku?"producto sin SKU/CN":
    !Number.isSafeInteger(quantity)||quantity<0||quantity>50000?"cantidad no válida":
    quantity===0?"cantidad cero": "código o pedido demasiado largo";
   skipped.push("Fila "+lineNumber+": "+cause);
   continue;
  }
  const date=get(row,"date");
  const parsedDate=date&&Number.isFinite(Date.parse(date))?new Date(date).toISOString():null;
  const source=get(row,"channel");
  const name=get(row,"title");
  lines.push({
   orderId,orderName:get(row,"orderName").slice(0,120)||orderId.slice(0,120),
   createdAt:parsedDate,channel:source.slice(0,120),
   quantity,sku,cn:skuToCn(sku),
   variantId:get(row,"variant").slice(0,90),
   title:name.slice(0,300)
  });
 }
 if(skipped.length&&lines.length===0)
  throw new Error("No hay líneas válidas para importar. "+skipped[0]+
   (skipped.length>1?" ("+skipped.length+" filas con incidencias).":""));
 // No perder todos los pedidos por una fila sin referencia o con cantidad cero.
 // Advertir de la importación parcial: nunca declararla completa.
 Object.defineProperty(lines,"warnings",{enumerable:false,value:skipped.length?[
  skipped.length+" filas no se han podido incluir en la preparación. "+
  skipped.slice(0,3).join("; ")+(skipped.length>3?"…":"")
 ]:[]});
 Object.defineProperty(lines,"skippedCount",{enumerable:false,value:skipped.length});
 return lines;
}
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
  const binary=Buffer.concat(chunks,bytes);
  let result;
  if(binary[0]===0xff&&binary[1]===0xfe)result=new TextDecoder("utf-16le").decode(binary);
  else if(binary[0]===0xfe&&binary[1]===0xff)
   result=new TextDecoder("utf-16be").decode(binary);
  else{
   result=new TextDecoder("utf-8").decode(binary);
   if(result.includes("\uFFFD"))result=new TextDecoder("windows-1252").decode(binary);
  }
  if(/^\s*<(?:!doctype|html|head)\b/i.test(result))
   throw new Error("Dropbox ha devuelto una página HTML en lugar del CSV.");
  return result;
 }
 throw new Error("Demasiadas redirecciones para descargar el CSV de Dropbox.");
}
