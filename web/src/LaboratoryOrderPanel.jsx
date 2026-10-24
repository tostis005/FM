import React,{useEffect,useMemo,useState} from "react";
import {Download,Save,AlertTriangle} from "lucide-react";
import {ReportPageHeader,ReportFilterBar} from "./ReportControls.jsx";
import {resolveSalesPeriod} from "./salesPeriods.js";
import {readSharedReportFilters,updateSharedReportFilters} from "./sharedReportFilters.js";
import {reconcilePharmacyIds,effectivePharmacyIds} from "./reportFilterScopes.js";
import {defaultLaboratoryLine,orderLineFor,mergeVisibleOrderLines,laboratoryExcelRows,laboratoryExportName,qty} from "./laboratoryOrderSheet.js";
import {exportLaboratoryOrderWorkbook} from "./exportaciones.js";
import "./laboratoryOrderPanel.css";

async function api(slug,path,{signal,method="GET",body}={}){
 const response=await fetch(path,{method,credentials:"same-origin",cache:"no-store",signal,
  headers:{"X-Farmetrica-Cliente":slug,...(body?{"Content-Type":"application/json"}:{})},
  ...(body?{body:JSON.stringify(body)}:{})});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||"No se pudo completar la consulta");
 return result;
}
const empty={rows:[],total:0};
const fmt=value=>value===null||value===undefined?"—":
 new Intl.NumberFormat("es-ES",{maximumFractionDigits:1}).format(Number(value));
