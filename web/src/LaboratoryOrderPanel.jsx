import React,{useEffect,useMemo,useRef,useState} from "react";
import {Download,Save,AlertTriangle,LoaderCircle} from "lucide-react";
import LaboratoryPicker from "./LaboratoryPicker.jsx";
import PreparadorAgenda from "./PreparadorAgenda.jsx";
import HorizontalTableScroll from "./HorizontalTableScroll.jsx";
import {ReportPageHeader,ReportFilterBar} from "./ReportControls.jsx";
import {resolveSalesPeriod} from "./salesPeriods.js";
import {readSharedReportFilters,updateSharedReportFilters} from "./sharedReportFilters.js";
import {defaultLaboratoryLine,orderLineFor,mergeVisibleOrderLines,laboratoryExcelRows,laboratoryOrderListRows,laboratoryExportName,qty,medicationOrderTotal,distributeMedicationOrderTotal} from "./laboratoryOrderSheet.js";
import {exportLaboratoryOrderWorkbook} from "./exportaciones.js";
import "./laboratoryOrderPanel.css";
import {collectLaboratoryCatalog,collectLaboratoryMetrics,LAB_CATALOG_BATCH} from "./laboratoryLoadAll.js";

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
 // Los pedidos son conjuntos: se contemplan siempre todas las farmacias autorizadas.
 const ids=pharmacies.map(p=>Number(p.id)).filter(Number.isSafeInteger).sort((a,b)=>a-b);
 const scope=ids.map(String).join(",");
 const chosen=pharmacies.filter(p=>ids.some(id=>String(id)===String(p.id)));
 const range=useMemo(()=>resolveSalesPeriod(period,new Date(),{from:customFrom,to:customTo}),[period,customFrom,customTo]);
 const [labs,setLabs]=useState([]);
 const [laboratory,setLaboratory]=useState("");
 const [tab,setTab]=useState("parafarmacia"),[search,setSearch]=useState("");
 const [data,setData]=useState(empty);
 const catalogueCache=useRef(new Map());
 const [loading,setLoading]=useState(false),[loadStage,setLoadStage]=useState("idle"),[labsLoading,setLabsLoading]=useState(true);
 const [diagnostic,setDiagnostic]=useState(null),[diagnosticBusy,setDiagnosticBusy]=useState(false);
 const [drafts,setDrafts]=useState({}),[savedLines,setSavedLines]=useState([]);
 const [savedDate,setSavedDate]=useState(null),[dirty,setDirty]=useState(false),[persisted,setPersisted]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [reload,setReload]=useState(0),[updatedAt,setUpdatedAt]=useState(null);
 const [agendaRefresh,setAgendaRefresh]=useState(0);
 const [recordLab,setRecordLab]=useState(""),[recordType,setRecordType]=useState("pedido");
 const [recordDate,setRecordDate]=useState(()=>new Date().toLocaleDateString("en-CA",{timeZone:"Europe/Madrid"}));
 const [recordBusy,setRecordBusy]=useState(false),[recordError,setRecordError]=useState("");
 function chooseLaboratory(key,fromAgenda=false){
  const next=labs.find(l=>l.key===key);
  setLaboratory(key);
  setTab(next?.hasMedication===true?"medicacion":"parafarmacia");
  setSearch("");setError("");
  setNotice("");
  // Pulsar un laboratorio de la agenda vuelve a lanzar la consulta incluso
  // si ya estaba seleccionado (p. ej. tras registrar pedidos/stock).
  if(fromAgenda)setReload(n=>n+1);
  document.getElementById("fm-preparador-laboratorio")?.scrollIntoView({behavior:"smooth",block:"start"});
 }
 function beginRecord(key,type="pedido"){
  setRecordLab(key);setRecordType(type);setRecordError("");
  setRecordDate(new Date().toLocaleDateString("en-CA",{timeZone:"Europe/Madrid"}));
 }
 async function confirmRecord(){
  if(!recordLab)return;
  setRecordBusy(true);setRecordError("");
  try{
   await api(clientSlug,"/api/analytics/pedidos/agenda/realizados",{
    method:"POST",body:{laboratorio:recordLab,fecha:recordDate,tipo:recordType}});
   setNotice("Fecha global registrada. Se ha recalculado el próximo vencimiento del laboratorio.");
   setRecordLab("");setAgendaRefresh(n=>n+1);
  }catch(e){setRecordError(e.message)}finally{setRecordBusy(false)}
 }
 useEffect(()=>{
  const controller=new AbortController();setLabsLoading(true);
  const q=new URLSearchParams({uso:"preparador",farmacias:scope});
  api(clientSlug,"/api/analytics/pedidos/proveedores-unificados?"+q,{signal:controller.signal})
   .then(d=>{if(!controller.signal.aborted){
    const available=d.laboratories||[];
    setLabs(available);
    setLaboratory(current=>current&& !available.some(l=>l.key===current)?"":current);
   }})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message)})
   .finally(()=>{if(!controller.signal.aborted)setLabsLoading(false)});
  return()=>controller.abort();
 },[clientSlug,scope]);
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
  if(!laboratory||laboratory.startsWith("P:")||diagnosticBusy)return;
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
   const base=new URLSearchParams({laboratorio:laboratory,tipo:tab,farmacias:scope});
   const tooLong=range.valid&&(Date.parse(range.to)-Date.parse(range.from)>5*366*86400000);
   const useMetrics=range.valid&&!tooLong&&Boolean(scope);
   let catalog;
   const cacheKey=[clientSlug,laboratory,tab,scope,reload].join("|");
   try{
    catalog=catalogueCache.current.get(cacheKey);
    if(!catalog){
     try{
      // Solo CN comprados históricamente al proveedor unificado en Farmatic.
      // Se consulta una vez por laboratorio, sin 10-20 páginas intermedias.
      catalog=await api(clientSlug,
       "/api/analytics/pedidos/catalogo-unificado?"+base,{signal:controller.signal});
      if(!Array.isArray(catalog.rows)||catalog.rows.length!==catalog.total)
       throw Error("Catálogo incompleto");
     }catch(error){
      if(controller.signal.aborted)return;
      // Retrocompatibilidad: si un laboratorio tiene demasiadas referencias
      // o la nueva consulta tarda demasiado, cargar páginas en paralelo.
      catalog=await collectLaboratoryCatalog((number,size)=>{
       const query=new URLSearchParams(base);
       query.set("pagina",String(number));query.set("tamano",String(size));
       query.set("ligero","1");
       return api(clientSlug,"/api/analytics/pedidos/catalogo-directo?"+query,{
        signal:controller.signal});
      },{
       batchSize:LAB_CATALOG_BATCH,signal:controller.signal,
       onBatch:({rows,total})=>{
        if(!controller.signal.aborted)setData({rows,total,loaded:rows.length,
         metricsLoaded:0,metricsUnavailable:true,frequencyDays:0});
       }
      });
     }
     catalogueCache.current.set(cacheKey,catalog);
     if(catalogueCache.current.size>6)
      catalogueCache.current.delete(catalogueCache.current.keys().next().value);
    }
    if(!controller.signal.aborted)setData({rows:catalog.rows,total:catalog.total,
     loaded:catalog.total,metricsLoaded:0,metricsUnavailable:true,frequencyDays:0});
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
     warning:!scope?"No hay farmacias autorizadas: faltan ventas y stock.":
      !range.valid?"El período no es válido. Se muestran referencias sin métricas.":
       "El período supera cinco años. Acótalo para consultar ventas y stock."}));
    setLoading(false);setLoadStage("idle");
    return;
   }
   setLoadStage("metrics");
   // Un solo conjunto de CN para agrupar las ventas de 3m, 12m y período;
   // el servidor también devuelve stock y sugerencias de todas las farmacias.
   let bulkComplete=false;
   try{
    const result=await api(clientSlug,"/api/analytics/pedidos/matriz-conjunta",{
     method:"POST",signal:controller.signal,
     body:{laboratorio:laboratory,tipo:tab,farmacias:ids.map(Number),
      desde:range.from,hasta:range.to,
      referencias:catalog.rows.map(row=>({
       referencia:row.referencia,cn:row.cn||null,nombre:row.nombre
      }))}
    });
    if(controller.signal.aborted)return;
    if(result.metricsUnavailable||result.rows?.length!==catalog.rows.length)
     throw Error(result.warning||"Métricas conjuntas incompletas");
    const byReference=new Map(result.rows.map(row=>[row.referencia,row]));
    const completed=catalog.rows.map(row=>{
     const metrics=byReference.get(row.referencia);
     if(!metrics)throw Error("Referencia sin métricas");
     return {...row,...metrics,metricsReady:true};
    });
    setData({rows:completed,total:catalog.total,loaded:catalog.total,
     metricsLoaded:catalog.total,frequencyDays:result.frequencyDays??0,
     metricsUnavailable:false});
    bulkComplete=true;
   }catch(e){
    if(controller.signal.aborted)return;
    // Si el SQL conjunto no termina, indicar el cambio de estrategia.
    // El usuario sigue viendo sus artículos mientras progresan los lotes.
    setLoadStage("fallback");
   }
   if(bulkComplete){
    setLoading(false);setLoadStage("idle");setUpdatedAt(new Date());return;
   }
   // Solo si falla el cálculo conjunto: lotes de 200 CN en paralelo.
   // Con 2.000 artículos son 10 lotes, no las 50 consultas anteriores.
   // No se reconstruye el catálogo ni se pierden artículos.
   try{
    await collectLaboratoryMetrics(catalog.rows,items=>api(
     clientSlug,"/api/analytics/pedidos/matriz-referencias",{
      method:"POST",signal:controller.signal,
      body:{laboratorio:laboratory,tipo:tab,farmacias:ids.map(Number),
       desde:range.from,hasta:range.to,
       referencias:items.map(item=>({
        referencia:item.referencia,cn:item.cn||null,nombre:item.nombre
       }))}
     }),{signal:controller.signal,onBatch:({rows,loaded,frequencyDays})=>{
      if(!controller.signal.aborted)setData({rows,total:catalog.total,loaded:catalog.total,
       metricsLoaded:loaded,frequencyDays,metricsUnavailable:loaded<catalog.total});
     }});
   }catch(e){
    if(controller.signal.aborted)return;
    setData(current=>({...current,metricsUnavailable:true,
     warning:"Se muestran todas las referencias, pero no se pudieron completar las ventas y el stock ("+
      e.message+"). Actualiza para volver a calcularlos."}));
    setLoading(false);setLoadStage("idle");
    return;
   }
   if(!controller.signal.aborted){setLoading(false);setLoadStage("idle");setUpdatedAt(new Date())}
  },250);
  return()=>{clearTimeout(timer);controller.abort()};
 },[clientSlug,laboratory,tab,scope,range.from,range.to,range.valid,reload]);
 const labName=labs.find(l=>l.key===laboratory)?.name||"laboratorio";
 // Buscar por CN no reejecuta el histórico: filtrar solo la tabla cargada.
 const currentRows=useMemo(()=>{
  const term=search.trim().toLocaleLowerCase("es");
  if(!term)return data.rows||[];
  return (data.rows||[]).filter(row=>
   String(row.cn||row.referencia||"").toLocaleLowerCase("es").includes(term)||
   String(row.nombre||"").toLocaleLowerCase("es").includes(term));
 },[data.rows,search]);
 const showLine=row=>orderLineFor(row,tab,ids,drafts);
 const metricsLoading=loading&&(loadStage==="metrics"||loadStage==="fallback")&&Boolean(data.rows?.length);
 const pageTotalSold=currentRows.reduce((sum,row)=>sum+Number(row.totalSold||0),0);
 const pageTotalSuggested=currentRows.reduce((sum,row)=>sum+Number(row.totalSuggested||0),0);
 const pageTotalOrder=currentRows.reduce((sum,row)=>{
  const line=showLine(row);
  return sum+(tab==="parafarmacia"?Number(line.units||0):
   medicationOrderTotal(line,ids));
 },0);
 const hasInvalid=Object.values(drafts).some(line=>tab==="parafarmacia"?qty(line.units)===null:
  Object.values(line.unitsByPharmacy||{}).some(value=>qty(value)===null));
 function choosePeriod(value){setPeriod(value);
  updateSharedReportFilters(clientSlug,{period:value})}
 function changeDate(field,value){
  // Editar un campo activa el período personalizado preservando la otra fecha.
  const from=field==="from"?value:(period==="custom"?customFrom:range.from||"");
  const to=field==="to"?value:(period==="custom"?customTo:range.to||"");
  setCustomFrom(from);setCustomTo(to);setPeriod("custom");
  updateSharedReportFilters(clientSlug,{period:"custom",customFrom:from,customTo:to});
 }
 function updateLine(row,newQty,pharmacyId=null){
  const amount=newQty===""?0:Number(newQty);
  setDrafts(current=>{
   const previous=orderLineFor(row,tab,ids,current);
   let update;
   if(tab==="parafarmacia")update={...previous,units:amount};
   else if(pharmacyId==="total"){
    update=distributeMedicationOrderTotal(row,previous,ids,amount);
    if(!update)return current;
   }else update={...previous,
    unitsByPharmacy:{...previous.unitsByPharmacy,[String(pharmacyId)]:amount}};
   return {...current,[row.referencia]:update};
  });
  if(tab==="medicacion"&&pharmacyId==="total"&&qty(newQty)===null){
   setError("Introduce un total válido entre 0 y 999.999 unidades.");return;
  }
  setDirty(true);setNotice("");setError("");
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
  <PreparadorAgenda clientSlug={clientSlug} laboratories={labs}
   canEdit={canEdit} refreshToken={agendaRefresh}
   onSelect={key=>chooseLaboratory(key,true)}
   onInitial={key=>beginRecord(key,"fecha_inicial")}/>
  <section id="fm-preparador-laboratorio" className="card fm-lab-order">
   <div className="fm-lab-order-top">
    <div><h2>1. Selecciona el laboratorio</h2>
     <p>Solo laboratorios con códigos nacionales de recepciones válidas, asignados según la última recepción. Se excluyen cooperativas, mayoristas y proveedores ignorados.</p></div>
    <div className="fm-lab-order-chooser">
     <LaboratoryPicker laboratories={labs} loading={labsLoading} selected={laboratory}
      onSelect={key=>chooseLaboratory(key)}/>
    </div>
   </div>
   {error&&<p className="fm-op-message fm-op-error" role="alert"><AlertTriangle size={15}/>{error}</p>}
   {notice&&<p className="fm-op-message" role="status">{notice}</p>}
   {!laboratory?<p className="fm-lab-order-placeholder">Selecciona un laboratorio para consultar y preparar su pedido.</p>:<>
    <div className="fm-lab-order-tabs" role="tablist" aria-label="Tipo de artículos">
     {[["parafarmacia","Parafarmacia"],["medicacion","Medicación"]].map(([value,label])=>
      <button key={value} type="button" role="tab" aria-selected={tab===value}
       className={"btn "+(tab===value?"btn-primary":"btn-secondary")}
       onClick={()=>{setTab(value);setNotice("");setError("")}}>{label}</button>)}
    </div>
    <ReportFilterBar periodKey={period} onPeriodChange={choosePeriod}
     alwaysShowDates showQuickPeriods={false} periodLabel="Ventas · período seleccionado"
     customFrom={period==="custom"?customFrom:range.from||""}
     customTo={period==="custom"?customTo:range.to||""}
     onCustomFromChange={v=>changeDate("from",v)}
     onCustomToChange={v=>changeDate("to",v)}>
     <label className="fm-unified-filter"><span>Buscar artículo o CN</span>
      <input type="search" placeholder="Artículo o CN…" value={search}
       onChange={e=>{setSearch(e.target.value)}}/></label>
    </ReportFilterBar>
    {!range.valid&&<p role="alert" className="fm-op-message fm-op-error">Selecciona un período válido y comprueba las fechas desde/hasta.</p>}
    {data.warning&&<p role="status" className="fm-lab-order-warning">
     <AlertTriangle size={15}/> {data.warning}
    </p>}
    {!laboratory.startsWith("P:")&&(!loading&&data.total===0||Boolean(error)||diagnostic)&&
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
     <span><strong>{search?currentRows.length:(data.loaded??0)} / {data.total??0}</strong> referencias</span>
     <span><strong>{!loading&&!data.metricsUnavailable?fmt(pageTotalSold):"—"}</strong> vendidas</span>
     <span><strong>{data.frequencyDays>0?data.frequencyDays+" días":"Bajo demanda"}</strong> · frecuencia de planificación</span>
     <span><strong>{!loading&&!data.metricsUnavailable?fmt(pageTotalSuggested):"—"}</strong> propuestas</span>
     <span><strong>{!loading&&!data.metricsUnavailable?fmt(pageTotalOrder):"—"}</strong> uds. a pedir</span>
     {loading&&<span role="status" className="fm-lab-loading-label">
      <LoaderCircle size={15} className="fm-lab-spinner"/>
      {loadStage==="catalog"?
       "Cargando referencias "+(data.loaded??0)+" de "+(data.total||"…")+"…":
       loadStage==="fallback"?
        "Calculando ventas y stock por lotes "+(data.metricsLoaded??0)+" de "+(data.total??0)+"…":
        "Calculando ventas y stock de "+(data.total??0)+" referencias en una consulta…"}
     </span>}
    </div>
    <div className="fm-lab-matrix-frame" data-metrics-loading={metricsLoading?"true":"false"}>
     <HorizontalTableScroll className="fm-lab-order-scroll" label="artículos y métricas por farmacia"
      aria-busy={metricsLoading}>
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
       <th className="fm-lab-order-editcol">Pedir total</th>
      </tr></thead>
      <tbody>{currentRows.map(row=>{
       const line=showLine(row);
       return <tr key={row.referencia}>
        <td className="fm-lab-order-sticky fm-lab-order-cn" title={row.cn||"Código nacional no disponible"}>{row.cn||"—"}
         {row.provisional&&<small>CN pendiente</small>}</td>
        <td className="fm-lab-order-sticky fm-lab-order-name" title={row.nombre}>{row.nombre}</td>
        {chosen.flatMap((p,i)=>{
         const m=row.byPharmacy?.[String(p.id)]||{};
         return [row.metricsReady?m.units3??0:null,row.metricsReady?m.units12??0:null,row.metricsReady?m.stock??null:null,row.metricsReady?m.unitsPeriod??0:null,
          tab==="medicacion"?"edit":row.metricsReady?m.suggested??null:null].map((value,k)=>
           <td key={p.id+"-"+k} className={"fm-lab-order-cell shade-"+i%3+(k===4?" fm-lab-order-ordercol":"")}>
            {value==="edit"?<input type="number" min="0" max="999999" step="1"
             aria-label={"Pedir "+row.nombre+" en "+p.name}
             disabled={!canEdit||loading||!row.metricsReady} value={line.unitsByPharmacy?.[String(p.id)]??0}
             onChange={e=>updateLine(row,e.target.value,p.id)}/>:fmt(value)}
           </td>);
        })}
        <td className="fm-lab-order-total">{row.metricsReady?fmt(row.totalSold):"—"}</td>
        <td className="fm-lab-order-total">{row.metricsReady?fmt(row.totalSuggested):"—"}</td>
        <td className="fm-lab-order-editcol">
         <input type="number" min="0" max="999999" step="1"
          disabled={!canEdit||loading||!row.metricsReady}
          title={tab==="medicacion"?"Reparte el total proporcionalmente entre las farmacias; después puedes ajustar cada una.":"Unidades totales a pedir"}
          aria-label={tab==="medicacion"?"Pedir total de "+row.nombre:"Pedir "+row.nombre+" para el laboratorio"}
          value={tab==="medicacion"?medicationOrderTotal(line,ids):line.units??0}
          onChange={e=>updateLine(row,e.target.value,tab==="medicacion"?"total":null)}/></td>
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
    </HorizontalTableScroll>
    {metricsLoading&&<div className="fm-lab-matrix-overlay" role="status" aria-live="polite">
     <div className="fm-lab-matrix-loading">
      <LoaderCircle size={30} className="fm-lab-spinner" aria-hidden="true"/>
      <strong>Calculando ventas y stock por farmacia…</strong>
      <span>{loadStage==="fallback"?
       "Procesando "+(data.metricsLoaded??0)+" de "+(data.total??0)+" referencias":
       "Completando las métricas y los totales de los artículos"}</span>
     </div>
    </div>}
   </div>
   <div className="fm-lab-order-actions">
     <button className="btn btn-secondary" type="button" onClick={save}
      disabled={!canEdit||busy||loading||!range.valid||!scope||data.metricsUnavailable||hasInvalid}>
      <Save size={16}/> {busy?"Guardando…":"Guardar borrador"}</button>
     <button className="btn btn-primary" type="button" onClick={exportExcel}
      disabled={busy||!persisted||dirty||!savedLines.length}>
      <Download size={16}/> Generar Excel</button>
     {canEdit&&<button className="btn btn-secondary" type="button"
      onClick={()=>beginRecord(laboratory)} disabled={busy||!laboratory||!ids.length}>
      Marcar pedido realizado</button>}
    </div>
    <p className="fm-muted">Generar Excel no confirma ni envía un pedido. Marca «Pedido realizado» solo después de haberlo cursado.</p>
   </>}
  </section>
  {recordLab&&<div className="fm-order-confirm-overlay" role="dialog" aria-modal="true" aria-label="Confirmar fecha de pedido">
   <div className="fm-order-confirm">
    <h2>{recordType==="fecha_inicial"?"Establecer fecha inicial":"Marcar pedido realizado"}</h2>
    <p><strong>{labs.find(l=>l.key===recordLab)?.name||recordLab}</strong></p>
    <p>{recordType==="fecha_inicial"?
      "Registra la fecha del último pedido conocido para iniciar la planificación. No se enviará ningún pedido.":
      "Confirma únicamente si ya has hecho el pedido conjunto fuera de Farmétrica. Esta acción reinicia el calendario global del laboratorio."}</p>
    <label>Fecha del pedido
     <input type="date" value={recordDate}
      max={new Date().toLocaleDateString("en-CA",{timeZone:"Europe/Madrid"})}
      onChange={e=>setRecordDate(e.target.value)}/>
    </label>
    <p className="fm-muted">La fecha se aplica a la planificación conjunta del laboratorio, independientemente de la farmacia.</p>
    {recordError&&<p role="alert" className="fm-op-message fm-op-error">{recordError}</p>}
    <div className="fm-order-confirm-actions">
     <button className="btn btn-secondary" disabled={recordBusy} onClick={()=>setRecordLab("")}>Cancelar</button>
     <button className="btn btn-primary" disabled={recordBusy||!recordDate}
      onClick={()=>void confirmRecord()}>{recordBusy?"Guardando…":"Confirmar fecha"}</button>
    </div>
   </div>
  </div>}
 </>;
}
