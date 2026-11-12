import React,{useCallback,useEffect,useMemo,useState} from "react";
import {ChevronDown,ChevronRight,Check,RefreshCcw,Search} from "lucide-react";
import "./familiasMaestro.css";

const SEGMENTS={MEDICACION:"Medicación",PARAFARMACIA:"Parafarmacia",SIN_DETERMINAR:"Sin clasificar"};
const count=n=>new Intl.NumberFormat("es-ES").format(Number(n)||0);
const EMPTY={maestros:0,medicacion:0,parafarmacia:0,pendientes:0};
async function api(slug,path,options={}){
 const r=await fetch(path,{credentials:"same-origin",cache:"no-store",...options,
  headers:{"Content-Type":"application/json","X-Farmetrica-Cliente":slug,...options.headers}});
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(data.error||"No se pudo cargar el maestro de familias");
 return data;
}
const groupOrigins=origins=>{
 const result=new Map();
 for(const origin of origins||[]){
  const key=String(origin.pharmacyCode||"");
  if(!result.has(key))result.set(key,[]);
  result.get(key).push(origin);
 }
 return [...result.entries()];
};

export default function FamiliasMaestro({clientSlug,pharmacies=[]}){
 const [view,setView]=useState("maestro"),[category,setCategory]=useState("todos");
 const [search,setSearch]=useState(""),[query,setQuery]=useState(""),[page,setPage]=useState(1);
 const [records,setRecords]=useState([]),[masterItems,setMasterItems]=useState([]);
 const [summary,setSummary]=useState(EMPTY),[total,setTotal]=useState(0);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(""),[message,setMessage]=useState("");
 const [expanded,setExpanded]=useState(null),[origins,setOrigins]=useState({});
 const [originsBusy,setOriginsBusy]=useState(null);
 const [editing,setEditing]=useState(null),[newName,setNewName]=useState("");
 const [destinations,setDestinations]=useState({});
 const pharmacyName=useCallback(code=>{
  if(code==="ALMACEN"||code==="AMP")return "Almacén";
  const found=pharmacies.find(p=>[p.sourceCode,p.databaseCode,p.code,p.codigo_origen]
   .some(value=>String(value||"").toUpperCase()===String(code||"").toUpperCase()));
  return found?.name||({ABA:"Abadía",EUR:"Europa",GRA:"Graneros"}[code]||code);
 },[pharmacies]);

 // Un único listado ligero de 65 referencias, sin JOIN ni COUNT sobre artículos.
 // Las categorías y los nombres locales se consultan independientemente.
 const load=useCallback(async(which=view,filter=query,currentPage=page)=>{
  const params=new URLSearchParams({view:which});
  if(filter)params.set("q",filter);
  if(which==="pendientes")params.set("page",String(currentPage));
  const result=await api(clientSlug,"/api/tenant/familias-globales?"+params.toString());
  setRecords(result.groups||[]);
  setSummary(result.summary||EMPTY);
  setTotal(Number(result.total)||0);
  if(which==="maestro"&&!filter)setMasterItems(result.groups||[]);
 },[clientSlug,view,query,page]);
 useEffect(()=>{
  const token=setTimeout(()=>{setQuery(search.trim());setPage(1)},220);
  return()=>clearTimeout(token);
 },[search]);
 useEffect(()=>{
  let alive=true;
  setLoading(true);setError("");
  const params=new URLSearchParams({view});
  if(query)params.set("q",query);
  if(view==="pendientes")params.set("page",String(page));
  api(clientSlug,"/api/tenant/familias-globales?"+params.toString())
   .then(result=>{
    if(!alive)return;
    setRecords(result.groups||[]);
    setSummary(result.summary||EMPTY);
    setTotal(Number(result.total)||0);
    if(view==="maestro"&&!query)setMasterItems(result.groups||[]);
   }).catch(err=>{if(alive)setError(err.message)})
   .finally(()=>{if(alive)setLoading(false)});
  return()=>{alive=false};
 },[clientSlug,view,query,page]);
 const visible=useMemo(()=>records.filter(g=>category==="todos"||g.segments.includes(category)),
  [records,category]);
 const options=masterItems.flatMap(g=>g.members).filter(g=>g.segment!=="SIN_DETERMINAR");
 async function act(action,success){
  setBusy(true);setError("");setMessage("");
  try{
   const result=await action();
   await load();
   setMessage(success);
   return result;
  }catch(err){setError(err.message);return null}
  finally{setBusy(false)}
 }
 async function expand(g){
  if(expanded===g.id){setExpanded(null);return}
  setExpanded(g.id);
  const missing=g.members.filter(m=>!origins[m.id]);
  if(!missing.length)return;
  setOriginsBusy(g.id);
  try{
   const replies=await Promise.all(missing.map(m=>api(clientSlug,
    "/api/tenant/familias-globales/"+m.id+"/origenes")));
   setOrigins(old=>{
    const next={...old};
    missing.forEach((m,i)=>{next[m.id]=replies[i].items||[]});
    return next;
   });
  }catch(err){setError(err.message)}
  finally{setOriginsBusy(null)}
 }
 async function saveName(g){
  const name=newName.trim();
  if(name.length<2)return setError("Introduce un nombre de familia.");
  const result=await act(()=>api(clientSlug,"/api/tenant/familias-globales/"+g.id,{
   method:"PUT",body:JSON.stringify({name})
  }),"Nombre de familia actualizado.");
  if(result){setEditing(null);setNewName("");setExpanded(null);setOrigins({})}
 }
 async function relink(origin,destinationId){
  if(!destinationId)return;
  const result=await act(()=>api(clientSlug,"/api/tenant/familias-globales/"+destinationId+"/origen",{
   method:"PUT",body:JSON.stringify({pharmacyCode:origin.pharmacyCode,sourceCode:origin.sourceCode})
  }),"La familia local se ha asignado al maestro.");
  if(result){
   setOrigins({});setExpanded(null);
   setDestinations(old=>({...old,[origin.pharmacyCode+"|"+origin.sourceCode]:""}));
  }
 }
 async function reconcile(){
  if(!window.confirm("¿Volver a analizar todas las familias? Puede tardar y no modifica nombres o vínculos manuales."))
   return;
  const result=await act(()=>api(clientSlug,"/api/tenant/familias-globales/reconciliar",
   {method:"POST"}),"Conciliación completada. Los cambios manuales se han conservado.");
  if(result)setOrigins({});
 }
 function switchView(next){
  setView(next);setSearch("");setQuery("");setPage(1);setCategory("todos");setExpanded(null);
 }
 return <div className="fm-families">
  <header className="fm-families-heading">
   <div><h1>Maestro de familias</h1>
    <p>Una sola entrada por nombre, en orden alfabético, con cada tipo de producto en su detalle.</p></div>
   <button className="btn btn-secondary btn-sm fm-families-reconcile" onClick={reconcile} disabled={busy||loading}>
    <RefreshCcw size={15} className={busy?"fm-families-spin":""}/>
    {busy?"Reconciliando…":"Volver a unificar"}</button>
  </header>
  <div className="fm-families-kpis">
   <div><span>Familias del maestro</span><strong>{count(summary.maestros)}</strong></div>
   <div><span>Medicación</span><strong>{count(summary.medicacion)}</strong></div>
   <div><span>Parafarmacia</span><strong>{count(summary.parafarmacia)}</strong></div>
  </div>
  <section className="card fm-families-directory">
   <div className="fm-families-tabs" role="tablist" aria-label="Tipo de familia">
    <button role="tab" aria-selected={view==="maestro"} className={view==="maestro"?"is-active":""}
     onClick={()=>switchView("maestro")}>Familias unificadas</button>
    <button role="tab" aria-selected={view==="pendientes"} className={view==="pendientes"?"is-active":""}
     onClick={()=>switchView("pendientes")}>
     Por revisar <span>{count(summary.pendientes)}</span></button>
   </div>
   <div className="fm-families-filters">
    <label className="fm-families-search"><Search size={17}/>
     <input type="search" placeholder="Buscar familia…" value={search} onChange={e=>setSearch(e.target.value)}
      aria-label="Buscar familia global"/></label>
    <select aria-label="Tipo de producto" value={category} onChange={e=>setCategory(e.target.value)}>
     <option value="todos">Todas las categorías</option>
     <option value="MEDICACION">Medicación</option>
     <option value="PARAFARMACIA">Parafarmacia</option>
     {view==="pendientes"&&<option value="SIN_DETERMINAR">Sin clasificar</option>}
    </select>
    <small>{count(visible.length)} en esta vista</small>
   </div>
   {view==="maestro"&&<p className="fm-families-note">
    Los nombres equivalentes aparecen una sola vez. Si una familia pertenece a medicación y parafarmacia, se muestran sus clasificaciones al desplegarla sin mezclar sus artículos.</p>}
   {view==="pendientes"&&<p className="fm-families-note">
    Estas categorías locales todavía no tienen una equivalencia segura con el maestro. Se muestran aparte para no duplicar familias ni asignar artículos incorrectamente.</p>}
   {message&&<p className="fm-families-notice" role="status">{message}</p>}
   {error&&<p className="fm-families-error" role="alert">{error}</p>}
   {loading?<p className="fm-families-empty">Cargando familias…</p>:
    !visible.length?<p className="fm-families-empty">No hay familias con estos filtros.</p>:
    <div className="fm-families-list">
     {visible.map(g=><article className="fm-family-row" key={g.key}>
      <div className="fm-family-main">
       <button className="fm-family-expand" onClick={()=>expand(g)} aria-expanded={expanded===g.id}
        aria-label={(expanded===g.id?"Ocultar":"Ver")+" nombres locales de "+g.name}>
        {expanded===g.id?<ChevronDown size={17}/>:<ChevronRight size={17}/>}</button>
       <div className="fm-family-title">
        {g.members.length===1&&editing===g.members[0].id?
         <form onSubmit={e=>{e.preventDefault();saveName(g.members[0])}} className="fm-family-rename">
          <input aria-label="Nombre de familia" autoFocus maxLength={200} value={newName}
           onChange={e=>setNewName(e.target.value)}/>
          <button className="btn btn-primary btn-sm" disabled={busy} type="submit"><Check size={15}/>Guardar</button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={()=>setEditing(null)}>Cancelar</button>
         </form>:
         <strong>{g.name}</strong>}
        <div className="fm-family-meta">
         {g.segments.map(segment=><span key={segment}>{SEGMENTS[segment]||segment}</span>)}
         {g.members.length>1&&<span>{g.members.length} clasificaciones agrupadas</span>}
         {g.members.length===1&&g.referencePharmacy&&<span>Referencia: {pharmacyName(g.referencePharmacy)}</span>}
        </div>
       </div>
       {g.members.length===1&&editing!==g.members[0].id?
        <button className="fm-family-link" disabled={busy}
         onClick={()=>{setEditing(g.members[0].id);setNewName(g.members[0].name)}}>Editar nombre</button>:
        g.members.length>1&&<button className="fm-family-link"
         onClick={()=>expand(g)}>{expanded===g.id?"Ocultar detalle":"Ver clasificaciones"}</button>}
      </div>
      {expanded===g.id&&<div className="fm-family-origins">
       <div className="fm-family-origins-title">Nombre de esta familia en cada farmacia</div>
       {g.members.map(member=><section className="fm-family-variant" key={member.id}>
        {g.members.length>1&&<div className="fm-family-variant-head">
         <div className="fm-family-variant-label">
          <strong>{SEGMENTS[member.segment]||member.segment}</strong>
          <span>{member.name}</span>
          {member.referencePharmacy&&<small>Referencia: {pharmacyName(member.referencePharmacy)}</small>}
         </div>
         {editing===member.id?
          <form onSubmit={e=>{e.preventDefault();saveName(member)}} className="fm-family-rename">
           <input aria-label={"Nombre de "+(SEGMENTS[member.segment]||"familia")} autoFocus
            maxLength={200} value={newName} onChange={e=>setNewName(e.target.value)}/>
           <button className="btn btn-primary btn-sm" disabled={busy} type="submit"><Check size={15}/>Guardar</button>
           <button className="btn btn-secondary btn-sm" type="button" onClick={()=>setEditing(null)}>Cancelar</button>
          </form>:
          <button className="fm-family-link" disabled={busy}
           onClick={()=>{setEditing(member.id);setNewName(member.name)}}>Editar nombre</button>}
        </div>}
        {originsBusy===g.id&&!origins[member.id]?<p>Consultando nombres locales…</p>:
         !(origins[member.id]||[]).length?<p>Sin denominaciones locales vinculadas.</p>:
         groupOrigins(origins[member.id]).map(([code,items])=>
          <div className="fm-family-pharmacy" key={code}>
           <strong>{pharmacyName(code)}</strong>
           <div>{items.map(origin=><div className="fm-family-local" key={origin.sourceCode}>
            <span title={"Código local "+origin.sourceCode}>{origin.sourceName||"Sin nombre local"}</span>
            {view==="pendientes"&&options.length>0&&<label className="fm-family-assign">
             <span>Vincular a</span>
             <select aria-label={"Vincular "+origin.sourceCode+" de "+pharmacyName(code)}
              value={destinations[code+"|"+origin.sourceCode]||""}
              disabled={busy} onChange={e=>setDestinations(old=>({...old,[code+"|"+origin.sourceCode]:e.target.value}))}>
              <option value="">Elegir familia global</option>
              {options.map(target=><option key={target.id} value={target.id}>{target.name} · {SEGMENTS[target.segment]}</option>)}
             </select>
             <button type="button" className="btn btn-primary btn-sm"
              disabled={busy||!destinations[code+"|"+origin.sourceCode]}
              onClick={()=>relink(origin,destinations[code+"|"+origin.sourceCode])}>Asignar</button>
            </label>}
           </div>)}</div>
          </div>)}
       </section>)}
      </div>}
     </article>)}
    </div>}
   {view==="pendientes"&&page*30<total&&<div className="fm-families-pages">
    <button className="btn btn-secondary btn-sm" disabled={page===1||loading}
     onClick={()=>{setPage(p=>Math.max(1,p-1));setExpanded(null)}}>Anterior</button>
    <span>Página {page}</span>
    <button className="btn btn-secondary btn-sm" disabled={loading}
     onClick={()=>{setPage(p=>p+1);setExpanded(null)}}>Siguiente</button>
   </div>}
   {view==="pendientes"&&page>1&&page*30>=total&&<div className="fm-families-pages">
    <button className="btn btn-secondary btn-sm" onClick={()=>setPage(p=>p-1)}>Anterior</button>
    <span>Página {page}</span>
   </div>}
  </section>
 </div>;
}
