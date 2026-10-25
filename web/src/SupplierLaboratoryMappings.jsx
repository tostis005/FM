import React,{useEffect,useMemo,useState} from "react";
import LaboratoryPicker from "./LaboratoryPicker.jsx";
import "./laboratoryCatalog.css";
async function request(path,clientSlug,options={}){
 const res=await fetch(path,{credentials:"same-origin",cache:"no-store",...options,
  headers:{"X-Farmetrica-Cliente":clientSlug,"Content-Type":"application/json",...options.headers}});
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw Error(data.error||"No se pudo gestionar la correspondencia");
 return data;
}
export default function SupplierLaboratoryMappings({clientSlug,suppliers=[]}){
 const [pharmacies,setPharmacies]=useState([]),[laboratories,setLaboratories]=useState([]);
 const [mappings,setMappings]=useState([]),[localSuppliers,setLocalSuppliers]=useState([]);
 const [autoPreview,setAutoPreview]=useState(null);
 const [customName,setCustomName]=useState("");
 const [search,setSearch]=useState(""),[view,setView]=useState("all");
 const [visibleGroups,setVisibleGroups]=useState(30);
 const [pharmacyId,setPharmacyId]=useState(""),[sourceCode,setSourceCode]=useState("");
 const [laboratoryKey,setLaboratoryKey]=useState("");
 const [error,setError]=useState(""),[notice,setNotice]=useState("");
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 useEffect(()=>{
  let alive=true;
  setLoading(true);setError("");
  Promise.all([
   request("/api/tenant/farmacias",clientSlug),
   request("/api/analytics/pedidos/catalogo-laboratorios",clientSlug),
   request("/api/tenant/proveedores/correspondencias",clientSlug),
   request("/api/tenant/proveedores/por-farmacia",clientSlug)
  ]).then(([p,l,m,local])=>{
   if(!alive)return;
   setPharmacies(p);setLaboratories(l.laboratories||[]);setMappings(m);
   setLocalSuppliers(local.suppliers||[]);
   setPharmacyId(v=>v||String(p[0]?.id||""));
  }).catch(e=>{if(alive)setError(e.message)})
   .finally(()=>{if(alive)setLoading(false)});
  return()=>{alive=false};
 },[clientSlug]);
 const supplierChoices=useMemo(()=>localSuppliers.length?
  localSuppliers.filter(s=>String(s.pharmacyId)===pharmacyId&&!s.cooperative&&s.sourceCode):
  suppliers.filter(s=>!s.cooperative&&s.sourceCode),[suppliers,localSuppliers,pharmacyId]);
 const pharmacyName=id=>pharmacies.find(p=>String(p.id)===String(id))?.name||String(id);
 const supplierName=code=>suppliers.find(s=>String(s.sourceCode).replace(/^0+(?=\d)/,"")===
  String(code).replace(/^0+(?=\d)/,""))?.name||code;
 const labName=key=>laboratories.find(l=>l.key===key)?.name||key;
 async function saveMapping(nextKey=laboratoryKey,pid=pharmacyId,code=sourceCode){
  if(!pid||!code||(!nextKey&&nextKey!==null))return;
  setBusy(true);setError("");setNotice("");
  try{
   const result=await request("/api/tenant/proveedores/correspondencias",clientSlug,{
    method:"PUT",body:JSON.stringify({pharmacyId:pid,sourceCode:code,laboratoryKey:nextKey})});
   setMappings(previous=>{
    const kept=previous.filter(m=>!(String(m.pharmacyId)===String(pid)&&
     String(m.sourceCode).replace(/^0+(?=\d)/,"")===String(code).replace(/^0+(?=\d)/,"")));
    return result.laboratoryKey?[...kept,result]:kept;
   });
   setNotice(result.laboratoryKey?"Correspondencia guardada.":"Correspondencia eliminada.");
   const local=await request("/api/tenant/proveedores/por-farmacia",clientSlug);
   setLocalSuppliers(local.suppliers||[]);
  }catch(e){setError(e.message)}
  finally{setBusy(false)}
 }
 const linked=localSuppliers.filter(s=>Boolean(s.laboratoryKey||s.inferredLaboratoryKey)).length;
 const grouped=useMemo(()=>{
  const groups=new Map();
  for(const s of localSuppliers){
   const text=[s.name,s.sourceCode,pharmacyName(s.pharmacyId),
    labName(s.laboratoryKey||s.inferredLaboratoryKey)].join(" ").toLocaleLowerCase("es");
   if(search&&!text.includes(search.toLocaleLowerCase("es")))continue;
   const assigned=Boolean(s.laboratoryKey||s.inferredLaboratoryKey);
   if((view==="linked"&&!assigned)||(view==="unlinked"&&assigned))continue;
   const key=s.laboratoryKey||s.inferredLaboratoryKey||"SIN VINCULAR";
   if(!groups.has(key))groups.set(key,[]);
   groups.get(key).push(s);
  }
  return [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0],"es"));
 },[localSuppliers,search,view,laboratories,pharmacies]);
 async function autoLink(apply=false){
  setBusy(true);setError("");setNotice("");
  try{
   const result=await request("/api/tenant/proveedores/autovincular-farmacias",clientSlug,{
    method:"POST",body:JSON.stringify({apply,
     ...(apply?{expected:autoPreview||[]}:{})})});
   if(!apply){setAutoPreview(result.suggestions||[]);setNotice(result.count+
     " correspondencias seguras encontradas entre Farmatic y el Nomenclátor.");}
   else{
    setAutoPreview(null);setNotice(result.applied+" relaciones por farmacia guardadas.");
    const [m,local,official]=await Promise.all([
     request("/api/tenant/proveedores/correspondencias",clientSlug),
     request("/api/tenant/proveedores/por-farmacia",clientSlug),
     request("/api/analytics/pedidos/catalogo-laboratorios",clientSlug)]);
    setMappings(m);setLocalSuppliers(local.suppliers||[]);
    setLaboratories(official.laboratories||[]);
   }
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function createCustom(e){
  e.preventDefault();if(!customName.trim()||busy)return;
  setBusy(true);setError("");setNotice("");
  try{
   const created=await request("/api/tenant/proveedores/laboratorios-propios",clientSlug,{
    method:"POST",body:JSON.stringify({name:customName.trim()})});
   const data=await request("/api/analytics/pedidos/catalogo-laboratorios",clientSlug);
   setLaboratories(data.laboratories||[]);
   setLaboratoryKey(created.key);setCustomName("");
   setNotice("Identidad "+created.name+" disponible. Vincula a ella los proveedores de las farmacias.");
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 const filteredGroups=grouped.slice(0,visibleGroups);
 return <section className="card fm-supplier-mapping" aria-label="Correspondencias de proveedores y laboratorios">
  <div><h2>Identidades unificadas de proveedores y laboratorios</h2>
   <p>El Nomenclátor aporta laboratorios oficiales y Farmatic los proveedores originales de cada farmacia. También puedes agrupar proveedores sin laboratorio AEMPS bajo una identidad propia. Los códigos originales se conservan; las cooperativas no se vinculan automáticamente.</p>
   <div className="fm-supplier-identity-stats" aria-label="Resumen de unificación">
    <span><strong>{localSuppliers.length}</strong> proveedores ERP</span>
    <span><strong>{linked}</strong> relacionados o identificados</span>
    <span><strong>{localSuppliers.length-linked}</strong> pendientes</span>
    <span><strong>{laboratories.length}</strong> identidades disponibles</span>
   </div>
   <button type="button" className="btn btn-secondary" disabled={loading||busy}
    onClick={()=>autoLink(false)}>Detectar coincidencias en todas las farmacias</button>
   {autoPreview!==null&&<div className="fm-auto-labs">
    <p>{autoPreview.length} coincidencias seguras propuestas.</p>
    {autoPreview.slice(0,30).map((x,i)=><p key={i}>{pharmacyName(x.pharmacyId)} · {x.name} ({x.sourceCode}) → {x.source==="farmatic"?x.customName:labName(x.laboratoryKey)} · {x.source==="farmatic"?"Identidad propia nueva":"Laboratorio reconocido"}</p>)}
    {autoPreview.length>30&&<p>Y {autoPreview.length-30} más. No se aplicará ninguna relación hasta confirmarlo.</p>}
    {!!autoPreview.length&&<button type="button" className="btn btn-primary" disabled={busy}
      onClick={()=>autoLink(true)}>Aplicar {autoPreview.length} relaciones</button>}
    <button type="button" className="btn btn-secondary" onClick={()=>setAutoPreview(null)}>Cancelar</button>
   </div>}</div>
  {loading&&<p>Cargando proveedores y laboratorios…</p>}
  {error&&<p role="alert" className="fm-op-message fm-op-error">{error}</p>}
  {notice&&<p role="status" className="fm-op-message">{notice}</p>}
  <form className="fm-supplier-create-identity" onSubmit={createCustom}>
   <label>Crear identidad para proveedores sin laboratorio en AEMPS
    <input value={customName} maxLength={200} onChange={e=>setCustomName(e.target.value)}
     placeholder="Nombre del laboratorio o grupo de proveedores…" />
   </label>
   <button type="submit" className="btn btn-secondary" disabled={busy||loading||customName.trim().length<3}>Crear identidad</button>
  </form>
  <div className="fm-supplier-mapping-controls">
   <label>Farmacia<select value={pharmacyId} onChange={e=>{setPharmacyId(e.target.value);setSourceCode("");setLaboratoryKey("")}}>
    {pharmacies.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   <label>Proveedor ERP<select value={sourceCode} onChange={e=>{const next=e.target.value;setSourceCode(next);
     const current=supplierChoices.find(s=>s.sourceCode===next);
     setLaboratoryKey(current?.laboratoryKey||current?.inferredLaboratoryKey||"");}}>
    <option value="">Selecciona proveedor de esta farmacia…</option>
    {supplierChoices.map(s=><option key={(s.pharmacyId||"")+":"+s.sourceCode} value={s.sourceCode}>{s.name||s.sourceCode} · {s.sourceCode}</option>)}</select></label>
   <div className="fm-supplier-laboratory-picker">
    <span>Laboratorio</span>
    <LaboratoryPicker laboratories={laboratories} selected={laboratoryKey}
     onSelect={setLaboratoryKey} loading={loading} ariaLabel="Seleccionar laboratorio por farmacia"/>
   </div>
   <button className="btn btn-primary" type="button" disabled={busy||loading||!pharmacyId||!sourceCode||!laboratoryKey}
    onClick={()=>saveMapping()}>Guardar relación</button>
  </div>
  <h3>Proveedores de todas las farmacias agrupados por identidad</h3>
  <div className="fm-supplier-identity-filters">
   <label>Buscar por proveedor, farmacia o laboratorio
    <input type="search" value={search} onChange={e=>{setSearch(e.target.value);setVisibleGroups(30)}}
     placeholder="Nombre, código, farmacia o laboratorio…" /></label>
   <label>Estado
    <select value={view} onChange={e=>{setView(e.target.value);setVisibleGroups(30)}}>
     <option value="all">Todos</option><option value="linked">Relacionados</option>
     <option value="unlinked">Pendientes</option>
    </select></label>
   <span>{grouped.length} grupos · {grouped.reduce((n,[,entries])=>n+entries.length,0)} proveedores</span>
  </div>
  <div className="fm-supplier-mapping-list" aria-label="Maestro unificado por laboratorio">
   {filteredGroups.map(([key,entries])=><div key={key} className="fm-supplier-group">
    <strong>{key==="SIN VINCULAR"?"Sin unificar":labName(key)}</strong>
    {entries.map((s,i)=><div key={i}>
     <span><strong>{pharmacyName(s.pharmacyId)}</strong> · {s.name||s.sourceCode} · código {s.sourceCode}
      {!s.laboratoryKey&&s.inferredLaboratoryKey&&
       <small> · Coincidencia por nombre (aún sin guardar)</small>}
      {s.localLaboratoryKey&&<small> · Enlace específico de farmacia</small>}</span>
     <button type="button" onClick={()=>{
      setPharmacyId(String(s.pharmacyId));setSourceCode(s.sourceCode);
      setLaboratoryKey(s.laboratoryKey||s.inferredLaboratoryKey||"");
     }}>Vincular / editar</button>
    </div>)}
   </div>)}
   {!grouped.length&&!loading&&<p>No hay proveedores para estos filtros.</p>}
  </div>
  {grouped.length>visibleGroups&&<button type="button" className="btn btn-secondary"
   onClick={()=>setVisibleGroups(n=>n+30)}>Ver más grupos ({grouped.length-visibleGroups} restantes)</button>
  <h3>Excepciones guardadas por farmacia</h3>
  <div className="fm-supplier-mapping-list" aria-label="Relaciones configuradas">
   {mappings.map(m=><div key={m.pharmacyId+"|"+m.sourceCode}>
    <span><strong>{pharmacyName(m.pharmacyId)}</strong> · {supplierName(m.sourceCode)} ({m.sourceCode}) → {labName(m.laboratoryKey)}</span>
    <button type="button" disabled={busy} onClick={()=>saveMapping(null,m.pharmacyId,m.sourceCode)}>Quitar</button>
   </div>)}
   {!mappings.length&&!loading&&<p>Sin correspondencias todavía. Hasta que asignes proveedores, solo aparecerán los medicamentos del maestro AEMPS.</p>}
  </div>
 </section>;
}
