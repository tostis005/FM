import React,{useEffect,useMemo,useRef,useState} from "react";
import {Download,FileSpreadsheet,Save,Search,ShoppingCart,Upload,RefreshCcw,Settings2} from "lucide-react";
import {ListPagination} from "./ListTable.jsx";
import LaboratoryPicker from "./LaboratoryPicker.jsx";
import {filterGenericOfferGroups,genericOfferOptions} from "./genericOfferFilters.js";
import {ReportPageHeader} from "./ReportControls.jsx";
import {LoadingPanel,KpiValue} from "./LoadingState.jsx";
import {readGenericOfferExcel} from "./genericOffersImport.js";
import {restoreGenericGoal,proposeGenericOrder,genericOrderRows} from "./genericRedirection.js";
import {exportGenericOfferOrders} from "./exportaciones.js";
import {offerSaving,savingsCoverage} from "./genericSavingsView.js";
import "./genericosComparador.css";

const euros=x=>x==null?"—":new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR",maximumFractionDigits:4}).format(Number(x));
const integers=x=>new Intl.NumberFormat("es-ES",{maximumFractionDigits:0}).format(Number(x||0));
const percent=x=>new Intl.NumberFormat("es-ES",{maximumFractionDigits:1}).format(Number(x||0))+" %";
async function request(clientSlug,path,{method="GET",body,signal}={}){
 const response=await fetch(path,{method,signal,credentials:"same-origin",cache:"no-store",
  headers:{"X-Farmetrica-Cliente":clientSlug,...(body?{"Content-Type":"application/json"}:{})},
  ...(body?{body:JSON.stringify(body)}:{})});
 const value=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(value.error||"No se pudo completar la consulta");
 return value;
}
const sourceName=item=>item.name||item.principle||"Presentación sin descripción";
const niceDate=v=>String(v||"").slice(0,10).split("-").reverse().join("/");

