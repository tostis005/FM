import JSZip from "jszip";
import { isValidCN } from "./cns.js";
import { applyObjectiveRows } from "./objetivosImportacion.js";

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
function createCampaign(laboratory,range,offer,start,end,description,cns,source,cnDescriptions={}){
  const classification=typeInfo(offer,description);
  const promo={
    id:null,name:clean(range)+" · "+(typeof offer==="number" ? (offer>0&&offer<=1?Math.round(offer*100)+"% DTO":offer+"€ DTO") : clean(offer||"Promoción")),
    subtitle:clean(laboratory),laboratory:clean(laboratory),range:clean(range),
    description:clean(description||offer),originalOffer:clean(offer),
    start,end,status:"Borrador",cns:[...new Set(cns)].filter(isValidCN),cnDescriptions,
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
// RESUMEN es la única fuente de campañas. LISTADO CN PROMOCIONES es un
// catálogo auxiliar que NUNCA puede crear una campaña nueva.
function summaryRowsUntilBlank(rows){
  const result=[];
  for(let i=1;i<(rows||[]).length;i++){
    const r=rows[i]||[];
    // La primera fila con las columnas principales vacías termina la tabla:
    // todo lo posterior, incluido "NO HACER ESTAS PROMOCIONES", es ajeno.
    if(!clean(r[0])&&!clean(r[1])&&!clean(r[2]))break;
    if(typeof r[0]!=="string"||!clean(r[0])||!clean(r[1])||!clean(r[2]))continue;
    result.push({row:r,rowNumber:i+1});
  }
  return result;
}
function normalizedLab(lab,brand=""){
  const l=key(lab),b=key(brand);
  if(l==="CANTABRIALABS")return "CANTABRIA";
  if(l==="LOREAL")return b.startsWith("CERAVE")?"CERAVE":"LAROCHEPOSAY";
  if(l==="NAOS")return "BIODERMA";
  if(l==="PUIGDERMA")return b.includes("APIVITA")?"APIVITA":"URIAGE";
  return l;
}
function brandTokens(raw){
  const canonical=fold(raw).replace(/FOTOPROTECTORES?/g,"FOTOPROT")
    .replace(/CAPILAR/g,"HAIR").replace(/COSMETICA PEDIATRICA/g,"COSMETICA")
    .replace(/[^A-Z0-9]+/g," ");
  return canonical.split(" ").filter(t=>t.length>=3&&
    !["GAMA","LABS","LABORATORIOS","CORPORAL","LIQUIDACION"].includes(t));
}
function brandScore(brand,gama){
  const a=key(brand),b=key(gama);
  if(a===b)return 100;
  if(a&&b&&(a.includes(b)||b.includes(a)))return 90;
  const first=brandTokens(brand),second=brandTokens(gama);
  const overlap=first.filter(t=>second.some(x=>x===t||t.length>=5&&x.startsWith(t.slice(0,5))||
    x.length>=5&&t.startsWith(x.slice(0,5)))).length;
  return overlap?Math.round(35+45*overlap/Math.max(first.length,second.length)):0;
}
function offerScore(a,b){
  const x=typeInfo(a),y=typeInfo(b);
  if(x.type===y.type){
    if(x.discountPercent&&y.discountPercent&&x.discountPercent!==y.discountPercent)return -200;
    if(x.discountAmount&&y.discountAmount&&x.discountAmount!==y.discountAmount)return -200;
    return 30;
  }
  // Descripciones especiales ("20% del champú") pueden representar la misma
  // campaña pero no deben ganar frente a una equivalencia de oferta exacta.
  if(key(a)===key(b))return 25;
  return -25;
}
function cnListGroups(rows){
  const groups=new Map();
  for(const r of (rows||[]).slice(1)){
    const [lab,gama,code,description,offer]=r||[];
    const cn=cnOf(code);
    if(!isValidCN(cn)||!clean(lab)||!clean(gama))continue;
    const id=[key(lab),key(gama),key(offer)].join("|");
    if(!groups.has(id))groups.set(id,{lab,gama,offer,entries:[]});
    groups.get(id).entries.push({cn,description:clean(description)});
  }
  return [...groups.values()];
}
function matchingCNs(row,group){
  const [lab,brand,offer,, ,description]=row;
  if(normalizedLab(lab,brand)!==normalizedLab(group.lab,group.gama))return null;
  const score=brandScore(brand,group.gama);
  if(score<40)return null;
  const offerWeight=offerScore(offer,group.offer);
  if(offerWeight<0 && score<90)return null;
  let entries=group.entries;
  // Dos filas URIAGE en RESUMEN tienen el mismo laboratorio, marca, fechas y
  // descuento: se distinguen por Xemose frente a los sérums de la descripción.
  if(normalizedLab(lab,brand)==="URIAGE"&&key(brand)==="URIAGE"){
    const xemose=/XEMOSE/i.test(description||"");
    const serum=/S[ÉE]RUM|SERUM/i.test(description||"");
    if(xemose)entries=entries.filter(e=>/XEMOSE/i.test(e.description));
    else if(serum)entries=entries.filter(e=>!/XEMOSE/i.test(e.description));
  }
  if(!entries.length)return null;
  // Premiar coincidencias explícitas y no mezclar gamas parcialmente relacionadas.
  return {score:score+offerWeight,entries};
}
export function importCampaignRows(summaryRows,cnRows,year=PROMOTION_YEAR){
  const groups=cnListGroups(cnRows);
  const campaigns=[];
  const assignedByGroup=new Map();
  for(const {row,rowNumber} of summaryRowsUntilBlank(summaryRows)){
    const [lab,brand,offer,from,to,description]=row;
    const start=excelDate(from,year),end=excelDate(to,year);
    const candidates=groups.map((group,index)=>{
      const result=matchingCNs(row,group);
      return result?{index,group,...result}:null;
    }).filter(Boolean).sort((a,b)=>b.score-a.score);
    // Agrupar subgamas de una misma marca únicamente cuando su puntuación
    // coincide y no tienen ofertas diferentes: p.ej. dos ramas PHYTO.
    const top=candidates[0]?.score??-Infinity;
    const relevant=candidates.filter(x=>x.score>=top-8&&x.score>=50);
    const entries=relevant.flatMap(g=>{
      const assigned=assignedByGroup.get(g.index)||new Set();
      const available=g.entries.filter(e=>!assigned.has(e.cn));
      for(const e of available)assigned.add(e.cn);
      assignedByGroup.set(g.index,assigned);
      return available;
    });
    const cnDescriptions=Object.fromEntries(entries.filter(e=>e.description).map(e=>[e.cn,e.description]));
    const promo=createCampaign(lab,brand,offer,start,end,description,entries.map(e=>e.cn),
      "RESUMEN",cnDescriptions);
    // Una fila del RESUMEN siempre es una promoción, aunque otra comparta
    // laboratorio/marca/oferta: el número de fila estabiliza su identidad.
    promo.sourceRow=rowNumber;
    promo.fingerprint=makeFingerprint(promo)+"|RESUMEN:"+rowNumber;
    promo.id=makeId(promo.fingerprint);
    if(!entries.length)promo.importWarnings.push("No se localizaron CNs asociados a esta fila de RESUMEN");
    campaigns.push(promo);
  }
  return campaigns;
}
export async function readPromotionExcel(file){
  if(!file||file.size>15*1024*1024)throw Error("El fichero es demasiado grande (máximo 15 MB)");
  if(!/\.xlsx$/i.test(file.name))throw Error("Selecciona un Excel .xlsx");
  const sheets=await sheetsFromExcel(await file.arrayBuffer());
  if(!sheets["RESUMEN"] || !sheets["LISTADO CN PROMOCIONES"])
    throw Error("Excel no compatible: se necesitan las hojas RESUMEN y LISTADO CN PROMOCIONES");
  const match=file.name.match(/20\d{2}/),year=match?Number(match[0]):PROMOTION_YEAR;
  let promos=importCampaignRows(sheets["RESUMEN"],sheets["LISTADO CN PROMOCIONES"],year).map(p=>({...p,source:"Excel: "+file.name}));
  if(sheets["OBJETIVOS OCTUBRE 2026"]) {
    promos=applyObjectiveRows(promos,sheets["OBJETIVOS OCTUBRE 2026"],year).promotions;
  }
  if(!promos.length)throw Error("No se encontraron promociones importables");
  return promos;
}
// Las fechas del Excel son días civiles del cliente, no UTC del navegador.
export function importedPromotionStatus(p,now=new Date(),timeZone="Europe/Madrid"){
  const targets=Object.values(p.targets||{});
  const completeObjectives=targets.some(value=>
    value!==""&&value!==null&&value!==undefined&&
    Number.isSafeInteger(Number(value))&&Number(value)>0);
  if(!completeObjectives)return "Borrador";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(p.start||"")||
     p.end&&(!/^\d{4}-\d{2}-\d{2}$/.test(p.end)||p.start>p.end))return "Borrador";
  const dayParts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{
    timeZone,year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(now).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
  const today=[dayParts.year,dayParts.month,dayParts.day].join("-");
  // El nombre almacenado sigue siendo Finalizada para compatibilidad histórica.
  // En la interfaz se presenta como Archivada.
  if(p.end&&p.end<today)return "Finalizada";
  if(p.start>today)return "Borrador";
  return "Activa";
}
export function mergeImportedPromos(existing,incoming){
  const normalize=p=>p.fingerprint||makeFingerprint({
    laboratory:p.laboratory||p.subtitle,range:p.range||p.name,
    start:p.start,end:p.end,originalOffer:p.originalOffer||p.name
  });
  const existingByFingerprint=new Map(existing.map(p=>[normalize(p),p]));
  const existingIds=new Set(existing.map(p=>p.id));
  let duplicates=0,expanded=0;
  const additions=[],updates=[];
  for(const p of incoming){
    const same=existingByFingerprint.get(p.fingerprint)||existing.find(x=>x.id===p.id);
    if(same){
      const newCNs=[...new Set([...(same.cns||[]),...p.cns])];
      const targets={...(same.targets||{}),...(p.targets||{})};
      const targetsChanged=Object.keys(p.targets||{}).some(id=>Number(same.targets?.[id])!==Number(p.targets[id])||same.targets?.[id]==="");
      const cnChanged=newCNs.length>(same.cns||[]).length;
      if(cnChanged || targetsChanged) {
        updates.push({...same,cns:newCNs,targets,
          objectivesSource: p.objectivesSource||same.objectivesSource,
          cnDescriptions:{...same.cnDescriptions,...p.cnDescriptions},
          importWarnings:[...new Set([...(same.importWarnings||[]),...(p.importWarnings||[])])]});
        if(cnChanged)expanded++;
      }else duplicates++;
      continue;
    }
    const overlapping=existing.some(e=>e.start===p.start&&e.end===p.end&&
      similarity(e.range||e.name,p.range)>0.82&&
      (e.cns||[]).length>0&&p.cns.length>0&&
      p.cns.filter(cn=>e.cns.includes(cn)).length/Math.min(p.cns.length,e.cns.length)>=0.75);
    if(overlapping){duplicates++;continue;}
    additions.push(p);existingByFingerprint.set(p.fingerprint,p);existingIds.add(p.id);
  }
  return {additions,updates,duplicates,expanded,warnings:additions.filter(p=>p.importWarnings.length).length};
}
