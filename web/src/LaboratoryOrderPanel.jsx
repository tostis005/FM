import React,{useEffect,useMemo,useState} from "react";
import {Download,Save,AlertTriangle,LoaderCircle} from "lucide-react";
import LaboratoryPicker from "./LaboratoryPicker.jsx";
import {ReportPageHeader,ReportFilterBar} from "./ReportControls.jsx";
import {resolveSalesPeriod} from "./salesPeriods.js";
import {readSharedReportFilters,updateSharedReportFilters} from "./sharedReportFilters.js";
import {reconcilePharmacyIds,effectivePharmacyIds} from "./reportFilterScopes.js";
import {defaultLaboratoryLine,orderLineFor,mergeVisibleOrderLines,laboratoryExcelRows,laboratoryOrderListRows,laboratoryExportName,qty} from "./laboratoryOrderSheet.js";
import {exportLaboratoryOrderWorkbook} from "./exportaciones.js";
import "./laboratoryOrderPanel.css";
import {collectLaboratoryCatalog,LAB_CATALOG_BATCH,LAB_METRICS_BATCH} from "./laboratoryLoadAll.js";

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
 const [labs,setLabs]=useState([]);
 const [laboratory,setLaboratory]=useState("");
 const [tab,setTab]=useState("parafarmacia"),[search,setSearch]=useState("");
 const [data,setData]=useState(empty);
 const [loading,setLoading]=useState(false),[loadStage,setLoadStage]=useState("idle"),[labsLoading,setLabsLoading]=useState(true);
 const [diagnostic,setDiagnostic]=useState(null),[diagnosticBusy,setDiagnosticBusy]=useState(false);
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
 useEffect(()=>{setDiagnostic(null);setDiagnosticBusy(false)},[clientSlug,laboratory,scope]);
 async function runDiagnostic(){
  if(!laboratory||diagnosticBusy)return;
  setDiagnosticBusy(true);setDiagnostic(null);
  const query=new URLSearchParams({laboratorio:laboratory,farmacias:scope});
  try{setDiagnostic(await api(clientSlug,"/api/analytics/pedidos/diagnostico-laboratorio?"+query))}
  catch(e){setDiagnostic({error:e.message})}
  finally{setDiagnosticBusy(false)}
 }
 useEffect(()=>{
  if(!laboratory){setData(empty);setLoading(false);setLoadStage("idle");return}
  const controller=new AbortController();
  setLoading(true);setLoadStage("catalog");setError("");
  setData({...empty,metricsUnavailable:true,loaded:0,metricsLoaded:0});
  const timer=setTimeout(async()=>{
   const base=new URLSearchParams({laboratorio:laboratory,tipo:tab,farmacias:scope,buscar:search});
   const tooLong=range.valid&&(Date.parse(range.to)-Date.parse(range.from)>5*366*86400000);
   const useMetrics=range.valid&&!tooLong&&Boolean(scope);
   let catalog;
   try{
    catalog=await collectLaboratoryCatalog((number,size)=>{
     const query=new URLSearchParams(base);
     query.set("pagina",String(number));query.set("tamano",String(size));
     return api(clientSlug,"/api/analytics/pedidos/catalogo-directo?"+query,{signal:controller.signal});
    },{
     batchSize:LAB_CATALOG_BATCH,signal:controller.signal,
     onBatch:({rows,total})=>{
      if(!controller.signal.aborted)setData({rows,total,loaded:rows.length,metricsLoaded:0,
       metricsUnavailable:true,frequencyDays:7});
     }
    });
   }catch(e){
    if(!controller.signal.aborted){
     setError("No se pudieron cargar todas las referencias: "+e.message);
     setData(current=>({...current,metricsUnavailable:true,
      warning:"La tabla está incompleta. Actualiza para volver a intentarlo."}));
     setLoading(false);setLoadStage("idle");
    }
    return;
   }
   if(controller.signal.aborted)return;
   setUpdatedAt(new Date());
   if(!catalog.rows.length||!useMetrics){
    if(!useMetrics&&catalog.rows.length)setData(current=>({...current,
     warning:!scope?"No hay farmacias seleccionadas: faltan ventas y stock.":
      !range.valid?"El período no es válido. Se muestran referencias sin métricas.":
       "El período supera cinco años. Acótalo para consultar ventas y stock."}));
    setLoading(false);setLoadStage("idle");
    return;
   }
   setLoadStage("metrics");
   // Se reúnen TODAS las filas y se calculan métricas por grupos de 40.
   // Los resultados parciales no sustituyen las cantidades ya editadas.
   let rows=[...catalog.rows],done=0,frequencyDays=7;
   for(let number=1;number<=Math.ceil(catalog.total/LAB_METRICS_BATCH);number++){
    if(controller.signal.aborted)return;
    const query=new URLSearchParams(base);
    query.set("pagina",String(number));
    query.set("tamano",String(LAB_METRICS_BATCH));
    query.set("desde",range.from);query.set("hasta",range.to);
    try{
     const result=await api(clientSlug,"/api/analytics/pedidos/matriz-laboratorio?"+query,
      {signal:controller.signal});
     if(controller.signal.aborted)return;
     if(result.metricsUnavailable||!Array.isArray(result.rows))
      throw Error(result.warning||"No están disponibles las ventas o el stock");
     const start=(number-1)*LAB_METRICS_BATCH;
     const end=Math.min(start+LAB_METRICS_BATCH,rows.length);
     const byReference=new Map(result.rows.map(r=>[r.referencia,r]));
     for(let i=start;i<end;i++){
      const details=byReference.get(rows[i].referencia);
      if(!details)throw Error("Las referencias cambiaron durante el cálculo de métricas");
      rows[i]={...rows[i],...details,metricsReady:true};
     }
     done=end;frequencyDays=result.frequencyDays??frequencyDays;
     setData({rows:[...rows],total:catalog.total,loaded:catalog.total,
      metricsLoaded:done,frequencyDays,metricsUnavailable:done<catalog.total});
    }catch(e){
     if(controller.signal.aborted)return;
     setData({rows:[...rows],total:catalog.total,loaded:catalog.total,metricsLoaded:done,
      frequencyDays,metricsUnavailable:true,
      warning:"Se muestran todas las referencias, pero no se pudieron completar las ventas y el stock ("+
       e.message+"). Actualiza para volver a calcularlos."});
     setLoading(false);setLoadStage("idle");
     return;
    }
   }
   if(!controller.signal.aborted){setLoading(false);setLoadStage("idle");setUpdatedAt(new Date())}
  },250);
  return()=>{clearTimeout(timer);controller.abort()};
 },[clientSlug,laboratory,tab,scope,range.from,range.to,range.valid,search,reload]);
 const labName=labs.find(l=>l.key===laboratory)?.name||"laboratorio";
 const currentRows=data.rows||[];
 const showLine=row=>orderLineFor(row,tab,ids,drafts);
 const pageTotalSold=currentRows.reduce((sum,row)=>sum+Number(row.totalSold||0),0);
 const pageTotalSuggested=currentRows.reduce((sum,row)=>sum+Number(row.totalSuggested||0),0);
 const pageTotalOrder=currentRows.reduce((sum,row)=>{
  const line=showLine(row);
  return sum+(tab==="parafarmacia"?Number(line.units||0):
   ids.reduce((n,id)=>n+Number(line.unitsByPharmacy?.[String(id)]||0),0));
 },0);
 const hasInvalid=Object.values(drafts).some(line=>tab==="parafarmacia"?qty(line.units)===null:
  Object.values(line.unitsByPharmacy||{}).some(value=>qty(value)===null));
 function choosePeriod(value){setPeriod(value);
  updateSharedReportFilters(clientSlug,{period:value})}
 function changeDate(field,value){if(field==="from")setCustomFrom(value);else setCustomTo(value);
  updateSharedReportFilters(clientSlug,{[field==="from"?"customFrom":"customTo"]:value})}
 function changePharmacies(next){const normalized=reconcilePharmacyIds(next,pharmacies);
  setSelectedPharmacies(normalized);updateSharedReportFilters(clientSlug,{pharmacyIds:normalized})}
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
   const orderRows=laboratoryOrderListRows(matrix,chosen,tab);
   await exportLaboratoryOrderWorkbook(rows,laboratoryExportName(labName,tab),orderRows,tab);
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
     <p>Productos con ventas o recepciones y presentaciones del Nomenclátor, excluyendo los dados de baja.</p></div>
    <div className="fm-lab-order-chooser">
     <LaboratoryPicker laboratories={labs} loading={labsLoading} selected={laboratory}
      onSelect={key=>{
       const next=labs.find(l=>l.key===key);
       setLaboratory(key);
       setTab(next?.hasMedication===true?"medicacion":"parafarmacia");
       setSearch("");setError("");setNotice("");
      }}/>
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
       onClick={()=>{setTab(value);setNotice("");setError("")}}>{label}</button>)}
    </div>
    <ReportFilterBar periodKey={period} onPeriodChange={choosePeriod}
     pharmacies={pharmacies} pharmacyIds={selectedPharmacies} onPharmacyChange={changePharmacies}
     customFrom={customFrom} customTo={customTo} onCustomFromChange={v=>changeDate("from",v)}
     onCustomToChange={v=>changeDate("to",v)}>
     <label className="fm-unified-filter"><span>Buscar artículo o CN</span>
      <input type="search" placeholder="Artículo o CN…" value={search}
       onChange={e=>{setSearch(e.target.value)}}/></label>
    </ReportFilterBar>
    {!range.valid&&<p role="alert" className="fm-op-message fm-op-error">Selecciona un período válido y comprueba las fechas desde/hasta.</p>}
    {data.warning&&<p role="status" className="fm-lab-order-warning">
     <AlertTriangle size={15}/> {data.warning}
    </p>}
    {(!loading&&data.total===0||Boolean(error)||diagnostic)&&
     <div className="fm-lab-order-diagnostic-area">
      <button type="button" className="btn btn-secondary" disabled={diagnosticBusy}
       onClick={runDiagnostic}>{diagnosticBusy?"Analizando enlaces…":"Diagnosticar enlace con Farmatic"}</button>
      {diagnostic&&<div className="fm-lab-order-diagnostics" role="status">
       <strong>Comprobación de {labName} · {chosen.length} farmacias seleccionadas</strong>
       {diagnostic.sources?.map(src=><span key={src.type}>
        {src.type==="medicacion"?"Medicación":"Parafarmacia"}: <b>{
         src.status==="ok"?src.total:"Error "+(src.errorCode||"desconocido")}</b>
       </span>)}
       {diagnostic.evidence&&<>
        <span>Nomenclátor: <b>{diagnostic.evidence.official}</b></span>
        <span>Fichas ERP con laboratorio: <b>{diagnostic.evidence.erpArticles}</b></span>
        <span>Proveedores ERP con ese nombre: <b>{diagnostic.evidence.erpSuppliers}</b></span>
        <span>Líneas de compra vinculadas por nombre: <b>{diagnostic.evidence.purchasesWithNamedSupplier}</b></span>
        <span>Compras con enlace manual: <b>{diagnostic.evidence.purchasesWithManualLink}</b></span>
       </>}
       {diagnostic.pharmacyCount===0&&<span>Sin farmacias asignadas</span>}
       {diagnostic.evidenceError&&<span>Error de diagnóstico: {diagnostic.evidenceError}</span>}
       {diagnostic.error&&<span>{diagnostic.error}</span>}
       {diagnostic.evidence?.official===0&&diagnostic.evidence?.erpArticles===0&&
        diagnostic.evidence?.erpSuppliers===0&&
        <p>No hay asociación reconocible con este laboratorio. Comprueba el Nomenclátor,
         el código del proveedor en Farmatic y su correspondencia en el Maestro de proveedores.</p>}
       {diagnostic.sources?.some(src=>src.status==="error")&&
        <p>La consulta ha fallado: no significa que el laboratorio no tenga productos.
         Comprueba el código del error y las migraciones y sincronizaciones.</p>}
      </div>}
     </div>}
    <div className="fm-lab-order-summary">
     <span><strong>{data.loaded??0} / {data.total??0}</strong> referencias en una sola tabla</span>
     <span><strong>{fmt(pageTotalSold)}</strong> vendidas {data.metricsUnavailable?"(parcial)":""}</span>
     <span><strong>{data.frequencyDays??7}</strong> días entre pedidos</span>
     <span><strong>{fmt(pageTotalSuggested)}</strong> propuestas {data.metricsUnavailable?"(parcial)":""}</span>
     <span><strong>{fmt(pageTotalOrder)}</strong> uds. a pedir</span>
     {loading&&<span role="status" className="fm-lab-loading-label">
      <LoaderCircle size={15} className="fm-lab-spinner"/>
      {loadStage==="catalog"?
       "Cargando referencias "+(data.loaded??0)+" de "+(data.total||"…")+"…":
       "Calculando ventas y stock "+(data.metricsLoaded??0)+" de "+(data.total??0)+"…"}
     </span>}
    </div>
    <div className="fm-lab-order-scroll" role="region" tabIndex={0}
     aria-label="Tabla horizontal de artículos y métricas por farmacia">
     <table className="fm-lab-order-table">
      <thead><tr><th className="fm-lab-order-sticky fm-lab-order-cn" rowSpan={2}>CN</th>
       <th className="fm-lab-order-sticky fm-lab-order-name" rowSpan={2}>Artículo</th>
       {chosen.map((p,i)=><th key={p.id} className={"fm-lab-order-group shade-"+i%3} colSpan={5}>{p.name}</th>)}
       <th colSpan={3} className="fm-lab-order-total-group">Totales</th>
      </tr><tr>
       {chosen.flatMap((p,i)=>["V. 3m","V. 12m","Stock","V. período",tab==="medicacion"?"Pedir":"Propuesta"]
        .map((name,k)=><th key={p.id+"-"+k} title={name}
         className={"fm-lab-order-sub shade-"+i%3+(k===4?" fm-lab-order-ordercol":"")}>{name}</th>))}
       <th>Vendido</th><th>Propuesta</th>
       <th className="fm-lab-order-editcol">{tab==="parafarmacia"?"Pedir · Pedia":"Pedir total"}</th>
      </tr></thead>
      <tbody>{currentRows.map(row=>{
       const line=showLine(row);
       return <tr key={row.referencia}>
        <td className="fm-lab-order-sticky fm-lab-order-cn" title={row.cn||"Código nacional no disponible"}>{row.cn||"—"}
         {row.provisional&&<small>CN pendiente</small>}</td>
        <td className="fm-lab-order-sticky fm-lab-order-name" title={row.nombre}>{row.nombre}
         <small>{row.inMaster?"Maestro":row.inReceipts?"Farmatic":"Referencia"}</small></td>
        {chosen.flatMap((p,i)=>{
         const m=row.byPharmacy?.[String(p.id)]||{};
         return [row.metricsReady?m.units3??0:null,row.metricsReady?m.units12??0:null,row.metricsReady?m.stock??null:null,row.metricsReady?m.unitsPeriod??0:null,
          tab==="medicacion"?"edit":row.metricsReady?m.suggested??null:null].map((value,k)=>
           <td key={p.id+"-"+k} className={"fm-lab-order-cell shade-"+i%3+(k===4?" fm-lab-order-ordercol":"")}>
            {value==="edit"?<input type="number" min="0" max="999999" step="1"
             aria-label={"Pedir "+row.nombre+" en "+p.name}
             disabled={!canEdit} value={line.unitsByPharmacy?.[String(p.id)]??0}
             onChange={e=>updateLine(row,e.target.value,p.id)}/>:fmt(value)}
           </td>);
        })}
        <td className="fm-lab-order-total">{row.metricsReady?fmt(row.totalSold):"—"}</td>
        <td className="fm-lab-order-total">{row.metricsReady?fmt(row.totalSuggested):"—"}</td>
        {tab==="parafarmacia"&&<td className="fm-lab-order-editcol">
         <input type="number" min="0" max="999999" step="1" disabled={!canEdit}
          aria-label={"Pedir "+row.nombre+" para el laboratorio"}
          value={line.units??0} onChange={e=>updateLine(row,e.target.value)}/></td>}
       </tr>;
      })}
      {loading&&loadStage==="catalog"&&!currentRows.length&&<tr><td className="fm-lab-table-loading" colSpan={chosen.length*5+5}><LoaderCircle className="fm-lab-spinner" size={18}/> Consultando artículos y códigos nacionales…</td></tr>}
      {!loading&&!currentRows.length&&<tr><td colSpan={chosen.length*5+5}>
       <div className="fm-lab-order-noresults">
        <strong>{tab==="parafarmacia"?
         "Sin referencias de parafarmacia en este laboratorio":
         "Sin medicamentos asociados a este laboratorio"}</strong>
        <span>{tab==="parafarmacia"?
         "Los medicamentos del nomenclátor AEMPS aparecen en la pestaña Medicación. Parafarmacia necesita ventas o recepciones de artículos asociados al laboratorio.":
         "Comprueba que el nomenclátor AEMPS esté cargado y que el laboratorio aparezca asociado a sus presentaciones."}</span>
        <button type="button" className="btn btn-secondary" onClick={()=>{setTab(tab==="parafarmacia"?"medicacion":"parafarmacia");setError("")}}>
         Ver {tab==="parafarmacia"?"Medicación":"Parafarmacia"}
        </button>
       </div>
      </td></tr>}
      </tbody>
     </table>
    </div>
    <div className="fm-lab-order-actions">
     <div><strong>{tab==="parafarmacia"?"Pedido conjunto de parafarmacia · central Pedia":"Pedido conjunto de medicación · desglose por farmacia"}</strong>
      <small>Todas las referencias aparecen juntas y se incluyen en el borrador al guardar. El stock es actual; las ventas de 3 y 12 meses se calculan hasta la fecha «Hasta».</small>
      {savedDate&&(savedDate.from!==range.from||savedDate.to!==range.to)&&
       <small className="fm-lab-order-notice">El borrador anterior tenía otro período. Al guardar se actualizará.</small>}
     </div>
     <button className="btn btn-secondary" type="button" onClick={save}
      disabled={!canEdit||busy||loading||!range.valid||!scope||data.metricsUnavailable||hasInvalid}>
      <Save size={16}/> {busy?"Guardando…":"Guardar borrador"}</button>
     <button className="btn btn-primary" type="button" onClick={exportExcel}
      disabled={busy||!persisted||dirty||!savedLines.length}>
      <Download size={16}/> Generar Excel</button>
    </div>
    <p className="fm-op-fine">En parafarmacia, Pedia emite un único pedido conjunto; la información de cada farmacia permanece diferenciada. En medicación, el pedido se prepara de forma conjunta para el laboratorio y conserva las cantidades de cada farmacia.</p>
    <p className="fm-op-fine">Las referencias sin CN verificado se señalan como pendientes y deben revisarse antes del envío. La exportación no envía ni aprueba ningún pedido.</p>
   </>}
  </section>
 </>;
}