export default function LaboratoryOrderPanel({clientSlug,pharmacies=[],canEdit=false}){
 const shared=()=>readSharedReportFilters(clientSlug);
 const [period,setPeriod]=useState(()=>shared().period||"this_month");
 const [customFrom,setCustomFrom]=useState(()=>shared().customFrom||"");
 const [customTo,setCustomTo]=useState(()=>shared().customTo||"");
 const [selectedPharmacies,setSelectedPharmacies]=useState(()=>
  reconcilePharmacyIds(shared().pharmacyIds||[],pharmacies));
 const ids=effectivePharmacyIds(selectedPharmacies,pharmacies);
 const scope=ids.map(String).join(",");
 const chosen=pharmacies.filter(p=>ids.some(id=>String(id)===String(p.id)));
 const range=useMemo(()=>resolveSalesPeriod(period,new Date(),{from:customFrom,to:customTo}),[period,customFrom,customTo]);
 const [labs,setLabs]=useState([]),[labSearch,setLabSearch]=useState("");
 const [laboratory,setLaboratory]=useState("");
 const [tab,setTab]=useState("parafarmacia"),[search,setSearch]=useState("");
 const [page,setPage]=useState(1),[data,setData]=useState(empty);
 const [loading,setLoading]=useState(false),[labsLoading,setLabsLoading]=useState(true);
 const [drafts,setDrafts]=useState({}),[savedLines,setSavedLines]=useState([]);
 const [savedDate,setSavedDate]=useState(null),[dirty,setDirty]=useState(false),[persisted,setPersisted]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [reload,setReload]=useState(0),[updatedAt,setUpdatedAt]=useState(null);
 useEffect(()=>{
  const controller=new AbortController();setLabsLoading(true);
  api(clientSlug,"/api/analytics/pedidos/catalogo-laboratorios",{signal:controller.signal})
   .then(d=>{if(!controller.signal.aborted)setLabs(d.laboratories||[])})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message)})
   .finally(()=>{if(!controller.signal.aborted)setLabsLoading(false)});
  return()=>controller.abort();
 },[clientSlug]);
 useEffect(()=>{
  setDrafts({});setSavedLines([]);setPersisted(false);setDirty(false);setSavedDate(null);
  if(!laboratory||!scope)return;
  const controller=new AbortController();
  const query=new URLSearchParams({laboratorio:laboratory,tipo:tab,farmacias:scope});
  api(clientSlug,"/api/analytics/pedidos/borrador-laboratorio?"+query,{signal:controller.signal})
   .then(d=>{if(controller.signal.aborted)return;
    const lines=Array.isArray(d.lineas)?d.lineas:[];
    setDrafts(Object.fromEntries(lines.map(line=>[line.reference,line])));
    setSavedLines(lines);setSavedDate(d.desde&&d.hasta?{from:d.desde,to:d.hasta}:null);
    setPersisted(Boolean(d.updatedAt));
   }).catch(e=>{if(!controller.signal.aborted)setError(e.message)});
  return()=>controller.abort();
 },[clientSlug,laboratory,tab,scope]);
 useEffect(()=>{
  if(!laboratory||!scope||!range.valid){setData(empty);return}
  const controller=new AbortController();const timer=setTimeout(()=>{
   setLoading(true);setError("");
   const query=new URLSearchParams({laboratorio:laboratory,tipo:tab,desde:range.from,hasta:range.to,
    farmacias:scope,buscar:search,pagina:String(page),tamano:"40"});
   api(clientSlug,"/api/analytics/pedidos/matriz-laboratorio?"+query,{signal:controller.signal})
    .then(d=>{if(!controller.signal.aborted){setData(d);setUpdatedAt(new Date())}})
    .catch(async e=>{
     if(controller.signal.aborted)return;
     // Recuperar las referencias sin métricas. Un fallo de ventas o stock no
     // implica que el laboratorio carezca de artículos.
     try{
      const catalog=new URLSearchParams({laboratorio:laboratory,tipo:tab,
       farmacias:scope,buscar:search,pagina:String(page),tamano:"40"});
      const articles=await api(clientSlug,
       "/api/analytics/pedidos/articulos-laboratorio?"+catalog,{signal:controller.signal});
      if(!controller.signal.aborted){
       setData({...articles,metricsUnavailable:true,
        metricsWarning:"No se pudieron calcular existencias y ventas: "+e.message});
       setUpdatedAt(new Date());
      }
     }catch(catalogError){
      if(!controller.signal.aborted){
       setData(empty);
       setError("Error al consultar el catálogo del laboratorio: "+catalogError.message);
      }
     }
    })
    .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  },250);
  return()=>{clearTimeout(timer);controller.abort()};
 },[clientSlug,laboratory,tab,scope,range.from,range.to,range.valid,search,page,reload]);
 const options=useMemo(()=>labs.filter(l=>(l.name+" "+l.key)
  .toLocaleLowerCase("es").includes(labSearch.toLocaleLowerCase("es"))),[labs,labSearch]);
 const labName=labs.find(l=>l.key===laboratory)?.name||"laboratorio";
 const currentRows=data.rows||[];
 const showLine=row=>orderLineFor(row,tab,ids,drafts);
 const pageTotalSold=data.metricsUnavailable?null:currentRows.reduce((sum,row)=>sum+Number(row.totalSold||0),0);
 const pageTotalSuggested=data.metricsUnavailable?null:currentRows.reduce((sum,row)=>sum+Number(row.totalSuggested||0),0);
 const pageTotalOrder=currentRows.reduce((sum,row)=>{
  const line=showLine(row);
  return sum+(tab==="parafarmacia"?Number(line.units||0):
   ids.reduce((n,id)=>n+Number(line.unitsByPharmacy?.[String(id)]||0),0));
 },0);
 const hasInvalid=Object.values(drafts).some(line=>tab==="parafarmacia"?qty(line.units)===null:
  Object.values(line.unitsByPharmacy||{}).some(value=>qty(value)===null));
 function choosePeriod(value){setPeriod(value);setPage(1);
  updateSharedReportFilters(clientSlug,{period:value})}
 function changeDate(field,value){if(field==="from")setCustomFrom(value);else setCustomTo(value);
  setPage(1);updateSharedReportFilters(clientSlug,{[field==="from"?"customFrom":"customTo"]:value})}
 function changePharmacies(next){const normalized=reconcilePharmacyIds(next,pharmacies);
  setSelectedPharmacies(normalized);setPage(1);updateSharedReportFilters(clientSlug,{pharmacyIds:normalized})}
 function updateLine(row,newQty,pharmacyId=null){
  const amount=newQty===""?0:Number(newQty);
  setDrafts(current=>{
   const previous=orderLineFor(row,tab,ids,current);
   const update=tab==="parafarmacia"?{...previous,units:amount}:
    {...previous,unitsByPharmacy:{...previous.unitsByPharmacy,[String(pharmacyId)]:amount}};
   return {...current,[row.referencia]:update};
  });
  setDirty(true);setNotice("");
 }
 async function save(){
  if(!canEdit||!laboratory||!range.valid||!scope||hasInvalid)return;
  const combined=mergeVisibleOrderLines(currentRows,tab,ids,drafts);
  const lines=Object.values(combined);
  if(lines.length>5000){setError("Demasiadas referencias para un único borrador. Acota la selección.");return}
  if(lines.some(line=>tab==="parafarmacia"?qty(line.units)===null:
   Object.values(line.unitsByPharmacy||{}).some(x=>qty(x)===null))){
   setError("Revisa las cantidades del pedido.");return;
  }
  setBusy(true);setError("");setNotice("");
  try{
   const result=await api(clientSlug,"/api/analytics/pedidos/borrador-laboratorio",{
    method:"PUT",body:{laboratorio:laboratory,tipo:tab,farmacias:ids.map(Number),
     desde:range.from,hasta:range.to,lineas:lines}});
   setDrafts(combined);setSavedLines(lines);setPersisted(true);
   setDirty(false);setSavedDate({from:range.from,to:range.to});
   setNotice("Borrador guardado: "+result.count+" referencias revisadas. Ya puedes generar el Excel.");
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function exportExcel(){
  if(!persisted||dirty||!savedLines.length)return;
  try{
   setBusy(true);setError("");
   const matrix=savedLines.map(line=>({
    row:{referencia:line.reference,cn:line.cn,nombre:line.name,
     byPharmacy:line.metrics||{}},line
   })).filter(item=>tab==="parafarmacia"?Number(item.line.units)>0:
    Object.values(item.line.unitsByPharmacy||{}).some(q=>Number(q)>0));
   if(!matrix.length){setError("El borrador no contiene cantidades positivas para exportar.");return}
   const rows=laboratoryExcelRows(matrix,chosen,tab);
   await exportLaboratoryOrderWorkbook(rows,laboratoryExportName(labName,tab));
   setNotice("Excel generado desde el último borrador guardado. No se ha enviado ningún pedido.");
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <>
  <ReportPageHeader title="Preparador de pedidos" description="Pedido por laboratorio · visión conjunta de todas las farmacias"
   period={range} updatedAt={updatedAt} refreshing={loading}
   onRefresh={()=>setReload(n=>n+1)}/>
  <section className="card fm-lab-order">
   <div className="fm-lab-order-top">
    <div><h2>1. Selecciona el laboratorio</h2>
     <p>Catálogo AEMPS y artículos identificados por código ERP y recepciones.</p></div>
    <div className="fm-lab-order-chooser">
     <input type="search" aria-label="Buscar laboratorio" placeholder="Buscar laboratorio…"
      value={labSearch} onChange={e=>setLabSearch(e.target.value)}/>
     <select aria-label="Seleccionar laboratorio" value={laboratory}
      onChange={e=>{
       const next=labs.find(l=>l.key===e.target.value);
       setLaboratory(e.target.value);
       setTab(next?.hasMedication===true&&next?.hasParapharmacy===false?"medicacion":"parafarmacia");
       setPage(1);setSearch("");setError("");setNotice("");
      }}>
      <option value="">{labsLoading?"Cargando laboratorios…":"Elige un laboratorio"}</option>
      {options.map(l=><option key={l.key} value={l.key}>{l.name}</option>)}
      {laboratory&&!options.some(l=>l.key===laboratory)&&labs.filter(l=>l.key===laboratory)
       .map(l=><option key={l.key} value={l.key}>{l.name}</option>)}
     </select>
    </div>
   </div>
   {error&&<p className="fm-op-message fm-op-error" role="alert"><AlertTriangle size={15}/>{error}</p>}
   {notice&&<p className="fm-op-message" role="status">{notice}</p>}
   {!laboratory?<p className="fm-lab-order-placeholder">Selecciona un laboratorio para consultar y preparar su pedido.</p>:<>
    <div className="fm-lab-order-tabs" role="tablist" aria-label="Tipo de artículos">
     {[["parafarmacia","Parafarmacia · CN 000000–399999"],
       ["medicacion","Medicación · CN desde 400000"]].map(([value,label])=>
      <button key={value} type="button" role="tab" aria-selected={tab===value}
       className={tab===value?"active":""}
       onClick={()=>{setTab(value);setPage(1);setNotice("");setError("")}}>{label}</button>)}
    </div>
    <ReportFilterBar periodKey={period} onPeriodChange={choosePeriod}
     pharmacies={pharmacies} pharmacyIds={selectedPharmacies} onPharmacyChange={changePharmacies}
     customFrom={customFrom} customTo={customTo} onCustomFromChange={v=>changeDate("from",v)}
     onCustomToChange={v=>changeDate("to",v)}>
     <label className="fm-unified-filter"><span>Buscar artículo o CN</span>
      <input type="search" placeholder="Artículo o CN…" value={search}
       onChange={e=>{setSearch(e.target.value);setPage(1)}}/></label>
    </ReportFilterBar>
    {!range.valid&&<p role="alert" className="fm-op-message fm-op-error">Selecciona un período válido y comprueba las fechas desde/hasta.</p>}
    {(data.metricsWarning||data.catalogWarning)&&<p className="fm-op-message" role="status">
     <AlertTriangle size={15}/>{data.metricsWarning||data.catalogWarning}
    </p>}
    <div className="fm-lab-order-summary">
     <span><strong>{data.total||0}</strong> referencias del laboratorio</span>
     <span><strong>{fmt(pageTotalSold)}</strong> vendidas en esta página</span>
     <span><strong>{fmt(pageTotalSuggested)}</strong> propuestas en esta página</span>
     <span><strong>{fmt(pageTotalOrder)}</strong> uds. a pedir en esta página</span>
     {loading&&<span role="status">Actualizando datos…</span>}
    </div>
    <div className="fm-lab-order-scroll" role="region" tabIndex={0}
     aria-label="Tabla horizontal de artículos y métricas por farmacia">
     <table className="fm-lab-order-table">
      <thead><tr><th className="fm-lab-order-sticky fm-lab-order-cn" rowSpan={2}>CN / ERP</th>
       <th className="fm-lab-order-sticky fm-lab-order-name" rowSpan={2}>Artículo</th>
       {chosen.map((p,i)=><th key={p.id} className={"fm-lab-order-group shade-"+i%3} colSpan={5}>{p.name}</th>)}
       <th colSpan={tab==="parafarmacia"?3:2} className="fm-lab-order-total-group">Totales</th>
      </tr><tr>
       {chosen.flatMap((p,i)=>["V. 3m","V. 12m","Stock","V. período",tab==="medicacion"?"Pedir":"Propuesta"]
        .map((name,k)=><th key={p.id+"-"+k} title={name}
         className={"fm-lab-order-sub shade-"+i%3+(k===4?" fm-lab-order-ordercol":"")}>{name}</th>))}
       <th>Vendido</th><th>Propuesta</th>
       {tab==="parafarmacia"&&<th className="fm-lab-order-editcol">Pedir</th>}
      </tr></thead>
      <tbody>{currentRows.map(row=>{
       const line=showLine(row);
       return <tr key={row.referencia}>
        <td className="fm-lab-order-sticky fm-lab-order-cn" title={row.referencia}>{row.cn||row.referencia}
         {row.provisional&&<small>CN pendiente</small>}</td>
        <td className="fm-lab-order-sticky fm-lab-order-name" title={row.nombre}>{row.nombre}
         <small>{row.inMaster?"Maestro":row.inReceipts?"ERP / recepciones":"Referencia"}</small></td>
        {chosen.flatMap((p,i)=>{
         const m=row.byPharmacy?.[String(p.id)]||{};
         return [m.units3??(data.metricsUnavailable?null:0),m.units12??(data.metricsUnavailable?null:0),m.stock??null,m.unitsPeriod??(data.metricsUnavailable?null:0),
          tab==="medicacion"?"edit":m.suggested??null].map((value,k)=>
           <td key={p.id+"-"+k} className={"fm-lab-order-cell shade-"+i%3+(k===4?" fm-lab-order-ordercol":"")}>
            {value==="edit"?<input type="number" min="0" max="999999" step="1"
             aria-label={"Pedir "+row.nombre+" en "+p.name}
             disabled={!canEdit} value={line.unitsByPharmacy?.[String(p.id)]??0}
             onChange={e=>updateLine(row,e.target.value,p.id)}/>:fmt(value)}
           </td>);
        })}
        <td className="fm-lab-order-total">{fmt(row.totalSold)}</td>
        <td className="fm-lab-order-total">{fmt(row.totalSuggested)}</td>
        {tab==="parafarmacia"&&<td className="fm-lab-order-editcol">
         <input type="number" min="0" max="999999" step="1" disabled={!canEdit}
          aria-label={"Pedir "+row.nombre+" para el laboratorio"}
          value={line.units??0} onChange={e=>updateLine(row,e.target.value)}/></td>}
       </tr>;
      })}
      {!loading&&!currentRows.length&&<tr><td colSpan={chosen.length*5+(tab==="parafarmacia"?5:4)}>
       <div className="fm-lab-order-noresults">
        <strong>{tab==="parafarmacia"?
         "Sin referencias de parafarmacia en este laboratorio":
         "Sin medicamentos asociados a este laboratorio"}</strong>
        <span>{tab==="parafarmacia"?
         "Los medicamentos del nomenclátor AEMPS aparecen en la pestaña Medicación. Parafarmacia necesita artículos del ERP o del catálogo externo con su laboratorio asociado.":
         "Comprueba que el nomenclátor AEMPS esté cargado y que el laboratorio aparezca asociado a sus presentaciones."}</span>
        <button type="button" className="btn btn-secondary" onClick={()=>{setTab(tab==="parafarmacia"?"medicacion":"parafarmacia");setPage(1);setError("")}}>
         Ver {tab==="parafarmacia"?"Medicación":"Parafarmacia"}
        </button>
       </div>
      </td></tr>}
      </tbody>
     </table>
    </div>
    <div className="fm-lab-order-pager">
     <span>Página {page} de {Math.max(1,Math.ceil((data.total||0)/40))}
      {currentRows.length>0?" · "+currentRows.length+" visibles":""}</span>
     <div><button className="btn btn-secondary" type="button" disabled={page<=1||loading}
       onClick={()=>setPage(n=>n-1)}>Anterior</button>
      <button className="btn btn-secondary" type="button"
       disabled={page>=Math.ceil((data.total||0)/40)||loading}
       onClick={()=>setPage(n=>n+1)}>Siguiente</button></div>
    </div>
    <div className="fm-lab-order-actions">
     <div><strong>{tab==="parafarmacia"?"Pedido conjunto para el laboratorio":"Pedido independiente por farmacia"}</strong>
      <small>El borrador incorpora las referencias revisadas al navegar por las páginas. El stock es actual; las ventas de 3 y 12 meses se calculan hasta la fecha «Hasta».</small>
      {savedDate&&(savedDate.from!==range.from||savedDate.to!==range.to)&&
       <small className="fm-lab-order-notice">El borrador anterior tenía otro período. Al guardar se actualizará.</small>}
     </div>
     <button className="btn btn-secondary" type="button" onClick={save}
      disabled={!canEdit||busy||loading||!range.valid||hasInvalid}>
      <Save size={16}/> {busy?"Guardando…":"Guardar borrador"}</button>
     <button className="btn btn-primary" type="button" onClick={exportExcel}
      disabled={busy||!persisted||dirty||!savedLines.length}>
      <Download size={16}/> Generar Excel</button>
    </div>
    <p className="fm-op-fine">Las referencias sin CN verificado aparecen identificadas por ERP y deben revisarse antes del envío. La exportación no envía ni aprueba ningún pedido.</p>
   </>}
  </section>
 </>;
}
