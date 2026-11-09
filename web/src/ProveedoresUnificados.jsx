import React,{useEffect,useMemo,useState} from "react";
import {Check,ChevronRight,GitMerge,RefreshCcw,Search,SlidersHorizontal,Users,FlaskConical,Truck,Building2,Link2,Plus,FolderOpen} from "lucide-react";
import HorizontalTableScroll from "./HorizontalTableScroll.jsx";
import ListTable from "./ListTable.jsx";
import {LoadingStatus} from "./LoadingState.jsx";
import SupplierWorkspace,{SupplierCategories} from "./SupplierWorkspace.jsx";
import {isLaboratory,supplierMergeSuggestions} from "./laboratoryUnificationSuggestions.js";
import "./supplierUnifiedAgenda.css";

const TYPES=["DIRECTO","MAYORISTA","INTERNO","OTROS","VACUNAS","FÓRMULAS","SIN_CLASIFICAR"];
const LABELS={DIRECTO:"Laboratorio",MAYORISTA:"Mayorista / cooperativa",INTERNO:"Interno",OTROS:"Otros / servicios",
 VACUNAS:"Vacunas",FÓRMULAS:"Fórmulas",SIN_CLASIFICAR:"Sin clasificar"};
const cleanCode=x=>String(x??"").trim().toUpperCase().replace(/^0+(?=\d)/,"");
const TABS=[["todos","Todos"],["laboratorios","Laboratorios"],["mayoristas","Mayoristas"],["internos","Internos"],["otros","Otros / servicios"],["sin_clasificar","Sin clasificar"],["pendientes","Sin vincular"]];
async function api(slug,path,options={}){
 const r=await fetch(path,{credentials:"same-origin",cache:"no-store",...options,
  headers:{"Content-Type":"application/json","X-Farmetrica-Cliente":slug,...options.headers}});
 const result=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(result.error||"No se pudo completar la operación");
 return result;
}
function parseCsv(text){
 const records=[];let row=[],cell="",quoted=false;
 text=String(text).replace(/^\uFEFF/,"");
 for(let i=0;i<text.length;i++){
  const c=text[i];if(c==='"'){
   if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted;
  }else if(!quoted&&(c===","||c==="\n")){
   row.push(cell.trim());cell="";if(c==="\n"){records.push(row);row=[]}
  }else if(c!=="\r"||quoted)cell+=c;
 }
 if(quoted)throw Error("Comillas incorrectas en el CSV");
 if(cell||row.length){row.push(cell.trim());records.push(row)}
 const keys=records.shift()||[],at=name=>keys.indexOf(name);
 if(["ID_UN","ID PROV","NOMBRE PROV","ID PROV NUEVO","NOMBRE PROV NUEVO","TIPO","FECHA"].some(k=>at(k)<0))
  throw Error("El archivo no tiene las columnas del CSV de equivalencias");
 return records.filter(r=>r.some(Boolean)).map(r=>({
  pharmacyCode:r[at("ID_UN")],sourceCode:r[at("ID PROV")],sourceName:r[at("NOMBRE PROV")],
  targetCode:r[at("ID PROV NUEVO")],targetName:r[at("NOMBRE PROV NUEVO")],
  class:r[at("TIPO")],validity:r[at("FECHA")]
 }));
}
const Frequency=({value,onChange,disabled,name})=><select aria-label={"Frecuencia de "+name}
 value={value==null?"demanda":String(value)} onChange={e=>onChange(e.target.value)}
 disabled={disabled} className="fm-master-frequency">
 <option value="demanda">Bajo demanda</option>
 {Array.from({length:10},(_,i)=><option key={i+1} value={i+1}>Cada {i+1} {i===0?"día":"días"}</option>)}
 {[14,21,30].map(x=><option key={x} value={x}>Cada {x} días</option>)}
 </select>;

