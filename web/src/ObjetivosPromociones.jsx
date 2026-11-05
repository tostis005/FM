import React,{useEffect,useMemo,useRef,useState} from "react";
import {Check,Plus,Search,Trash2} from "lucide-react";
import DetalleVentas from "./DetalleVentas.jsx";
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
 const [search,setSearch]=useState("");
 const [bulk,setBulk]=useState("");
 const [searchNonce,setSearchNonce]=useState(0);
 const [results,setResults]=useState([]);
 const [selected,setSelected]=useState([]);
 const [searchBusy,setSearchBusy]=useState(false);
 const [searchError,setSearchError]=useState("");
 const [historyBusy,setHistoryBusy]=useState(false);
 const [historyError,setHistoryError]=useState("");
 const [historical,setHistorical]=useState({});
 const [baseline,setBaseline]=useState("previous");
 const [customFrom,setCustomFrom]=useState(()=>{const {year,month}=monthAtMadrid();return first(year,month);});
 const [customTo,setCustomTo]=useState(madridToday);
 const [rateByPharmacy,setRateByPharmacy]=useState({});
 const [manualTargets,setManualTargets]=useState({});
 const codes=useMemo(()=>[...new Set(bulk.split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean))],[bulk]);
 const invalid=codes.filter(x=>!CN(x));
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

 // Al escribir se buscan productos automáticamente, y el botón permite
 // repetir la búsqueda sin cambiar el filtro. Al vaciar, vuelve el placeholder.
 useEffect(()=>{
  const term=search.trim();
  if(!term&&!codes.length){setResults([]);setSearchBusy(false);setSearchError("");return;}
  if(invalid.length){setResults([]);setSearchBusy(false);
   setSearchError("Cada código nacional debe tener exactamente 6 dígitos.");return;}
  if(term.length<2&&!codes.length){setResults([]);setSearchBusy(false);
   setSearchError("Introduce al menos dos caracteres para buscar.");return;}
  const controller=new AbortController();
  let timedOut=false;
  setResults([]);setSearchBusy(true);setSearchError("");
  const deadline=setTimeout(()=>{timedOut=true;controller.abort();},10500);
  const timer=setTimeout(()=>{
   post(clientSlug,"/api/ventas/objetivos/buscar",{search:term,cns:codes},controller.signal)
    .then(data=>{
     if(controller.signal.aborted)return;
     const products=data.products||[],found=new Set(products.map(x=>x.cn).filter(Boolean));
     setResults([...products,...codes.filter(cn=>!found.has(cn))
      .map(cn=>({cn,description:"CN no localizado en el catálogo",supplier:null}))]);
     if(data.partial)setSearchError("Resultados parciales: alguna fuente ha tardado demasiado. Prueba una búsqueda más específica.");
    })
    .catch(error=>{
     if(timedOut)setSearchError("La búsqueda ha tardado demasiado. Prueba con un nombre o CN más específico.");
     else if(!controller.signal.aborted){setSearchError(error.message);setResults([]);}
    })
    .finally(()=>{clearTimeout(deadline);if(!controller.signal.aborted||timedOut)setSearchBusy(false);});
  },420);
  return()=>{clearTimeout(timer);clearTimeout(deadline);controller.abort();};
 },[clientSlug,search,bulk,searchNonce]);

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
 function append(items){
  setSelected(current=>{
   const currentByCN=new Map(current.map(item=>[item.cn,item]));
   for(const item of items)if(CN(item.cn))currentByCN.set(item.cn,item);
   return [...currentByCN.values()];
  });
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
   <div className="fm-objectives-search">
    <label>Buscar por artículo, proveedor o CN
     <input type="search" placeholder="Nombre, marca, laboratorio o CN…" value={search}
      onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();setSearchNonce(n=>n+1);}}}/></label>
    <label>Pegar códigos nacionales (uno por línea)
     <textarea rows={4} placeholder={"123456\n654321"} value={bulk}
      onChange={e=>setBulk(e.target.value)}/></label>
    <button className="btn btn-secondary" type="button" disabled={searchBusy||(!search.trim()&&!codes.length)}
     onClick={()=>setSearchNonce(n=>n+1)}><Search size={16}/>{searchBusy?"Buscando…":"Buscar productos"}</button>
   </div>
   {searchError&&<p role="alert" className="fm-objectives-warning">{searchError}</p>}
   {searchBusy&&<p role="status" className="fm-objectives-hint">Buscando artículos…</p>}
   {!searchBusy&&results.length>0&&<div className="fm-objectives-results">
    <div className="fm-objectives-section-title"><strong>Resultados ({results.length})</strong>
     <button className="btn btn-secondary btn-sm" type="button" onClick={()=>append(results.filter(item=>CN(item.cn)))}>
      <Check size={14}/> Seleccionar CN disponibles</button></div>
    <div className="fm-objectives-result-scroll">
     {results.map((item,i)=><label key={item.cn||"erp-"+item.sourceId+"-"+i}
      className={"fm-objectives-product "+(!CN(item.cn)?"unavailable":"")}>
      <input type="checkbox" disabled={!CN(item.cn)}
       checked={CN(item.cn)&&selected.some(x=>x.cn===item.cn)}
       onChange={e=>e.target.checked?append([item]):setSelected(s=>s.filter(x=>x.cn!==item.cn))}/>
      <code>{CN(item.cn)?item.cn:"Sin CN"}</code>
      <span><strong>{item.description}</strong>
       {item.supplier&&<small>{item.supplier}</small>}
       {!CN(item.cn)&&<small>Sin código nacional válido en el catálogo; no se puede seleccionar.</small>}
      </span></label>)}
    </div>
   </div>}
   {!searchBusy&&!searchError&&results.length===0&&(search.trim().length>=2||codes.length>0)&&
    <p className="fm-objectives-hint">No se han encontrado artículos con esos filtros.</p>}
   <div className="fm-objectives-selected">
    <div className="fm-objectives-section-title"><strong>Productos seleccionados · {selected.length} CN</strong>
     <button type="button" className="btn btn-secondary btn-sm" disabled={!selected.length}
      onClick={()=>setSelected([])}>Limpiar selección</button></div>
    {selected.length?<div className="fm-objectives-chips">{selected.map(item=><span key={item.cn} title={item.description}>
     <code>{item.cn}</code> {item.description}
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
          <input type="number" min="-100" max="500" step="0.5"
           aria-label={"Incremento personalizado "+f.name} value={rateByPharmacy[id]??5}
           onChange={e=>{const v=Number(e.target.value);
            if(Number.isFinite(v)&&v>=-100&&v<=500){
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
   {!selectedCNs.length&&<p className="fm-objectives-hint">Selecciona productos para cargar las ventas y calcular objetivos automáticamente.</p>}
   {historyBusy&&<p role="status" className="fm-objectives-hint">Actualizando las ventas por farmacia…</p>}
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
