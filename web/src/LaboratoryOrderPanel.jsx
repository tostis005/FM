import {numberFormatES} from "./localeES.js";
import React,{useEffect,useMemo,useRef,useState} from "react";
import {Download,Save,AlertTriangle,MessageSquareText} from "lucide-react";
import {LoadingStatus} from "./LoadingState.jsx";
import LaboratoryPicker from "./LaboratoryPicker.jsx";
import PreparadorAgenda from "./PreparadorAgenda.jsx";
import HorizontalTableScroll from "./HorizontalTableScroll.jsx";
import {groupedLaboratoryRows} from "./laboratoryOrderGrouping.js";
import {ALL_LAB_ROWS,LAB_VIRTUAL_ROW_HEIGHT,laboratoryTablePage,laboratoryTableViewport} from "./laboratoryTableWindow.js";
import {ReportPageHeader,ReportFilterBar} from "./ReportControls.jsx";
import {resolveSalesPeriod} from "./salesPeriods.js";
import {readSharedReportFilters,updateSharedReportFilters} from "./sharedReportFilters.js";
import {defaultLaboratoryLine,orderLineFor,mergeVisibleOrderLines,laboratoryExcelRows,laboratoryOrderListRows,laboratoryExportName,qty,medicationOrderTotal,distributeMedicationOrderTotal,totalStockFor,laboratoryStockTotals,isExcludedOrderRow,compareLaboratoryOrderGroups,laboratoryOrderGroupValue,matchesLaboratoryColumnFilters} from "./laboratoryOrderSheet.js";
import {exportLaboratoryOrderWorkbook} from "./exportaciones.js";
import "./laboratoryOrderPanel.css";
import {collectLaboratoryCatalog,collectLaboratoryMetrics,LAB_CATALOG_BATCH,LAB_METRICS_BULK_LIMIT,laboratoryMetricsBatchSize,retryTransientLaboratoryRead} from "./laboratoryLoadAll.js";
import {MAX_BULK_CODES,parseBulkCodes,parseDescriptionLines,preferredCNType} from "./preparadorBulkCodes.js";

