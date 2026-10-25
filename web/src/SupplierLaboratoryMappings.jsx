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
   setLocalSuppliers(prev=>prev.map(s=>String(s.pharmacyId)===String(pid)&&
    String(s.sourceCode).replace(/^0+(?=\d)/,"")===String(code).replace(/^0+(?=\d)/,"")?
     {...s,localLaboratoryKey:result.laboratoryKey,laboratoryKey:result.laboratoryKey||s.globalLaboratoryKey}:s));
  }catch(e){setError(e.message)}
  finally{setBusy(false)}
 }
 const grouped=useMemo(()=>{
  const groups=new Map();
  for(const s of localSuppliers){
   const key=s.laboratoryKey||s.inferredLaboratoryKey||"SIN VINCULAR";
   if(!groups.has(key))groups.set(key,[]);
   groups.get(key).push(s);
  }
  return [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0],"es"));
 },[localSuppliers]);
 async function autoLink(apply=false){
  setBusy(true);setError("");setNotice("");
  try{
   const result=await request("/api/tenant/proveedores/autovincular-farmacias",clientSlug,{
    method:"POST",body:JSON.stringify({apply})});
   if(!apply){setAutoPreview(result.suggestions||[]);setNotice(result.count+
     " coincidencias exactas encontradas entre Farmatic y el Nomenclátor.");}
   else{
    setAutoPreview(null);setNotice(result.applied+" relaciones por farmacia guardadas.");
    const [m,local]=await Promise.all([
     request("/api/tenant/proveedores/correspondencias",clientSlug),
     request("/api/tenant/proveedores/por-farmacia",clientSlug)]);
    setMappings(m);setLocalSuppliers(local.suppliers||[]);
   }
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <section className="card fm-supplier-mapping" aria-label="Correspondencias de proveedores y laboratorios">
  <div><h2>Correspondencias ERP ↔ laboratorio</h2>
   <p>Maestro unificado: un laboratorio común con los distintos nombres y códigos que utiliza cada farmacia. Cada correspondencia se guarda por farmacia para evitar mezclar códigos iguales de proveedores diferentes. Las cooperativas no se asignan automáticamente.</p>
   <button type="button" className="btn btn-secondary" disabled={loading||busy}
    onClick={()=>autoLink(false)}>Detectar coincidencias en todas las farmacias</button>
   {autoPreview!==null&&<div className="fm-auto-labs">
    <p>{autoPreview.length} coincidencias seguras propuestas.</p>
    {autoPreview.slice(0,15).map((x,i)=><p key={i}>{pharmacyName(x.pharmacyId)} · {x.name} ({x.sourceCode}) → {labName(x.laboratoryKey)}</p>)}
    {!!autoPreview.length&&<button type="button" className="btn btn-primary" disabled={busy}
      onClick={()=>autoLink(true)}>Aplicar {autoPreview.length} relaciones</button>}
    <button type="button" className="btn btn-secondary" onClick={()=>setAutoPreview(null)}>Cancelar</button>
   </div>}</div>
  {loading&&<p>Cargando proveedores y laboratorios…</p>}
  {error&&<p role="alert" className="fm-op-message fm-op-error">{error}</p>}
  {notice&&<p role="status" className="fm-op-message">{notice}</p>}
  <div className="fm-supplier-mapping-controls">
   <label>Farmacia<select value={pharmacyId} onChange={e=>{setPharmacyId(e.target.value);setSourceCode("")}}>
    {pharmacies.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   <label>Proveedor ERP<select value={sourceCode} onChange={e=>setSourceCode(e.target.value)}>
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
  <h3>Proveedores de todas las farmacias agrupados por laboratorio</h3>
  <div className="fm-supplier-mapping-list" aria-label="Maestro unificado por laboratorio">
   {grouped.map(([key,entries])=><div key={key} style={{display:"block"}}>
    <strong>{key==="SIN VINCULAR"?"Sin unificar":labName(key)}</strong>
    {entries.map((s,i)=><div key={i}>
     <span>{pharmacyName(s.pharmacyId)} · {s.name||s.sourceCode} · código {s.sourceCode}
      {!s.laboratoryKey&&s.inferredLaboratoryKey&&
       <small> · Coincidencia exacta con el Nomenclátor (sin guardar)</small>}</span>
     <button type="button" onClick={()=>{
      setPharmacyId(String(s.pharmacyId));setSourceCode(s.sourceCode);
      setLaboratoryKey(s.laboratoryKey||s.inferredLaboratoryKey||"");
     }}>Vincular / editar</button>
    </div>)}
   </div>)}
   {!grouped.length&&!loading&&<p>No hay proveedores de las farmacias en el maestro de Farmatic.</p>}
  </div>
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
