import JSZip from "jszip";
import { isValidCN } from "./cns.js";

const MONTHS={enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12,ene:1,feb:2,mar:3,abr:4,may:5,jun:6,jul:7,ago:8,sep:9,oct:10,nov:11,dic:12};
export const PROMOTION_YEAR=2026;
export function clean(value){return String(value??"").trim().replace(/\s+/g," ")}
function fold(value){return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();}
function key(value){return fold(value).replace(/[^A-Z0-9]/g,"");}
const iso=(year,month,day)=>{
  const d=new Date(Date.UTC(year,month-1,day));
  return d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day
    ? [year,String(month).padStart(2,"0"),String(day).padStart(2,"0")].join("-"):"";
};
export function excelDate(value,year=PROMOTION_YEAR){
  if(value===null||value===undefined||value==="")return "";
  if(typeof value==="number"&&value>30000&&value<90000){
    const date=new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000);
    return iso(date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate());
  }
  const s=fold(value).replace(/OOCTUBRE/g,"OCTUBRE").replace(/[.]/g,"").replace(/\s+/g," ");
  if(/FIN EXISTENCIAS|HASTA FIN|AGOTAR STOCK|SIN FECHA/.test(s))return "";
  const normalized=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(normalized)return iso(+normalized[1],+normalized[2],+normalized[3]);
  const match=s.match(/^(\d{1,2})[\s/-]+([A-Z]+)(?:[\s/-]+(\d{2,4}))?$/);
  if(!match)return "";
  let y=match[3]?Number(match[3]):year;
  if(y<100)y+=2000;
  const month=MONTHS[match[2].toLowerCase()];
  return month?iso(y,month,+match[1]):"";
}
function typeInfo(value,description=""){
  const raw=typeof value==="number"&&value>0&&value<=1?String(Math.round(value*100))+"% DTO":clean(value);
  const t=fold(raw);
  const desc=fold(description);
  const p=t.match(/(\d{1,3})\s*%/);
  const percent=p?Number(p[1]):null;
  const euro=t.match(/(\d+(?:[,.]\d+)?)\s*(?:€|EUROS?)/);
  const amount=euro?Number(euro[1].replace(",",".")):typeof value==="number"&&value>1?value:null;
  const SECOND=/2\s*[ªºA]?\s*(?:UD|UNIDAD)|SEGUNDA|2DA/.test(t);
  if(/\b2\s*X\s*1\b/.test(t))return {type:"dos_por_uno",discountPercent:""};
  if(/\b3\s*X\s*2\b/.test(t))return {type:"tres_por_dos",discountPercent:""};
  if(/\b[34]\s*\+\s*1\b/.test(t))return {type:"otras_unidades",discountPercent:"",formula:raw};
  if(/REGALO/.test(t+" "+desc))return {type:"regalo",discountPercent:"",formula:raw};
  if(/POR 1 UD|2 UDS O MAS|2UDS/.test(t)&&/(?:\d+\s*%|\d+\s*€)/.test(t))
    return {type:"escalonado",discountPercent:"",formula:raw};
  if(SECOND&&percent!==null)return {type:"segunda_porcentaje",discountPercent:String(percent)};
  if(SECOND&&amount!==null)return {type:"segunda_importe",discountPercent:"",discountAmount:String(amount)};
  if(SECOND&&/\b50\b/.test(t))return {type:"segunda_porcentaje",discountPercent:"50"};
  if(percent!==null)return {type:"descuento_porcentaje",discountPercent:String(percent)};
  if(amount!==null)return {type:"descuento_importe",discountPercent:"",discountAmount:String(amount)};
  return {type:"sin_clasificar",discountPercent:"",formula:raw};
}
function parseXml(text){
  const xml=new DOMParser().parseFromString(text,"application/xml");
  if(xml.getElementsByTagName("parsererror").length)throw Error("Formato Excel XML inválido");
  return xml;
}
const local=(el,tag)=>[...el.getElementsByTagName("*")].filter(n=>n.localName===tag);
async function sheetsFromExcel(buffer){
  const zip=await JSZip.loadAsync(buffer);
  const workbook=parseXml(await zip.file("xl/workbook.xml")?.async("text"));
  const rels=parseXml(await zip.file("xl/_rels/workbook.xml.rels")?.async("text"));
  const sharedFile=zip.file("xl/sharedStrings.xml");
  const strings=sharedFile?local(parseXml(await sharedFile.async("text")),"si").map(si=>local(si,"t").map(n=>n.textContent).join("")):[];
  const relationMap=new Map(local(rels,"Relationship").map(el=>[el.getAttribute("Id"),el.getAttribute("Target")]));
  const output={};
  for(const sheet of local(workbook,"sheet")){
    const id=sheet.getAttribute("r:id") || sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships","id");
    let target=relationMap.get(id);
    if(!target)continue;
    target=target.startsWith("/")?target.slice(1):target.startsWith("xl/")?target:"xl/"+target.replace(/^\.\//,"");
    const entry=zip.file(target);
    if(!entry)continue;
    const xml=parseXml(await entry.async("text"));
    const rows=[];
    for(const row of local(xml,"row")){
      const index=Number(row.getAttribute("r"))-1;
      const values=[];
      for(const cell of [...row.children].filter(el=>el.localName==="c")){
        const col=cell.getAttribute("r")?.match(/^[A-Z]+/i)?.[0]||"A";
        let pos=0;
        for(const letter of col.toUpperCase())pos=pos*26+letter.charCodeAt(0)-64;
        pos--;
        const v=[...cell.children].find(n=>n.localName==="v")?.textContent;
        const inline=[...cell.children].find(n=>n.localName==="is");
        const type=cell.getAttribute("t");
        let val=type==="inlineStr" ? local(inline||cell,"t").map(n=>n.textContent).join("")
          :type==="s"?strings[Number(v)] : type==="b"?v==="1"
          :v==null?"":(Number.isFinite(Number(v))?Number(v):v);
        values[pos]=val;
      }
      rows[index]=values;
    }
    output[sheet.getAttribute("name")]=rows;
  }
  return output;
}
function makeFingerprint(p){
  return [p.laboratory,p.range,p.start,p.end,p.originalOffer].map(key).join("|");
}
function makeId(fingerprint){
  // Determinista con contenido semántico, no con nombre/tamaño del fichero.
  let h=2166136261;
  for(let i=0;i<fingerprint.length;i++){h^=fingerprint.charCodeAt(i);h=Math.imul(h,16777619);}
  return "X"+(h>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function cnOf(value){if(value===null||value===undefined)return "";return String(value).trim().replace(/\.0$/,"").padStart(6,"0");}
function createCampaign(laboratory,range,offer,start,end,description,cns,source){
  const classification=typeInfo(offer,description);
  const promo={
    id:null,name:clean(range)+" · "+clean(offer||"Promoción"),
    subtitle:clean(laboratory),laboratory:clean(laboratory),range:clean(range),
    description:clean(description||offer),originalOffer:clean(offer),
    start,end,status:"Borrador",cns:[...new Set(cns)].filter(isValidCN),
    targets:{},sales:{},...classification,
    source:"Excel octubre 2026",sourceSheet:source,
  };
  promo.fingerprint=makeFingerprint(promo);
  promo.id=makeId(promo.fingerprint);
  promo.importWarnings=[];
  if(!start||!end)promo.importWarnings.push("Fechas sin determinar: revisar antes de activar");
  if(!promo.cns.length)promo.importWarnings.push("Sin CNs asociados: revisar antes de activar");
  if(promo.type==="sin_clasificar")promo.importWarnings.push("Tipo de promoción pendiente de clasificación");
  return promo;
}
function groupCnRows(rows){
  const groups=new Map();
  for(const row of rows.slice(1)){
    const [lab,range,code,description,offer,from,to]=row;
    const cn=cnOf(code);
    if(!isValidCN(cn)||!clean(lab)||!clean(range)||!clean(offer))continue;
    const start=excelDate(from),end=excelDate(to);
    const groupKey=[key(lab),key(range),key(offer),start,end].join("|");
    if(!groups.has(groupKey))groups.set(groupKey,{lab,range,offer,start,end,cns:[],description});
    groups.get(groupKey).cns.push(cn);
  }
  return [...groups.values()];
}
const stopwords=new Set(["LA","EL","LOS","LAS","DE","DEL","GAMA","PRODUCTOS","DTO","2A","2","EN","Y","POR","CORPORAL","PROMOCION","ANTIEDAD"]);
function tokens(s){return new Set(fold(s).split(/[^A-Z0-9]+/).filter(t=>t.length>2&&!stopwords.has(t)));}
function similarity(a,b){
  const x=tokens(a),y=tokens(b);
  if(!x.size||!y.size)return 0;
  const common=[...x].filter(t=>y.has(t)).length;
  return common/Math.min(x.size,y.size);
}
function comparableOffers(a,b){
  const x=typeInfo(a),y=typeInfo(b);
  return x.type===y.type&&(x.discountPercent===y.discountPercent||!x.discountPercent||!y.discountPercent);
}
export function importCampaignRows(summaryRows,cnRows){
  const summary=(summaryRows||[]).slice(1).filter(r=>clean(r[0])&&clean(r[1])&&r[2]!==null&&r[2]!==undefined&&r[2]!=="");
  const cnGroups=groupCnRows(cnRows||[]);
  const assigned=new Set();
  const campaigns=[];
  for(const row of summary){
    const [lab,range,offer,from,to,description]=row;
    // Filas de material auxiliar, códigos sueltos o sin oferta no son promociones.
    if(typeof lab==="number" || !clean(offer))continue;
    const start=excelDate(from),end=excelDate(to);
    const matches=cnGroups.map((g,index)=>{
      if(assigned.has(index)||!comparableOffers(offer,g.offer))return {index,score:0};
      const sameStart=!start||!g.start||start===g.start;
      const sameEnd=!end||!g.end||end===g.end;
      if(!sameStart||!sameEnd)return {index,score:0};
      const rangeScore=similarity(range,g.range);
      const labScore=similarity(lab,g.lab);
      return {index,score:rangeScore*0.85+labScore*0.15};
    }).sort((a,b)=>b.score-a.score);
    // Unir solo coincidencias suficientemente claras y únicas.
    const best=matches[0],second=matches[1];
    const confident=best&&best.score>=0.72&&(!second||best.score-second.score>=0.12);
    const g=confident?cnGroups[best.index]:null;
    if(g)assigned.add(best.index);
    const promo=createCampaign(lab,range,offer,start,end,description,g?.cns||[],"RESUMEN");
    if(!g && cnGroups.length)promo.importWarnings.push("No se ha podido asociar con seguridad el listado de CNs");
    campaigns.push(promo);
  }
  for(let i=0;i<cnGroups.length;i++){
    if(assigned.has(i))continue;
    const g=cnGroups[i];
    const promo=createCampaign(g.lab,g.range,g.offer,g.start,g.end,g.description,g.cns,"LISTADO CN PROMOCIONES");
    promo.importWarnings.push("Grupo de CN sin conciliación exacta con RESUMEN: revisar posible duplicado");
    campaigns.push(promo);
  }
  // Duplicados internos: mismos criterios comerciales -> mantener unión de CNs.
  const result=new Map();
  for(const p of campaigns){
    if(result.has(p.fingerprint)){
      const old=result.get(p.fingerprint);
      old.cns=[...new Set([...old.cns,...p.cns])];
      old.importWarnings=[...new Set([...old.importWarnings,...p.importWarnings])];
    }else result.set(p.fingerprint,p);
  }
  return [...result.values()];
}
export async function readPromotionExcel(file){
  if(!file||file.size>15*1024*1024)throw Error("El fichero es demasiado grande (máximo 15 MB)");
  if(!/\.xlsx$/i.test(file.name))throw Error("Selecciona un Excel .xlsx");
  const sheets=await sheetsFromExcel(await file.arrayBuffer());
  if(!sheets["RESUMEN"] || !sheets["LISTADO CN PROMOCIONES"])
    throw Error("Excel no compatible: se necesitan las hojas RESUMEN y LISTADO CN PROMOCIONES");
  const promos=importCampaignRows(sheets["RESUMEN"],sheets["LISTADO CN PROMOCIONES"]);
  if(!promos.length)throw Error("No se encontraron promociones importables");
  return promos;
}
export function mergeImportedPromos(existing,incoming){
  const keys=new Set(existing.map(p=>p.fingerprint||makeFingerprint({
    laboratory:p.laboratory||p.subtitle,range:p.range||p.name,
    start:p.start,end:p.end,originalOffer:p.originalOffer||p.name
  })));
  let duplicates=0;
  const additions=[];
  for(const p of incoming){
    const sameId=existing.some(e=>e.id===p.id);
    const overlapping=existing.some(e=>e.start===p.start&&e.end===p.end&&
      similarity(e.range||e.name,p.range)>0.82&&
      (e.cns||[]).length>0&&p.cns.length>0&&
      p.cns.filter(cn=>e.cns.includes(cn)).length/Math.min(p.cns.length,e.cns.length)>=0.75);
    if(keys.has(p.fingerprint)||sameId||overlapping){duplicates++;continue;}
    additions.push(p);
    keys.add(p.fingerprint);
  }
  return {additions,duplicates,warnings:additions.filter(p=>p.importWarnings.length).length};
}
