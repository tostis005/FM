import React,{useCallback,useEffect,useState} from "react";
import {ChevronDown,ChevronRight,Check,RefreshCcw,Search} from "lucide-react";
import "./familiasMaestro.css";

const count=n=>new Intl.NumberFormat("es-ES").format(Number(n)||0);
const EMPTY={unicas:0,maestros:0,pendientes:0};
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
 const view="todas";
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

 // Listado único de familias, sin clasificaciones visibles ni consultas a artículos.
 // Los nombres locales se consultan solo al desplegar.
 const load=useCallback(async(which=view,filter=query,currentPage=page)=>{
  const params=new URLSearchParams({view:which});
  if(filter)params.set("q",filter);
  if(which==="pendientes")params.set("page",String(currentPage));
  const result=await api(clientSlug,"/api/tenant/familias-globales?"+params.toString());
  setRecords(result.groups||[]);
  setSummary(result.summary||EMPTY);
  setTotal(Number(result.total)||0);
  if(which==="todas"&&!filter)setMasterItems(result.groups||[]);
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
    if(view==="todas"&&!query)setMasterItems(result.groups||[]);
   }).catch(err=>{if(alive)setError(err.message)})
   .finally(()=>{if(alive)setLoading(false)});
  return()=>{alive=false};
 },[clientSlug,view,query,page]);
 const visible=records;
 const options=masterItems.filter(g=>g.confirmed).flatMap(g=>g.members);
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
 return <div className="fm-families">
  <header className="fm-families-heading">
   <div><h1>Maestro de familias</h1>
    <p>Todas las familias, de la A a la Z y sin nombres duplicados. Consulta sus denominaciones locales y edita sus vínculos.</p></div>
   <button className="btn btn-secondary btn-sm fm-families-reconcile" onClick={reconcile} disabled={busy||loading}>
    <RefreshCcw size={15} className={busy?"fm-families-spin":""}/>
    {busy?"Reconciliando…":"Volver a unificar"}</button>
  </header>
  <div className="fm-families-kpis">
   <div><span>Familias únicas</span><strong>{count(summary.unicas)}</strong></div>
   <div><span>Pendientes de vincular</span><strong>{count(summary.pendientes)}</strong></div>
  </div>
  <section className="card fm-families-directory">
   <div className="fm-families-filters">
    <label className="fm-families-search"><Search size={17}/>
     <input type="search" placeholder="Buscar familia…" value={search} onChange={e=>setSearch(e.target.value)}
      aria-label="Buscar familia global"/></label>
    <small>{count(visible.length)} familias únicas</small>
   </div>
   <p className="fm-families-note">
    Cada nombre aparece una sola vez, aunque tenga varios vínculos de origen o exista en varias farmacias. Las familias pendientes de vincular también se muestran.</p>
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
         {g.members.length>1&&<span>{g.members.length} vínculos internos</span>}
         {!g.confirmed&&<span>Pendiente de validar</span>}
         {g.members.length===1&&g.referencePharmacy&&<span>Referencia: {pharmacyName(g.referencePharmacy)}</span>}
        </div>
       </div>
       {g.members.length===1&&editing!==g.members[0].id?
        <button className="fm-family-link" disabled={busy}
         onClick={()=>{setEditing(g.members[0].id);setNewName(g.members[0].name)}}>Editar nombre</button>:
        g.members.length>1&&<button className="fm-family-link"
         onClick={()=>expand(g)}>{expanded===g.id?"Ocultar detalle":"Ver detalles"}</button>}
      </div>
      {expanded===g.id&&<div className="fm-family-origins">
       <div className="fm-family-origins-title">Nombre de esta familia en cada farmacia</div>
       {g.members.map((member,index)=><section className="fm-family-variant" key={member.id}>
        {g.members.length>1&&<div className="fm-family-variant-head">
         <div className="fm-family-variant-label">
          <strong>Vínculo {index+1}</strong>
          <span>{member.name}</span>
          {member.referencePharmacy&&<small>Referencia: {pharmacyName(member.referencePharmacy)}</small>}
         </div>
         {editing===member.id?
          <form onSubmit={e=>{e.preventDefault();saveName(member)}} className="fm-family-rename">
           <input aria-label={"Nombre de la familia, vínculo "+(index+1)} autoFocus
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
            {!member.referencePharmacy&&!member.customName&&options.length>0&&<label className="fm-family-assign">
             <span>Vincular a</span>
             <select aria-label={"Vincular "+origin.sourceCode+" de "+pharmacyName(code)}
              value={destinations[code+"|"+origin.sourceCode]||""}
              disabled={busy} onChange={e=>setDestinations(old=>({...old,[code+"|"+origin.sourceCode]:e.target.value}))}>
              <option value="">Elegir familia global</option>
              {options.map(target=><option key={target.id} value={target.id}>{target.name}{target.referencePharmacy?" · "+pharmacyName(target.referencePharmacy):""}</option>)}
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
  </section>
 </div>;
}
