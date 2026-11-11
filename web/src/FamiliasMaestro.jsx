import React,{useEffect,useMemo,useState} from "react";
import {GitMerge,RefreshCcw,Search,Save,ChevronDown,ChevronUp,Link2,Layers3} from "lucide-react";
import "./familiasMaestro.css";

const METHODS={referencia:"Referencia principal",coincidencia_cn:"Coincidencia por CN",
 coincidencia_nombre:"Nombre exacto de referencia",nombre_compartido:"Nombre compartido entre farmacias",
 sin_referencia:"Pendiente de unificar",manual:"Vinculación manual"};
const SEGMENTS={MEDICACION:"Medicación",PARAFARMACIA:"Parafarmacia",SIN_DETERMINAR:"Por revisar"};
const count=n=>new Intl.NumberFormat("es-ES").format(Number(n)||0);
async function api(slug,path,options={}){
 const response=await fetch(path,{credentials:"same-origin",cache:"no-store",...options,
  headers:{"Content-Type":"application/json","X-Farmetrica-Cliente":slug,...options.headers}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||"No se pudo completar la operación");
 return data;
}
export default function FamiliasMaestro({clientSlug}){
 const [data,setData]=useState({items:[]}),[search,setSearch]=useState(""),[segment,setSegment]=useState("todas");
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(""),
  [notice,setNotice]=useState(""),[lastRun,setLastRun]=useState(null);
 const [editing,setEditing]=useState(null),[name,setName]=useState("");
 const [expanded,setExpanded]=useState(null),[articleSamples,setArticleSamples]=useState({});
 const [selection,setSelection]=useState([]),[destination,setDestination]=useState("");
 const refresh=async()=>{
  const result=await api(clientSlug,"/api/tenant/familias-globales");
  setData(result);
 };
 useEffect(()=>{
  let active=true;
  setLoading(true);setError("");setNotice("");setLastRun(null);setSelection([]);
  api(clientSlug,"/api/tenant/familias-globales")
   .then(result=>{if(active)setData(result)})
   .catch(e=>{if(active)setError(e.message)})
   .finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[clientSlug]);
 const all=data.items||[];
 const visible=useMemo(()=>all.filter(g=>{
  if(segment!=="todas"&&
   (segment==="pendientes"?!g.origins.some(x=>x.method==="sin_referencia"):g.segment!==segment))
   return false;
  const haystack=[g.name,g.key,g.segment,
   ...g.origins.flatMap(o=>[o.pharmacyCode,o.sourceCode,o.sourceName])]
   .join(" ").toLocaleLowerCase("es");
  return haystack.includes(search.trim().toLocaleLowerCase("es"));
 }),[all,search,segment]);
 const linked=all.reduce((n,g)=>n+Number(g.articles||0),0);
 const unresolved=all.filter(g=>g.segment==="SIN_DETERMINAR").length;
 async function act(fn,message){
  setBusy(true);setError("");setNotice("");
  try{const result=await fn();await refresh();setNotice(message);return result}
  catch(e){setError(e.message);return null}finally{setBusy(false)}
 }
 async function reconcile(){
  const result=await act(()=>api(clientSlug,"/api/tenant/familias-globales/reconciliar",
   {method:"POST"}),"Análisis finalizado. Se han conservado las asignaciones manuales.");
  if(result){setLastRun(result);setArticleSamples({});setSelection([]);}
 }
 async function rename(id){
  const value=name.trim();
  if(value.length<2)return setError("Indica un nombre de familia válido.");
  const result=await act(()=>api(clientSlug,"/api/tenant/familias-globales/"+id,
   {method:"PUT",body:JSON.stringify({name:value})}),"Nombre global actualizado.");
  if(result)setEditing(null);
 }
 async function relink(g,origin,to){
  if(String(g.id)===to)return;
  const result=await act(()=>api(clientSlug,"/api/tenant/familias-globales/"+to+"/origen",
   {method:"PUT",body:JSON.stringify({pharmacyCode:origin.pharmacyCode,sourceCode:origin.sourceCode})}),
   "La familia de origen y sus artículos asociados se han vinculado.");
  if(result)setArticleSamples({});
 }
 async function merge(){
  if(!destination||!selection.length||selection.includes(destination))return;
  const label=all.find(x=>x.id===destination)?.name||"la familia elegida";
  if(!window.confirm("¿Unificar "+selection.length+" familias en «"+label+"»? Se conservarán sus códigos de origen."))return;
  const result=await act(()=>api(clientSlug,"/api/tenant/familias-globales/fusionar",
   {method:"POST",body:JSON.stringify({destination,sources:selection})}),
   "Familias unificadas. Los artículos mantienen su trazabilidad con el origen.");
  if(result){setSelection([]);setDestination("");setArticleSamples({});}
 }
 async function toggleSamples(g){
  if(expanded===g.id){setExpanded(null);return}
  setExpanded(g.id);
  if(articleSamples[g.id])return;
  try{
   const result=await api(clientSlug,"/api/tenant/familias-globales/"+g.id+"/articulos");
   setArticleSamples(prev=>({...prev,[g.id]:result.items}));
  }catch(e){setError(e.message);}
 }
 return <div className="fm-families">
  <div className="page-header fm-families-heading">
   <div><h1>Maestro de familias</h1><p>Identidad global editable por cliente, equivalencias de cada farmacia y artículos vinculados.</p></div>
   <button type="button" className="btn btn-primary" onClick={reconcile} disabled={busy||loading}>
    <RefreshCcw size={17} className={busy?"fm-families-spin":""}/>{busy?"Analizando…":"Analizar y unificar"}</button>
  </div>
  <section className="card fm-families-summary">
   <div><span>Familias globales</span><strong>{count(all.length)}</strong></div>
   <div><span>Artículos vinculados</span><strong>{count(linked)}</strong></div>
   <div><span>Familias por revisar</span><strong>{count(unresolved)}</strong></div>
  </section>
  <p className="fm-families-source">
   <Layers3 size={18}/> Referencias: <strong>Almacén</strong> para CN 000000–399999 y
   <strong> Abadía</strong> desde CN 400000. Se compara el mismo artículo en distintas farmacias;
   los códigos de familia locales no se equiparan por su número.
  </p>
  {lastRun&&<section className="card fm-families-result" role="status">
   <strong>Resultado de la conciliación</strong>
   <p>{count(lastRun.localFamilies)} familias locales analizadas · {count(lastRun.references)} familias de referencia · {count(lastRun.linked)} artículos vinculados.</p>
   {lastRun.unresolved>0&&<p>{count(lastRun.unresolved)} artículos sin relación demostrable permanecen sin categorizar.</p>}
   {!lastRun.namesAvailable&&<p>No se encuentra el catálogo de nombres de familias sincronizado. Los nombres desconocidos se muestran como «Familia [código]» hasta importar ese catálogo o editarlos.</p>}
  </section>}
  {notice&&<p className="fm-families-notice" role="status">{notice}</p>}
  {error&&<p className="fm-families-error" role="alert">{error}</p>}
  <section className="card fm-families-directory">
   <div className="fm-families-controls">
    <label className="fm-families-search"><Search size={17}/>
     <input type="search" placeholder="Buscar nombre, código o farmacia…" value={search} onChange={e=>setSearch(e.target.value)}/>
    </label>
    <select value={segment} onChange={e=>setSegment(e.target.value)} aria-label="Filtrar familias">
     <option value="todas">Todas las familias</option>
     <option value="PARAFARMACIA">Parafarmacia</option>
     <option value="MEDICACION">Medicación</option>
     <option value="pendientes">Pendientes de unificar</option>
    </select>
    <span className="fm-families-counter">{count(visible.length)} resultados</span>
   </div>
   {selection.length>0&&<div className="fm-families-merge">
    <GitMerge size={17}/><strong>{selection.length} seleccionadas</strong>
    <select aria-label="Familia de destino" value={destination} onChange={e=>setDestination(e.target.value)}>
     <option value="">Unificar en…</option>
     {all.filter(g=>!selection.includes(g.id)).map(g=><option key={g.id} value={g.id}>{g.name} ({SEGMENTS[g.segment]})</option>)}
    </select>
    <button className="btn btn-primary" disabled={!destination||busy} onClick={merge}>Unificar</button>
    <button className="btn btn-secondary" onClick={()=>{setSelection([]);setDestination("")}}>Cancelar</button>
   </div>}
   {loading?<p className="fm-families-empty">Cargando maestro…</p>:
    !all.length?<p className="fm-families-empty">Todavía no hay familias globales. Pulsa «Analizar y unificar» para construir el maestro a partir de los datos sincronizados.</p>:
    !visible.length?<p className="fm-families-empty">No hay familias para esos filtros.</p>:
    <div className="fm-families-list">{visible.map(g=><article className="fm-family-row" key={g.id}>
     <div className="fm-family-main">
      <label className="fm-family-select" title="Seleccionar para unificar">
       <input type="checkbox" checked={selection.includes(g.id)}
        onChange={e=>setSelection(old=>e.target.checked?[...old,g.id]:old.filter(x=>x!==g.id))}
        aria-label={"Seleccionar "+g.name}/>
      </label>
      <div className="fm-family-title">
       {editing===g.id?
        <form onSubmit={e=>{e.preventDefault();rename(g.id)}}>
         <input value={name} onChange={e=>setName(e.target.value)} maxLength={200} autoFocus aria-label="Nombre global"/>
         <button className="btn btn-primary btn-sm" disabled={busy} type="submit"><Save size={15}/>Guardar</button>
         <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setEditing(null)}>Cancelar</button>
        </form>:
        <div className="fm-family-title-line"><strong>{g.name}</strong>
         <button className="fm-family-link" disabled={busy} onClick={()=>{setEditing(g.id);setName(g.name)}}>Editar nombre</button>
        </div>}
       <div className="fm-family-meta">
        <span>{SEGMENTS[g.segment]}</span><span>{g.origins.length} códigos de origen</span>
        <span>{count(g.articles)} artículos</span>
        {g.referencePharmacy&&<span>Referencia {g.referencePharmacy}: {g.referenceCode}</span>}
       </div>
      </div>
      <button type="button" className="fm-family-expand" onClick={()=>toggleSamples(g)}
       aria-expanded={expanded===g.id}>
       <span>Ver artículos</span>{expanded===g.id?<ChevronUp size={16}/>:<ChevronDown size={16}/>}
      </button>
     </div>
     <div className="fm-family-origins">
      {g.origins.map(o=><div className="fm-family-origin" key={o.pharmacyCode+"|"+o.sourceCode}>
       <div><strong>{o.pharmacyCode}</strong><span className="fm-family-code">Código {o.sourceCode}</span>
        <span>{o.sourceName||"Sin nombre local"}</span>
        <small>{METHODS[o.method]||o.method}{o.matches>0?" · "+count(o.matches)+" CN":""}</small></div>
       <label><span className="fm-family-origin-label"><Link2 size={13}/> Vincular a</span>
        <select disabled={busy} value={g.id} onChange={e=>relink(g,o,e.target.value)}
         aria-label={"Vincular familia "+o.sourceCode+" de "+o.pharmacyCode}>
         {all.map(target=><option key={target.id} value={target.id}>{target.name} ({SEGMENTS[target.segment]})</option>)}
        </select></label>
      </div>)}
     </div>
     {expanded===g.id&&<div className="fm-family-examples">
      <strong>Ejemplos de artículos asociados (máximo 50)</strong>
      {!articleSamples[g.id]?<p>Cargando artículos…</p>:
       !articleSamples[g.id].length?<p>Sin artículos asociados.</p>:
       <div className="fm-family-example-grid">{articleSamples[g.id].map((a,i)=>
        <div key={a.pharmacyCode+"|"+a.cn+"|"+i}>
         <span>{a.pharmacyCode}</span><strong>{a.cn}</strong>
         <span>{a.name}</span><small>{a.method==="referencia_cn"?"Por CN de referencia":"Por familia local"}</small>
        </div>)}</div>}
     </div>}
    </article>)}</div>}
  </section>
 </div>;
}
