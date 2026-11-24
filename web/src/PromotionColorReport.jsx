import {numberFormatES} from "./localeES.js";
import React,{useMemo,useState} from "react";
import {ArrowDownToLine,Copy,Store,Tag,CalendarClock} from "lucide-react";
import {exportObjectiveTrackingExcel} from "./exportaciones.js";
import {trackingColorRows} from "./promotionTrackingPace.js";
import "./PromotionColorReport.css";
import {useColumnTable,ColumnTableHead} from "./ColumnTable.jsx";

const number=value=>numberFormatES({maximumFractionDigits:1}).format(value);
const asPct=value=>value===null?"—":number(value)+" %";
const escapeHtml=value=>String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;")
 .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const colours={
 success:{background:"#daf3e5",color:"#176342"},
 warning:{background:"#fff1ce",color:"#855a12"},
 danger:{background:"#fce4df",color:"#a03d33"},
 upcoming:{background:"#edf4fa",color:"#466b87"},
 none:{background:"#f1f4f3",color:"#66756c"}
};
const headings=["Promoción","Farmacia","Objetivo (uds.)","Vendidas (uds.)","Restantes (uds.)",
 "Avance objetivo","Plazo transcurrido","Ritmo"];
// La columna siempre muestra unidades positivas: pendientes en rojo, exceso en verde.
const remainingInfo=row=>{
 const difference=(Number(row.goal)||0)-(Number(row.sold)||0);
 const kind=difference>0?"pending":difference<0?"over":"met";
 return {kind,label:(difference<0?"+":"")+number(Math.abs(difference))};
};
const cellValues=row=>[row.promotion,row.pharmacy,number(row.goal),number(row.sold),
 remainingInfo(row).label,asPct(row.pct),asPct(row.elapsedPct),
 row.status+(row.pacePct===null?"":" · "+asPct(row.pacePct)+" del ritmo previsto")];

