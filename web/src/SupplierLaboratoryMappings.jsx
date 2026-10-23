import React,{useEffect,useMemo,useState} from "react";
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
 const [mappings,setMappings]=useState([]);
 const [pharmacyId,setPharmacyId]=useState(""),[sourceCode,setSourceCode]=useState("");
 const [laboratoryKey,setLaboratoryKey]=useState("");
 const [labSearch,setLabSearch]=useState("");
 const [error,setError]=useState(""),[notice,setNotice]=useState("");
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 useEffect(()=>{
  let alive=true;
  setLoading(true);setError("");
  Promise.all([
   request("/api/tenant/farmacias",clientSlug),
   request("/api/analytics/pedidos/catalogo-laboratorios",clientSlug),
   request("/api/tenant/proveedores/correspondencias",clientSlug)
  ]).then(([p,l,m])=>{
   if(!alive)return;
   setPharmacies(p);setLaboratories(l.laboratories||[]);setMappings(m);
   setPharmacyId(v=>v||String(p[0]?.id||""));
  }).catch(e=>{if(alive)setError(e.message)})
   .finally(()=>{if(alive)setLoading(false)});
  return()=>{alive=false};
 },[clientSlug]);
 const choices=useMemo(()=>laboratories.filter(l=>
  (l.name+" "+l.key).toLocaleLowerCase("es").includes(labSearch.toLocaleLowerCase("es"))),[laboratories,labSearch]);
 const supplierChoices=useMemo(()=>suppliers.filter(s=>!s.cooperative&&s.sourceCode),[suppliers]);
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
  }catch(e){setError(e.message)}
  finally{setBusy(false)}
 }
 return <section className="card fm-supplier-mapping" aria-label="Correspondencias de proveedores y laboratorios">
  <div><h2>Correspondencias ERP ↔ laboratorio</h2>
   <p>Relaciona el código del proveedor de Farmatic u otro ERP con el laboratorio oficial, para cada farmacia. No se atribuyen automáticamente artículos de cooperativas a un laboratorio.</p></div>
  {loading&&<p>Cargando proveedores y laboratorios…</p>}
  {error&&<p role="alert" className="fm-op-message fm-op-error">{error}</p>}
  {notice&&<p role="status" className="fm-op-message">{notice}</p>}
  <div className="fm-supplier-mapping-controls">
   <label>Farmacia<select value={pharmacyId} onChange={e=>setPharmacyId(e.target.value)}>
    {pharmacies.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   <label>Proveedor ERP<select value={sourceCode} onChange={e=>setSourceCode(e.target.value)}>
    <option value="">Selecciona proveedor…</option>
    {supplierChoices.map(s=><option key={s.sourceCode} value={s.sourceCode}>{s.name} · {s.sourceCode}</option>)}</select></label>
   <label>Laboratorio
    <input type="search" value={labSearch} onChange={e=>setLabSearch(e.target.value)}
     placeholder="Filtrar laboratorios…" aria-label="Buscar laboratorio para correspondencia"/>
    <select value={laboratoryKey} onChange={e=>setLaboratoryKey(e.target.value)}>
     <option value="">Selecciona laboratorio…</option>
     {choices.map(l=><option key={l.key} value={l.key}>{l.name}</option>)}
     {laboratoryKey&&!choices.some(l=>l.key===laboratoryKey)&&
      laboratories.filter(l=>l.key===laboratoryKey).map(l=><option key={l.key} value={l.key}>{l.name}</option>)}
    </select></label>
   <button className="btn btn-primary" type="button" disabled={busy||loading||!pharmacyId||!sourceCode||!laboratoryKey}
    onClick={()=>saveMapping()}>Guardar relación</button>
  </div>
  <div className="fm-supplier-mapping-list" aria-label="Relaciones configuradas">
   {mappings.map(m=><div key={m.pharmacyId+"|"+m.sourceCode}>
    <span><strong>{pharmacyName(m.pharmacyId)}</strong> · {supplierName(m.sourceCode)} ({m.sourceCode}) → {labName(m.laboratoryKey)}</span>
    <button type="button" disabled={busy} onClick={()=>saveMapping(null,m.pharmacyId,m.sourceCode)}>Quitar</button>
   </div>)}
   {!mappings.length&&!loading&&<p>Sin correspondencias todavía. Hasta que asignes proveedores, solo aparecerán los medicamentos del maestro AEMPS.</p>}
  </div>
 </section>;
