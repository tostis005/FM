import React,{useEffect,useMemo,useState} from "react";
import {LoadingStatus} from "./LoadingState.jsx";
import HorizontalTableScroll from "./HorizontalTableScroll.jsx";
import "./supplierUnifiedAgenda.css";
const CLASSES=["DIRECTO","MAYORISTA","INTERNO","VACUNAS","FÓRMULAS","SIN_CLASIFICAR"];
const CLASS_LABELS={DIRECTO:"Laboratorio",MAYORISTA:"Cooperativa / mayorista",INTERNO:"Interno",
 VACUNAS:"Vacunas",FÓRMULAS:"Fórmulas",SIN_CLASIFICAR:"Sin clasificar"};
const ORDERABLE=new Set(["DIRECTO","VACUNAS","FÓRMULAS"]);
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
 if(["ID_UN","ID PROV","NOMBRE PROV","ID PROV NUEVO","NOMBRE PROV NUEVO","TIPO","FECHA"].some(k=>col(k)<0))
  throw Error("El CSV no contiene las columnas de unificación esperadas");
 return records.filter(r=>r.some(Boolean)).map(r=>({
  pharmacyCode:r[col("ID_UN")],sourceCode:r[col("ID PROV")],
  sourceName:r[col("NOMBRE PROV")],targetCode:r[col("ID PROV NUEVO")],
  targetName:r[col("NOMBRE PROV NUEVO")],class:r[col("TIPO")],validity:r[col("FECHA")]
 }));
}
export default function ProveedoresUnificados({clientSlug}){
 const [suppliers,setSuppliers]=useState([]),[sources,setSources]=useState([]),
  [pharmacies,setPharmacies]=useState([]),[frequencies,setFrequencies]=useState([]);
 const [tab,setTab]=useState("maestro"),[search,setSearch]=useState(""),
  [editing,setEditing]=useState(null),[chosen,setChosen]=useState(""),
  [linking,setLinking]=useState(null),[selected,setSelected]=useState([]),
  [mergeTo,setMergeTo]=useState(""),[limit,setLimit]=useState(80);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),
  [error,setError]=useState(""),[notice,setNotice]=useState("");
 const refresh=async()=>{
  setLoading(true);setError("");
  try{
   const [unified,erp,shops,frequency]=await Promise.all([
    call(clientSlug,"/api/tenant/proveedores-unificados"),
    call(clientSlug,"/api/tenant/proveedores"),
    call(clientSlug,"/api/tenant/farmacias"),
    call(clientSlug,"/api/tenant/pedidos/frecuencias")]);
   setSuppliers(unified);setSources(erp);setPharmacies(shops);
   setFrequencies(frequency.items||[]);
  }catch(e){setError(e.message)}finally{setLoading(false)}
 };
 useEffect(()=>{void refresh()},[clientSlug]);
 const names=new Map(pharmacies.map(p=>[String(p.id),p.name]));
 const normalize=x=>String(x??"").trim().toUpperCase().replace(/^0+(?=\d)/,"");
 const linked=useMemo(()=>new Set(suppliers.flatMap(p=>(p.origins||[]).map(a=>
  a.pharmacyCode.toUpperCase()+"|"+normalize(a.sourceCode)))),[suppliers]);
 const pending=useMemo(()=>sources.flatMap(p=>(p.origins||[])
  .filter(o=>o.pharmacyId&&(o.source==="farmatic"||o.source==="recepciones"))
  .map(o=>{
   const pharmacy=pharmacies.find(f=>String(f.id)===String(o.pharmacyId));
   return pharmacy?{pharmacyCode:String(pharmacy.databaseCode||pharmacy.sourceCode).toUpperCase(),
    pharmacyName:pharmacy.name,sourceCode:p.sourceCode,name:o.name}:null;
  }).filter(Boolean)).filter(o=>!linked.has(o.pharmacyCode+"|"+normalize(o.sourceCode))),
  [sources,suppliers,pharmacies,linked]);
 const uniquePending=[...new Map(pending.map(x=>[x.pharmacyCode+"|"+normalize(x.sourceCode),x])).values()];
 const visible=useMemo(()=>suppliers.filter(p=>
  [p.name,p.key,p.class,...(p.origins||[]).flatMap(o=>[o.sourceName,o.sourceCode,o.pharmacyCode])]
   .join(" ").toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"))),[suppliers,search]);
 const freqByKey=new Map(frequencies.map(x=>[x.key,x.days]));
 const checked=new Set(selected);
 async function save(){
  if(!editing)return;
  setBusy(true);setError("");setNotice("");
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
   await refresh();setNotice(`Importadas ${data.newAliases} equivalencias y ${data.newSuppliers} proveedores. Conflictos: ${data.sourceConflicts}.`);
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function link(){
  if(!linking||!chosen)return;
  setBusy(true);setError("");setNotice("");
  try{
   await call(clientSlug,"/api/tenant/proveedores-unificados/"+chosen+"/origen",{
    method:"PUT",body:JSON.stringify({pharmacyCode:linking.pharmacyCode,
     sourceCode:linking.sourceCode,sourceName:linking.name})});
   setLinking(null);setChosen("");await refresh();setNotice("Código de Farmatic vinculado");
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function saveFrequency(supplier,value){
  setBusy(true);setError("");setNotice("");
  try{
   const result=await call(clientSlug,"/api/tenant/pedidos/frecuencias",{
    method:"PUT",body:JSON.stringify({key:"P:"+supplier.id,days:value==="demanda"?null:Number(value)})});
   setFrequencies(prev=>value==="demanda"?
    prev.filter(x=>x.key!==result.key):
    [...prev.filter(x=>x.key!==result.key),result]);
   setNotice("Planificación de "+supplier.name+" actualizada.");
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function merge(){
  if(!selected.length||!mergeTo||checked.has(mergeTo))return;
  const destination=suppliers.find(x=>String(x.id)===mergeTo);
  if(!window.confirm(`¿Fusionar ${selected.length} proveedores dentro de ${destination?.name}? Sus códigos heredarán la clasificación del destino.`))return;
  setBusy(true);setError("");setNotice("");
  try{
   const result=await call(clientSlug,"/api/tenant/proveedores-unificados/fusionar",{
    method:"POST",body:JSON.stringify({destino:mergeTo,origenes:selected})});
   setSelected([]);setMergeTo("");await refresh();
   setNotice(`Fusionados ${result.merged} proveedores y ${result.aliases} códigos bajo ${result.target.name}.`);
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 const toggle=id=>setSelected(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]);
 return <div className="fm-management fm-production-panel fm-unified-master">
  <header className="section-heading"><div><h1>Maestro de proveedores</h1>
   <p>Cada proveedor definitivo tiene un solo nombre, clasificación y frecuencia de pedidos. Sus equivalencias de Farmatic heredan estos ajustes.</p></div>
   <div><button className="btn btn-secondary" disabled={loading||busy} onClick={()=>void refresh()}>Actualizar</button>{" "}
    <button className="btn btn-primary" onClick={()=>setEditing({name:"",class:"SIN_CLASIFICAR"})}>Nuevo proveedor</button>
   </div></header>
  {error&&<p role="alert" className="fm-manage-feedback">{error}</p>}
  {notice&&<p role="status" className="fm-manage-feedback">{notice}</p>}
  {loading&&<LoadingStatus label="Comprobando identidades de proveedores…"/>}
  <div className="fm-supplier-summary">
   <div className="card fm-supplier-summary-item"><span>Proveedores unificados</span><strong>{suppliers.length}</strong></div>
   <div className="card fm-supplier-summary-item"><span>Laboratorios</span><strong>{suppliers.filter(p=>ORDERABLE.has(p.class)).length}</strong></div>
   <div className="card fm-supplier-summary-item"><span>Cooperativas / internos</span><strong>{suppliers.filter(p=>["MAYORISTA","INTERNO"].includes(p.class)).length}</strong></div>
   <div className="card fm-supplier-summary-item"><span>Pendientes de unificar</span><strong>{uniquePending.length}</strong></div>
  </div>
  <div className="fm-supplier-tabs" role="tablist" aria-label="Vistas del maestro">
   <button role="tab" aria-selected={tab==="maestro"} className={tab==="maestro"?"active":""} onClick={()=>setTab("maestro")}>Proveedores unificados ({suppliers.length})</button>
   <button role="tab" aria-selected={tab==="pendientes"} className={tab==="pendientes"?"active":""} onClick={()=>setTab("pendientes")}>Pendientes de unificar ({uniquePending.length})</button>
  </div>
  {tab==="maestro"?<>
   <section className="card fm-supplier-master-list">
    <label>Buscar proveedor, farmacia o código
     <input type="search" placeholder="Nombre, código o farmacia…" value={search}
      onChange={e=>{setSearch(e.target.value);setLimit(80)}}/>
    </label>
    {selected.length>0&&<div className="fm-supplier-merge-bar">
     <strong>{selected.length} identidades seleccionadas para fusionar</strong>
     <select aria-label="Proveedor definitivo de destino" value={mergeTo} onChange={e=>setMergeTo(e.target.value)}>
      <option value="">Elegir proveedor definitivo…</option>
      {suppliers.filter(p=>!checked.has(String(p.id))).map(p=><option key={p.id} value={String(p.id)}>{p.name}</option>)}
     </select>
     <button className="btn btn-primary" disabled={!mergeTo||busy} onClick={()=>void merge()}>Fusionar en destino</button>
     <button className="btn btn-secondary" disabled={busy} onClick={()=>{setSelected([]);setMergeTo("")}}>Cancelar</button>
    </div>}
    <HorizontalTableScroll className="fm-preview-scroll" label="maestro unificado de proveedores">
     <table className="fm-table"><thead><tr><th>Fusionar</th>
      <th>Proveedor definitivo</th><th>Clasificación única</th><th>Frecuencia de pedido</th>
      <th>Equivalencias de Farmatic</th><th>Acciones</th>
     </tr></thead><tbody>
     {visible.slice(0,limit).map(p=><tr key={p.id}>
      <td><input type="checkbox" checked={checked.has(String(p.id))} onChange={()=>toggle(String(p.id))}
       aria-label={"Seleccionar "+p.name+" para fusionar"}/></td>
      <td><strong>{p.name}</strong></td>
      <td>{CLASS_LABELS[p.class]||p.class}</td>
      <td>{ORDERABLE.has(p.class)?<select aria-label={"Frecuencia de "+p.name}
        value={freqByKey.get("P:"+p.id)==null?"demanda":String(freqByKey.get("P:"+p.id))}
        disabled={busy} onChange={e=>void saveFrequency(p,e.target.value)}>
        <option value="demanda">Bajo demanda</option>
        {Array.from({length:10},(_,i)=><option key={i+1} value={i+1}>Cada {i+1} {i===0?"día":"días"}</option>)}
        {[14,21,30].map(d=><option key={d} value={d}>Cada {d} días</option>)}
       </select>:<span className="fm-muted">No aplica</span>}</td>
      <td><details><summary>{p.origins?.length||0} identidades de origen</summary>
       <div className="fm-supplier-alias-list">{(p.origins||[]).map((a,i)=><div key={i}>
        {a.pharmacyCode}: {a.sourceCode} — {a.sourceName}{" "}
        <button type="button" className="btn btn-secondary btn-sm"
         onClick={()=>{setLinking({pharmacyCode:a.pharmacyCode,sourceCode:a.sourceCode,name:a.sourceName});setChosen("")}}>Reasignar</button>
       </div>)}</div>
      </details></td>
      <td><button className="btn btn-secondary btn-sm" onClick={()=>setEditing({...p})}>Editar</button></td>
     </tr>)}
     </tbody></table>
    </HorizontalTableScroll>
    {visible.length>limit&&<button className="btn btn-secondary" onClick={()=>setLimit(x=>x+80)}>
     Mostrar 80 más ({visible.length-limit} pendientes)</button>}
    {!visible.length&&!loading&&<p>No hay proveedores para esta búsqueda.</p>}
   </section>
  </>:<section className="card">
   <h2>Identidades de Farmatic pendientes de relacionar</h2>
   <p>Los códigos de proveedor son propios de cada farmacia. Selecciona un destino definitivo; no se fusionarán automáticamente por compartir número o nombre.</p>
   <label>Importar equivalencias desde CSV (se respetan los cambios manuales)
    <input type="file" accept=".csv,text/csv" disabled={busy} onChange={e=>{void importFile(e.target.files?.[0]);e.target.value=""}}/>
   </label>
   <HorizontalTableScroll className="fm-preview-scroll" label="orígenes pendientes">
    <table className="fm-table"><thead><tr><th>Farmacia</th><th>Código</th><th>Nombre de origen</th><th>Destino</th></tr></thead>
     <tbody>{uniquePending.slice(0,limit).map((p,i)=><tr key={i}>
      <td>{p.pharmacyName}</td><td>{p.sourceCode}</td><td>{p.name}</td>
      <td><button className="btn btn-secondary btn-sm" onClick={()=>{setLinking(p);setChosen("")}}>Relacionar</button></td>
     </tr>)}</tbody>
    </table>
   </HorizontalTableScroll>
   {uniquePending.length>limit&&<button className="btn btn-secondary" onClick={()=>setLimit(n=>n+80)}>Mostrar más pendientes</button>}
  </section>}
  {editing&&<div className="fm-demo-overlay" role="dialog" aria-modal="true" aria-label="Editar proveedor">
   <div className="fm-demo-detail fm-provider-dialog"><h2>{editing.id?"Editar proveedor":"Nuevo proveedor"}</h2>
    <label>Nombre unificado<input value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/></label>
    <label>Clasificación única<select value={editing.class} onChange={e=>setEditing({...editing,class:e.target.value})}>
     {CLASSES.map(c=><option key={c} value={c}>{CLASS_LABELS[c]}</option>)}</select></label>
    <p>Esta clasificación se aplicará a todos los códigos de origen vinculados. Los movimientos históricos permanecen intactos.</p>
    <button className="btn btn-secondary" onClick={()=>setEditing(null)}>Cancelar</button>
    <button className="btn btn-primary" disabled={busy} onClick={()=>void save()}>Guardar</button>
   </div></div>}
  {linking&&<div className="fm-demo-overlay" role="dialog" aria-modal="true" aria-label="Relacionar código de Farmatic">
   <div className="fm-demo-detail fm-provider-dialog"><h2>Relacionar código de Farmatic</h2>
    <p>{linking.pharmacyName||linking.pharmacyCode} · {linking.sourceCode} · {linking.name}</p>
    <label>Proveedor unificado de destino<select value={chosen} onChange={e=>setChosen(e.target.value)}>
     <option value="">Seleccionar proveedor definitivo…</option>
     {suppliers.map(p=><option key={p.id} value={p.id}>{p.name} ({CLASS_LABELS[p.class]})</option>)}</select></label>
    <button className="btn btn-secondary" onClick={()=>setLinking(null)}>Cancelar</button>
    <button className="btn btn-primary" disabled={busy||!chosen} onClick={()=>void link()}>Guardar equivalencia</button>
   </div></div>}
 </div>;
}
