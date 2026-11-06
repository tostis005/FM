import React,{useEffect,useMemo,useRef,useState} from "react";
import {Check,Plus,Search,Trash2} from "lucide-react";
import DetalleVentas from "./DetalleVentas.jsx";
import {LoadingFrame,LoadingStatus} from "./LoadingState.jsx";
import {parsePromotionCNs,selectablePromotionProducts,mergePromotionSelection,promotionProductName,promotionProductLabel,UNKNOWN_PRODUCT_NAME} from "./simuladorProductSelection.js";
import {simulatorPeriods,validSimulatorPeriod,simulatorTarget,first} from "./simuladorLogic.js";
import "./ObjetivosPromociones.css";

const CN=value=>/^\d{6}$/.test(value||"");
const num=value=>new Intl.NumberFormat("es-ES",{maximumFractionDigits:0}).format(Number(value)||0);
const madridToday=()=>new Intl.DateTimeFormat("sv-SE",{
 timeZone:"Europe/Madrid",year:"numeric",month:"2-digit",day:"2-digit"
}).format(new Date());
const monthAtMadrid=()=>{
 const today=madridToday();
 return {year:Number(today.slice(0,4)),month:Number(today.slice(5,7))-1};
};
async function post(clientSlug,path,body,signal){
 const response=await fetch(path,{method:"POST",credentials:"same-origin",signal,
  headers:{"Content-Type":"application/json","X-Farmetrica-Cliente":clientSlug},
  body:JSON.stringify(body)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||"No se pudo completar la consulta");
 return data;
}
export default function ObjetivosPromociones({clientSlug,pharmacies=[],canManage=false,onCreatePromotion}){
 const active=useMemo(()=>pharmacies.filter(f=>f.active!==false),[pharmacies]);
 const [selectedPharmacies,setSelectedPharmacies]=useState(()=>active.map(f=>String(f.id)));
 const initializedPharmacies=useRef(active.length>0);
 const [mode,setMode]=useState("search");
 const [search,setSearch]=useState("");
 const [bulk,setBulk]=useState("");
 const [searchNonce,setSearchNonce]=useState(0);
 const [searchPage,setSearchPage]=useState(0);
 const [hasMore,setHasMore]=useState(false);
 const [results,setResults]=useState([]);
 const [selected,setSelected]=useState([]);
 const [searchBusy,setSearchBusy]=useState(false);
 const [unavailableCount,setUnavailableCount]=useState(0);
 const [bulkBusy,setBulkBusy]=useState(false);
 const [bulkError,setBulkError]=useState("");
 const [searchError,setSearchError]=useState("");
 const [historyBusy,setHistoryBusy]=useState(false);
 const [historyError,setHistoryError]=useState("");
 const [historical,setHistorical]=useState({});
 const [baseline,setBaseline]=useState("previous");
 const [customFrom,setCustomFrom]=useState(()=>{const {year,month}=monthAtMadrid();return first(year,month);});
 const [customTo,setCustomTo]=useState(madridToday);
 const [rateByPharmacy,setRateByPharmacy]=useState({});
 const [manualTargets,setManualTargets]=useState({});
 const {codes,invalid}=useMemo(()=>parsePromotionCNs(bulk),[bulk]);
 const selectedCNs=useMemo(()=>selected.map(x=>x.cn),[selected]);
 const selectedKey=selectedCNs.join(",");
 const pharmacyKey=selectedPharmacies.join(",");
 const today=useMemo(madridToday,[]);
 const periods=useMemo(()=>simulatorPeriods(today,customFrom,customTo),[today,customFrom,customTo]);
 const chosen=periods.find(p=>p.id===baseline)||periods[0];
 const validRange=validSimulatorPeriod(customFrom,customTo);

 useEffect(()=>{
  if(!initializedPharmacies.current&&active.length){
   initializedPharmacies.current=true;
   setSelectedPharmacies(active.map(f=>String(f.id)));
   return;
  }
  setSelectedPharmacies(ids=>ids.filter(id=>active.some(f=>String(f.id)===id)));
 },[active]);

 // Cada modo busca por su cuenta: nunca se aplican AND/OR implícitos
 // entre un texto y la lista de CN pegados.
 useEffect(()=>{
  const term=search.trim();
  if(mode!=="search"||!term){
   setResults([]);setHasMore(false);setSearchBusy(false);setSearchError("");setUnavailableCount(0);return;
  }
  if(term.length<2){setResults([]);setHasMore(false);setSearchBusy(false);setSearchError("");
   setUnavailableCount(0);return;}
  const controller=new AbortController();
  let timedOut=false;
  if(searchPage===0){setResults([]);setHasMore(false);setUnavailableCount(0);}
  setSearchBusy(true);setSearchError("");
  const deadline=setTimeout(()=>{timedOut=true;controller.abort();},10500);
  const timer=setTimeout(()=>{
   post(clientSlug,"/api/ventas/objetivos/buscar",{search:term,cns:[],page:searchPage},controller.signal)
    .then(data=>{
     if(controller.signal.aborted)return;
     const {products,unavailableCount:missing}=selectablePromotionProducts(data.products);
     setResults(previous=>searchPage===0?products:(()=>{
      const seen=new Set(previous.map(item=>item.cn));
      return [...previous,...products.filter(item=>!seen.has(item.cn))];
     })());
     setHasMore(Boolean(data.hasMore));setUnavailableCount(previous=>searchPage===0?missing:previous+missing);
     if(data.partial)setSearchError("Resultados parciales: prueba una búsqueda más específica.");
    })
    .catch(error=>{
     if(timedOut)setSearchError("La búsqueda ha tardado demasiado. Prueba con un nombre o CN más específico.");
     else if(!controller.signal.aborted){setSearchError(error.message);setResults([]);}
    })
    .finally(()=>{clearTimeout(deadline);if(!controller.signal.aborted||timedOut)setSearchBusy(false);});
  },420);
  return()=>{clearTimeout(timer);clearTimeout(deadline);controller.abort();};
 },[clientSlug,search,mode,searchNonce,searchPage]);

 useEffect(()=>{
  if(!selectedCNs.length||!selectedPharmacies.length||!validRange){
   setHistorical({});setHistoryBusy(false);setHistoryError("");return;
  }
  const controller=new AbortController();
  setHistoryBusy(true);setHistoryError("");
  post(clientSlug,"/api/ventas/objetivos/historico",{
   cns:selectedCNs,pharmacyIds:selectedPharmacies,periods
  },controller.signal).then(data=>{
   if(controller.signal.aborted)return;
   setHistorical(data.periods||{});
  }).catch(error=>{
   if(!controller.signal.aborted){setHistoryError(error.message);setHistorical({});}
  }).finally(()=>{if(!controller.signal.aborted)setHistoryBusy(false);});
  return()=>controller.abort();
 },[clientSlug,selectedKey,pharmacyKey,customFrom,customTo]);

 // Recalcular objetivos cuando cambian productos, la referencia o las fechas
 // del período seleccionado. No sobrescribir una edición manual al recibir datos.
 useEffect(()=>{setManualTargets({});},[selectedKey,baseline,baseline==="custom"?customFrom:"",baseline==="custom"?customTo:""]);

 const query=useMemo(()=>selectedCNs.length&&selectedPharmacies.length&&validRange?
  {cns:[...selectedCNs],start:customFrom,end:customTo}:null,
  [selectedKey,pharmacyKey,customFrom,customTo,validRange]);
 const units=(id,periodId)=>Number(historical[periodId]?.[id]||0);
 const rate=id=>Number(rateByPharmacy[id]??5);
 const proposal=id=>simulatorTarget(units(id,chosen.id),rate(id));
 const target=id=>manualTargets[id]===undefined?proposal(id):manualTargets[id];
 const totals=periodId=>selectedPharmacies.reduce((n,id)=>n+units(id,periodId),0);
 const totalTarget=()=>selectedPharmacies.reduce((n,id)=>n+(Number(target(id))||0),0);
 const canCreate=Boolean(canManage&&selectedCNs.length&&selectedPharmacies.length&&
  validRange&&!historyBusy&&!historyError);
 const chosenPharmacies=active.filter(f=>selectedPharmacies.includes(String(f.id)));
 function append(items){setSelected(current=>mergePromotionSelection(current,items));}
 async function addPastedCNs(){
  if(bulkBusy||!codes.length||invalid.length||codes.length>500)return;
  const requested=[...codes];
  append(requested.map(cn=>({cn,description:UNKNOWN_PRODUCT_NAME})));
  setBulk("");setBulkError("");setBulkBusy(true);
  // Añadir es instantáneo; recuperar la ficha es solo un enriquecimiento.
  try{
   const data=await post(clientSlug,"/api/ventas/objetivos/buscar",{search:"",cns:requested});
   const byCode=new Map((data.products||[]).filter(item=>CN(item.cn)&&
    requested.includes(item.cn)).map(item=>[item.cn,item]));
   setSelected(current=>current.map(item=>{
    const known=byCode.get(item.cn);
    return known&&promotionProductName(item)===UNKNOWN_PRODUCT_NAME?
     {...item,description:promotionProductName(known),supplier:known.supplier||null,
       referenceType:known.referenceType||null}:item;
   }));
  }catch{
   setBulkError("Los CN están añadidos. No se han podido recuperar algunos nombres del catálogo.");
  }finally{setBulkBusy(false);}
 }
 function create(){
  if(!canCreate)return;
  onCreatePromotion?.({
   cns:[...selectedCNs],
   cnDescriptions:Object.fromEntries(selected.map(x=>[x.cn,x.description])),
   targets:Object.fromEntries(selectedPharmacies.map(id=>[id,target(id)])),
   objectiveBaseline:chosen.id,
   objectiveBaselineRange:{from:chosen.from,to:chosen.to},
   objectiveRates:Object.fromEntries(selectedPharmacies.map(id=>[id,rate(id)]))
  });
 }
 return <div className="fm-objectives">
  <div className="fm-objectives-intro">
   <div><h1>Simulador de promociones</h1>
    <p>Selecciona artículos, consulta sus ventas y define los objetivos por farmacia.</p></div>
  </div>
  <section className="card fm-objectives-card">
   <h2>1. Seleccionar productos</h2>
   <div className="fm-objectives-methods" role="tablist" aria-label="Forma de seleccionar productos">
    <button type="button" role="tab" id="simulator-search-tab" aria-controls="simulator-search-panel"
     aria-selected={mode==="search"} className={mode==="search"?"active":""} onClick={()=>setMode("search")}>
     <Search size={15}/> Buscar artículos</button>
    <button type="button" role="tab" id="simulator-paste-tab" aria-controls="simulator-paste-panel"
     aria-selected={mode==="paste"} className={mode==="paste"?"active":""} onClick={()=>setMode("paste")}>
     <Plus size={15}/> Pegar lista de CN</button>
   </div>
   {mode==="search"?<div id="simulator-search-panel" role="tabpanel" aria-labelledby="simulator-search-tab">
    <div className="fm-objectives-search">
     <label>Buscar por artículo, proveedor o CN
      <input type="search" placeholder="Artículo, laboratorio, proveedor o CN (palabras en cualquier orden)…" value={search}
       onChange={e=>{setSearch(e.target.value);setSearchPage(0);}}
       onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();setSearchNonce(n=>n+1);}}}/></label>
     <button className="btn btn-secondary" type="button" disabled={searchBusy||search.trim().length<2}
      onClick={()=>{setSearchPage(0);setSearchNonce(n=>n+1);}}><Search size={16}/>{searchBusy?"Buscando…":"Buscar"}</button>
    </div>
    {searchBusy&&<div className="fm-objectives-search-loading"><LoadingStatus label="Buscando artículos con CN…"/></div>}
    {searchError&&<p role="alert" className="fm-objectives-warning">{searchError}</p>}
    {results.length>0&&<div className="fm-objectives-results">
     <div className="fm-objectives-section-title"><strong>Artículos identificados ({results.length} mostrados)</strong>
      <button className="btn btn-secondary btn-sm" type="button" onClick={()=>append(results)}>
       <Check size={14}/> Seleccionar mostrados</button></div>
     <div className="fm-objectives-result-scroll">
      {results.map(item=><label key={item.cn} className="fm-objectives-product">
       <input type="checkbox" checked={selected.some(x=>x.cn===item.cn)}
        onChange={e=>e.target.checked?append([item]):setSelected(v=>v.filter(x=>x.cn!==item.cn))}/>
       <code>{item.cn}</code>
       <span><strong>{item.description}</strong>{item.supplier&&<small>{item.supplier}</small>}
        {item.referenceType==="farmatic"&&<small title="El origen ERP coincide con este código, pero el CN no está contrastado con el catálogo oficial">Referencia Farmatic · CN sin verificar</small>}</span>
      </label>)}
     </div>
     {hasMore&&<div className="fm-objectives-more">
      <button type="button" className="btn btn-secondary btn-sm" disabled={searchBusy}
       onClick={()=>setSearchPage(page=>page+1)}>
       {searchBusy?"Cargando más coincidencias…":"Mostrar más artículos"}
      </button>
     </div>}
    </div>}
    {!searchBusy&&unavailableCount>0&&<p className="fm-objectives-excluded">
     {unavailableCount} {unavailableCount===1?"artículo no aparece":"artículos no aparecen"} porque
     {unavailableCount===1?" no tiene":" no tienen"} un CN identificable en el catálogo.</p>}
    {!searchBusy&&!searchError&&results.length===0&&unavailableCount===0&&search.trim().length>=2&&
     <p className="fm-objectives-hint">No hay artículos identificables que coincidan con la búsqueda.</p>}
   </div>:
   <div id="simulator-paste-panel" role="tabpanel" aria-labelledby="simulator-paste-tab"
    className="fm-objectives-paste">
    <label>Pegar códigos nacionales
     <textarea rows={4} placeholder={"123456\n654321"} value={bulk}
      onChange={e=>{setBulk(e.target.value);setBulkError("");}}/></label>
    <div className="fm-objectives-paste-action">
     <span>{codes.length} CN {codes.length===1?"válido":"válidos"} detectados</span>
     <button type="button" className="btn btn-secondary" disabled={!codes.length||invalid.length>0||codes.length>500||bulkBusy}
      onClick={()=>void addPastedCNs()}><Plus size={16}/> Añadir CN</button>
    </div>
    {invalid.length>0&&<p role="alert" className="fm-objectives-warning">
     Comprueba {invalid.length===1?"el código":"los "+invalid.length+" códigos"}: deben tener exactamente 6 dígitos.</p>}
    {codes.length>500&&<p role="alert" className="fm-objectives-warning">Máximo 500 CN a la vez.</p>}
    {bulkBusy&&<LoadingStatus label="Recuperando nombres de los CN añadidos…"/>}
    {bulkError&&<p role="status" className="fm-objectives-hint">{bulkError}</p>}
   </div>}
   <div className="fm-objectives-selected">
    <div className="fm-objectives-section-title"><strong>Productos seleccionados · {selected.length} CN</strong>
     <button type="button" className="btn btn-secondary btn-sm" disabled={!selected.length}
      onClick={()=>setSelected([])}>Limpiar selección</button></div>
    {selected.length?<div className="fm-objectives-chips">{selected.map(item=><span key={item.cn} title={promotionProductLabel(item)+(item.referenceType==="farmatic"?" (referencia Farmatic, CN no contrastado)":"")}>
     <code>{item.cn}</code>{" - "}{promotionProductName(item)}
     <button type="button" aria-label={"Quitar "+item.cn}
      onClick={()=>setSelected(s=>s.filter(x=>x.cn!==item.cn))}><Trash2 size={13}/></button>
    </span>)}</div>:<p>Busca o pega CN para seleccionar los productos.</p>}
   </div>
  </section>
  <section className="card fm-objectives-card">
   <h2>2. Farmacias, ventas y objetivos</h2>
   <div className="fm-objectives-pharmacies">{active.map(f=><label key={f.id}>
    <input type="checkbox" checked={selectedPharmacies.includes(String(f.id))}
     onChange={e=>setSelectedPharmacies(ids=>e.target.checked?[...new Set([...ids,String(f.id)])]:
      ids.filter(id=>id!==String(f.id)))}/>{f.name}</label>)}</div>
   <div className="fm-objectives-custom">
    <label>Período desde <input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)}/></label>
    <label>Hasta <input type="date" min={customFrom||undefined} value={customTo}
     onChange={e=>setCustomTo(e.target.value)}/></label>
   </div>
   {!validRange&&<p role="alert" className="fm-objectives-warning">
    Selecciona un período válido de hasta 367 días para consultar las ventas.</p>}
   <LoadingFrame loading={historyBusy} label="Calculando ventas y objetivos por farmacia…" className="fm-objectives-loading-frame">
   <div className="fm-objectives-history-scroll">
    <table className="fm-objectives-table fm-objectives-unified-table">
     <thead><tr><th>Farmacia</th>
      {periods.map(p=><th key={p.id}><label className={"fm-objectives-base "+(baseline===p.id?"chosen":"")}>
       <input type="radio" name="simulator-objective-reference" value={p.id}
        checked={baseline===p.id} onChange={()=>setBaseline(p.id)}
        aria-label={"Usar "+p.label+" como base de objetivos"}/>
       <span>{p.label}</span></label><small>{p.id==="custom"?p.from+" — "+p.to:p.from.slice(0,7)}</small></th>)}
      <th>Incremento (%)</th><th>Objetivo</th>
     </tr></thead>
     <tbody>
      {chosenPharmacies.map(f=>{
       const id=String(f.id),pct=rate(id);
       return <tr key={id}><th>{f.name}</th>
        {periods.map(p=><td key={p.id}>{!selectedCNs.length||historyBusy||historyError?"—":
         <strong>{num(units(id,p.id))}</strong>}</td>)}
        <td><div className="fm-objectives-rate-line"><div className="fm-objectives-rates">{[5,8,10,12,14].map(value=><button type="button"
         key={value} className={pct===value?"chosen":""} aria-pressed={pct===value}
         onClick={()=>{setRateByPharmacy(v=>({...v,[id]:value}));setManualTargets(v=>({...v,[id]:undefined}));}}>
         {value}%</button>)}</div>
         <label className="fm-objectives-rate-custom">
          <input type="number" min="-100" max="500" step="1" inputMode="numeric"
           aria-label={"Incremento personalizado "+f.name} value={rateByPharmacy[id]??5}
           onChange={e=>{const v=Number(e.target.value);
            if(Number.isInteger(v)&&v>=-100&&v<=500){
             setRateByPharmacy(old=>({...old,[id]:v}));
             setManualTargets(old=>({...old,[id]:undefined}));
            }}}/><span>%</span></label></div></td>
        <td className="fm-objectives-goal-cell"><input type="number" min="0" step="1"
         aria-label={"Objetivo "+f.name} value={target(id)}
         onChange={e=>setManualTargets(old=>({...old,[id]:e.target.value===""?"":
          String(Math.max(0,Math.round(Number(e.target.value)||0)))}))}/></td>
       </tr>;
      })}
      <tr className="fm-objectives-summary"><th>Total</th>
       {periods.map(p=><td key={p.id}>{!selectedCNs.length||historyBusy||historyError?"—":
        <strong>{num(totals(p.id))}</strong>}</td>)}
       <td>—</td><td><strong>{num(totalTarget())}</strong></td></tr>
     </tbody>
    </table>
   </div>
   </LoadingFrame>
   {historyError&&<p role="alert" className="fm-objectives-warning">{historyError}</p>}
  </section>
  <section className="fm-objectives-extraction" aria-label="Extracción de ventas">
   <div className="fm-objectives-extract-head"><h2>3. Extracción de ventas</h2></div>
   <DetalleVentas simulator directQuery={query} pharmacies={pharmacies}
    pharmacyScopeIds={selectedPharmacies} connected={true}/>
  </section>
  <div className="fm-objectives-create">
   <button type="button" className="btn btn-primary" disabled={!canCreate}
    onClick={create}><Plus size={17}/> Crear promoción</button>
  </div>
 </div>;
}