export default function ProveedoresUnificados({clientSlug,canEditMaster=false,canMergeMaster=false}){
 const [suppliers,setSuppliers]=useState([]),[sources,setSources]=useState([]),
  [pharmacies,setPharmacies]=useState([]),[frequencies,setFrequencies]=useState([]);
 const [tab,setTab]=useState("todos"),[search,setSearch]=useState(""),
  [editing,setEditing]=useState(null),[linking,setLinking]=useState(null),[chosen,setChosen]=useState(""),
  [selected,setSelected]=useState([]),[mergeTo,setMergeTo]=useState(""),
  [limit,setLimit]=useState(60),[showSuggestions,setShowSuggestions]=useState(false),
  [newOriginType,setNewOriginType]=useState("DIRECTO"),
  [selectedSupplier,setSelectedSupplier]=useState(null),[categoryView,setCategoryView]=useState(false);
 const [loading,setLoading]=useState(true),[loadedOnce,setLoadedOnce]=useState(false),
  [busy,setBusy]=useState(false),
  [error,setError]=useState(""),[notice,setNotice]=useState("");
 async function refresh(){
  setLoading(true);setError("");
  try{
   const [p,s,f,q]=await Promise.all([
    api(clientSlug,"/api/tenant/proveedores-unificados"),
    canEditMaster?api(clientSlug,"/api/tenant/proveedores"):Promise.resolve([]),
    canEditMaster?api(clientSlug,"/api/tenant/farmacias"):Promise.resolve([]),
    canMergeMaster?api(clientSlug,"/api/tenant/pedidos/frecuencias").catch(()=>({items:[]})):Promise.resolve({items:[]})]);
   setSuppliers(Array.isArray(p)?p:[]);setSources(Array.isArray(s)?s:[]);
   setPharmacies(Array.isArray(f)?f:[]);setFrequencies(q.items||[]);
   setLoadedOnce(true);
  }catch(e){setError(e.message)}
  finally{setLoading(false)}
 }
 useEffect(()=>{void refresh()},[clientSlug,canEditMaster,canMergeMaster]);
 const linked=useMemo(()=>new Set(suppliers.flatMap(p=>(p.origins||[]).map(o=>
  String(o.pharmacyCode).toUpperCase()+"|"+cleanCode(o.sourceCode)))),[suppliers]);
 const pending=useMemo(()=>{
  const rows=sources.flatMap(p=>(p.origins||[])
   .filter(o=>o.pharmacyId&&(o.source==="farmatic"||o.source==="recepciones"))
   .map(o=>{
    const f=pharmacies.find(f=>String(f.id)===String(o.pharmacyId));
    return f?{pharmacyCode:String(f.databaseCode||f.sourceCode).toUpperCase(),
     pharmacyName:f.name,sourceCode:p.sourceCode,name:o.name||p.name}:null;
   }).filter(Boolean)).filter(x=>!linked.has(x.pharmacyCode+"|"+cleanCode(x.sourceCode)));
  return [...new Map(rows.map(x=>[x.pharmacyCode+"|"+cleanCode(x.sourceCode),x])).values()];
 },[sources,pharmacies,linked]);
 const suggestions=useMemo(()=>supplierMergeSuggestions(suppliers),[suppliers]);
 const counts={todos:suppliers.length,laboratorios:suppliers.filter(isLaboratory).length,
  mayoristas:suppliers.filter(x=>x.class==="MAYORISTA").length,
  internos:suppliers.filter(x=>x.class==="INTERNO").length,
  otros:suppliers.filter(x=>x.class==="OTROS").length,
  sin_clasificar:suppliers.filter(x=>x.class==="SIN_CLASIFICAR").length,
  pendientes:pending.length};
 const visible=useMemo(()=>suppliers.filter(p=>{
  const inTab=tab==="todos"||tab==="laboratorios"&&isLaboratory(p)||
   tab==="mayoristas"&&p.class==="MAYORISTA"||
   tab==="internos"&&p.class==="INTERNO"||
   tab==="otros"&&p.class==="OTROS"||
   tab==="sin_clasificar"&&p.class==="SIN_CLASIFICAR";
  if(!inTab)return false;
  const haystack=[p.name,p.key,LABELS[p.class],...(p.origins||[]).flatMap(x=>[x.sourceName,x.sourceCode,x.pharmacyCode])].join(" ").toLocaleLowerCase("es");
  return haystack.includes(search.trim().toLocaleLowerCase("es"));
 }),[tab,suppliers,search]);
 const matches=pending.filter(p=>[p.name,p.pharmacyName,p.sourceCode].join(" ")
  .toLocaleLowerCase("es").includes(search.trim().toLocaleLowerCase("es")));
 const frequenciesByKey=new Map(frequencies.map(f=>[f.key,f.days]));
 const checked=new Set(selected),canMerge=tab==="laboratorios"&&canMergeMaster;
 const destinations=suppliers.filter(isLaboratory).filter(p=>!checked.has(String(p.id))&&
  selected.every(id=>suppliers.find(x=>String(x.id)===id)?.class===p.class));
 const changeTab=value=>{setTab(value);setSearch("");setLimit(60);setSelected([]);setMergeTo("");setShowSuggestions(false)};
 async function act(fn,success){
  setBusy(true);setError("");setNotice("");
  try{await fn();if(success)setNotice(success);await refresh()}
  catch(e){setError(e.message)}
  finally{setBusy(false)}
 }
 function editSupplier(p){setEditing({id:p?.id,name:p?.name||"",class:p?.class||"SIN_CLASIFICAR"})}
 async function save(){
  const p=editing;
  if(!p||!p.name.trim())return;
  await act(async()=>{
   await api(clientSlug,p.id?"/api/tenant/proveedores-unificados/"+p.id:"/api/tenant/proveedores-unificados",{
    method:p.id?"PUT":"POST",body:JSON.stringify({name:p.name.trim(),class:p.class})});
   setEditing(null);
  },"Proveedor guardado");
 }
 async function setType(p,value){
  if(p.class===value)return;
  await act(()=>api(clientSlug,"/api/tenant/proveedores-unificados/"+p.id,{
   method:"PUT",body:JSON.stringify({name:p.name,class:value})}),"Tipo actualizado para "+p.name);
 }
 async function saveFrequency(p,value){
  await act(()=>api(clientSlug,"/api/tenant/pedidos/frecuencias",{
   method:"PUT",body:JSON.stringify({key:"P:"+p.id,days:value==="demanda"?null:Number(value)})}),
   "Frecuencia actualizada para "+p.name);
 }
 async function link(){
  if(!linking||!chosen)return;
  const p=linking;
  await act(async()=>{
   await api(clientSlug,"/api/tenant/proveedores-unificados/"+chosen+"/origen",{
    method:"PUT",body:JSON.stringify({pharmacyCode:p.pharmacyCode,sourceCode:p.sourceCode,sourceName:p.name})});
   setLinking(null);setChosen("");
  },"Código de Farmatic vinculado");
 }
 async function classifyOrigin(){
  if(!linking)return;
  const p=linking;
  await act(async()=>{
   await api(clientSlug,"/api/tenant/proveedores-unificados/clasificar-origen",{
    method:"POST",body:JSON.stringify({name:p.name,class:newOriginType,
     pharmacyCode:p.pharmacyCode,sourceCode:p.sourceCode,sourceName:p.name})});
   setLinking(null);setChosen("");
  },"Origen clasificado; los mayoristas e internos permanecen separados");
 }
 async function merge(ids=selected,dest=mergeTo){
  const from=ids.map(String);
  const target=suppliers.find(p=>String(p.id)===String(dest));
  if(!from.length||!target||!isLaboratory(target)||from.some(id=>id===String(dest)||
   !isLaboratory(suppliers.find(p=>String(p.id)===id))||
   suppliers.find(p=>String(p.id)===id).class!==target.class))return;
  if(!window.confirm("¿Unificar "+from.length+" laboratorio(s) dentro de "+target.name+
   "? Los códigos y fechas de pedido pasarán a la identidad definitiva."))return;
  await act(async()=>{
   const r=await api(clientSlug,"/api/tenant/proveedores-unificados/fusionar",{
    method:"POST",body:JSON.stringify({destino:String(dest),origenes:from})});
   setSelected([]);setMergeTo("");
   setNotice("Se han unificado "+r.merged+" laboratorios");
  },"Laboratorios unificados bajo "+target.name);
 }
 async function importFile(file){
  if(!file)return;
  await act(async()=>{
   const rows=parseCsv(await file.text());
   const data=await api(clientSlug,"/api/tenant/proveedores-unificados/importar",{
    method:"POST",body:JSON.stringify({rows})});
   setNotice("Importadas "+data.newAliases+" equivalencias");
  },"Equivalencias importadas");
 }
 const tableColumns=[
  {key:"name",label:"Proveedor",value:p=>p.name,render:p=><div className="fm-master-name">
   <button type="button" className="fm-master-name-link" onClick={e=>{e.stopPropagation();setSelectedSupplier(p.id)}}>{p.name}</button>
   <small>Proveedor #{p.id}</small></div>},
  {key:"class",label:"Tipo",value:p=>LABELS[p.class]||p.class,filterMode:"multi",
   render:p=>canEditMaster?<div onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
    <select aria-label={"Tipo de "+p.name} className="fm-master-type" value={p.class} disabled={busy}
     onChange={e=>void setType(p,e.target.value)}>{TYPES.map(t=><option key={t} value={t}>{LABELS[t]}</option>)}</select>
    <small className="fm-master-type-caption">{LABELS[p.class]}</small>
   </div>:<span className="fm-master-readonly-type">{LABELS[p.class]||p.class}</span>},
  {key:"origins",label:"Origen en farmacias",value:p=>(p.origins||[]).map(o=>[o.pharmacyCode,o.sourceCode,o.sourceName].join(" ")).join(" "),
   render:p=><details className="fm-master-origins" onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
    <summary><Link2 size={14}/> {p.origins?.length||0} {(p.origins||[]).length===1?"código":"códigos"}</summary>
    <div className="fm-supplier-alias-list">{(p.origins||[]).map((o,i)=><div className="fm-master-alias" key={i}>
     <span>{o.pharmacyCode} · {o.sourceCode}</span><small>{o.sourceName}</small>
     {canEditMaster&&<button type="button" className="btn btn-secondary btn-sm" onClick={()=>{setLinking({pharmacyCode:o.pharmacyCode,sourceCode:o.sourceCode,name:o.sourceName});setChosen("")}}>Reasignar</button>}
    </div>)}</div></details>},
  ...(canMerge?[{key:"frequency",label:"Frecuencia de pedido",value:p=>frequenciesByKey.get("P:"+p.id)||"demanda",
   searchable:false,render:p=><div onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
    <Frequency value={frequenciesByKey.get("P:"+p.id)} name={p.name} disabled={busy||!canEditMaster} onChange={v=>void saveFrequency(p,v)}/></div>}]:[]),
  {key:"actions",label:"Acciones",value:()=>"",sortable:false,searchable:false,
   render:p=><div className="fm-workspace-actions" onClick={e=>e.stopPropagation()}>
    <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setSelectedSupplier(p.id)}>Ver ficha y documentos</button>
    {canEditMaster&&<button type="button" className="btn btn-secondary btn-sm" onClick={()=>editSupplier(p)}>Editar</button>}
   </div>}
 ];
 const pendingColumns=[
  {key:"name",label:"Proveedor de origen",value:p=>p.name,render:p=><strong>{p.name}</strong>},
  {key:"pharmacyName",label:"Farmacia",value:p=>p.pharmacyName},
  {key:"sourceCode",label:"Código Farmatic",value:p=>p.sourceCode},
  {key:"actions",label:"Acción",value:()=>"",sortable:false,searchable:false,
   render:p=>canEditMaster?<button type="button" className="btn btn-secondary btn-sm" onClick={()=>{setLinking(p);setChosen("");setNewOriginType("DIRECTO")}}>Clasificar / vincular <ChevronRight size={14}/></button>:<span className="fm-muted">Solo lectura</span>}
 ];
 if(categoryView&&canEditMaster)return <SupplierCategories clientSlug={clientSlug} onBack={()=>setCategoryView(false)}/>;
 if(selectedSupplier)return <SupplierWorkspace clientSlug={clientSlug} supplierId={selectedSupplier}
  onBack={()=>{setSelectedSupplier(null);void refresh()}} onSupplierChanged={()=>void refresh()} onCategories={()=>setCategoryView(true)}/>;
 const nPending=tab==="pendientes"&&canEditMaster;
 return <div className="fm-management fm-production-panel fm-unified-master">
  <header className="fm-supplier-head">
   <div className="fm-supplier-heading">
    <span className="fm-master-eyebrow"><Users size={14}/> Proveedores · Directorio compartido</span>
    <h1>{canEditMaster?"Maestro de proveedores":"Directorio de proveedores"}</h1>
    <p>{canEditMaster?"Gestiona proveedores, contactos y documentación de todo el grupo. Los cambios se comparten entre farmacias.":
      "Consulta las fichas, contactos y documentos compartidos del grupo de farmacias."}</p>
   </div>
   <div className="fm-master-header-actions">
    {canEditMaster&&<button type="button" className="btn btn-secondary fm-master-categories-button" aria-label="Configurar categorías documentales" title="Configurar categorías documentales" onClick={()=>setCategoryView(true)}><FolderOpen size={15}/><span>Categorías</span></button>}
    <button type="button" className="btn btn-secondary" disabled={loading||busy} onClick={()=>void refresh()}><RefreshCcw size={15}/> Actualizar</button>
    {canEditMaster&&<button type="button" className="btn btn-primary" disabled={busy} onClick={()=>editSupplier(null)}><Plus size={16}/> Nuevo proveedor</button>}
   </div>
  </header>
  {loading&&<div className="fm-master-loading-indicator">
   <LoadingStatus label={loadedOnce?"Actualizando información de proveedores…":"Cargando información de proveedores…"} />
  </div>}
  {error&&<div className="fm-master-alert" role="alert">{error}</div>}
  {notice&&<div className="fm-master-notice" role="status"><Check size={15}/>{notice}</div>}
  <div className="fm-supplier-summary">
   {[[ "todos","Todos",Users],["laboratorios","Laboratorios",FlaskConical],["mayoristas","Mayoristas",Truck],["internos","Internos",Building2],["otros","Otros / servicios",Link2]].map(([key,title,Icon])=>
    <button key={key} type="button" onClick={()=>changeTab(key)}
     className={"fm-supplier-summary-item"+(tab===key?" is-selected":"")} aria-pressed={tab===key}>
     <span><Icon size={16}/>{title}</span><strong aria-busy={loading}>
      {loadedOnce?counts[key]:loading?<span className="fm-load-spinner" aria-hidden="true"/>:"—"}
     </strong>
    </button>)}
  </div>
  <div className="fm-supplier-tabs" role="tablist" aria-label="Vistas del maestro">
   {TABS.filter(([key])=>canEditMaster||key!=="pendientes").map(([key,label])=><button key={key} role="tab" aria-selected={tab===key}
    className={tab===key?"active":""} onClick={()=>changeTab(key)}>
    {label} <span>{loadedOnce?counts[key]:loading?<span className="fm-load-spinner" aria-hidden="true"/>:"—"}</span>
   </button>)}
  </div>
  <section className="card fm-supplier-master-list">
   <div className="fm-master-section-heading">
    <div>
     <h2>{TABS.find(x=>x[0]===tab)?.[1]}</h2>
     <p>{tab==="laboratorios"?"Asocia códigos de varias farmacias al mismo laboratorio. Solo aquí se configuran pedidos periódicos y se fusionan identidades.":
       tab==="mayoristas"?"Cooperativas y mayoristas, clasificados sin necesidad de fusionarlos.":
       tab==="internos"?"Movimientos y proveedores internos. No participan en compras conjuntas.":
       tab==="otros"?"Servicios, seguros y suministros externos. No aparecen en el preparador de pedidos.":
       nPending?"Códigos de Farmatic que todavía no tienen un proveedor definitivo asignado.":
       "Consulta y clasifica proveedores desde el listado general."}</p>
    </div>
    <span className="fm-master-count">{loadedOnce?
     (nPending?matches.length:visible.length+(canEditMaster&&tab==="todos"?matches.length:0))+" resultados":
     loading?"Calculando resultados…":"Datos no disponibles"}</span>
   </div>
   <div className="fm-master-toolbar">
    <label className="fm-master-search"><span><Search size={15}/> Buscar proveedor o código</span>
     <input type="search" value={search} placeholder="Nombre, código, farmacia…" onChange={e=>{setSearch(e.target.value);setLimit(60)}}/>
    </label>
    {nPending&&canMergeMaster&&<label className="fm-master-upload">Importar CSV
      <input aria-label="Importar equivalencias desde CSV" type="file" accept=".csv,text/csv" disabled={busy}
       onChange={e=>{void importFile(e.target.files?.[0]);e.target.value=""}}/>
    </label>}
   </div>
   {canMerge&&<div className="fm-master-lab-tools">
    <div className="fm-master-lab-tools-header">
     <div><strong><GitMerge size={17}/> Unificación de laboratorios</strong>
      <p>Selecciona las identidades duplicadas y elige cuál debe conservarse. Las frecuencias pertenecen al laboratorio resultante.</p>
     </div>
     <button className="btn btn-secondary btn-sm" type="button" onClick={()=>setShowSuggestions(v=>!v)}>
      Coincidencias posibles ({suggestions.length}) <ChevronRight size={14}/></button>
    </div>
    {selected.length>0&&<div className="fm-supplier-merge-bar">
     <strong>{selected.length} seleccionados</strong>
     <select aria-label="Proveedor definitivo de destino" value={mergeTo} onChange={e=>setMergeTo(e.target.value)}>
      <option value="">Elegir laboratorio definitivo…</option>
      {destinations.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}
     </select>
     <button type="button" className="btn btn-primary btn-sm" onClick={()=>void merge()} disabled={!mergeTo||busy}>Unificar laboratorios</button>
     <button type="button" className="btn btn-secondary btn-sm" onClick={()=>{setSelected([]);setMergeTo("")}}>Cancelar</button>
    </div>}
    {showSuggestions&&<div className="fm-master-suggestions">
     <h3>Posibles duplicados para revisar</h3>
     <p>Basados en nombres normalizados; los códigos que coinciden entre farmacias se muestran como evidencia adicional. Ninguna sugerencia se aplica sola.</p>
     {!suggestions.length?<p>No se detectan nombres duplicados pendientes en el maestro actual.</p>:
      suggestions.slice(0,50).map(x=><div key={x.destination} className="fm-master-suggestion">
       <div><strong>{x.name}</strong><small>{x.count} identidades · {x.matchingCodes.length?
        "Código de proveedor coincidente: "+x.matchingCodes.join(", "):"Sin evidencia de código compartido"}</small></div>
       <button className="btn btn-secondary btn-sm" type="button" onClick={()=>{
        setSelected(x.sourceIds);setMergeTo(x.destination);setShowSuggestions(false);
       }}>Revisar fusión</button>
      </div>)}
    </div>}
   </div>}
   {!loadedOnce&&!loading?<div className="fm-master-empty" role="status">
    No se ha podido cargar el directorio. <button type="button" className="btn btn-secondary btn-sm"
     onClick={()=>void refresh()}>Reintentar</button>
   </div>:nPending?
    <ListTable rows={matches} rowKey={p=>p.pharmacyCode+"|"+p.sourceCode} label="proveedores sin vincular"
     columns={pendingColumns} defaultSort={{key:"name",direction:"asc"}} showExport={false}
     loading={loading} loadingLabel="Cargando proveedores sin vincular…"
     emptyText="No hay proveedores sin vincular"/>:
    <ListTable rows={visible} rowKey={p=>p.id} label="proveedores del maestro" columns={tableColumns}
     onRowClick={p=>setSelectedSupplier(p.id)} defaultSort={{key:"name",direction:"asc"}} showExport={false}
     loading={loading} loadingLabel="Cargando proveedores…"
     selection={canMerge?{selectedKeys:selected,onChange:setSelected,disabled:busy}:null}
     emptyText="No hay proveedores para esta búsqueda."/>}
   {loadedOnce&&!loading&&canEditMaster&&tab==="todos"&&matches.length>0&&<div className="fm-master-pending-inline">
    <div className="fm-master-pending-inline-head"><div><h3>Orígenes todavía sin vincular</h3>
     <p>También forman parte del listado total. Clasifícalos sin necesidad de unir cooperativas o internos.</p></div>
     <button className="btn btn-secondary btn-sm" onClick={()=>changeTab("pendientes")}>
      Ver todos ({matches.length}) <ChevronRight size={14}/></button></div>
    <div className="fm-master-pending-items">{matches.slice(0,20).map((p,i)=><div key={i}>
     <div><strong>{p.name}</strong><small>{p.pharmacyName} · {p.sourceCode}</small></div>
     <button type="button" className="btn btn-secondary btn-sm"
      onClick={()=>{setLinking(p);setChosen("");setNewOriginType("DIRECTO")}}>Clasificar / vincular</button>
    </div>)}</div>
   </div>}
  </section>
  {editing&&<div className="fm-demo-overlay" role="dialog" aria-modal="true" aria-label="Editar proveedor">
   <div className="fm-demo-detail fm-provider-dialog">
    <h2>{editing.id?"Editar proveedor":"Nuevo proveedor"}</h2>
    <p>El tipo se aplica a esta identidad y a sus códigos vinculados.</p>
    <label>Nombre del proveedor<input value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/></label>
    <label>Clasificación<select value={editing.class} onChange={e=>setEditing({...editing,class:e.target.value})}>
     {TYPES.map(t=><option key={t} value={t}>{LABELS[t]}</option>)}</select></label>
    <p className="fm-master-dialog-note">Los movimientos históricos permanecen intactos.</p>
    <div className="fm-master-dialog-actions">
     <button className="btn btn-secondary" onClick={()=>setEditing(null)}>Cancelar</button>
     <button className="btn btn-primary" disabled={busy||!editing.name.trim()} onClick={()=>void save()}>Guardar</button>
    </div>
   </div></div>}
  {linking&&<div className="fm-demo-overlay" role="dialog" aria-modal="true" aria-label="Relacionar código de Farmatic">
   <div className="fm-demo-detail fm-provider-dialog">
    <h2>Clasificar origen de Farmatic</h2>
    <p><strong>{linking.name}</strong><br/>{linking.pharmacyName||linking.pharmacyCode} · {linking.sourceCode}</p>
    <div className="fm-master-link-form">
     <label>Vincular a un proveedor existente<select value={chosen} onChange={e=>setChosen(e.target.value)}>
      <option value="">Elegir proveedor definitivo…</option>
      {suppliers.map(p=><option key={p.id} value={p.id}>{p.name} · {LABELS[p.class]}</option>)}
     </select></label>
     <button className="btn btn-primary" type="button" disabled={!chosen||busy} onClick={()=>void link()}>Guardar equivalencia</button>
     <div className="fm-master-form-divider"><span>o clasificar como nuevo</span></div>
     <label>Tipo del nuevo proveedor<select value={newOriginType} onChange={e=>setNewOriginType(e.target.value)}>
      {TYPES.map(t=><option key={t} value={t}>{LABELS[t]}</option>)}</select></label>
     <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>void classifyOrigin()}>
      Crear proveedor {LABELS[newOriginType].toLowerCase()} independiente
     </button>
    </div>
    <div className="fm-master-dialog-actions"><button className="btn btn-secondary" onClick={()=>setLinking(null)}>Cancelar</button></div>
   </div></div>}
 </div>;
}
