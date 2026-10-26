import React,{useEffect,useMemo,useState} from "react";
import {LoadingStatus} from "./LoadingState.jsx";
const CLASSES=["DIRECTO","MAYORISTA","INTERNO","VACUNAS","FÓRMULAS","SIN_CLASIFICAR"];
async function call(slug,path,options={}){
 const r=await fetch(path,{credentials:"same-origin",cache:"no-store",...options,
  headers:{"Content-Type":"application/json","X-Farmetrica-Cliente":slug,...options.headers}});
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(data.error||"Error al consultar proveedores");
 return data;
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
 const keys=records.shift()||[];const col=name=>keys.indexOf(name);
 const cols=["ID_UN","ID PROV","NOMBRE PROV","ID PROV NUEVO","NOMBRE PROV NUEVO","TIPO","FECHA"];
 if(cols.some(k=>col(k)<0))throw Error("El CSV no contiene las columnas de unificación esperadas");
 return records.filter(r=>r.some(Boolean)).map(r=>({
  pharmacyCode:r[col("ID_UN")],sourceCode:r[col("ID PROV")],
  sourceName:r[col("NOMBRE PROV")],targetCode:r[col("ID PROV NUEVO")],
  targetName:r[col("NOMBRE PROV NUEVO")],class:r[col("TIPO")],validity:r[col("FECHA")]
 }));
}
export default function ProveedoresUnificados({clientSlug}){
 const [suppliers,setSuppliers]=useState([]),[sources,setSources]=useState([]),
  [pharmacies,setPharmacies]=useState([]),[search,setSearch]=useState(""),
  [editing,setEditing]=useState(null),[chosen,setChosen]=useState(""),
  [linking,setLinking]=useState(null),[busy,setBusy]=useState(false),
  [loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const refresh=async()=>{
  setLoading(true);setError("");
  try{
   const [unified,erp,shops]=await Promise.all([
    call(clientSlug,"/api/tenant/proveedores-unificados"),
    call(clientSlug,"/api/tenant/proveedores"),
    call(clientSlug,"/api/tenant/farmacias")]);
   setSuppliers(unified);setSources(erp);setPharmacies(shops);
  }catch(e){setError(e.message)}finally{setLoading(false)}
 };
 useEffect(()=>{void refresh()},[clientSlug]);
 const names=new Map(pharmacies.map(p=>[String(p.id),p.name]));
 const normalize=x=>String(x??"").trim().toUpperCase().replace(/^0+(?=\d)/,"");
 const linked=new Set(suppliers.flatMap(p=>(p.origins||[]).map(a=>
   a.pharmacyCode.toUpperCase()+"|"+normalize(a.sourceCode))));
 const pending=useMemo(()=>sources.flatMap(p=>(p.origins||[])
  .filter(o=>o.pharmacyId&&(o.source==="farmatic"||o.source==="recepciones"))
  .map(o=>{
   const pharmacy=pharmacies.find(f=>String(f.id)===String(o.pharmacyId));
   return pharmacy?{pharmacyCode:String(pharmacy.databaseCode||pharmacy.sourceCode).toUpperCase(),
    pharmacyName:pharmacy.name,sourceCode:p.sourceCode,name:o.name}:null;
  }).filter(Boolean)).filter(o=>!linked.has(o.pharmacyCode+"|"+normalize(o.sourceCode))),
  [sources,suppliers,pharmacies]);
 const uniquePending=[...new Map(pending.map(x=>[x.pharmacyCode+"|"+normalize(x.sourceCode),x])).values()];
 const visible=suppliers.filter(p=>[p.name,p.key,p.class,...(p.origins||[]).flatMap(o=>[o.sourceName,o.sourceCode,o.pharmacyCode])]
   .join(" ").toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es")));
 async function save(){
  if(!editing)return;
  setBusy(true);setError("");
  try{
   await call(clientSlug,editing.id?"/api/tenant/proveedores-unificados/"+editing.id:"/api/tenant/proveedores-unificados",{
    method:editing.id?"PUT":"POST",body:JSON.stringify({name:editing.name,class:editing.class})});
   setEditing(null);await refresh();setNotice("Proveedor actualizado");
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function importFile(file){
  if(!file)return;
  setBusy(true);setError("");setNotice("");
  try{
   const rows=parseCsv(await file.text());
   const data=await call(clientSlug,"/api/tenant/proveedores-unificados/importar",{
    method:"POST",body:JSON.stringify({rows})});
   await refresh();setNotice(`Importadas ${data.newAliases} equivalencias y ${data.newSuppliers} proveedores nuevos. Conflictos de origen: ${data.sourceConflicts}.`);
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function link(){
  if(!linking||!chosen)return;
  setBusy(true);setError("");
  try{
   await call(clientSlug,"/api/tenant/proveedores-unificados/"+chosen+"/origen",{
    method:"PUT",body:JSON.stringify({pharmacyCode:linking.pharmacyCode,
     sourceCode:linking.sourceCode,sourceName:linking.name})});
   setLinking(null);setChosen("");await refresh();setNotice("Código ERP vinculado");
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <div className="fm-management fm-production-panel">
  <header className="section-heading"><div><h1>Maestro único de proveedores</h1>
   <p>Identidades unificadas de Farmatic con equivalencias independientes por farmacia.</p></div>
   <div><button className="btn btn-secondary" disabled={loading} onClick={()=>void refresh()}>Actualizar</button> {" "}
    <button className="btn btn-primary" onClick={()=>setEditing({name:"",class:"SIN_CLASIFICAR"})}>Nuevo proveedor</button>
   </div></header>
  <label>Importar equivalencias desde CSV (se conservan las relaciones manuales)
   <input type="file" accept=".csv,text/csv" disabled={busy} onChange={e=>{void importFile(e.target.files?.[0]);e.target.value=""}}/>
  </label>
  {error&&<p role="alert" className="fm-manage-feedback">{error}</p>}
  {notice&&<p role="status" className="fm-manage-feedback">{notice}</p>}
  {loading&&<LoadingStatus label="Comprobando proveedores y correspondencias…"/>}
  <div className="fm-supplier-summary">
   <div className="card fm-supplier-summary-item"><span>Proveedores unificados</span><strong>{suppliers.length}</strong></div>
   <div className="card fm-supplier-summary-item"><span>Mayoristas</span><strong>{suppliers.filter(p=>p.class==="MAYORISTA").length}</strong></div>
   <div className="card fm-supplier-summary-item"><span>Internos</span><strong>{suppliers.filter(p=>p.class==="INTERNO").length}</strong></div>
   <div className="card fm-supplier-summary-item"><span>Orígenes pendientes</span><strong>{uniquePending.length}</strong></div>
  </div>
  <section className="card"><label>Buscar proveedor o código
   <input type="search" placeholder="Nombre, código o farmacia…" value={search}
    onChange={e=>setSearch(e.target.value)}/></label>
   <div style={{overflowX:"auto"}}><table className="fm-table"><thead><tr>
    <th>Proveedor unificado</th><th>Clasificación</th><th>Farmacias y códigos Farmatic</th><th>Acciones</th>
   </tr></thead><tbody>
    {visible.map(p=><tr key={p.id}><td><strong>{p.name}</strong></td>
     <td>{p.class}</td><td>{(p.origins||[]).map((a,i)=><div key={i}>
      {a.pharmacyCode}: {a.sourceCode} — {a.sourceName} {" "}<button type="button" className="btn btn-secondary btn-sm" onClick={()=>{setLinking({pharmacyCode:a.pharmacyCode,sourceCode:a.sourceCode,name:a.sourceName});setChosen("")}}>Cambiar grupo</button></div>)}</td>
     <td><button className="btn btn-secondary btn-sm" onClick={()=>setEditing({...p})}>Editar</button></td></tr>)}
   </tbody></table></div>
  </section>
  <section className="card"><h2>Proveedores de Farmatic pendientes de relacionar ({uniquePending.length})</h2>
   <p>Estos códigos están presentes en el ERP pero todavía no tienen equivalencia en el maestro.
    No se unificarán automáticamente por compartir un código con otra farmacia.</p>
   <div style={{maxHeight:400,overflow:"auto"}}><table className="fm-table"><thead><tr>
    <th>Farmacia</th><th>Código</th><th>Nombre de origen</th><th></th>
   </tr></thead><tbody>{uniquePending.slice(0,300).map((p,i)=><tr key={i}>
    <td>{p.pharmacyName}</td><td>{p.sourceCode}</td><td>{p.name}</td>
    <td><button className="btn btn-secondary btn-sm" onClick={()=>{setLinking(p);setChosen("")}}>Relacionar</button></td></tr>)}
   </tbody></table>{uniquePending.length>300&&<p>Mostrando los primeros 300 pendientes.</p>}</div>
  </section>
  {editing&&<div className="fm-demo-overlay" role="dialog" aria-modal="true" aria-label="Editar proveedor">
   <div className="fm-demo-detail fm-provider-dialog"><h2>{editing.id?"Editar proveedor":"Nuevo proveedor"}</h2>
    <label>Nombre unificado<input value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/></label>
    <label>Clasificación<select value={editing.class} onChange={e=>setEditing({...editing,class:e.target.value})}>
     {CLASSES.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
    <p>Esta clasificación solo afecta a la selección del preparador. Los movimientos históricos siguen contando en los totales.</p>
    <button className="btn btn-secondary" onClick={()=>setEditing(null)}>Cancelar</button>
    <button className="btn btn-primary" disabled={busy} onClick={()=>void save()}>Guardar</button>
   </div></div>}
  {linking&&<div className="fm-demo-overlay" role="dialog" aria-modal="true" aria-label="Relacionar código ERP">
   <div className="fm-demo-detail fm-provider-dialog"><h2>Relacionar proveedor de Farmatic</h2>
    <p>{linking.pharmacyName} · {linking.sourceCode} · {linking.name}</p>
    <label>Proveedor de destino<select value={chosen} onChange={e=>setChosen(e.target.value)}>
     <option value="">Seleccionar proveedor…</option>
     {suppliers.map(p=><option key={p.id} value={p.id}>{p.name} ({p.class})</option>)}</select></label>
    <button className="btn btn-secondary" onClick={()=>setLinking(null)}>Cancelar</button>
    <button className="btn btn-primary" disabled={busy||!chosen} onClick={()=>void link()}>Guardar equivalencia</button>
   </div></div>}
 </div>;
}
