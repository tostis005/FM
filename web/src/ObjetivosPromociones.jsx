import React,{useEffect,useMemo,useState} from "react";
import {Check,Plus,Search,Trash2} from "lucide-react";
import "./ObjetivosPromociones.css";
const ISO=value=>/^20\d{2}-\d{2}-\d{2}$/.test(value||"");
const CN=value=>/^\d{6}$/.test(value);
const num=value=>new Intl.NumberFormat("es-ES",{maximumFractionDigits:0}).format(value||0);
const first=(year,month)=>new Date(Date.UTC(year,month,1)).toISOString().slice(0,10);
const last=(year,month)=>new Date(Date.UTC(year,month+1,0)).toISOString().slice(0,10);
function periodsFor(now,customFrom,customTo){
 const year=now.year,month=now.month-1;
 return [
  {id:"previous",label:"Mes anterior",from:first(year,month-1),to:last(year,month-1)},
  {id:"quarter",label:"3 meses anteriores",from:first(year,month-3),to:last(year,month-1)},
  {id:"year",label:"Mismo mes hace 1 año",from:first(year-1,month-1),to:last(year-1,month-1)},
  {id:"twoYears",label:"Mismo mes hace 2 años",from:first(year-2,month-1),to:last(year-2,month-1)},
  ...(ISO(customFrom)&&ISO(customTo)&&customFrom<=customTo?
   [{id:"custom",label:"Rango libre",from:customFrom,to:customTo}]:[])
 ];
}
function currentMadrid(){
 const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{
  timeZone:"Europe/Madrid",year:"numeric",month:"numeric"
 }).formatToParts(new Date()).map(p=>[p.type,Number(p.value)]));
 return {year:parts.year,month:parts.month};
}
async function post(clientSlug,path,body,signal){
 const response=await fetch(path,{method:"POST",credentials:"same-origin",signal,
  headers:{"Content-Type":"application/json","X-Farmetrica-Cliente":clientSlug},
  body:JSON.stringify(body)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||"No se pudo consultar el histórico");
 return data;
}
export default function ObjetivosPromociones({clientSlug,pharmacies=[],canManage=false,onCreatePromotion}){
 const active=useMemo(()=>pharmacies.filter(f=>f.active!==false),[pharmacies]);
 const [selectedPharmacies,setSelectedPharmacies]=useState(()=>active.map(f=>String(f.id)));
 const [search,setSearch]=useState("");
 const [bulk,setBulk]=useState("");
 const [results,setResults]=useState([]);
 const [selected,setSelected]=useState([]);
 const [searchBusy,setSearchBusy]=useState(false);
 const [historyBusy,setHistoryBusy]=useState(false);
 const [error,setError]=useState("");
 const [historical,setHistorical]=useState({});
 const [baseline,setBaseline]=useState("previous");
 const [customFrom,setCustomFrom]=useState("");
 const [customTo,setCustomTo]=useState("");
 const [rateByPharmacy,setRateByPharmacy]=useState({});
 const [manualTargets,setManualTargets]=useState({});
 const codes=useMemo(()=>[...new Set(bulk.split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean))],[bulk]);
 const invalid=codes.filter(x=>!CN(x));
 const periods=useMemo(()=>periodsFor(currentMadrid(),customFrom,customTo),[customFrom,customTo]);
 const chosen=useMemo(()=>periods.find(p=>p.id===baseline)||periods[0],[periods,baseline]);
 const selectedCNs=useMemo(()=>selected.map(x=>x.cn),[selected]);
 const selectedKey=selectedCNs.join(",");
 const pharmacyKey=selectedPharmacies.join(",");
 useEffect(()=>{
  setSelectedPharmacies(ids=>ids.filter(id=>active.some(p=>String(p.id)===id)).concat(
   active.filter(f=>!ids.includes(String(f.id))&&ids.length===0).map(f=>String(f.id))));
 },[active]);
 useEffect(()=>{
  if(!selectedCNs.length||!selectedPharmacies.length){setHistorical({});setHistoryBusy(false);setError("");return;}
  const controller=new AbortController();
  setHistoryBusy(true);setError("");
  post(clientSlug,"/api/ventas/objetivos/historico",{
   cns:selectedCNs,pharmacyIds:selectedPharmacies,periods
  },controller.signal).then(data=>{setHistorical(data.periods||{});setManualTargets({});})
   .catch(e=>{if(e.name!=="AbortError"){setError(e.message);setHistorical({});}})
   .finally(()=>{if(!controller.signal.aborted)setHistoryBusy(false);});
  return()=>controller.abort();
 },[clientSlug,selectedKey,pharmacyKey,customFrom,customTo]);
 async function lookup(){
  if(!search.trim()&&!codes.length)return;
  if(invalid.length){setError("Revisa los CN: cada código debe contener exactamente 6 cifras.");return;}
  setSearchBusy(true);setError("");
  try{
   const response=await post(clientSlug,"/api/ventas/objetivos/buscar",{
    search:search.trim(),cns:codes
   });
   const entries=response.products||[];
   // Mostrar también los CN del bloque que todavía no están en el maestro.
   const found=new Set(entries.map(x=>x.cn));
   setResults([...entries,...codes.filter(cn=>!found.has(cn)).map(cn=>({cn,description:"No localizado en catálogo"}))]);
  }catch(e){setError(e.message);}finally{setSearchBusy(false);}
 }
 function append(items){setSelected(current=>{
  const indexed=new Map(current.map(x=>[x.cn,x]));
  for(const item of items)if(CN(item.cn))indexed.set(item.cn,item);
  return [...indexed.values()];
 });}
 const units=(id,periodId)=>Number(historical[periodId]?.[id]||0);
 const rate=id=>Number(rateByPharmacy[id]??5);
 const proposal=id=>Math.max(0,Math.ceil(units(id,chosen.id)*(1+rate(id)/100)));
 const target=id=>manualTargets[id]===undefined?proposal(id):Number(manualTargets[id])||0;
 const totals=periodId=>selectedPharmacies.reduce((n,id)=>n+units(id,periodId),0);
 const canCreate=canManage&&Boolean(selected.length)&&Boolean(selectedPharmacies.length)&&!historyBusy&&!error;
 function create(){
  if(!canCreate)return;
  const targets=Object.fromEntries(selectedPharmacies.map(id=>[id,target(id)]));
  onCreatePromotion?.({
   cns:selectedCNs,cnDescriptions:Object.fromEntries(selected.map(x=>[x.cn,x.description])),
   targets,objectiveBaseline:chosen.id,objectiveBaselineRange:{from:chosen.from,to:chosen.to},
   objectiveRates:Object.fromEntries(selectedPharmacies.map(id=>[id,rate(id)]))
  });
 }
 return <div className="fm-objectives">
  <div className="fm-objectives-intro">
   <div><h1>Objetivos de promociones</h1><p>Elige los CN, compara ventas reales por farmacia y prepara una promoción con objetivos sugeridos.</p></div>
   <button className="btn btn-primary" type="button" disabled={!canCreate} onClick={create}><Plus size={17}/> Crear promoción con estos objetivos</button>
  </div>
  <section className="card fm-objectives-card">
   <h2>1. Seleccionar productos</h2>
   <div className="fm-objectives-search">
    <label>Buscar por descripción, marca o CN
     <input type="search" placeholder="Ej.: marca, gama o 123456" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();lookup();}}}/></label>
    <label>Pegar códigos nacionales (uno por línea)
     <textarea rows={4} placeholder={"123456\n654321"} value={bulk} onChange={e=>setBulk(e.target.value)}/></label>
    <button className="btn btn-secondary" type="button" disabled={searchBusy||(!search.trim()&&!codes.length)} onClick={lookup}><Search size={16}/>{searchBusy?"Buscando…":"Buscar productos"}</button>
   </div>
   {invalid.length>0&&<p className="fm-objectives-warning">CN inválidos: {invalid.slice(0,8).join(", ")}</p>}
   {results.length>0&&<div className="fm-objectives-results">
    <div className="fm-objectives-section-title"><strong>Resultados ({results.length})</strong><button className="btn btn-secondary btn-sm" type="button" onClick={()=>append(results)}><Check size={14}/> Seleccionar todos los resultados</button></div>
    <div className="fm-objectives-result-scroll">{results.map(item=><label key={item.cn} className="fm-objectives-product">
      <input type="checkbox" checked={selected.some(x=>x.cn===item.cn)} onChange={e=>e.target.checked?append([item]):setSelected(s=>s.filter(x=>x.cn!==item.cn))}/>
      <code>{item.cn}</code><span>{item.description}</span></label>)}</div>
   </div>}
   <div className="fm-objectives-selected"><div className="fm-objectives-section-title"><strong>Productos seleccionados · {selected.length} CN</strong><button type="button" className="btn btn-secondary btn-sm" disabled={!selected.length} onClick={()=>setSelected([])}>Limpiar selección</button></div>
    {selected.length?<div className="fm-objectives-chips">{selected.map(item=><span key={item.cn} title={item.description}><code>{item.cn}</code> {item.description} <button type="button" aria-label={"Quitar "+item.cn} onClick={()=>setSelected(s=>s.filter(x=>x.cn!==item.cn))}><Trash2 size={13}/></button></span>)}</div>:<p>Busca productos y marca los que quieras incluir en el análisis.</p>}
   </div>
  </section>
  <section className="card fm-objectives-card">
   <h2>2. Farmacias y períodos de referencia</h2>
   <p>Por defecto se incluyen todas las farmacias disponibles. Puedes desmarcar cualquiera.</p>
   <div className="fm-objectives-pharmacies">{active.map(f=><label key={f.id}><input type="checkbox" checked={selectedPharmacies.includes(String(f.id))} onChange={e=>setSelectedPharmacies(ids=>e.target.checked?[...ids,String(f.id)]:ids.filter(id=>id!==String(f.id)))}/>{f.name}</label>)}</div>
   <div className="fm-objectives-custom"><label>Rango libre desde <input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)}/></label><label>Hasta <input type="date" min={customFrom||undefined} value={customTo} onChange={e=>setCustomTo(e.target.value)}/></label></div>
   <p className="fm-objectives-hint">Las ventas de tres meses son el total acumulado, no una media mensual. Cada columna suma todos los CN seleccionados.</p>
   <div className="fm-objectives-history-scroll">
    <table className="fm-objectives-table"><thead><tr><th>Farmacia</th>{periods.map(p=><th key={p.id}>{p.label}<small>{p.from} — {p.to}</small></th>)}</tr></thead>
      <tbody>{active.filter(f=>selectedPharmacies.includes(String(f.id))).map(f=><tr key={f.id}><th>{f.name}</th>{periods.map(p=><td key={p.id}>{!selected.length||historyBusy?"—":num(units(String(f.id),p.id))}</td>)}</tr>)}
       <tr className="fm-objectives-summary"><th>Total seleccionado</th>{periods.map(p=><td key={p.id}>{!selected.length||historyBusy?"—":num(totals(p.id))}</td>)}</tr>
      </tbody></table>
   </div>
   {historyBusy&&<p role="status">Calculando ventas reales por farmacia…</p>}
   {error&&<p role="alert" className="fm-objectives-warning">{error}</p>}
  </section>
  <section className="card fm-objectives-card">
   <h2>3. Calculadora de objetivos</h2>
   <p>Selecciona qué período utilizar como base. Después aplica a cada farmacia un incremento rápido o personalizado y revisa las unidades objetivo.</p>
   <div className="fm-objectives-period-picks">{periods.map(p=><label key={p.id} className={chosen.id===p.id?"chosen":""}><input type="radio" name="baseline-objectives" checked={chosen.id===p.id} onChange={()=>{setBaseline(p.id);setManualTargets({});}}/>{p.label}</label>)}</div>
   <div className="fm-objectives-history-scroll"><table className="fm-objectives-table fm-objectives-targets"><thead><tr><th>Farmacia</th><th>Ventas base</th><th>Incremento</th><th>Objetivo propuesto</th></tr></thead>
   <tbody>{active.filter(f=>selectedPharmacies.includes(String(f.id))).map(f=>{
    const id=String(f.id),pct=rate(id);
    return <tr key={id}><th>{f.name}</th><td>{num(units(id,chosen.id))} uds.</td>
     <td><div className="fm-objectives-rates">{[5,8,10,12,14].map(value=><button key={value} type="button" className={pct===value?"chosen":""} aria-pressed={pct===value} onClick={()=>{setRateByPharmacy(x=>({...x,[id]:value}));setManualTargets(x=>({...x,[id]:undefined}));}}>{value}%</button>)}</div>
      <label className="fm-objectives-rate-custom">Personalizado <input aria-label={"Incremento personalizado "+f.name} type="number" min="-100" max="500" step="0.5" value={rateByPharmacy[id]??5} onChange={e=>{const value=Number(e.target.value);if(Number.isFinite(value)&&value>=-100&&value<=500){setRateByPharmacy(x=>({...x,[id]:value}));setManualTargets(x=>({...x,[id]:undefined}));}}}/> %</label>
     </td><td><input type="number" min="0" step="1" aria-label={"Unidades objetivo "+f.name} value={target(id)} onChange={e=>setManualTargets(x=>({...x,[id]:e.target.value===""?0:Math.max(0,Math.round(Number(e.target.value)||0))}))}/> uds.</td></tr>;
   })}
    <tr className="fm-objectives-summary"><th>Total</th><td>{num(totals(chosen.id))} uds.</td><td>—</td><td><strong>{num(selectedPharmacies.reduce((n,id)=>n+target(id),0))} uds.</strong></td></tr>
   </tbody></table></div>
   <div className="fm-objectives-footer"><p>Los objetivos se redondean hacia arriba. Podrás modificar todos los datos y completar el tipo y las fechas al crear la promoción.</p>
    <button className="btn btn-primary" type="button" disabled={!canCreate} onClick={create}><Plus size={17}/> Continuar a crear promoción</button>
   </div>
  </section>
 </div>;
}