export function objectiveReportHtml(rows,title){
 const base='font-family:Arial,sans-serif;font-size:12px;border:1px solid #e0e9e3;padding:10px 12px;';
 const head='<tr>'+headings.map((h,i)=>'<th style="'+base+'background:#f2f8f5;color:#264b3b;font-weight:bold;text-align:'+(i<2?"left":"center")+';">'+escapeHtml(h)+'</th>').join("")+'</tr>';
 const body=rows.map(row=>{
  const color=colours[row.tone]||colours.none;
  const remaining=remainingInfo(row);
  const remainingColor=remaining.kind==="pending"?"#b42318":remaining.kind==="over"?"#16704b":"#242424";
  return '<tr>'+cellValues(row).map((v,i)=>'<td style="'+base+
   'text-align:'+(i<2?"left":"center")+';'+
   (i===4?'color:'+remainingColor+';font-weight:bold;':'')+
   (i===7?'background:'+color.background+';color:'+color.color+';font-weight:bold;':'')+
   '">'+escapeHtml(v)+'</td>').join("")+'</tr>';
 }).join("");
 return '<div><p style="font:700 14px Arial,sans-serif;color:#28523b;">'+escapeHtml(title)+
  '</p><table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;">'+
  head+body+'</table><p style="font:12px Arial,sans-serif;color:#677c70;">'+
  'El estado compara las unidades vendidas con las previstas según los días transcurridos en cada objetivo.</p></div>';
}
function Meter({value,kind}){
 if(value===null)return <span className="fm-color-report-empty">—</span>;
 const clamped=Math.max(0,Math.min(100,value));
 return <div className="fm-color-report-meter">
  <strong>{asPct(value)}</strong>
  <span className={"fm-color-report-meter-track fm-color-report-meter-"+kind} aria-hidden="true">
   <span style={{width:clamped+"%"}}/></span>
 </div>;
}
export default function PromotionColorReport({campaigns=[],pharmacyName,month="",today="",salesReady=false,onMessage}){
 const [mode,setMode]=useState("promotion");
 const [chosenPharmacy,setChosenPharmacy]=useState("");
 const ids=[...new Set(campaigns.flatMap(p=>Object.keys(p.targets||{})))];
 const pharmacyId=ids.includes(chosenPharmacy)?chosenPharmacy:ids[0]||"";
 const rows=useMemo(()=>trackingColorRows(campaigns,pharmacyName,mode,pharmacyId,month,today||undefined),
  [campaigns,pharmacyName,mode,pharmacyId,month,today]);
 const columns=[
  {key:"promotion",label:headings[0],value:r=>r.promotion},
  {key:"pharmacy",label:headings[1],value:r=>r.pharmacy,filterMode:"multi"},
  {key:"goal",label:headings[2],value:r=>r.goal,filterText:r=>number(r.goal)},
  {key:"sold",label:headings[3],value:r=>r.sold,filterText:r=>number(r.sold)},
  {key:"remaining",label:headings[4],value:r=>Number(r.goal)-Number(r.sold),filterText:r=>remainingInfo(r).label},
  {key:"pct",label:headings[5],value:r=>r.pct,filterText:r=>asPct(r.pct)},
  {key:"elapsedPct",label:headings[6],value:r=>r.elapsedPct,filterText:r=>asPct(r.elapsedPct)},
  {key:"status",label:headings[7],value:r=>r.status,filterMode:"multi"}
 ];
 const table=useColumnTable(rows,columns,{scope:mode+"|"+pharmacyId+"|"+month});
 const filtered=table.rows;
 const monthLabel=month?new Date(month+"-01T12:00:00Z").toLocaleDateString("es-ES",
  {month:"long",year:"numeric",timeZone:"UTC"}):"Todos los períodos";
 const title="Tabla de seguimiento · "+monthLabel;
 const plain=()=>title+"\n"+[headings,...filtered.map(cellValues)].map(values=>values.join("\t")).join("\n");
 async function copy(){
  if(!filtered.length||!salesReady)return;
  try{
   const html=objectiveReportHtml(filtered,title);
   if(navigator.clipboard?.write&&typeof ClipboardItem!=="undefined"){
    await navigator.clipboard.write([new ClipboardItem({
     "text/html":new Blob([html],{type:"text/html"}),
     "text/plain":new Blob([plain()],{type:"text/plain"})
    })]);
    onMessage?.("Tabla copiada con formato y colores. Pégala en el correo.");
   }else if(navigator.clipboard?.writeText){
    await navigator.clipboard.writeText(plain());
    onMessage?.("Tabla copiada en texto. Para conservar los colores, utiliza Descargar Excel.");
   }else throw Error("El navegador no permite copiar directamente");
  }catch(error){onMessage?.("No se pudo copiar: "+error.message+". Utiliza Descargar Excel.");}
 }
 async function download(){
  if(!filtered.length||!salesReady)return;
  try{
   await exportObjectiveTrackingExcel(filtered,{title,month,mode});
   onMessage?.("Tabla de seguimiento descargada en Excel.");
  }catch(error){onMessage?.("Error al generar el Excel: "+error.message);}
 }
 return <section className="card fm-color-report" aria-label="Tabla de seguimiento">
  <div className="section-heading fm-color-report-heading">
   <div><h2>Tabla de seguimiento</h2>
    <p>Avance de objetivos y ritmo respecto a los días transcurridos.</p></div>
   <span className="count-label">{filtered.length} {filtered.length===1?"fila":"filas"}</span>
  </div>
  <div className="fm-color-report-body">
   <div className="fm-color-report-controls">
    <div className="fm-color-report-switch" role="group" aria-label="Agrupar seguimiento">
     <button type="button" className={mode==="promotion"?"active":""} aria-pressed={mode==="promotion"}
      onClick={()=>setMode("promotion")}><Tag size={15}/> Por promoción</button>
     <button type="button" className={mode==="pharmacy"?"active":""} aria-pressed={mode==="pharmacy"}
      onClick={()=>setMode("pharmacy")}><Store size={15}/> Por farmacia</button>
    </div>
    {mode==="pharmacy"&&<label className="fm-color-report-pharmacy">
     <span>Farmacia</span><select aria-label="Farmacia de la tabla de seguimiento" value={pharmacyId}
      onChange={e=>setChosenPharmacy(e.target.value)}>
      {ids.map(id=><option key={id} value={id}>{pharmacyName(id)}</option>)}
     </select></label>}
    <div className="fm-color-report-actions">
     <button type="button" className="btn btn-secondary" onClick={()=>void copy()}
      disabled={!salesReady||!filtered.length}><Copy size={16}/> Copiar para correo</button>
     <button type="button" className="btn btn-secondary" onClick={()=>void download()}
      disabled={!salesReady||!filtered.length}><ArrowDownToLine size={16}/> Descargar Excel</button>
    </div>
   </div>
   <div className="fm-color-report-period"><CalendarClock size={15}/>
    <span>{monthLabel}</span><span className="fm-color-report-separator">·</span>
    <span>Verde: en ritmo · Ámbar: cerca · Rojo: por debajo</span>
   </div>
   {!salesReady?<p className="fm-color-report-message" role="status">La tabla estará disponible cuando termine de cargarse la información de ventas reales.</p>:
    !rows.length?<p className="fm-color-report-message">No hay objetivos configurados en esta selección.</p>:
    <div className="fm-color-report-scroll"><table>
     <ColumnTableHead table={table}/>
     <tbody>{!filtered.length&&<tr><td colSpan={headings.length}>No hay filas que coincidan con los filtros.</td></tr>}{filtered.slice(0,30).map((row,i)=>{
      const remaining=remainingInfo(row);
      return <tr key={row.promotion+row.pharmacy+i}>
      <td className="fm-color-report-name">{row.promotion}</td>
      <td className="fm-color-report-name">{row.pharmacy}</td>
      <td className="fm-color-report-value">{number(row.goal)}</td>
      <td className="fm-color-report-value">{number(row.sold)}</td>
      <td className={"fm-color-report-remaining fm-color-report-remaining-"+remaining.kind}
       title={remaining.kind==="pending"?"Unidades pendientes para alcanzar el objetivo":remaining.kind==="over"?"Unidades vendidas de más":"Objetivo cumplido exactamente"}>
       <strong style={{color:remaining.kind==="pending"?"#b42318":remaining.kind==="over"?"#16704b":"#242424"}}>{remaining.label}</strong>
      </td>
      <td><Meter value={row.pct} kind="goal"/></td>
      <td><Meter value={row.elapsedPct} kind="time"/></td>
      <td><div className={"fm-color-report-status fm-color-"+row.tone}
       title={row.elapsedDays+" de "+row.totalDays+" días · "+number(row.expectedUnits)+" unidades previstas a la fecha"}>
       <strong>{row.status}</strong>
       {row.pacePct!==null&&<small>{asPct(row.pacePct)} del ritmo previsto</small>}
      </div></td>
     </tr>;
     })}</tbody>
    </table></div>}
   {filtered.length>30&&<small className="fm-color-report-preview">Vista previa de 30 filas. Copiar y Descargar incluyen las {filtered.length} filas filtradas.</small>}
   <p className="fm-color-report-note">El avance muestra las unidades vendidas frente al objetivo total. El plazo indica los días de vigencia transcurridos. El color compara las ventas con las esperadas hasta la fecha; en meses futuros se muestra «Por comenzar».</p>
  </div>
 </section>;
}
