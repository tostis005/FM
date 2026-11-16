import React,{useEffect,useMemo,useRef,useState} from "react";
import {Download,FileSpreadsheet,Save,Search,ShoppingCart,Upload,RefreshCcw} from "lucide-react";
import {ReportPageHeader} from "./ReportControls.jsx";
import {LoadingPanel,KpiValue} from "./LoadingState.jsx";
import {readGenericOfferExcel} from "./genericOffersImport.js";
import {allocateGenericUnits,distributeGenericUnits,sumGenericPharmacies} from "./genericOfferPlanning.js";
import {exportGenericOfferOrders} from "./exportaciones.js";
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

export default function GenericosComparador({clientSlug,pharmacies=[],canEdit=false,range}){
 const [status,setStatus]=useState(null),[suppliers,setSuppliers]=useState([]);
 const [metaLoading,setMetaLoading]=useState(true),[refresh,setRefresh]=useState(0);
 const [search,setSearch]=useState(""),[found,setFound]=useState([]),[searchBusy,setSearchBusy]=useState(false);
 const [dcpf,setDcpf]=useState(""),[details,setDetails]=useState(null),[detailBusy,setDetailBusy]=useState(false);
 const [volume,setVolume]=useState(""),[shares,setShares]=useState({}),[chosenCN,setChosenCN]=useState({});
 const [destinations,setDestinations]=useState({}),[overrides,setOverrides]=useState({});
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const fileRef=useRef(null);
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
  const controller=new AbortController();
  const timer=setTimeout(()=>{
   setSearchBusy(true);
   request(clientSlug,"/api/genericos/ofertas/buscar?"+new URLSearchParams({buscar:search.trim()}),
    {signal:controller.signal})
    .then(v=>{if(!controller.signal.aborted)setFound(v.items||[])})
    .catch(e=>{if(!controller.signal.aborted)setError(e.message)})
    .finally(()=>{if(!controller.signal.aborted)setSearchBusy(false)});
  },300);
  return()=>{clearTimeout(timer);controller.abort()};
 },[clientSlug,search,refresh]);
 useEffect(()=>{
  if(!dcpf){setDetails(null);return}
  const controller=new AbortController();setDetailBusy(true);setError("");
  request(clientSlug,"/api/genericos/ofertas/conjunto/"+encodeURIComponent(dcpf),
   {signal:controller.signal})
   .then(v=>{
    if(controller.signal.aborted)return;
    setDetails(v);
    const initialShares=Object.fromEntries((v.objectives||[]).map(x=>[x.laboratory,Number(x.percent)]));
    const initialCN=Object.fromEntries((v.objectives||[]).map(x=>[x.laboratory,x.cn]));
    setShares(initialShares);setChosenCN(initialCN);
    setDestinations(Object.fromEntries((v.destinations||[]).map(x=>[x.laboratory,String(x.supplierId)])));
    setOverrides({});setNotice("");
   }).catch(e=>{if(!controller.signal.aborted)setError(e.message)})
    .finally(()=>{if(!controller.signal.aborted)setDetailBusy(false)});
  return()=>controller.abort();
 },[clientSlug,dcpf,refresh]);
 const selectedGroup=found.find(g=>String(g.dcpf)===String(dcpf));
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
   return {name,options:sorted,selected,percent:Number(shares[name]||0)};
  }).sort((a,b)=>Number(a.selected.puc)-Number(b.selected.puc)||a.name.localeCompare(b.name,"es"));
 },[details,chosenCN,shares]);
 const goalShare=labs.reduce((n,l)=>n+l.percent,0);
 const planned=useMemo(()=>{
  if(volume===""||!/^[0-9]+$/.test(String(volume)))
   return {error:"Introduce las unidades previstas antes de preparar el reparto.",units:[],unassigned:0};
  try{
   return {...allocateGenericUnits(Number(volume),labs),error:""};
  }catch(e){return {error:e.message,units:[],unassigned:0}}
 },[volume,labs]);
 const assignments=labs.map((lab,i)=>{
  const units=planned.units[i]||0;
  const distribution=overrides[lab.name]||distributeGenericUnits(units,pharmacies);
  return {...lab,units,distribution,distributionValid:sumGenericPharmacies(distribution)===units};
 });
 const active=assignments.filter(x=>x.units>0);
 const best=labs.length?Math.min(...labs.map(x=>Number(x.selected.puc))):null;
 const estimated=active.reduce((n,x)=>n+x.units*Number(x.selected.puc),0);
 const invalidDistribution=active.some(x=>!x.distributionValid);
 const missingDestinations=active.some(x=>!destinations[x.name]);
 const canPrepare=canEdit&&!busy&&!planned.error&&active.length>0&&!invalidDistribution&&
  !missingDestinations&&range?.valid!==false&&Boolean(range?.from&&range?.to);
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
  if(!canEdit||goalShare>100||busy)return;
  setBusy(true);setError("");setNotice("");
  try{
   const goals=labs.filter(x=>x.percent>0).map(x=>({
    laboratory:x.name,cn:x.selected.cn,percent:x.percent
   }));
   await request(clientSlug,"/api/genericos/ofertas/objetivos/"+encodeURIComponent(dcpf),
    {method:"PUT",body:{goals}});
   setNotice("Objetivo de reparto guardado: "+percent(goalShare)+
    ". El porcentaje restante no se reasigna automáticamente.");
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
  if(planned.error||!active.length||invalidDistribution)return;
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
  {canEdit&&<section className="card fm-gof-import">
   <div><strong><FileSpreadsheet size={17}/> Tarifas comerciales</strong>
    <p>Importa un archivo con una pestaña por laboratorio (Código, PVL, %Dto, Neto, IVA, PUC). Reemplaza la tarifa vigente del cliente, sin cambiar los datos del Nomenclátor ni las compras reales.</p>
    {status?.summary?.filename&&<small>Archivo vigente: {status.summary.filename} · {status.summary.importedAt?niceDate(status.summary.importedAt):"—"}</small>}
   </div>
   <label className="btn btn-secondary fm-gof-upload"><Upload size={15}/>
    {busy?"Procesando…":"Importar / actualizar Excel"}
    <input ref={fileRef} type="file" accept=".xlsx" disabled={busy}
     onChange={e=>void importFile(e.target.files?.[0]||null)}/></label>
  </section>}
  <section className="card fm-gof-picker">
   <div className="section-heading"><div><h2>1. Selecciona el medicamento</h2>
    <p>La comparación agrupa únicamente presentaciones equivalentes (misma composición, dosis, forma y envase).</p></div></div>
   <div className="fm-gof-search-row">
    <label>Buscar por CN, principio activo o presentación
     <span className="fm-gof-search"><Search size={16}/>
      <input type="search" value={search} onChange={e=>setSearch(e.target.value)}
       placeholder="Ej.: esomeprazol 20 mg 28 cápsulas"/></span></label>
    <label>Conjunto DCPF
     <select value={dcpf} onChange={e=>{setDcpf(e.target.value);setVolume("");setNotice("");setOverrides({})}}>
      <option value="">Selecciona un genérico</option>
      {dcpf&&!found.some(g=>String(g.dcpf)===String(dcpf))&&
       <option value={dcpf}>Conjunto DCPF {dcpf}</option>}
      {found.map(g=><option key={g.dcpf} value={g.dcpf}>
       {sourceName(g)} · {g.laboratories} lab. · DCPF {g.dcpf}</option>)}
     </select></label>
   </div>
   {searchBusy&&<span className="fm-gof-hint"><span className="fm-load-spinner" aria-hidden="true"/> Buscando conjuntos…</span>}
   {!metaLoading&&status?.summary?.total===0&&
    <p className="fm-gof-hint">Todavía no hay tarifas importadas. La comparación estará disponible al incorporar el Excel del cliente.</p>}
   {!!status?.summary?.total&&status.summary.matched<status.summary.total&&
    <p className="fm-gof-hint">{integers(status.summary.total-status.summary.matched)} CN del Excel no aparecen en el Nomenclátor activo y no entran en comparaciones por equivalencia.</p>}
  </section>
  {detailBusy?<LoadingPanel kind="table" label="Relacionando CN, DCPF y ofertas de laboratorio…" rows={5}/>:
  dcpf&&details&&<section className="card fm-gof-results">
   <div className="section-heading"><div><h2>2. Compara los precios de los laboratorios</h2>
    <p>{selectedGroup?sourceName(selectedGroup):"Conjunto DCPF "+dcpf} · {labs.length} laboratorios con ofertas EFG</p></div></div>
   {labs.length?<div className="fm-gof-scroll"><table className="fm-gof-table">
    <thead><tr><th>Laboratorio de la oferta</th><th>Medicamento / CN</th><th>PVL</th>
     <th>Dto.</th><th>Neto</th><th>PUC con IVA</th><th>Frente al mejor</th>
     <th>Objetivo de compra</th><th>Uds. previstas</th><th>Proveedor del pedido</th></tr></thead>
    <tbody>{assignments.map(row=><tr key={row.name}>
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
     <td><div className="fm-gof-target">
      <input type="range" min="0" max="100" step="1" value={row.percent} disabled={!canEdit}
       aria-label={"Porcentaje objetivo "+row.name}
       onChange={e=>{setShares(prev=>({...prev,[row.name]:Number(e.target.value)}));setNotice("")}}/>
      <input type="number" min="0" max="100" step="0.1" value={row.percent} disabled={!canEdit}
       aria-label={"Porcentaje numérico "+row.name}
       onChange={e=>{setShares(prev=>({...prev,[row.name]:Math.max(0,Math.min(100,Number(e.target.value)||0))}));setNotice("")}}/>
      <span>%</span></div></td>
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
   <p className="fm-gof-legal">PUC de la tarifa comercial del Excel (IVA incluido). No equivale al coste histórico observado ni acredita disponibilidad o condiciones vigentes. La equivalencia DCPF no autoriza por sí sola la sustitución o dispensación de un medicamento.</p>
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