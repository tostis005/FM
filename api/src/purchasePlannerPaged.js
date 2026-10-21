import {readFile} from "node:fs/promises";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
const TEMPLATE=await readFile(new URL("./purchasePlannerPaged.sql",import.meta.url),"utf8");
const FIELD={
 articleName:'g."articleName"',unitsPeriod:'g."unitsPeriod"',
 units3:'g."units3"',units12:'g."units12"',
 stock:'g.stock',suggested:'g.suggested'
};
export function inferGenericGroupName(names,fallback="",principles=[]){
 const labels=[...new Set((names||[]).map(v=>String(v||"").trim()).filter(Boolean))];
 if(!labels.length)return "Genérico · Denominación pendiente";
 const norm=v=>String(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toUpperCase().replace(/[^A-Z0-9]+/g," ").trim().split(/\s+/).filter(Boolean);
 const normalizeDose=label=>{
  const hit=label.match(/\b(\d+(?:[,.]\d+)?)\s*(MG|G|MCG|MICROGRAMOS|UI)\b/i);
  if(!hit)return "";
  const amount=Number(hit[1].replace(",","."));
  if(!Number.isFinite(amount)||amount<=0)return "";
  return hit[2].toUpperCase()==="G"?String(amount*1000)+" mg":
   String(amount)+" "+hit[2].toLowerCase();
 };
 const mostCommon=list=>{
  const counter=new Map();
  for(const value of list.filter(Boolean))counter.set(value,(counter.get(value)||0)+1);
  return [...counter].sort((a,b)=>b[1]-a[1]||
   String(a[0]).localeCompare(String(b[0]),"es"))[0]||null;
 };
 const normalized=labels.map(norm);
 // El DCPF agrupa presentaciones de distintas marcas. Inferir el principio
 // activo por su prefijo compartido, no por la primera marca alfabética.
 const first=mostCommon(normalized.map(words=>words[0]));
 let generic="";
 if(first&&first[1]>=Math.max(2,Math.ceil(labels.length*.30))){
  generic=first[0];
  for(let i=1;i<3;i++){
   const term=mostCommon(normalized.filter(w=>w[0]===first[0]).map(w=>w[i]));
   if(!term||term[1]<Math.ceil(first[1]*.72)||
    /^(\d+|MG|G|MCG|EFG|FORTE)$/.test(term[0]))break;
   generic+=" "+term[0];
  }
 }
 const principle=(principles||[]).map(x=>String(x||"").trim()).find(Boolean);
 if(principle)generic=principle;
 const dose=mostCommon(labels.map(normalizeDose))?.[0]||"";
 const forms=["COMPRIMIDOS","CAPSULAS","SOBRES","SOLUCION","SUSPENSION",
  "CREMA","GEL","POMADA","COLIRIO","SUPOSITORIOS","PARCHES","INYECTABLE"];
 const form=mostCommon(normalized.map(words=>forms.find(t=>words.includes(t))||""))?.[0]||"";
 const suffix=form==="CAPSULAS"&&normalized.filter(w=>w.includes("GASTRORRESISTENTES")).length>=labels.length*.45?
  "Cápsulas gastrorresistentes":form.toLocaleLowerCase("es-ES");
 if(!generic){
  // Ante nomenclátor parcial, mostrar la presentación oficial sin fingir
  // un principio activo que no se ha podido determinar.
  const fallbackName=labels.find(n=>/\bEFG\b/i.test(n))||labels[0];
  return "Genérico · "+fallbackName.replace(/,\s*\d+\s*(?:comprimidos|capsulas|sobres|unidades).*$/i,"").trim();
 }
 const name=generic.toLocaleLowerCase("es-ES").replace(/(^|\s)(\S)/g,
  (_m,space,ch)=>space+ch.toLocaleUpperCase("es-ES"));
 return "Genérico · "+[name,dose,suffix].filter(Boolean).join(" ");
}
// El detalle incluye también farmacias con existencias pero ninguna venta.
// Consultar únicamente CNs de la página evita recorrer todo el catálogo en Node.
export async function addUnsoldPharmacies(pool,ctx,chosen,groups){
 if(!groups.length)return groups;
 const dcpfs=[...new Set(groups.filter(g=>g.kind==="generico").map(g=>String(g.dcpf)).filter(Boolean))];
 let official=[];
 if(dcpfs.length){
  const r=await pool.query("SELECT cn,dcpf,nombre,principio_activo FROM farmetrica.nomenclator_presentaciones"+
   " WHERE generico=true AND dcpf=ANY($1::text[]) LIMIT 8000",[dcpfs]);
  official=r.rows;
 }
 const keyByCn=new Map();
 for(const g of groups)if(g.cn&&g.kind!=="generico")keyByCn.set(g.cn,g.key);
 for(const o of official)keyByCn.set(String(o.cn),"DCPF:"+o.dcpf);
 const officialByDcpf=new Map();
 for(const o of official){
  const id=String(o.dcpf);
  if(!officialByDcpf.has(id))officialByDcpf.set(id,[]);
  officialByDcpf.get(id).push(o);
 }
 for(const g of groups)if(g.kind==="generico"){
  const rows=officialByDcpf.get(String(g.dcpf))||[];
  g.articleName=inferGenericGroupName(rows.map(o=>o.nombre),g.dcpf,rows.map(o=>o.principio_activo));
 }
 const codes=[...keyByCn.keys()];
 if(!codes.length)return groups;
 const q='"'+ctx.client.schema+'"',farmCode=pharmacyDataCodeSQL("f");
 const query="SELECT f.id::text AS \"pharmacyId\",a.origen_id AS \"articleId\","+
  "a.nombre AS \"articleName\",a.stock_actual::float8 AS stock,"+
  "a.sincronizado_en AS \"stockAt\",pol.cobertura_saludable AS \"coverageDays\","+
  "pol.intervalo_pedidos AS interval_days FROM "+q+".articulos a"+
  " JOIN farmetrica.farmacias f ON f.cliente_slug=$1 AND f.id=ANY($2::int[])"+
  " AND upper(btrim(a.farmacia_codigo))="+farmCode+
  " LEFT JOIN farmetrica.op_politicas_reposicion pol ON pol.cliente_slug=$1 AND pol.farmacia_id=f.id"+
  " WHERE a.origen_id=ANY($3::text[])";
 const {rows}=await pool.query({text:query,values:[ctx.client.slug,chosen,codes],query_timeout:15000});
 const byGroup=new Map(groups.map(g=>[g.key,g]));
 for(const a of rows){
  const g=byGroup.get(keyByCn.get(String(a.articleId)));
  if(!g)continue;
  let p=g.pharmacies.find(x=>String(x.pharmacyId)===String(a.pharmacyId));
  if(!p){
   p={pharmacyId:String(a.pharmacyId),groupKey:g.key,articleId:a.articleId,
    articleName:a.articleName,cn:a.articleId,stock:0,stockAt:a.stockAt,
    unitsPeriod:0,units3:0,units12:0,units30:0,ordered:0,daily:0,
    interval:Number(a.interval_days||7),lead:0,safety:0,coverageDays:Number(a.coverageDays||90),demandPattern:"sin_ventas",
    suggested:0,policyDefault:!a.coverageDays,confidence:a.stockAt?"calculable":"fecha_desconocida",options:[]};
   g.pharmacies.push(p);
  }
  if(!Array.isArray(p.options))p.options=[];
  if(p.options.some(o=>String(o.articleId)===String(a.articleId)))continue;
  p.options.push({articleId:a.articleId,articleName:a.articleName,cn:a.articleId,
   stock:a.stock,unitsPeriod:0,units3:0,units12:0});
  if(p.stock===null||a.stock===null)p.stock=null;
  else p.stock=Number(p.stock)+Number(a.stock);
  if(p.stockAt&&a.stockAt&&new Date(a.stockAt)<new Date(p.stockAt))p.stockAt=a.stockAt;
  if(!p.stockAt)p.stockAt=a.stockAt;
  if(p.stock===null){p.suggested=null;p.confidence="sin_stock"}
  else if(["concentrada","pico_reciente","sin_actividad","posible_estacional","sin_ventas"]
   .includes(p.demandPattern))p.suggested=0;
  else{
   const daily=p.demandPattern==="estacional"?
    Number(p.units3||0)/90:Number(p.daily||0);
   p.suggested=Math.max(0,Math.min(999999,Math.ceil(
    daily*Math.max(Number(p.coverageDays||90),Number(p.interval||7))-
    Number(p.stock)-Number(p.ordered||0)-1e-9)));
  }
 }
 for(const g of groups){
  g.pharmacies.sort((a,b)=>Number(a.pharmacyId)-Number(b.pharmacyId));
  g.productCount=g.pharmacies.reduce((n,p)=>n+p.options.length,0);
  g.stock=g.pharmacies.every(p=>p.stock!==null)?
   g.pharmacies.reduce((n,p)=>n+Number(p.stock||0),0):null;
  g.suggested=g.pharmacies.every(p=>p.suggested!==null)?
   g.pharmacies.reduce((n,p)=>n+Number(p.suggested||0),0):null;
 }
 return groups;
}

export async function readPurchasePlannerPaged(pool,ctx,{
 from,to,chosen,search="",sort="suggested",direction="desc",
 page=1,pageSize=50,columnFilters={}
}){
 const schema=ctx.client.schema;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema))throw Error("Esquema de farmacia inválido");
 if(!Object.hasOwn(FIELD,sort))throw Error("Columna de orden desconocida");
 const desc=direction!=="asc";
 const order=sort==="suggested"?
  "g.prioridad DESC,g.suggested "+(desc?"DESC":"ASC")+" NULLS LAST,g.key":
  FIELD[sort]+" "+(desc?"DESC":"ASC")+" NULLS LAST,g.key";
 const sourceCode=pharmacyDataCodeSQL("f");
 const query=TEMPLATE.replaceAll("__SCHEMA__","\""+schema+"\"")
  .replaceAll("__FARMACIA_CODE__",sourceCode)
  .replaceAll("__ORDER__",order);
 const keys=["articleName","stock","unitsPeriod","units3","units12","suggested"];
 const params=[from,to,chosen,ctx.client.slug,String(search||"").trim().toUpperCase(),
  pageSize,(page-1)*pageSize,...keys.map(key=>String(columnFilters[key]||""))];
 const {rows}=await pool.query({text:query,values:params,query_timeout:30000});
 const data=rows[0]||{};
 await addUnsoldPharmacies(pool,ctx,chosen,data.groups||[]);
 const summary=data.summary||{};
 return {available:true,from,to,groups:data.groups||[],
  page,pageSize,totalGroups:Number(summary.products||0),summary,
  truncated:false,commitmentsAvailable:true,
  policiesDefaulted:false,
  pharmacies:ctx.pharmacies.filter(f=>chosen.includes(Number(f.id)))
   .map(f=>({id:f.id,name:f.name})),
  note:"El grupo usa el CN común y, cuando corresponde, el DCPF verificado. La prioridad se calcula a partir de días, semanas y meses con ventas reales: los picos concentrados y los períodos sin actividad reciente no generan compras automáticas. Los indicios de estacionalidad no se consideran certeza sin comparación interanual."
 };
}