export default function GenericosComparador({clientSlug,pharmacies=[],canEdit=false,range,mode="comparador"}){
 const [status,setStatus]=useState(null),[suppliers,setSuppliers]=useState([]);
 const [metaLoading,setMetaLoading]=useState(true),[refresh,setRefresh]=useState(0);
 const [catalog,setCatalog]=useState([]),[catalogBusy,setCatalogBusy]=useState(true);
 const [principle,setPrinciple]=useState(""),
  [strength,setStrength]=useState(""),[form,setForm]=useState(""),[pack,setPack]=useState("");
 const [applied,setApplied]=useState(null),[page,setPage]=useState(0),[pageSize,setPageSize]=useState(100);
 const [soldByGroup,setSoldByGroup]=useState(null),[soldBusy,setSoldBusy]=useState(false),
  [soldError,setSoldError]=useState(""),[soldRetry,setSoldRetry]=useState(0),
  [soldProgress,setSoldProgress]=useState({ready:0,total:0});
 const salesCache=useRef(new Map());
 const [dcpf,setDcpf]=useState(""),[details,setDetails]=useState(null),[detailBusy,setDetailBusy]=useState(false);
 const [redirectPercent,setRedirectPercent]=useState(80),[targetLaboratory,setTargetLaboratory]=useState(""),
  [legacyMultiple,setLegacyMultiple]=useState(false),[history,setHistory]=useState(null),
  [historyBusy,setHistoryBusy]=useState(false),[historyError,setHistoryError]=useState("");
 const historicalRange=range||{valid:false,reason:"Elige un período válido"};
 const [volume,setVolume]=useState(""),[orderUnits,setOrderUnits]=useState({}),[chosenCN,setChosenCN]=useState({});
 const [destinations,setDestinations]=useState({});
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const fileRef=useRef(null);
 const pharmacyScope=pharmacies.map(p=>String(p.id)).join(",");
 useEffect(()=>{setOrderUnits({})},[pharmacyScope]);
 useEffect(()=>{
  const controller=new AbortController();setMetaLoading(true);
  Promise.all([
   request(clientSlug,"/api/genericos/ofertas/estado",{signal:controller.signal}),
   request(clientSlug,"/api/genericos/ofertas/proveedores",{signal:controller.signal})
  ]).then(([a,b])=>{
   if(controller.signal.aborted)return;
   setStatus(a);setSuppliers(b.items||[]);
  }).catch(e=>{if(!controller.signal.aborted)setError(e.message)})
   .finally(()=>{if(!controller.signal.aborted)setMetaLoading(false)});
  return()=>controller.abort();
 },[clientSlug,refresh]);
 useEffect(()=>{
  if(mode!=="comparador")return;
  const controller=new AbortController();setCatalogBusy(true);
  request(clientSlug,"/api/genericos/ofertas/catalogo",{signal:controller.signal})
   .then(v=>{if(!controller.signal.aborted)setCatalog(v.items||[])})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message)})
   .finally(()=>{if(!controller.signal.aborted)setCatalogBusy(false)});
  return()=>controller.abort();
 },[clientSlug,mode,refresh]);
 useEffect(()=>{
  if(!dcpf){setDetails(null);return}
  const controller=new AbortController();setDetailBusy(true);setError("");setDetails(null);setOrderUnits({});
  request(clientSlug,"/api/genericos/ofertas/conjunto/"+encodeURIComponent(dcpf),
   {signal:controller.signal})
   .then(v=>{
    if(controller.signal.aborted)return;
    setDetails(v);
    const visibleLabs=[...new Set((v.offers||[]).filter(o=>o.isGeneric===true).map(o=>o.laboratory))]
     .map(name=>({name}));
    const saved=restoreGenericGoal(v.objectives||[],visibleLabs);
    setTargetLaboratory(saved.laboratory);setRedirectPercent(saved.percent);
    setLegacyMultiple(saved.legacyMultiple);
    setChosenCN(saved.cn&&saved.laboratory?{[saved.laboratory]:saved.cn}:{});
    setDestinations(Object.fromEntries((v.destinations||[]).map(x=>[x.laboratory,String(x.supplierId)])));
    setOrderUnits({});setNotice("");
   }).catch(e=>{if(!controller.signal.aborted)setError(e.message)})
    .finally(()=>{if(!controller.signal.aborted)setDetailBusy(false)});
  return()=>controller.abort();
 },[clientSlug,dcpf,refresh]);
 useEffect(()=>{
  if(mode!=="comparador"||!dcpf||!historicalRange.valid){
   setHistory(null);setHistoryBusy(false);return;
  }
  const controller=new AbortController();
  setHistory(null);setHistoryBusy(true);setHistoryError("");
  const p=new URLSearchParams({desde:historicalRange.from,hasta:historicalRange.to});
  if(pharmacies.length)p.set("farmacias",pharmacies.map(x=>x.id).join(","));
  request(clientSlug,"/api/genericos/ofertas/historico/"+encodeURIComponent(dcpf)+"?"+p,
   {signal:controller.signal})
   .then(v=>{if(!controller.signal.aborted)setHistory(v)})
   .catch(e=>{if(!controller.signal.aborted)setHistoryError(e.message)})
   .finally(()=>{if(!controller.signal.aborted)setHistoryBusy(false)});
  return()=>controller.abort();
 },[clientSlug,dcpf,mode,historicalRange.from,historicalRange.to,
   historicalRange.valid,pharmacyScope,refresh]);
 const selectedGroup=catalog.find(g=>String(g.dcpf)===String(dcpf));
 const principleOptions=useMemo(()=>[
  {key:"",name:"Todas las moléculas"},
  ...genericOfferOptions(catalog,"principle")
   .filter(x=>x!=="Sin principio activo identificado")
   .map(name=>({key:name,name}))
 ],[catalog]);
 const searchScope=useMemo(()=>filterGenericOfferGroups(catalog,{principle}),[catalog,principle]);
 const strengths=useMemo(()=>genericOfferOptions(searchScope,"strength"),[searchScope]);
 const formScope=useMemo(()=>filterGenericOfferGroups(searchScope,{strength}),[searchScope,strength]);
 const forms=useMemo(()=>genericOfferOptions(formScope,"form"),[formScope]);
 const packScope=useMemo(()=>filterGenericOfferGroups(formScope,{form}),[formScope,form]);
 const packs=useMemo(()=>genericOfferOptions(packScope,"pack"),[packScope]);
 const results=useMemo(()=>applied?
  filterGenericOfferGroups(catalog,applied):[],[catalog,applied]);
 const pageCount=pageSize===0?1:Math.max(1,Math.ceil(results.length/pageSize));
 const safePage=Math.min(page,pageCount-1);
 const visibleResults=pageSize===0?results:results.slice(safePage*pageSize,(safePage+1)*pageSize);
 const showResults=()=>{
  setApplied({principle,strength,form,pack});setPage(0);setDcpf("");
  setNotice("");
 };
 // Las ventas se calculan por lotes pequeños y se muestran conforme llegan.
 // No poner toda la tabla en "…" mientras una consulta masiva espera 12 meses.
 const visibleDcpfs=visibleResults.map(item=>String(item.dcpf)).join(",");
 useEffect(()=>{
  if(mode!=="comparador"||!applied||!historicalRange.valid||!visibleDcpfs){
   setSoldByGroup(null);setSoldBusy(false);setSoldError("");
   setSoldProgress({ready:0,total:0});return;
  }
  const controller=new AbortController();
  const keys=visibleDcpfs.split(",");
  const prefix=[clientSlug,historicalRange.from,historicalRange.to,pharmacyScope,refresh].join("|")+"|";
  const found=new Map(),missing=[];
  for(const id of keys){
   const cacheKey=prefix+id;
   if(salesCache.current.has(cacheKey))found.set(id,salesCache.current.get(cacheKey));
   else missing.push(id);
  }
  setSoldByGroup(new Map(found));setSoldError("");
  setSoldProgress({ready:found.size,total:keys.length});
  setSoldBusy(missing.length>0);
  if(!missing.length)return()=>controller.abort();
  const batches=[];
  for(let i=0;i<missing.length;i+=20)batches.push(missing.slice(i,i+20));
  let next=0,completed=found.size,timedOut=false;
  const issues=[];
  // La conexión o una consulta sin respuesta no debe dejar spinners indefinidos.
  const timer=setTimeout(()=>{timedOut=true;controller.abort()},38000);
  const worker=async()=>{
   while(!controller.signal.aborted){
    const index=next++;
    if(index>=batches.length)break;
    const dcpfs=batches[index];
    try{
     const value=await request(clientSlug,"/api/genericos/ofertas/ventas",{
      method:"POST",signal:controller.signal,
      body:{desde:historicalRange.from,hasta:historicalRange.to,dcpfs,
       ...(pharmacies.length?{farmacias:pharmacies.map(p=>Number(p.id))}:{})}
     });
     if(controller.signal.aborted)return;
     if(value.salesAvailable!==true)
      throw Error(value.warning||"No hay ventas importadas para este período");
     const received=new Map((value.items||[]).map(item=>[String(item.dcpf),Number(item.units)]));
     if(dcpfs.some(id=>!received.has(id)))throw Error("La respuesta de ventas está incompleta");
     for(const id of dcpfs)salesCache.current.set(prefix+id,received.get(id));
     setSoldByGroup(prev=>new Map([...(prev||new Map()),...received]));
    }catch(e){
     if(controller.signal.aborted)return;
     issues.push(e.message);
    }finally{
     if(!controller.signal.aborted){
      completed+=dcpfs.length;
      setSoldProgress({ready:completed,total:keys.length});
     }
    }
   }
  };
  Promise.all([worker(),worker()]).then(()=>{
   if(controller.signal.aborted)return;
   if(issues.length)setSoldError(
    "No se pudieron consultar todas las ventas: "+[...new Set(issues)].join(" ") );
  }).catch(e=>{if(!controller.signal.aborted)setSoldError(e.message)})
   .finally(()=>{
    clearTimeout(timer);
    if(!controller.signal.aborted)setSoldBusy(false);
    else if(timedOut){
     setSoldBusy(false);
     setSoldError("La consulta de ventas ha agotado el tiempo de espera. Puedes reintentar.");
    }
   });
  return()=>{clearTimeout(timer);controller.abort()};
 },[mode,clientSlug,visibleDcpfs,historicalRange.valid,historicalRange.from,
  historicalRange.to,pharmacyScope,refresh,soldRetry,Boolean(applied)]);

 const labs=useMemo(()=>{
  const map=new Map();
  for(const offer of details?.offers||[]){
   if(offer.isGeneric!==true)continue;
   if(!map.has(offer.laboratory))map.set(offer.laboratory,[]);
   map.get(offer.laboratory).push(offer);
  }
  return [...map].map(([name,options])=>{
   const sorted=[...options].sort((a,b)=>Number(a.puc)-Number(b.puc)||a.cn.localeCompare(b.cn));
   const selected=sorted.find(o=>o.cn===chosenCN[name])||sorted[0];
   return {name,options:sorted,selected};
  }).sort((a,b)=>Number(a.selected.puc)-Number(b.selected.puc)||a.name.localeCompare(b.name,"es"));
 },[details,chosenCN]);
 const target=labs.find(x=>x.name===targetLaboratory);
 const goalShare=target?redirectPercent:0;
 const suggestion=useMemo(()=>proposeGenericOrder(volume,redirectPercent,
  pharmacies,history?.pharmacies||[]),[volume,redirectPercent,pharmacyScope,history]);
 const assignments=genericOrderRows(labs,pharmacies,orderUnits);
 const active=assignments.filter(x=>x.units>0);
 const best=labs.length?Math.min(...labs.map(x=>Number(x.selected.puc))):null;
 const totalOrderUnits=active.reduce((n,x)=>n+x.units,0);
 const estimated=active.reduce((n,x)=>n+x.cost,0);
 const potentialSaving=target?offerSaving(history,target.selected,redirectPercent):null;
 const historicalPercentiles=[...new Set((history?.pharmacies||[])
  .filter(p=>p.referencePuc!=null).map(p=>p.percentile))];
 const percentileLabel=historicalPercentiles.length===1?
  "P"+historicalPercentiles[0]:historicalPercentiles.length>1?
  "Según farmacia":"P"+Number(history?.policy?.global?.percentile||20);
 const redirectTo=laboratory=>{
  setTargetLaboratory(laboratory);setNotice("");
 };
 const applySuggestion=()=>{
  if(!target||!suggestion.available||suggestion.error||!canEdit)return;
  const old=assignments.find(x=>x.name===target.name);
  if(old?.units>0&&!window.confirm("¿Sustituir las unidades manuales de "+target.name+
   " por la propuesta? Los demás laboratorios no se modificarán."))return;
  setOrderUnits(prev=>({...prev,[target.name]:{...suggestion.distribution}}));
  setNotice("Propuesta aplicada a "+target.name+". Revisa las unidades por farmacia antes de guardar el borrador.");
 };
 const missingDestinations=active.some(x=>!destinations[x.name]);
 const canPrepare=canEdit&&!busy&&active.length>0&&!missingDestinations&&
  range?.valid!==false&&Boolean(range?.from&&range?.to);
 async function importFile(file){
  if(!file)return;
  setBusy(true);setError("");setNotice("");
  try{
   const parsed=await readGenericOfferExcel(file);
   const confirm=window.confirm("Se sustituirán las tarifas de genéricos anteriores de este cliente por "+
    integers(parsed.items.length)+" líneas de "+parsed.tabs.length+
    " laboratorios. Los objetivos vigentes solo se conservan si sus CN siguen disponibles. ¿Continuar?");
   if(!confirm)return;
   const result=await request(clientSlug,"/api/genericos/ofertas/importar",{
    method:"POST",body:{filename:file.name,items:parsed.items}});
   setNotice("Tarifas importadas: "+integers(result.offers)+" ofertas, "+
    integers(result.matched)+" códigos enlazados al Nomenclátor y "+
    integers(result.unmatched)+" sin correspondencia. "+
    integers(result.duplicateRows)+" filas duplicadas idénticas unificadas.");
   setRefresh(x=>x+1);
  }catch(e){setError(e.message)}
  finally{setBusy(false);if(fileRef.current)fileRef.current.value=""}
 }
 async function setDestination(lab,id){
  setBusy(true);setError("");setNotice("");
  try{
   await request(clientSlug,"/api/genericos/ofertas/destinos",{
    method:"PUT",body:{laboratory:lab,supplierId:id}});
   setDestinations(prev=>({...prev,[lab]:id}));
   setNotice("Proveedor del preparador vinculado a "+lab+".");
  }catch(e){setError(e.message)}
  finally{setBusy(false)}
 }
 async function saveGoals(){
  if(!canEdit||busy||!labs.length)return;
  setBusy(true);setError("");setNotice("");
  try{
   const goals=target&&redirectPercent>0?[{
    laboratory:target.name,cn:target.selected.cn,percent:redirectPercent
   }]:[];
   await request(clientSlug,"/api/genericos/ofertas/objetivos/"+encodeURIComponent(dcpf),
    {method:"PUT",body:{goals}});
   setLegacyMultiple(false);
   setNotice(goals.length?"Objetivo guardado: "+percent(redirectPercent)+" hacia "+target.name+
    ". El "+percent(100-redirectPercent)+" restante queda sin destino automático.":"Objetivo de redirección eliminado.");
  }catch(e){setError(e.message)}
  finally{setBusy(false)}
 }
 function orderSheets(){
  return active.map(x=>({
   laboratory:x.name,
   lines:[{cn:x.selected.cn,name:x.selected.name,puc:x.selected.puc,dcpf,
    pharmacies:pharmacies.map(p=>({
     id:p.id,name:p.name||"Farmacia "+p.id,units:Number(x.distribution[String(p.id)]||0)
    }))}]
  }));
 }
 async function exportExcel(){
  if(!active.length)return;
  setBusy(true);setError("");setNotice("");
  try{
   await exportGenericOfferOrders(orderSheets(),"farmetrica-propuesta-genericos-"+dcpf+".xlsx");
   setNotice("Excel de propuesta generado por laboratorio. No supone un pedido enviado o confirmado.");
  }catch(e){setError(e.message)}
  finally{setBusy(false)}
 }
 async function prepareDrafts(){
  if(!canPrepare)return;
  const count=active.reduce((n,x)=>n+x.units,0);
  if(!window.confirm("¿Añadir "+integers(count)+" unidades a los borradores del preparador? "+
   "Se conservarán los demás artículos y se sustituirán las cantidades de CN ya existentes. "+
   "Este paso NO envía pedidos a los laboratorios."))return;
  setBusy(true);setError("");setNotice("");
  try{
   const result=await request(clientSlug,"/api/genericos/ofertas/preparar",{
    method:"POST",body:{dcpf,from:range.from,to:range.to,
     pharmacies:pharmacies.map(p=>Number(p.id)),
     entries:active.map(x=>({laboratory:x.name,cn:x.selected.cn,
      unitsByPharmacy:Object.fromEntries(pharmacies.map(p=>
       [String(p.id),Number(x.distribution[String(p.id)]||0)]))}))}});
   setNotice("Añadido a "+result.laboratories.length+" borradores de laboratorio. "+
    (result.replaced.length?result.replaced.length+" CN existentes actualizados. ":"")+
    "Revísalos en Compras → Preparador de pedidos antes de confirmar o enviar.");
  }catch(e){setError(e.message)}
  finally{setBusy(false)}
 }
 if(mode==="config")return <div className="fm-gof">
  <ReportPageHeader title="Genéricos · Configuración de tarifas"
   description="Actualización de ofertas comerciales por laboratorio, privadas para este cliente"
   refreshing={metaLoading} onRefresh={()=>setRefresh(x=>x+1)}/>
  {error&&<p role="alert" className="fm-gof-message fm-gof-error">{error}</p>}
  {notice&&<p role="status" className="fm-gof-message">{notice}</p>}
  <div className="fm-gof-kpis">
   {[
    ["Ofertas cargadas",status?.summary?.total],
    ["CN vinculados a AEMPS",status?.summary?.matched],
    ["Conjuntos relacionados",status?.summary?.groups],
    ["Laboratorios",status?.summary?.laboratories]
   ].map(([label,value])=><div className="card fm-gof-kpi" key={label}>
    <small>{label}</small><KpiValue loading={metaLoading} label={label}
     loadingText="Consultando tarifas…" value={integers(value)}/></div>)}
  </div>
  <section className="card fm-gof-config">
   <div className="section-heading"><div><h2><Settings2 size={19}/> Archivo de tarifas vigente</h2>
    <p>Los gestores pueden sustituir las tarifas cuando los laboratorios comuniquen nuevas condiciones. El comparador leerá automáticamente los precios actualizados.</p></div></div>
   <div className="fm-gof-config-file">
    <div><small>Última importación</small>
     <strong>{status?.summary?.filename||"Sin archivo importado"}</strong>
     <span>{status?.summary?.importedAt?niceDate(status.summary.importedAt):"Todavía no existen tarifas cargadas"}</span></div>
    <label className="btn btn-primary fm-gof-upload">
     <Upload size={16}/>{busy?"Importando…":"Actualizar fichero Excel"}
     <input ref={fileRef} type="file" accept=".xlsx" disabled={!canEdit||busy}
      onChange={e=>void importFile(e.target.files?.[0]||null)}/></label>
   </div>
   <p className="fm-gof-legal">El archivo debe contener una pestaña por laboratorio, con Código nacional, PVL, descuento, Neto, IVA y PUC. La importación sustituye las tarifas anteriores del cliente, pero no modifica el Nomenclátor ni las compras históricas. Los objetivos guardados se conservan siempre que sigan existiendo sus CN y conjuntos equivalentes.</p>
   <h3>Laboratorios presentes en la tarifa</h3>
   {metaLoading?<LoadingPanel kind="table" label="Consultando tarifas vigentes…" rows={4}/>:
    <div className="fm-gof-source-scroll"><table className="fm-gof-source-table">
     <thead><tr><th>Laboratorio (hoja Excel)</th><th>Referencias de tarifa</th></tr></thead>
     <tbody>{(status?.laboratories||[]).map(x=><tr key={x.name}>
      <td>{x.name}</td><td>{integers(x.offers)}</td>
     </tr>)}
     {!(status?.laboratories||[]).length&&<tr><td colSpan={2}>
      Todavía no se han importado tarifas de este cliente.</td></tr>}
     </tbody>
    </table></div>}
  </section>
 </div>;

 return <div className="fm-gof">
  <ReportPageHeader title="Genéricos · Comparador de compras"
   description="Tarifas de laboratorio vinculadas por código nacional y conjunto DCPF de AEMPS"
   refreshing={metaLoading||detailBusy} onRefresh={()=>setRefresh(x=>x+1)}/>
  {error&&<p role="alert" className="fm-gof-message fm-gof-error">{error}</p>}
  {notice&&<p role="status" className="fm-gof-message">{notice}</p>}
  <div className="fm-gof-kpis">
   {[
    ["Ofertas del archivo",status?.summary?.total],
    ["CN con correspondencia",status?.summary?.matched],
    ["Conjuntos relacionados",status?.summary?.groups],
    ["Laboratorios con tarifa",status?.summary?.laboratories]
   ].map(([label,value])=><div className="card fm-gof-kpi" key={label}>
    <small>{label}</small><KpiValue loading={metaLoading} label={label} loadingText="Calculando…" value={integers(value)}/>
   </div>)}
  </div>
  {!metaLoading&&status?.summary?.filename&&
   <p className="fm-gof-hint">Tarifas vigentes: <strong>{status.summary.filename}</strong>. Los gestores pueden actualizarlas desde «Configuración de tarifas».</p>}
  <section className="card fm-gof-picker">
   <div className="section-heading"><div><h2>1. Busca y selecciona un genérico</h2>
    <p>Elige una molécula y, si lo necesitas, acota por dosis, forma o envase.</p></div></div>
   <form className="fm-gof-filters" onSubmit={e=>{e.preventDefault();showResults()}}>
    <label>Molécula
     <LaboratoryPicker laboratories={principleOptions} selected={principle}
      onSelect={value=>{setPrinciple(value);setStrength("");setForm("");setPack("")}}
      loading={catalogBusy} ariaLabel="Buscar y seleccionar molécula"
      emptySelectionAsPlaceholder
      placeholder="Todas las moléculas · escribe para filtrar" optionsLabel="Moléculas"
      emptyMessage="No se han encontrado moléculas."
      loadingMessage="Cargando moléculas…" showAllOnFocus/>
    </label>
    <label>Dosis o concentración
     <select value={strength} onChange={e=>{setStrength(e.target.value);setForm("");setPack("")}}>
      <option value="">Todas las dosis</option>
      {strengths.map(x=><option value={x} key={x}>{x}</option>)}
     </select></label>
    <label>Forma farmacéutica
     <select value={form} onChange={e=>{setForm(e.target.value);setPack("")}}>
      <option value="">Todas las formas</option>
      {forms.map(x=><option value={x} key={x}>{x}</option>)}
     </select></label>
    <label>Envase / presentación
     <select value={pack} onChange={e=>setPack(e.target.value)}>
      <option value="">Todos los envases</option>
      {packs.map(x=><option value={x} key={x}>{x}</option>)}
     </select></label>
    <div className="fm-gof-filter-actions">
     <button type="button" className="btn btn-secondary" onClick={()=>{
      setPrinciple("");setStrength("");setForm("");setPack("");
      setApplied(null);setDcpf("");setPage(0);
     }}>Limpiar filtros</button>
     <button type="submit" className="btn btn-primary" disabled={catalogBusy}>
      <Search size={16}/> Mostrar resultados</button>
    </div>
   </form>
   {catalogBusy?<LoadingPanel kind="table" label="Relacionando ofertas y presentaciones oficiales…" rows={4}/>:
    applied?<div className="fm-gof-catalog">
     {soldError&&<div role="alert" className="fm-gof-message fm-gof-error">
      No se han podido obtener las unidades vendidas: {soldError} 
      <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setSoldRetry(n=>n+1)}>
       Reintentar ventas</button>
     </div>}
     <div className="fm-gof-catalog-title"><h3>Presentaciones encontradas</h3>
      <span>{integers(results.length)} conjuntos con ofertas de laboratorio{soldBusy?" · Consultando ventas "+soldProgress.ready+"/"+soldProgress.total:""}</span></div>
     <div className="fm-gof-catalog-scroll"><table className="fm-gof-catalog-table">
      <thead><tr><th>Presentación equivalente</th><th>Dosis</th>
       <th>Forma</th><th>Envase</th><th>Laboratorios</th><th>Vendidas (uds.)</th><th>Menor PUC ofertado</th><th/></tr></thead>
      <tbody>{visibleResults.map(item=><tr key={item.dcpf}
       className={String(dcpf)===String(item.dcpf)?"is-selected":""}>
       <td><strong>{sourceName(item)}</strong></td>
       <td>{item.strength||"—"}</td><td>{item.form||"—"}</td>
       <td>{item.pack||"—"}</td><td>{integers(item.laboratories)}</td>
       <td className="fm-gof-num" title="Unidades netas vendidas en el período seleccionado">
        {soldByGroup?.has(String(item.dcpf))?integers(soldByGroup.get(String(item.dcpf))):
         soldBusy?<span className="fm-gof-cell-loading" aria-label="Consultando unidades vendidas">
          <span className="fm-load-spinner" aria-hidden="true"/> Calculando</span>:"—"}
       </td>
       <td className="fm-gof-num">{euros(item.bestPuc)}</td>
       <td><button type="button" className="btn btn-secondary btn-sm" onClick={()=>{
        setDcpf(item.dcpf);setVolume("");setNotice("");setOrderUnits({});
        document.getElementById("fm-gof-detail")?.scrollIntoView({behavior:"smooth",block:"start"});
       }}>{String(dcpf)===String(item.dcpf)?"Seleccionado":"Comparar precios"}</button></td>
      </tr>)}
      {!results.length&&<tr><td colSpan={8}>No hay presentaciones con tarifa para estos filtros. Prueba con otra dosis o amplía la búsqueda.</td></tr>}
      </tbody>
     </table></div>
     {results.length>0&&<ListPagination total={results.length} page={safePage}
      pageSize={pageSize} pageSizes={[25,50,100,500,0]}
      onPageChange={setPage} onPageSizeChange={size=>{setPageSize(size);setPage(0)}}
      label="conjuntos"/>}
    </div>:<p className="fm-gof-hint">Selecciona, por ejemplo, «Paracetamol» y pulsa «Mostrar resultados» para ver todas las dosis y presentaciones que tienen tarifas importadas.</p>}
   {!metaLoading&&status?.summary?.total===0&&
    <p className="fm-gof-hint">Todavía no hay tarifas importadas. Un gestor puede cargarlas desde «Configuración de tarifas».</p>}
   {!!status?.summary?.total&&status.summary.matched<status.summary.total&&
    <p className="fm-gof-hint">{integers(status.summary.total-status.summary.matched)} CN del archivo no aparecen en el Nomenclátor AEMPS activo y no se incluyen en comparaciones clínicas.</p>}
  </section>
  {detailBusy?<LoadingPanel kind="table" label="Relacionando CN, DCPF y ofertas de laboratorio…" rows={5}/>:
  dcpf&&details&&<section id="fm-gof-detail" className="card fm-gof-results">
   <div className="section-heading"><div><h2>2. Comparativa y objetivo de redirección</h2>
    <p>{selectedGroup?sourceName(selectedGroup):"Conjunto DCPF "+dcpf} · {labs.length} laboratorios con ofertas EFG. Selecciona el laboratorio al que quieres dirigir las próximas compras.</p></div></div>
   <div className="fm-gof-history-controls">
    <div className="fm-gof-history-period">
     <small>Período de ventas y simulación</small>
     <strong>{historicalRange.valid?niceDate(historicalRange.from)+" – "+niceDate(historicalRange.to):"Período pendiente"}</strong>
     <span>Modifica el período arriba (12 meses por defecto).</span>
    </div>
    <label>Porcentaje a redirigir
     <div className="fm-gof-redirection"><input type="range" min="0" max="100" step="5"
      value={redirectPercent} aria-label="Porcentaje de redirección"
      onChange={e=>setRedirectPercent(Number(e.target.value))}/>
      <input type="number" min="0" max="100" step="1" value={redirectPercent}
       aria-label="Porcentaje numérico de redirección" onChange={e=>
        setRedirectPercent(Math.min(100,Math.max(0,Number(e.target.value)||0)))}/><span>%</span>
     </div></label>
   </div>
   {!historicalRange.valid&&<p role="alert" className="fm-gof-message fm-gof-error">{historicalRange.reason}</p>}
   {historyBusy?<LoadingPanel kind="kpis" label="Calculando ventas y precios de referencia…" rows={2}/>:
    historyError?<p role="alert" className="fm-gof-message fm-gof-error">El histórico no está disponible: {historyError}. Puedes seguir consultando las tarifas.</p>:
    history&&<div className="fm-gof-history-kpis">
     <div><small>Unidades vendidas · período seleccionado</small>
      <strong>{history.salesAvailable?integers(history.soldUnits):"—"}</strong></div>
     <div><small>Venta neta histórica</small><strong>{history.salesAvailable?euros(history.salesRevenue):"—"}</strong></div>
     <div><small>PUC ref. {percentileLabel} · sin IVA</small>
      <strong>{history.referencePuc==null?"—":euros(history.referencePuc)}</strong></div>
     <div><small>Ahorro potencial con el reparto</small><strong>{potentialSaving===null?"—":euros(potentialSaving)}</strong></div>
    </div>}
   {history?.warning&&<p className="fm-gof-hint">{history.warning}</p>}
   {history&&history.referenceUnits<Number(history.soldUnits||0)&&<p className="fm-gof-hint">
    Referencia de precio calculable para el {savingsCoverage(history)} % de las unidades vendidas.
    Sin al menos 3 recepciones válidas no se estima ahorro para las otras farmacias.
   </p>}
   {labs.length?<div className="fm-gof-scroll"><table className="fm-gof-table">
    <thead><tr><th>Laboratorio de la oferta</th><th>Medicamento / CN</th><th>PVL</th>
     <th>Dto.</th><th>Neto</th><th>PUC con IVA</th><th>Frente al mejor</th>
     <th>Redirigir compras</th><th>Objetivo (%)</th><th>Ahorro histórico estimado</th><th>Uds. previstas</th><th>Proveedor del pedido</th></tr></thead>
    <tbody>{assignments.map(row=><tr key={row.name} className={row.percent>0?"fm-gof-selected-lab":""}>
     <td><strong>{row.name}</strong>
      {row.options.length>1&&<small>{row.options.length} CN del conjunto</small>}</td>
     <td><select aria-label={"CN de "+row.name} value={row.selected.cn}
      onChange={e=>{setChosenCN(prev=>({...prev,[row.name]:e.target.value}));setNotice("")}}>
      {row.options.map(x=><option key={x.cn} value={x.cn}>{x.cn} · {x.name}</option>)}
     </select>
     <small>Comercializa: {row.selected.officialLaboratory||"No consta"}</small>
     {row.selected.holderLaboratory&&row.selected.holderLaboratory!==row.selected.officialLaboratory&&
      <small>Titular: {row.selected.holderLaboratory}</small>}
     {(row.selected.minimum||row.selected.pack||row.selected.box)&&
      <small>Pedido: mínimo {row.selected.minimum||"—"} · pack {row.selected.pack||"—"} · caja {row.selected.box||"—"}</small>}</td>
     <td className="fm-gof-num">{euros(row.selected.pvl)}</td>
     <td className="fm-gof-num">{percent(row.selected.discount*100)}</td>
     <td className="fm-gof-num">{euros(row.selected.net)}</td>
     <td className="fm-gof-num"><strong>{euros(row.selected.puc)}</strong>
      {row.selected.puc===best&&<small>Menor precio</small>}</td>
     <td className="fm-gof-num">{row.selected.puc===best?"—":euros(row.selected.puc-best)+" / ud."}</td>
     <td><button type="button" className={"btn btn-sm "+(row.percent>0?"btn-primary":"btn-secondary")}
      disabled={!canEdit||busy} onClick={()=>redirectTo(row.name)}>
      {row.percent>0?"Destino seleccionado":"Redirigir "+redirectPercent+" % aquí"}</button>
      {row.selected.puc===best&&<small>Precio más bajo del conjunto</small>}</td>
     <td><div className="fm-gof-target">
      <input type="range" min="0" max="100" step="1" value={row.percent} disabled={!canEdit}
       aria-label={"Porcentaje objetivo "+row.name}
       onChange={e=>{setShares(prev=>({...prev,[row.name]:Number(e.target.value)}));setNotice("")}}/>
      <input type="number" min="0" max="100" step="0.1" value={row.percent} disabled={!canEdit}
       aria-label={"Porcentaje numérico "+row.name}
       onChange={e=>{setShares(prev=>({...prev,[row.name]:Math.max(0,Math.min(100,Number(e.target.value)||0))}));setNotice("")}}/>
      <span>%</span></div></td>
     <td className="fm-gof-num">{historyBusy?"Calculando…":
      offerSaving(history,row.selected,row.percent)===null?"—":
      euros(offerSaving(history,row.selected,row.percent))}</td>
     <td className="fm-gof-num">{planned.error?"—":integers(row.units)}</td>
     <td><select aria-label={"Proveedor de pedido "+row.name}
      value={destinations[row.name]||""} disabled={!canEdit||busy}
      onChange={e=>void setDestination(row.name,e.target.value)}>
      <option value="">Sin vincular</option>
      {suppliers.map(s=><option key={s.id} value={String(s.id)}>{s.name}</option>)}
     </select>
     {!destinations[row.name]&&row.units>0&&<small>Vinculación necesaria para preparar pedido</small>}</td>
    </tr>)}</tbody>
   </table></div>:<p className="fm-gof-hint">No hay ofertas EFG del catálogo oficial para esta presentación.</p>}
   <p className="fm-gof-legal">El ahorro estimado compara el precio neto ofertado (sin IVA) con el PUC de referencia {percentileLabel} obtenido de recepciones reales según la política comercial de cada farmacia. Se aplica solo al porcentaje elegido de las unidades vendidas del período; es una proyección de futuras compras, no un ahorro realizado. El PUC de la tabla incluye IVA. La equivalencia DCPF no implica por sí sola sustitución legal ni disponibilidad.</p>
  </section>}
  {!!labs.length&&<section className="card fm-gof-plan">
   <div className="section-heading"><div><h2>3. Define el reparto y prepara los pedidos</h2>
    <p>Indica las unidades totales que quieres planificar; el porcentaje no asignado se mantiene sin decisión de compra.</p></div></div>
   <div className="fm-gof-plan-input">
    <label>Unidades previstas del conjunto
     <input type="number" min="0" max="999999" step="1" placeholder="Ej.: 100"
      value={volume} onChange={e=>{setVolume(e.target.value);setOverrides({});setNotice("")}}/></label>
    <div><small>Porcentaje distribuido</small><strong className={goalShare>100?"fm-gof-invalid":""}>
     {percent(goalShare)}</strong></div>
    <div><small>Sin asignar</small><strong>{goalShare>100?"—":percent(100-goalShare)}</strong></div>
    <div><small>Unidades asignadas</small><strong>{planned.error?"—":integers(active.reduce((n,x)=>n+x.units,0))}</strong></div>
    <div><small>Coste orientativo del reparto</small><strong>{planned.error?"—":euros(estimated)}</strong></div>
   </div>
   {goalShare>100&&<p className="fm-gof-message fm-gof-error">Los objetivos superan el 100 %. Reduce alguna cuota.</p>}
   {planned.error&&<p className="fm-gof-hint">{planned.error}</p>}
   {!planned.error&&active.map(row=><div className="fm-gof-lab-plan" key={row.name}>
    <div><strong>{row.name}</strong> · CN {row.selected.cn} · {percent(row.percent)} · {integers(row.units)} unidades
     <small>PUC {euros(row.selected.puc)}</small></div>
    <div className="fm-gof-pharmacy-inputs">
     {pharmacies.map(p=><label key={p.id}>{p.name||"Farmacia "+p.id}
      <input type="number" min="0" max="999999" step="1"
       value={row.distribution[String(p.id)]??0} disabled={!canEdit}
       onChange={e=>{
        const value=Math.max(0,Math.min(999999,Math.trunc(Number(e.target.value)||0)));
        setOverrides(prev=>({...prev,[row.name]:{...row.distribution,[String(p.id)]:value}}));
        setNotice("");
       }}/></label>)}
    </div>
    {!row.distributionValid&&<small className="fm-gof-invalid">El reparto por farmacias debe sumar exactamente {integers(row.units)} unidades.</small>}
    {(row.selected.minimum&&row.units%row.selected.minimum!==0||
      row.selected.pack&&row.units%row.selected.pack!==0)&&
     <small className="fm-gof-hint">Revisa mínimos y múltiplos de pedido antes de confirmar con el laboratorio.</small>}
   </div>)}
   <div className="fm-gof-actions">
    {canEdit&&<button type="button" className="btn btn-secondary"
     onClick={()=>void saveGoals()} disabled={busy||goalShare>100||!labs.length}>
     <Save size={16}/> Guardar porcentajes objetivo</button>}
    <button type="button" className="btn btn-secondary" onClick={()=>void exportExcel()}
     disabled={busy||Boolean(planned.error)||!active.length||invalidDistribution}>
     <Download size={16}/> Exportar propuesta Excel</button>
    {canEdit&&<button type="button" className="btn btn-primary" onClick={()=>void prepareDrafts()}
     disabled={!canPrepare}>
     <ShoppingCart size={16}/> Añadir al preparador de pedidos</button>}
   </div>
   <p className="fm-gof-legal">El reparto inicial entre farmacias es uniforme y editable: comprueba la demanda y las existencias de cada centro. Preparar un borrador no envía pedidos ni confirma una compra. Revisa el pedido definitivo en Compras → Preparador.</p>
  </section>}
 </div>;
}