async function api(slug,path,{signal,method="GET",body}={}){
 // Repetir únicamente lecturas idempotentes ante errores de red o 502/503.
 // Nunca duplicar una grabación de pedido, ni repetir un SQL que agotó su tiempo.
 const readOnly=method==="GET"||path.startsWith("/api/analytics/pedidos/matriz-");
 return retryTransientLaboratoryRead(async()=>{
  const response=await fetch(path,{method,credentials:"same-origin",cache:"no-store",signal,
   headers:{"X-Farmetrica-Cliente":slug,...(body?{"Content-Type":"application/json"}:{})},
   ...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok){
   const error=Error(result.error||"No se pudo completar la consulta");
   error.status=response.status;
   error.code=result.metricsErrorCode||result.code;
   throw error;
  }
  return result;
 },{signal,attempts:readOnly?2:1});
}
const empty={rows:[],total:0};
const fmt=value=>value===null||value===undefined?"—":
 numberFormatES({maximumFractionDigits:1}).format(Number(value));
export default function LaboratoryOrderPanel({clientSlug,pharmacies=[],warehouses=[],canEdit=false,userEmail=""}){
 const shared=()=>readSharedReportFilters(clientSlug);
 const [period,setPeriod]=useState(()=>shared().period||"this_month");
 const [customFrom,setCustomFrom]=useState(()=>shared().customFrom||"");
 const [customTo,setCustomTo]=useState(()=>shared().customTo||"");
 // Los pedidos son conjuntos: se contemplan siempre todas las farmacias autorizadas.
 const ids=pharmacies.map(p=>Number(p.id)).filter(Number.isSafeInteger).sort((a,b)=>a-b);
 const scope=ids.map(String).join(",");
 const chosen=pharmacies.filter(p=>ids.some(id=>String(id)===String(p.id)));
 const activeWarehouses=warehouses.filter(w=>w.active!==false&&w.establishmentType==="almacen");
 const range=useMemo(()=>resolveSalesPeriod(period,new Date(),{from:customFrom,to:customTo}),[period,customFrom,customTo]);
 const [labs,setLabs]=useState([]);
 const [laboratory,setLaboratory]=useState("");
 const [crossInputs,setCrossInputs]=useState({cns:"",eans:"",descriptions:""});
 const bulkCN=useMemo(()=>parseBulkCodes(crossInputs.cns,"cn"),[crossInputs.cns]);
 const bulkEAN=useMemo(()=>parseBulkCodes(crossInputs.eans,"ean"),[crossInputs.eans]);
 const bulkDescriptions=useMemo(()=>parseDescriptionLines(crossInputs.descriptions),[crossInputs.descriptions]);
 const bulkCount=bulkCN.total+bulkEAN.total+bulkDescriptions.length;
 const [crossSearch,setCrossSearch]=useState(null);
 const isCrossSearch=Boolean(crossSearch);
 // Clave virtual usada exclusivamente para las métricas de la búsqueda.
 const activeLaboratory=isCrossSearch?"N:BUSQUEDA TRANSVERSAL":laboratory;
 const [tab,setTab]=useState("parafarmacia");
 const showWarehouses=tab==="parafarmacia"&&activeWarehouses.length>0;
 const [columnFilter,setColumnFilter]=useState({cn:"",article:"",provider:""});
 const [tableSort,setTableSort]=useState("original"),[tablePage,setTablePage]=useState(0),
  [tablePageSize,setTablePageSize]=useState(ALL_LAB_ROWS);
 // Mientras se edita Pedir total, no mover de sitio el campo con cada pulsación.
 const [frozenSortDrafts,setFrozenSortDrafts]=useState(null);
 const [data,setData]=useState(empty);
 const catalogueCache=useRef(new Map());
 const tableScrollRef=useRef(null);
 const [virtualRow,setVirtualRow]=useState(0);
 const [loading,setLoading]=useState(false),[loadStage,setLoadStage]=useState("idle"),[labsLoading,setLabsLoading]=useState(true);
 const [metricsProgress,setMetricsProgress]=useState(0);
 const [diagnostic,setDiagnostic]=useState(null),[diagnosticBusy,setDiagnosticBusy]=useState(false);
 const [drafts,setDrafts]=useState({}),[savedLines,setSavedLines]=useState([]);
 const [globalComment,setGlobalComment]=useState(""),[savedGlobalComment,setSavedGlobalComment]=useState("");
 const [commentRow,setCommentRow]=useState(null),[commentText,setCommentText]=useState("");
 const [savedDate,setSavedDate]=useState(null),[dirty,setDirty]=useState(false),[persisted,setPersisted]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [reload,setReload]=useState(0),[updatedAt,setUpdatedAt]=useState(null);
 const [agendaRefresh,setAgendaRefresh]=useState(0);
 const [recordLab,setRecordLab]=useState(""),[recordType,setRecordType]=useState("pedido");
 const [recordDate,setRecordDate]=useState(()=>new Date().toLocaleDateString("en-CA",{timeZone:"Europe/Madrid"}));
 const [recordBusy,setRecordBusy]=useState(false),[recordError,setRecordError]=useState("");
 function chooseLaboratory(key,fromAgenda=false){
  setCrossSearch(null);
  const next=labs.find(l=>l.key===key);
  setLaboratory(key);
  setTab(next?.hasMedication===true?"medicacion":"parafarmacia");
  setError("");setColumnFilter({cn:"",article:"",provider:""});setTablePage(0);
  setTablePageSize(ALL_LAB_ROWS);
  setNotice("");
  // Pulsar un laboratorio de la agenda vuelve a lanzar la consulta incluso
  // si ya estaba seleccionado (p. ej. tras registrar pedidos/stock).
  if(fromAgenda)setReload(n=>n+1);
  document.getElementById("fm-preparador-laboratorio")?.scrollIntoView({behavior:"smooth",block:"start"});
 }
 function submitCrossSearch(event){
  event.preventDefault();
  if(!bulkCount){
   setError("Pega al menos un CN, un EAN o una descripción para buscar.");return;
  }
  if(bulkCN.invalid.length||bulkEAN.invalid.length){
   const example=[...bulkCN.invalid,...bulkEAN.invalid].slice(0,3).join(", ");
   setError("Hay códigos con formato no válido ("+example+"). Usa CN de 6-7 cifras o EAN de 8-14 cifras.");return;
  }
  if(bulkDescriptions.some(v=>v.length<2||v.length>100)){
   setError("Cada descripción debe contener entre 2 y 100 caracteres.");return;
  }
  if(bulkCount>MAX_BULK_CODES){
   setError("Puedes buscar hasta "+MAX_BULK_CODES+" códigos y descripciones a la vez.");return;
  }
  const filters={cns:bulkCN.codes,eans:bulkEAN.codes,descriptions:bulkDescriptions};
  // Seleccionar automáticamente Medicación o Parafarmacia cuando todos los CN
  // son del mismo tipo; con una lista mixta se conservan ambas pestañas.
  if(bulkCN.total&&!bulkEAN.total&&!bulkDescriptions.length){
   const type=preferredCNType(bulkCN.codes);
   if(type)setTab(type);
  }
  setCrossSearch(filters);
  setLaboratory("");setColumnFilter({cn:"",article:"",provider:""});
  setTablePage(0);setTablePageSize(ALL_LAB_ROWS);setNotice("");setError("");
  setReload(n=>n+1);
 }
 function beginRecord(key,type="pedido"){
  setRecordLab(key);setRecordType(type);setRecordError("");
  setRecordDate(new Date().toLocaleDateString("en-CA",{timeZone:"Europe/Madrid"}));
 }

 async function confirmRecord(){
  if(!recordLab)return;
  setRecordBusy(true);setRecordError("");
  try{
   if(recordType==="fecha_inicial"){
    await api(clientSlug,"/api/analytics/pedidos/agenda/realizados",{
     method:"POST",body:{laboratorio:recordLab,fecha:recordDate,tipo:recordType}});
    setNotice("Fecha inicial registrada; se ha actualizado la planificación.");
   }else{
    if(isCrossSearch||loading||data.metricsUnavailable||hasInvalid||!range.valid)
     throw Error("Espera a que termine la carga y revisa las cantidades antes de confirmar.");
    const combined=mergeOrderRows();
    const lines=Object.values(combined).filter(line=>tab==="parafarmacia"?
     Number(line.units)>0:Object.values(line.unitsByPharmacy||{}).some(value=>Number(value)>0))
     .map(line=>({reference:line.reference,cn:line.cn,name:line.name,
      ...(tab==="parafarmacia"?{units:line.units}:{unitsByPharmacy:line.unitsByPharmacy}),
      comment:line.comment||"",excluded:line.excluded===true}));
    if(!lines.length)throw Error("El pedido no tiene unidades positivas que registrar.");
    if(lines.length>5000)throw Error("Demasiadas referencias en el pedido.");
    const response=await api(clientSlug,"/api/analytics/pedidos/historial",{
     method:"POST",body:{laboratorio:recordLab,tipo:tab,farmacias:ids,
      fecha:recordDate,desde:range.from,hasta:range.to,
      origen:"preparador",lineas:lines,comentarioGlobal:globalComment}});
    setDrafts({});setSavedLines([]);setPersisted(false);setSavedDate(null);
    setDirty(false);setGlobalComment("");setSavedGlobalComment("");
    setNotice("Pedido realizado y archivado en el historial por "+response.realizadoPor+".");
    setReload(n=>n+1);
   }
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
  setGlobalComment("");setSavedGlobalComment("");setCommentRow(null);
  if(isCrossSearch||!laboratory||!scope)return;
  const controller=new AbortController();
  const query=new URLSearchParams({laboratorio:activeLaboratory,tipo:tab,farmacias:scope});
  api(clientSlug,"/api/analytics/pedidos/borrador-laboratorio?"+query,{signal:controller.signal})
   .then(d=>{if(controller.signal.aborted)return;
    const lines=Array.isArray(d.lineas)?d.lineas:[];
    setDrafts(Object.fromEntries(lines.map(line=>[line.reference,line])));
    setSavedLines(lines);setSavedDate(d.desde&&d.hasta?{from:d.desde,to:d.hasta}:null);
    setGlobalComment(d.comentarioGlobal||"");setSavedGlobalComment(d.comentarioGlobal||"");
    setPersisted(Boolean(d.updatedAt));
   }).catch(e=>{if(!controller.signal.aborted)setError(e.message)});
  return()=>controller.abort();
 },[clientSlug,laboratory,isCrossSearch,tab,scope]);
 useEffect(()=>{setDiagnostic(null);setDiagnosticBusy(false)},[clientSlug,laboratory,scope,isCrossSearch]);
 async function runDiagnostic(){
  if(isCrossSearch||!laboratory||laboratory.startsWith("P:")||diagnosticBusy)return;
  setDiagnosticBusy(true);setDiagnostic(null);
  const query=new URLSearchParams({laboratorio:activeLaboratory,farmacias:scope});
  try{setDiagnostic(await api(clientSlug,"/api/analytics/pedidos/diagnostico-laboratorio?"+query))}
  catch(e){setDiagnostic({error:e.message})}
  finally{setDiagnosticBusy(false)}
 }
 useEffect(()=>{
  if(!activeLaboratory){setData(empty);setLoading(false);setLoadStage("idle");return}
  const controller=new AbortController();
  setLoading(true);setLoadStage("catalog");setMetricsProgress(0);setError("");
  setData({...empty,metricsUnavailable:true,loaded:0,metricsLoaded:0});
  // No ocultar el spinner al recibir HTTP: esperar a pintar la matriz y sus totales.
  const finishRendering=()=>{
   if(controller.signal.aborted)return;
   setLoadStage("render");
   requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(controller.signal.aborted)return;
    setLoading(false);setLoadStage("idle");setUpdatedAt(new Date());
   }));
  };
  const timer=setTimeout(async()=>{
   const base=new URLSearchParams({laboratorio:activeLaboratory,tipo:tab,farmacias:scope});
   const tooLong=range.valid&&(Date.parse(range.to)-Date.parse(range.from)>5*366*86400000);
   const useMetrics=range.valid&&!tooLong&&Boolean(scope);
   let catalog;
   const cacheKey=[clientSlug,activeLaboratory,tab,scope,JSON.stringify(crossSearch),reload].join("|");
   try{
    catalog=catalogueCache.current.get(cacheKey);
    if(!catalog){
     try{
      // Solo CN comprados históricamente al proveedor unificado en Farmatic.
      // Se consulta una vez por laboratorio, sin 10-20 páginas intermedias.
      catalog=isCrossSearch?
       await api(clientSlug,"/api/analytics/pedidos/catalogo-busqueda",{
        method:"POST",signal:controller.signal,
        body:{farmacias:scope,tipo:tab,filtros:crossSearch}}):
       await api(clientSlug,
        "/api/analytics/pedidos/catalogo-unificado?"+base,{signal:controller.signal});
      if(!Array.isArray(catalog.rows)||catalog.rows.length!==catalog.total)
       throw Error("Catálogo incompleto");
     }catch(error){
      if(controller.signal.aborted)return;
      if(isCrossSearch)throw error;
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
     loaded:catalog.total,metricsLoaded:0,metricsUnavailable:true,frequencyDays:0,warning:catalog.warning||null});
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
   // Para catálogos pequeños una consulta es más rápida. Los medianos y
    // grandes se calculan en lotes, con progreso real por artículos.
    if(catalog.rows.length<=LAB_METRICS_BULK_LIMIT){
    setLoadStage("bulk");
   let bulkComplete=false;
   try{
    const result=await api(clientSlug,"/api/analytics/pedidos/matriz-conjunta",{
     method:"POST",signal:controller.signal,
     body:{laboratorio:activeLaboratory,tipo:tab,farmacias:ids.map(Number),
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
     metricsUnavailable:false,warning:catalog.warning||null});
    setMetricsProgress(catalog.total);
    bulkComplete=true;
   }catch(e){
    if(controller.signal.aborted)return;
    // Si el SQL conjunto no termina, indicar el cambio de estrategia.
    // El usuario sigue viendo sus artículos mientras progresan los lotes.
    setLoadStage("fallback");
   }
   if(bulkComplete){
    finishRendering();return;
   }
   }
   // Mientras el spinner tapa el pedido, no volver a pintar toda la tabla
   // ni recalcular los totales por cada lote: actualizar solo el progreso.
   // La matriz completa se publica en un único render al finalizar.
   setLoadStage("progress");
   let lastPartial=null,lastVisibleProgress=0;
   try{
    const completed=await collectLaboratoryMetrics(catalog.rows,items=>api(
     clientSlug,"/api/analytics/pedidos/matriz-referencias",{
      method:"POST",signal:controller.signal,
      body:{laboratorio:activeLaboratory,tipo:tab,farmacias:ids.map(Number),
       desde:range.from,hasta:range.to,
       referencias:items.map(item=>({
        referencia:item.referencia,cn:item.cn||null,nombre:item.nombre
       }))}
     }),{batchSize:laboratoryMetricsBatchSize(catalog.rows.length),
      signal:controller.signal,onBatch:({rows,loaded,frequencyDays})=>{
      lastPartial={rows,loaded,frequencyDays};
      if(!controller.signal.aborted){
       setMetricsProgress(loaded);
       // Mostrar stock/ventas ya calculados, sin esperar a que termine
       // el último lote del laboratorio. Evitar renders muy frecuentes.
       const now=Date.now();
       if(!lastVisibleProgress||now-lastVisibleProgress>=700||loaded===catalog.total){
        lastVisibleProgress=now;
        setData(current=>({...current,rows,total:catalog.total,
         metricsLoaded:loaded,frequencyDays,
         metricsUnavailable:loaded<catalog.total,
         warning:catalog.warning||null}));
       }
      }
     }});
    if(controller.signal.aborted)return;
    setData({rows:completed.rows,total:catalog.total,loaded:catalog.total,
     metricsLoaded:catalog.total,frequencyDays:completed.frequencyDays,
     metricsUnavailable:false,warning:catalog.warning||null});
    setMetricsProgress(catalog.total);
   }catch(e){
    if(controller.signal.aborted)return;
    setData(current=>({...current,...(lastPartial||{}),metricsUnavailable:true,
     warning:"Se muestran todas las referencias, pero no se pudieron completar las ventas y el stock ("+
      e.message+"). Actualiza para volver a calcularlos."}));
    setLoading(false);setLoadStage("idle");
    return;
   }
   if(!controller.signal.aborted)finishRendering();
  },250);
  return()=>{clearTimeout(timer);controller.abort()};
 },[clientSlug,activeLaboratory,crossSearch,tab,scope,range.from,range.to,range.valid,reload]);
 const labName=isCrossSearch?"selección de productos":labs.find(l=>l.key===laboratory)?.name||"laboratorio";
 // Búsqueda y ordenación locales: no recalcular el histórico.
 const currentRows=(data.rows||[]).filter(row=>
  !isExcludedOrderRow(row)||!row.metricsReady||totalStockFor(row,ids)>0);
 // El paginado y los filtros son únicamente visuales: pedidos y totales completos.
 const tableVisibleRows=useMemo(()=>
  currentRows.filter(row=>matchesLaboratoryColumnFilters(row,columnFilter,isCrossSearch,{type:tab,pharmacyIds:ids})),
  [currentRows,columnFilter,isCrossSearch,tab,scope]);
 // Ordenar por la suma de TODAS las referencias de cada grupo, pero mantener
 // los campos y CN individuales para editar, guardar y exportar.
 const orderSortDrafts=frozenSortDrafts??drafts;
 const tableGroups=useMemo(()=>groupedLaboratoryRows(tableVisibleRows,tableSort,
  (a,b)=>compareLaboratoryOrderGroups(a,b,tableSort,tab,ids,orderSortDrafts)),
  [tableVisibleRows,tableSort,tab,scope,orderSortDrafts]);
 const groupOrderTotals=useMemo(()=>new Map(tableGroups.filter(group=>group.rows.length>1)
  .map(group=>[group.id,laboratoryOrderGroupValue(group,"totalOrder",tab,ids,drafts)])),
  [tableGroups,tab,scope,drafts]);
 const {totalPages,safePage,rows:tablePageRows}=useMemo(
  ()=>laboratoryTablePage(tableGroups,tablePageSize,tablePage),
  [tableGroups,tablePageSize,tablePage]);
 const viewport=laboratoryTableViewport(tablePageRows.length,virtualRow);
 const renderedRows=viewport.virtualized?
  tablePageRows.slice(viewport.start,viewport.end):tablePageRows;
 // Un límite de página anterior nunca debe esconder artículos de otro laboratorio
 // ni de otra pestaña. Cada nueva consulta comienza mostrando todos.
 useEffect(()=>{setTablePageSize(ALL_LAB_ROWS);setTablePage(0)},[laboratory,tab]);
 // Al cambiar filtros o página, comenzar por las primeras referencias.
 useEffect(()=>{
  setVirtualRow(0);
  if(tableScrollRef.current)tableScrollRef.current.scrollTop=0;
 },[laboratory,tab,tablePage,tablePageSize,tableSort,columnFilter,isCrossSearch]);
 const toggleTableSort=field=>{
  setFrozenSortDrafts(null);
  setTableSort(current=>current===field+":desc"?field+":asc":
   current===field+":asc"?field+":desc":
   field==="cn"||field==="article"||field==="provider"?field+":asc":field+":desc");
  setTablePage(0);
 };
 const sortDirection=field=>tableSort===field+":asc"?"ascending":
  tableSort===field+":desc"?"descending":"none";
 // Mantener la matriz compacta: controles de métricas dentro de su cabecera.
 const metricHeader=(field,name,description)=><div className="fm-lab-metric-head">
  <button type="button" className="fm-lab-total-sort" onClick={()=>toggleTableSort(field)}
   aria-label={"Ordenar por "+description}>{name}<span aria-hidden="true" data-direction={sortDirection(field)}/></button>
  <input type="search" className="fm-lab-column-filter fm-lab-metric-filter"
   value={columnFilter[field]||""} placeholder="Filtrar" aria-label={"Filtrar por "+description}
   onChange={e=>{setColumnFilter(prev=>({...prev,[field]:e.target.value}));setTablePage(0)}}/>
 </div>;
 const metricKeys=["stock","units12","units3","unitsPeriod","suggested"];
 const metricLabels=["stock","ventas de 12 meses","ventas de 3 meses","unidades vendidas","propuesta"];
 useEffect(()=>{
  setColumnFilter(prev=>Object.fromEntries(Object.entries(prev).filter(([key])=>["cn","article","provider"].includes(key))));
  setTableSort(prev=>/^(pharmacy|warehouse)\./.test(prev)?"original":prev);
 },[tab,scope,activeWarehouses.map(w=>w.id).join(",")]);
 const pauseOrderSorting=()=>{
  if(tableSort.startsWith("totalOrder:"))setFrozenSortDrafts(drafts);
 };
 const resumeOrderSorting=()=>setFrozenSortDrafts(null);
 // Las bajas sin existencias quedan fuera también del pedido guardado,
 // aunque un borrador anterior conserve cantidades de esa referencia.
 function mergeOrderRows(){
  const references=new Set(currentRows.map(row=>row.referencia));
  const validDrafts=Object.fromEntries(
   Object.entries(drafts).filter(([reference])=>references.has(reference)));
  return mergeVisibleOrderLines(currentRows,tab,ids,validDrafts);
 }
 const showLine=row=>orderLineFor(row,tab,ids,drafts);
 const metricsLoading=loading&&Boolean(activeLaboratory);
 // No ocultar al llegar el primer bloque: esperar a los totales completos.
 const showMatrixOverlay=metricsLoading&&!data.metricsLoaded;
 const matrixColumnCount=chosen.length*5+(showWarehouses?activeWarehouses.length*5:0)+(tab==="medicacion"?5:7)+(isCrossSearch?1:0);
 const stockTotals=useMemo(()=>laboratoryStockTotals(
   currentRows,ids,showWarehouses),[currentRows,scope,showWarehouses]);
 const stockAvailable=!loading&&!data.metricsUnavailable&&
  stockTotals.pharmacyStock!==null;
 const {pageTotalSold,pageTotalSuggested,pageTotalOrder}=useMemo(()=>{
  const pageTotalSold=currentRows.reduce((sum,row)=>sum+Number(row.totalSold||0),0);
   const pageTotalSuggested=currentRows.reduce((sum,row)=>sum+Number(row.totalSuggested||0),0);
   const pageTotalOrder=currentRows.reduce((sum,row)=>{
    const line=orderLineFor(row,tab,ids,drafts);
    return sum+(tab==="parafarmacia"?Number(line.units||0):
     medicationOrderTotal(line,ids));
   },0);
   return {pageTotalSold,pageTotalSuggested,pageTotalOrder};
  },[currentRows,scope,tab,drafts]);
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
 function openComment(row){
  setCommentRow(row);setCommentText(showLine(row).comment||"");
 }
 function confirmComment(){
  if(!commentRow||!canEdit)return;
  setDrafts(current=>{
   const previous=orderLineFor(commentRow,tab,ids,current);
   return {...current,[commentRow.referencia]:{...previous,comment:commentText.trim()}};
  });
  setDirty(true);setNotice("");setCommentRow(null);
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
  if(!canEdit||isCrossSearch||!laboratory||!range.valid||!scope||hasInvalid)return;
  const combined=mergeOrderRows();
  const lines=Object.values(combined);
  if(lines.length>5000){setError("Demasiadas referencias para un único borrador. Acota la selección.");return}
  if(lines.some(line=>tab==="parafarmacia"?qty(line.units)===null:
   Object.values(line.unitsByPharmacy||{}).some(x=>qty(x)===null))){
   setError("Revisa las cantidades del pedido.");return;
  }
  setBusy(true);setError("");setNotice("");
  try{
   const result=await api(clientSlug,"/api/analytics/pedidos/borrador-laboratorio",{
    method:"PUT",body:{laboratorio:activeLaboratory,tipo:tab,farmacias:ids.map(Number),
     desde:range.from,hasta:range.to,lineas:lines,comentarioGlobal:globalComment}});
   setDrafts(combined);setSavedLines(lines);setSavedGlobalComment(globalComment);setPersisted(true);
   setDirty(false);setSavedDate({from:range.from,to:range.to});
   setNotice("Borrador guardado en Farmétrica para este cliente, laboratorio y farmacias ("+result.count+" referencias).");
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }

 async function exportExcel(){
  if(loading||busy||data.metricsUnavailable||!range.valid||hasInvalid)return;
  try{
   setBusy(true);setError("");setNotice("");
   // El Excel refleja las cantidades actuales, incluso sin guardar borrador.
   // La búsqueda visual no elimina las líneas fuera de la vista del pedido.
   const all=mergeOrderRows();
   const matrix=currentRows.map(row=>({row,
    line:orderLineFor(row,tab,ids,all)}));
   if(matrix.length>5000)throw Error("Acota el laboratorio: supera las 5.000 referencias.");
   const matrixByReference=new Map(matrix.map(item=>[item.row.referencia,item]));
   const sortedMatrix=groupedLaboratoryRows(matrix.map(item=>item.row))
    .flatMap(group=>group.rows.map(row=>matrixByReference.get(row.referencia)));
   const ordered=sortedMatrix.filter(item=>tab==="parafarmacia"?
    Number(item.line.units)>0:
    Object.values(item.line.unitsByPharmacy||{}).some(q=>Number(q)>0));
   if(!ordered.length)throw Error("No hay cantidades positivas para exportar.");
   const rows=laboratoryExcelRows(sortedMatrix,chosen,tab,globalComment);
   const orderRows=laboratoryOrderListRows(ordered,chosen,tab,globalComment);
   await exportLaboratoryOrderWorkbook(rows,laboratoryExportName(labName,tab),orderRows,tab);
   setNotice("Excel generado con las cantidades actuales, sin guardar ni confirmar el pedido.");
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <>
  <ReportPageHeader title="Preparador de pedidos" description={isCrossSearch?"Búsqueda de productos de cualquier laboratorio · todas las farmacias":"Pedido por laboratorio · visión conjunta de todas las farmacias"}
   period={range} updatedAt={updatedAt} refreshing={loading}
   onRefresh={()=>setReload(n=>n+1)}/>
  <PreparadorAgenda clientSlug={clientSlug} laboratories={labs}
   canEdit={canEdit} refreshToken={agendaRefresh}
   onSelect={key=>chooseLaboratory(key,true)}
   onInitial={key=>beginRecord(key,"fecha_inicial")}/>
  <section id="fm-preparador-laboratorio" className="card fm-lab-order">
   <div className="fm-lab-order-top">
    <div><h2>Laboratorio</h2></div>
    <div className="fm-lab-order-chooser">
     <LaboratoryPicker laboratories={labs} loading={labsLoading} selected={laboratory}
      onSelect={key=>chooseLaboratory(key)}/>
    </div>
    <form className="fm-lab-cross-search" onSubmit={submitCrossSearch}>
     <h3>Buscar artículos</h3>
     <div className="fm-lab-cross-grid">
      <label htmlFor="fm-lab-bulk-cn">
       CN
       <textarea id="fm-lab-bulk-cn" rows={3} value={crossInputs.cns}
        placeholder={"Pega los CN, uno por línea\n123456\n234567"}
        aria-label="CN" spellCheck={false} autoComplete="off"
        onChange={e=>setCrossInputs(v=>({...v,cns:e.target.value}))}/>
      </label>
      <label htmlFor="fm-lab-bulk-ean">
       EAN
       <textarea id="fm-lab-bulk-ean" rows={3} value={crossInputs.eans}
        placeholder={"Pega los EAN, uno por línea\n8412345678901"}
        aria-label="EAN" spellCheck={false} autoComplete="off"
        onChange={e=>setCrossInputs(v=>({...v,eans:e.target.value}))}/>
      </label>
      <label htmlFor="fm-lab-bulk-description">
       Descripción
       <textarea id="fm-lab-bulk-description" rows={3} value={crossInputs.descriptions}
        placeholder={"Una descripción por línea\nParacetamol\nOmeprazol"}
        aria-label="Descripción"
        onChange={e=>setCrossInputs(v=>({...v,descriptions:e.target.value}))}/>
      </label>
     </div>
     <div className="fm-lab-cross-actions">
      <button className="btn btn-primary" type="submit" disabled={loading||!bulkCount}>Buscar</button>
      <button className="btn btn-secondary" type="button"
       onClick={()=>{
        setCrossInputs({cns:"",eans:"",descriptions:""});
        setCrossSearch(null);setColumnFilter({cn:"",article:"",provider:""});
        setNotice("");setError("");
       }}>Limpiar</button>
     </div>
    </form>
   </div>
   {error&&<p className="fm-op-message fm-op-error" role="alert"><AlertTriangle size={15}/>{error}</p>}
   {notice&&<p className="fm-op-message" role="status">{notice}</p>}
   {!activeLaboratory?<p className="fm-lab-order-placeholder">Selecciona un laboratorio o busca artículos.</p>:<>
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
     onCustomToChange={v=>changeDate("to",v)}/>
    {!range.valid&&<p role="alert" className="fm-op-message fm-op-error">Selecciona un período válido y comprueba las fechas desde/hasta.</p>}
    {(data.warning||(!loading&&data.metricsUnavailable&&data.rows?.length>0&&scope))&&
     <div className="fm-lab-order-warning" role="status">
      <AlertTriangle size={15}/>
      <span className="fm-lab-warning-text">
       {data.warning||"No se han podido completar las métricas de stock y ventas."}
       {!loading&&data.metricsUnavailable&&data.metricsLoaded>0&&
        " Hay "+data.metricsLoaded+" de "+data.total+" artículos calculados."}
      </span>
      {!loading&&data.metricsUnavailable&&data.rows?.length>0&&scope&&
       <button type="button" className="btn btn-secondary fm-lab-warning-retry"
        onClick={()=>setReload(n=>n+1)}>Reintentar stock y ventas</button>}
     </div>}
    {!isCrossSearch&&!laboratory.startsWith("P:")&&(!loading&&data.total===0||Boolean(error)||diagnostic)&&
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
        <span>Fichas de farmacia con laboratorio: <b>{diagnostic.evidence.erpArticles}</b></span>
        <span>Proveedores de farmacia con ese nombre: <b>{diagnostic.evidence.erpSuppliers}</b></span>
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
    <div className="fm-lab-order-lower" aria-busy={metricsLoading}>
    <div className="fm-lab-order-summary">
     {(!loading||data.rows?.length>0)&&<span className="fm-lab-order-article-count"><strong>{tableVisibleRows.length}</strong> artículos{tableVisibleRows.length!==currentRows.length?" de "+currentRows.length+" del catálogo":""}</span>}
     <span title="Stock de las farmacias seleccionadas; las existencias sin dato cuentan como cero">
      <strong>{loading?"Calculando…":stockAvailable?fmt(stockTotals.pharmacyStock):"Sin datos"}</strong> stock farmacias
     </span>
     {showWarehouses&&<span title="Stock conjunto de farmacias y almacenes configurados">
      <strong>{loading?"Calculando…":stockAvailable?fmt(stockTotals.globalStock):"Sin datos"}</strong> stock global
     </span>}
      <span><strong>{!loading&&!data.metricsUnavailable?fmt(pageTotalSold):"—"}</strong> vendidas</span>
     <span><strong>{data.frequencyDays>0?data.frequencyDays+" días":"Bajo demanda"}</strong> · frecuencia de planificación</span>
     <span><strong>{!loading&&!data.metricsUnavailable?fmt(pageTotalSuggested):"—"}</strong> propuestas</span>

     {metricsLoading&&metricsProgress>0&&<span role="status">
      Stock y ventas: {metricsProgress} de {data.total} artículos calculados
     </span>}
     <span><strong>{!loading&&!data.metricsUnavailable?fmt(pageTotalOrder):"—"}</strong> uds. a pedir</span>

    </div>
    <div className="fm-lab-matrix-frame" data-metrics-loading={showMatrixOverlay?"true":"false"}>
     <HorizontalTableScroll className="fm-lab-order-scroll" label="artículos y métricas por farmacia"
      scrollRef={tableScrollRef} aria-busy={metricsLoading}
      data-virtualized={viewport.virtualized?"true":"false"}
      onScrollCapture={event=>{
       if(!viewport.virtualized||event.target!==event.currentTarget)return;
       const next=Math.floor(Math.max(0,event.currentTarget.scrollTop-95)/LAB_VIRTUAL_ROW_HEIGHT);
       setVirtualRow(previous=>previous===next?previous:next);
      }}>
     <table className={"fm-lab-order-table"+(viewport.virtualized?" fm-lab-order-virtual":"")+(isCrossSearch?" fm-lab-order-cross":"")}>
      <thead><tr><th scope="col" className="fm-lab-order-sticky fm-lab-order-cn" rowSpan={2}
          aria-sort={tableSort.startsWith("cn:")?(tableSort.endsWith("asc")?"ascending":"descending"):"none"}>
          <div className="fm-lab-column-head">
           <button type="button" className="fm-lab-sort-head" onClick={()=>toggleTableSort("cn")}
            aria-label="Ordenar por CN">CN <span aria-hidden="true">{tableSort==="cn:asc"?"▲":tableSort==="cn:desc"?"▼":"↕"}</span></button>
           <input type="search" className="fm-lab-column-filter" value={columnFilter.cn} placeholder="Filtrar"
            aria-label="Filtrar por código nacional" title="Filtrar por código nacional"
            onChange={e=>{setColumnFilter(prev=>({...prev,cn:e.target.value}));setTablePage(0)}}/>
          </div>
         </th>
        <th scope="col" className="fm-lab-order-sticky fm-lab-order-name" rowSpan={2}
          aria-sort={tableSort.startsWith("article:")?(tableSort.endsWith("asc")?"ascending":"descending"):"none"}>
          <div className="fm-lab-column-head">
           <button type="button" className="fm-lab-sort-head" onClick={()=>toggleTableSort("article")}
            aria-label="Ordenar por artículo">Artículo <span aria-hidden="true">{tableSort==="article:asc"?"▲":tableSort==="article:desc"?"▼":"↕"}</span></button>
           <input type="search" className="fm-lab-column-filter" value={columnFilter.article} placeholder="Filtrar artículo"
            aria-label="Filtrar por artículo" title="Filtrar por artículo"
            onChange={e=>{setColumnFilter(prev=>({...prev,article:e.target.value}));setTablePage(0)}}/>
          </div>
         </th>
        {isCrossSearch&&<th scope="col" rowSpan={2}
         className="fm-lab-order-sticky fm-lab-order-provider"
         aria-sort={tableSort.startsWith("provider:")?(tableSort.endsWith("asc")?"ascending":"descending"):"none"}
         title="Proveedor unificado de Farmatic">
         <div className="fm-lab-column-head">
          <button type="button" className="fm-lab-sort-head" onClick={()=>toggleTableSort("provider")}
           aria-label="Ordenar por proveedor">Proveedor <span aria-hidden="true">{tableSort==="provider:asc"?"▲":tableSort==="provider:desc"?"▼":"↕"}</span></button>
          <input type="search" className="fm-lab-column-filter"
           value={columnFilter.provider} placeholder="Filtrar proveedor"
           aria-label="Filtrar por proveedor" title="Filtrar por proveedor"
           onChange={e=>{setColumnFilter(prev=>({...prev,provider:e.target.value}));setTablePage(0)}}/>
         </div>
        </th>}
        {chosen.map((p,i)=><th key={p.id} className={"fm-lab-order-group shade-"+i%3} colSpan={5}>{p.name}</th>)}
       {showWarehouses&&activeWarehouses.map(w=><th key={"warehouse-"+w.id}
        className="fm-lab-order-group fm-lab-order-warehouse-group" colSpan={5}>
        {/^alm$/i.test(String(w.name||"").trim())?"Almacén":w.name||"Almacén"}
       </th>)}
       <th colSpan={tab==="medicacion"?2:3} className="fm-lab-order-total-group">Totales</th>
       <th colSpan={tab==="medicacion"?1:2} className="fm-lab-order-order-group">Pedido</th>
      </tr><tr>
       {chosen.flatMap((p,i)=>["SCK","12M","3M","UDS","PED"]
        .map((name,k)=><th key={p.id+"-"+k}
         title={["Existencias actuales de la farmacia","Unidades vendidas en los últimos 12 meses",
          "Unidades vendidas en los últimos 3 meses","Unidades vendidas en el período seleccionado",
          tab==="medicacion"?"Unidades del pedido para esta farmacia":"Propuesta de pedido para esta farmacia"][k]}
         className={"fm-lab-order-sub shade-"+i%3+(k===4?" fm-lab-order-ordercol":"")}
         aria-sort={k===4&&tab==="medicacion"?undefined:sortDirection("pharmacy."+p.id+"."+metricKeys[k])}>
         {k===4&&tab==="medicacion"?name:metricHeader("pharmacy."+p.id+"."+metricKeys[k],name,metricLabels[k]+" en "+p.name)}</th>))}
       {showWarehouses&&activeWarehouses.flatMap(w=>["SCK","12M","3M","UDS","PED"]
        .map((name,k)=><th key={"alm-"+w.id+"-"+k} className="fm-lab-order-warehouse-head"
         title={k===0?"Existencias de "+w.name:k===1?"Ventas de "+w.name+" en 12 meses":
          k===2?"Ventas de "+w.name+" en 3 meses":k===3?"Ventas de "+w.name+" en el período":
          "Los almacenes no generan propuestas independientes"}
         aria-sort={k===4?undefined:sortDirection("warehouse."+w.id+"."+metricKeys[k])}>
         {k===4?name:metricHeader("warehouse."+w.id+"."+metricKeys[k],name,metricLabels[k]+" en "+w.name)}</th>))}
       <th className="fm-lab-order-total-head" aria-sort={sortDirection("totalStock")}
        title="Stock conjunto de las farmacias y, en parafarmacia, del almacén cuando está disponible">
        {metricHeader("totalStock","SCK","stock total")}
       </th>
       <th className="fm-lab-order-total-head" aria-sort={sortDirection("totalUnits")}
        title="Unidades vendidas en el período seleccionado por las farmacias">
        {metricHeader("totalUnits","UDS","unidades vendidas totales")}
       </th>
       {tab==="parafarmacia"&&<th className="fm-lab-order-total-head" aria-sort={sortDirection("totalSuggested")}
        title="Propuesta descontando el stock global">
        {metricHeader("totalSuggested","Propuesta","propuesta total")}
       </th>}
       {tab==="parafarmacia"&&<th className="fm-lab-order-editcol" aria-sort={sortDirection("totalOrder")}>
        <button type="button" className="fm-lab-total-sort" onClick={()=>toggleTableSort("totalOrder")}
         aria-label="Ordenar por unidades a pedir en total">UDS pedir <span aria-hidden="true" data-direction={sortDirection("totalOrder")}/></button>
       </th>}<th>Comentarios</th>
      </tr></thead>
      <tbody>
      {viewport.virtualized&&viewport.top>0&&<tr className="fm-lab-virtual-spacer" aria-hidden="true"
        style={{height:viewport.top}}><td colSpan={matrixColumnCount}
         style={{height:viewport.top}}/></tr>}
      {renderedRows.map((row,index)=>{
       const line=showLine(row);
       return <tr key={row.referencia}
         className={[
          isExcludedOrderRow(row)?"fm-lab-order-excluded":"",
          // La franja alterna depende de la posición REAL del artículo, no de
          // su posición en la ventana virtual ni de las filas espaciadoras.
          (viewport.start+index)%2===1?"fm-lab-row-even":"",
          row._visualGroupSize>1?"fm-lab-family-row":"",
          row._visualGroupFirst&&row._visualGroupSize>1?"fm-lab-family-first":"",
          row._visualGroupLast&&row._visualGroupSize>1?"fm-lab-family-last":""
         ].filter(Boolean).join(" ")}>
        <td className="fm-lab-order-sticky fm-lab-order-cn" title={row.cn||"Código nacional no disponible"}>{row.cn||"—"}
         {row.provisional&&<small>CN pendiente</small>}</td>
        <td className="fm-lab-order-sticky fm-lab-order-name" title={row.nombre}>
          <span className="fm-lab-order-name-text">{row.nombre}</span>
           {row._visualGroupSize>1&&<span className={"fm-lab-family-badge fm-lab-family-"+row._visualKind}
            title="Referencias relacionadas visualmente; cada CN se compra y contabiliza por separado">{row._visualLabel}</span>}
          </td>
        {isCrossSearch&&<td className="fm-lab-order-sticky fm-lab-order-provider" title={row.proveedor||"Proveedor no identificado"}>
          {row.proveedor||"—"}
         </td>}
        {chosen.flatMap((p,i)=>{
         const m=row.byPharmacy?.[String(p.id)]||{};
         return [row.metricsReady?m.stock??0:null,row.metricsReady?m.units12??0:null,row.metricsReady?m.units3??0:null,row.metricsReady?m.unitsPeriod??0:null,
          tab==="medicacion"?"edit":row.metricsReady?m.suggested??null:null].map((value,k)=>
           <td key={p.id+"-"+k} className={"fm-lab-order-cell shade-"+i%3+(k===4?" fm-lab-order-ordercol":"")}
            title={k===0?(m.stockInferredZero?
              "Stock 0 asumido: no existe existencia informada para este artículo":
              value===null?"Stock no disponible: error o carga de métricas incompleta":
              "Existencias actuales de la farmacia"):undefined}>
            {value==="edit"?<input type="number" min="0" max="999999" step="1"
             aria-label={"Pedir "+row.nombre+" en "+p.name}
             disabled={!canEdit||loading||!row.metricsReady} value={line.unitsByPharmacy?.[String(p.id)]??0}
             onFocus={pauseOrderSorting} onBlur={resumeOrderSorting}
             onChange={e=>updateLine(row,e.target.value,p.id)}/>:fmt(value)}
           </td>);
        })}
        {showWarehouses&&activeWarehouses.flatMap(w=>["stock","units12","units3","unitsPeriod","suggested"].map((key,k)=>{
          const available=row.metricsReady,details=row.warehouseBySite?.[String(w.id)]||{};
          const value=k===4?null:available?(key==="stock"?details.stock??0:details[key]):null;
          return <td key={"alm-"+w.id+"-"+key}
           className={"fm-lab-order-warehouse-col"+(k===4?" fm-lab-order-ordercol":"")}
           title={k===4?"Los almacenes no emiten propuestas propias":!available?"Calculando":
            key==="stock"?"Existencias de "+w.name+" (0 si no figuran)":value==null?
            "No hay ventas registradas del almacén":"Dato del almacén "+w.name}>
           {value==null?"—":fmt(value)}</td>;
         }))}
         <td className="fm-lab-order-total" title={showWarehouses&&row.globalStock!=null?
          "Stock total de farmacias y almacenes configurados":"Stock de todas las farmacias"}>
          {row.metricsReady?fmt(tab==="parafarmacia"?
           row.globalStock??totalStockFor(row,ids):
           totalStockFor(row,ids)):"—"}</td>
         <td className="fm-lab-order-total" title="Unidades vendidas por todas las farmacias en el período seleccionado">
          {row.metricsReady?fmt(row.totalSold):"—"}</td>
         {tab==="parafarmacia"&&<td className="fm-lab-order-total" title="Propuesta total de unidades a pedir">
          {row.metricsReady?fmt(row.totalSuggested):"—"}</td>}
         {tab==="parafarmacia"&&<td className="fm-lab-order-editcol">
          <div className="fm-lab-order-total-input">
           <input type="number" min="0" max="999999" step="1"
            disabled={!canEdit||loading||!row.metricsReady}
            title={tab==="medicacion"?"Reparte el total proporcionalmente entre las farmacias; después puedes ajustar cada una.":"Unidades totales a pedir"}
            aria-label={tab==="medicacion"?"Pedir total de "+row.nombre:"Pedir "+row.nombre+" para el laboratorio"}
            value={tab==="medicacion"?medicationOrderTotal(line,ids):line.units??0}
            onFocus={pauseOrderSorting} onBlur={resumeOrderSorting}
            onChange={e=>updateLine(row,e.target.value,tab==="medicacion"?"total":null)}/>
           {row._visualGroupFirst&&row._visualGroupSize>1&&groupOrderTotals.get(row._visualGroup)!=null&&
            <small className="fm-lab-order-group-sum"
             title="Suma de las unidades a pedir de todas las referencias del grupo, incluidas R1/R2 y dúplos. Cada CN conserva su cantidad individual.">
             Grupo: {fmt(groupOrderTotals.get(row._visualGroup))}
            </small>}
          </div>
         </td>}
         <td className="fm-lab-order-commentcol">
          <button type="button" disabled={loading} onClick={()=>openComment(row)}
           className={"fm-lab-comment-link"+(line.comment?.trim()?" has-comment":"")}
           aria-label={(line.comment?.trim()?"Ver o editar":"Añadir")+" comentario para "+row.nombre}
           title={line.comment?.trim()?"Comentario guardado en esta línea":"Añadir comentario"}>
           <MessageSquareText size={14}/>{line.comment?.trim()?"Con comentario":"Comentar"}
          </button>
         </td>
       </tr>;
      })}
      {viewport.virtualized&&viewport.bottom>0&&<tr className="fm-lab-virtual-spacer" aria-hidden="true"
       style={{height:viewport.bottom}}><td colSpan={matrixColumnCount}
         style={{height:viewport.bottom}}/></tr>}
      {!loading&&currentRows.length>0&&!tableVisibleRows.length&&<tr>
        <td colSpan={matrixColumnCount}>Ningún artículo coincide con los filtros de columna.</td>
       </tr>}
       {!loading&&!currentRows.length&&<tr><td colSpan={matrixColumnCount}>
       <div className="fm-lab-order-noresults">
        <strong>{isCrossSearch?"No hay productos que coincidan con la búsqueda":tab==="parafarmacia"?
         "Sin referencias de parafarmacia en este laboratorio":
         "Sin medicamentos asociados a este laboratorio"}</strong>
        <span>{isCrossSearch?"Prueba otra descripción, otro CN o EAN, o cambia entre Medicación y Parafarmacia.":tab==="parafarmacia"?
         "Los medicamentos del nomenclátor AEMPS aparecen en la pestaña Medicación. Se incluyen artículos del catálogo del laboratorio incluso si no han tenido ventas.":
         "Comprueba que el nomenclátor AEMPS esté cargado y que el laboratorio aparezca asociado a sus presentaciones."}</span>
        <button type="button" className="btn btn-secondary" onClick={()=>{setTab(tab==="parafarmacia"?"medicacion":"parafarmacia");setError("")}}>
         Ver {tab==="parafarmacia"?"Medicación":"Parafarmacia"}
        </button>
       </div>
      </td></tr>}
      </tbody>
     </table>
    </HorizontalTableScroll>
    {(tableGroups.length>50||tablePageSize!==ALL_LAB_ROWS)&&<nav className="fm-lab-order-pager" aria-label="Páginas del preparador">
     <label>Artículos por página
      <select value={tablePageSize} disabled={loading} onChange={e=>{setTablePageSize(Number(e.target.value));setTablePage(0)}}>
       <option value={ALL_LAB_ROWS}>Todos ({tableVisibleRows.length})</option>
       {[25,50,100,250,500,1000].map(n=><option key={n} value={n}>{n}</option>)}
      </select>
     </label>
     <button type="button" className="btn btn-secondary" disabled={loading||safePage===0}
      onClick={()=>setTablePage(n=>Math.max(0,n-1))}>Anterior</button>
     <span>{tablePageSize===ALL_LAB_ROWS?("Mostrando los "+tablePageRows.length+" artículos"):("Página "+(safePage+1)+" de "+totalPages+" · "+tablePageRows.length+" de "+tableVisibleRows.length+" artículos")}</span>
     <button type="button" className="btn btn-secondary" disabled={loading||safePage>=totalPages-1}
      onClick={()=>setTablePage(n=>Math.min(totalPages-1,n+1))}>Siguiente</button>
    </nav>}
   </div>
   <div className="fm-lab-order-global-comment">
     <label htmlFor="fm-lab-order-global-notes">Comentarios generales del pedido</label>
     <textarea id="fm-lab-order-global-notes" rows={3} maxLength={3000}
      placeholder="Observaciones para el laboratorio, condiciones o instrucciones del pedido…"
      value={globalComment} disabled={!canEdit||loading}
      onChange={e=>{setGlobalComment(e.target.value);setDirty(true);setNotice("")}}/>
    </div>
    <p className="fm-lab-draft-help">{isCrossSearch?"Esta búsqueda reúne productos de distintos laboratorios: puedes revisar cantidades y exportar Excel, pero para guardar o registrar el pedido debes seleccionar un laboratorio.":"Guardar borrador conserva las cantidades y comentarios en la base de datos del cliente, compartidos con los usuarios autorizados. Generar Excel es independiente y no marca el pedido como realizado."}</p>
    <div className="fm-lab-order-actions">
     <button className="btn btn-secondary" type="button" onClick={save}
      disabled={!canEdit||isCrossSearch||busy||loading||!range.valid||!scope||data.metricsUnavailable||hasInvalid}>
      <Save size={16}/> {busy?"Guardando…":"Guardar borrador"}</button>
     <button className="btn btn-primary" type="button" onClick={exportExcel}
      disabled={busy||loading||data.metricsUnavailable||!range.valid||hasInvalid||!data.rows?.length}>
      <Download size={16}/> Generar Excel</button>
     {canEdit&&<button className="btn btn-secondary" type="button"
      onClick={()=>beginRecord(laboratory)} disabled={isCrossSearch||busy||loading||!laboratory||!ids.length}>
      Marcar pedido realizado</button>}
    </div>
    {showMatrixOverlay&&<div className="fm-lab-matrix-overlay fm-lab-order-full-overlay" role="status" aria-live="polite">
     <div className="fm-lab-matrix-loading">
      <LoadingStatus label="Cargando artículos, ventas y stock…"/>
      <span>{data.rows?.length?
       (loadStage==="catalog"?"Preparando los artículos del laboratorio":
        loadStage==="render"?"Preparando la tabla y los totales finales":
        loadStage==="bulk"?"Calculando "+data.rows.length+" artículos en una consulta única":
        "Calculando stock, ventas y totales: "+metricsProgress+" de "+data.rows.length+" artículos"):
       "Preparando los códigos nacionales del laboratorio"}</span>
     </div>
    </div>}
   </div>
   </>}
  </section>
  {commentRow&&<div className="fm-lab-comment-overlay" role="dialog" aria-modal="true"
     aria-label={"Comentario de "+commentRow.nombre}
     onKeyDown={e=>{if(e.key==="Escape")setCommentRow(null)}}>
    <div className="fm-lab-comment-dialog">
     <h2>Comentario del artículo</h2>
     <p>{commentRow.nombre} · {commentRow.cn||commentRow.referencia}</p>
     <textarea autoFocus rows={5} maxLength={2000} value={commentText}
      disabled={!canEdit} onChange={e=>setCommentText(e.target.value)}
      aria-label="Comentario de la línea" placeholder="Añade una observación a esta línea…"/>
     <small>{commentText.length} / 2000 caracteres · Guarda el borrador del pedido para conservar este comentario.</small>
     <div className="fm-lab-comment-actions">
      <button className="btn btn-secondary" type="button" onClick={()=>setCommentRow(null)}>
       {canEdit?"Cancelar":"Cerrar"}</button>
      {canEdit&&<button className="btn btn-primary" type="button" onClick={confirmComment}>Aplicar comentario</button>}
     </div>
    </div>
   </div>}
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
    {recordType==="pedido"&&<p className="fm-muted"><strong>Realizado por:</strong> {userEmail||"Usuario de la sesión"} · Se registrará el correo autenticado y una copia de las líneas del pedido en Compras → Historial de pedidos.</p>}
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
