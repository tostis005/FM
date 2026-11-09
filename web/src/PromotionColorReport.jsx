import React,{useMemo,useState} from "react";
import {ArrowDownToLine,Copy,Store,Tag} from "lucide-react";
import {exportObjectiveTrackingExcel} from "./exportaciones.js";
import "./PromotionColorReport.css";

const number=value=>new Intl.NumberFormat("es-ES",{maximumFractionDigits:1}).format(value);
const toPct=(sold,goal)=>goal>0?Math.round(1000*sold/goal)/10:null;
const tone=pct=>pct===null?"none":pct>=100?"success":pct>=80?"warning":"danger";
const escapeHtml=value=>String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;")
 .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const colours={
 success:{background:"#d9f3e4",color:"#17663c"},
 warning:{background:"#fff1ca",color:"#825400"},
 danger:{background:"#ffe1dd",color:"#9c332d"},
 none:{background:"#edf0f3",color:"#57606d"}
};
export function trackingColorRows(campaigns,pharmacyName,mode="promotion",pharmacyId=""){
 const rows=[];
 for(const campaign of campaigns||[]){
  for(const [id,target] of Object.entries(campaign.targets||{})){
   if(mode==="pharmacy"&&String(id)!==String(pharmacyId))continue;
   const goal=Number(target)||0;
   const sold=Number(campaign.sales?.[id])||0;
   rows.push({promotion:campaign.name,pharmacy:pharmacyName(id),goal,sold,pct:toPct(sold,goal)});
  }
 }
 return rows.sort((a,b)=>{
  const first=mode==="pharmacy"?a.promotion.localeCompare(b.promotion,"es"):a.promotion.localeCompare(b.promotion,"es");
  return first||a.pharmacy.localeCompare(b.pharmacy,"es");
 });
}
export function objectiveReportHtml(rows,title){
 const cells=["Promoción","Farmacia","Objetivo (uds.)","Vendidas (uds.)","Cumplimiento"];
 const head='<tr>'+cells.map(cell=>'<th style="padding:9px 12px;background:#174d3d;color:white;border:1px solid #e0e5e9;text-align:left;">'+cell+'</th>').join("")+'</tr>';
 const body=rows.map(row=>{
  const color=colours[tone(row.pct)];
  const arr=[row.promotion,row.pharmacy,number(row.goal),number(row.sold),row.pct===null?"Sin objetivo":number(row.pct)+" %"];
  return '<tr>'+arr.map((value,i)=>'<td style="padding:9px 12px;border:1px solid #e0e5e9;'+(i===4?'background:'+color.background+';color:'+color.color+';font-weight:bold;':'')+'">'+escapeHtml(value)+'</td>').join("")+'</tr>';
 }).join("");
 return '<div><p style="font-family:Arial,sans-serif;font-weight:bold;color:#174d3d;">'+escapeHtml(title)+'</p><table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;">'+head+body+'</table></div>';
}
export default function PromotionColorReport({campaigns=[],pharmacies=[],pharmacyName,month="",salesReady=false,onMessage}){
 const [mode,setMode]=useState("promotion");
 const [chosenPharmacy,setChosenPharmacy]=useState("");
 const ids=[...new Set(campaigns.flatMap(p=>Object.keys(p.targets||{})))];
 const pharmacyId=ids.includes(chosenPharmacy)?chosenPharmacy:ids[0]||"";
 const rows=useMemo(()=>trackingColorRows(campaigns,pharmacyName,mode,pharmacyId),
  [campaigns,pharmacyName,mode,pharmacyId]);
 const monthLabel=month?new Date(month+"-01T12:00:00Z").toLocaleDateString("es-ES",
  {month:"long",year:"numeric",timeZone:"UTC"}):"Todo el período";
 const title="Seguimiento de objetivos · "+monthLabel;
 const plain=()=>{
  const values=[["Promoción","Farmacia","Objetivo","Ventas","Cumplimiento"],
   ...rows.map(r=>[r.promotion,r.pharmacy,r.goal,r.sold,r.pct===null?"—":number(r.pct)+" %"])];
  return title+"\n"+values.map(r=>r.join("\t")).join("\n");
 };
 async function copy(){
  if(!rows.length||!salesReady)return;
  try{
   const html=objectiveReportHtml(rows,title);
   if(navigator.clipboard?.write&&typeof ClipboardItem!=="undefined"){
    await navigator.clipboard.write([new ClipboardItem({
     "text/html":new Blob([html],{type:"text/html"}),
     "text/plain":new Blob([plain()],{type:"text/plain"})
    })]);
    onMessage?.("Tabla copiada con formato y colores. Puedes pegarla en tu correo.");
   }else if(navigator.clipboard?.writeText){
    await navigator.clipboard.writeText(plain());
    onMessage?.("Tabla copiada en texto. Para conservar los colores, descarga el Excel.");
   }else throw Error("El navegador no permite copiar directamente");
  }catch(error){onMessage?.("No se pudo copiar: "+error.message+". Utiliza Descargar Excel.");}
 }
 async function download(){
  if(!rows.length||!salesReady)return;
  try{
   await exportObjectiveTrackingExcel(rows,{title,month,mode});
   onMessage?.("Tabla colorimétrica descargada en Excel.");
  }catch(error){onMessage?.("Error al generar el Excel: "+error.message);}
 }
 return <section className="card fm-color-report" aria-label="Tabla colorimétrica de objetivos">
  <div className="fm-color-report-heading">
   <div><h2>Tabla de seguimiento para compartir</h2>
    <p>Consulta los objetivos y copia esta tabla con colores en un correo, o descárgala en Excel.</p></div>
   <div className="fm-color-report-actions">
    <button type="button" className="btn btn-secondary" onClick={()=>void copy()}
     disabled={!salesReady||!rows.length}><Copy size={16}/> Copiar para correo</button>
    <button type="button" className="btn btn-secondary" onClick={()=>void download()}
     disabled={!salesReady||!rows.length}><ArrowDownToLine size={16}/> Descargar Excel</button>
   </div>
  </div>
  <div className="fm-color-report-controls">
   <div className="fm-color-report-switch" role="group" aria-label="Agrupar seguimiento">
    <button type="button" className={mode==="promotion"?"active":""} aria-pressed={mode==="promotion"}
     onClick={()=>setMode("promotion")}><Tag size={15}/> Por promoción</button>
    <button type="button" className={mode==="pharmacy"?"active":""} aria-pressed={mode==="pharmacy"}
     onClick={()=>setMode("pharmacy")}><Store size={15}/> Por farmacia</button>
   </div>
   {mode==="pharmacy"&&<label>Farmacia
    <select value={pharmacyId} onChange={e=>setChosenPharmacy(e.target.value)}>
     {ids.map(id=><option key={id} value={id}>{pharmacyName(id)}</option>)}
    </select></label>}
   <span className="fm-color-report-period">{monthLabel} · {rows.length} filas</span>
  </div>
  {!salesReady?<p role="status">El informe estará disponible cuando termine de cargarse la información de ventas reales.</p>:
   !rows.length?<p>No hay objetivos configurados en esta selección.</p>:
   <div className="fm-color-report-scroll"><table>
    <thead><tr><th>Promoción</th><th>Farmacia</th><th>Objetivo</th><th>Ventas</th><th>Cumplimiento</th></tr></thead>
    <tbody>{rows.slice(0,30).map((row,i)=><tr key={row.promotion+row.pharmacy+i}>
     <td>{row.promotion}</td><td>{row.pharmacy}</td><td>{number(row.goal)}</td>
     <td>{number(row.sold)}</td><td><span className={"fm-color-report-pct fm-color-"+tone(row.pct)}>
      {row.pct===null?"—":number(row.pct)+" %"}</span></td></tr>)}</tbody>
   </table></div>}
  {rows.length>30&&<small>Vista previa de 30 filas. Copiar y Descargar incluyen las {rows.length} filas.</small>}
  <p className="fm-color-report-note">Colores: verde, objetivo alcanzado; amarillo, 80–99,9 %; rojo, por debajo del 80 %. El porcentaje indica unidades conseguidas, no previsión de cierre.</p>
 </section>;
}
