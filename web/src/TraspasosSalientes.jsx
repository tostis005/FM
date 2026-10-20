import React,{useEffect,useMemo,useState} from "react";
import "./moduleDemo.css";
const TODAY=()=>new Date().toISOString().slice(0,10);
const MONTH_AGO=()=>new Date(Date.now()-30*86400000).toISOString().slice(0,10);
export default function TraspasosSalientes({clientSlug,suppliers=[]}){
 const [pharmacies,setPharmacies]=useState([]),[mappings,setMappings]=useState([]),
 [form,setForm]=useState({supplierCode:"",pharmacyId:"",customerId:"",from:MONTH_AGO(),to:TODAY()}),
 [preview,setPreview]=useState(null),[confirmed,setConfirmed]=useState(false),
 [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const root="/api/tenant/proveedores/traspasos-salidas";
 async function api(path,options={}){
  const response=await fetch(path,{credentials:"same-origin",cache:"no-store",...options,
   headers:{"Content-Type":"application/json","X-Farmetrica-Cliente":clientSlug,...options.headers}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||"No se pudo completar la operación");
  return data;
 }
 async function reload(){
  const [m,p]=await Promise.all([api(root),api("/api/tenant/farmacias")]);
  setMappings(Array.isArray(m)?m:[]);setPharmacies(Array.isArray(p)?p:[]);
 }
 useEffect(()=>{let live=true;
  Promise.all([api(root),api("/api/tenant/farmacias")]).then(([m,p])=>{
   if(live){setMappings(m);setPharmacies(p);}
  }).catch(e=>{if(live)setError(e.message)});
  return()=>{live=false}
 },[clientSlug]);
 const ignored=useMemo(()=>suppliers.filter(p=>p.ignoreReports),[suppliers]);
 const clearForm=(key,value)=>{setForm(f=>({...f,[key]:value}));setPreview(null);setConfirmed(false);setError("");setMessage("")};
 const pharmacyName=id=>pharmacies.find(p=>String(p.id)===String(id))?.name||"Farmacia "+id;
 async function inspect(e){
  e.preventDefault();setBusy(true);setError("");setMessage("");setPreview(null);setConfirmed(false);
  try{
   const data=await api(root+"/preview",{method:"POST",body:JSON.stringify(form)});
   setPreview(data);
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function save(){
  if(!preview||!confirmed)return;
  setBusy(true);setError("");
  try{
   await api(root,{method:"PUT",body:JSON.stringify({
    pharmacyId:form.pharmacyId,supplierCode:form.supplierCode,
    customerId:form.customerId,confirmed:true})});
   await reload();setPreview(null);setConfirmed(false);setForm(f=>({...f,customerId:""}));
   setMessage("Correspondencia activada. Las salidas identificadas dejarán de contar como ventas comerciales.");
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function remove(m){
  if(!window.confirm("¿Desactivar la exclusión de salidas de "+pharmacyName(m.pharmacyId)+" para el cliente ERP "+m.customerId+"?"))return;
  setBusy(true);setError("");
  try{
   await api(root,{method:"DELETE",body:JSON.stringify({pharmacyId:m.pharmacyId,customerId:m.customerId})});
   await reload();setMessage("Correspondencia eliminada; estas salidas vuelven a contar como ventas.");
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <section className="card fm-manage-transfers">
  <h2>Traspasos salientes entre farmacias</h2>
  <p>«Ignorar en informes» ya excluye las <strong>recepciones</strong> del proveedor.
   Para excluir también las <strong>salidas contabilizadas como ventas</strong>,
   hay que identificar el código del cliente destinatario en Farmatic
   (<code>Venta.XClie_IdCliente</code>) para cada farmacia de origen.</p>
  <p>Un código de proveedor no es necesariamente un código de cliente.
   <strong> No se excluirá ninguna venta sin esta correspondencia confirmada.</strong></p>
  {error&&<p role="alert" className="fm-manage-feedback">{error}</p>}
  {message&&<p role="status" className="fm-manage-feedback">{message}</p>}
  <h3>Correspondencias configuradas</h3>
  {mappings.length?<div className="fm-manage-domain-list">
   {mappings.map(m=><div className="fm-manage-domain-item"
     key={m.pharmacyId+"|"+m.customerId}>
    <strong>{pharmacyName(m.pharmacyId)}</strong>
    <span>Cliente ERP {m.customerId} → proveedor {m.supplierCode}
     {!ignored.some(p=>p.sourceCode===m.supplierCode)?" (exclusión desactivada en el proveedor)":""}</span>
    <button className="btn btn-secondary btn-sm" type="button" disabled={busy}
      onClick={()=>remove(m)}>Desactivar</button>
   </div>)}
  </div>:<p>No hay salidas internas identificadas; los informes de ventas todavía incluyen todas las operaciones de venta.</p>}
  <h3>Comprobar y vincular un destinatario</h3>
  {!ignored.length?<p>Marca primero el proveedor de la farmacia receptora como «Ignorar en informes».</p>:
  <form className="fm-manage-form" onSubmit={inspect}>
   <label>Proveedor ignorado en compras
    <select value={form.supplierCode} required onChange={e=>clearForm("supplierCode",e.target.value)}>
     <option value="">Seleccionar proveedor</option>
     {ignored.map(p=><option key={p.sourceCode} value={p.sourceCode}>{p.name} ({p.sourceCode})</option>)}
    </select></label>
   <label>Farmacia que registra la salida
    <select value={form.pharmacyId} required onChange={e=>clearForm("pharmacyId",e.target.value)}>
     <option value="">Seleccionar farmacia</option>
     {pharmacies.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
    </select></label>
   <label>ID del cliente destinatario en Farmatic
    <input type="text" required inputMode="numeric" pattern="[1-9][0-9]{0,17}"
      value={form.customerId} onChange={e=>clearForm("customerId",e.target.value.trim())}
      placeholder="XClie_IdCliente"/></label>
   <label>Desde<input type="date" required value={form.from}
    onChange={e=>clearForm("from",e.target.value)}/></label>
   <label>Hasta<input type="date" required value={form.to}
    onChange={e=>clearForm("to",e.target.value)}/></label>
   <button type="submit" className="btn btn-secondary" disabled={busy}>
    {busy?"Comprobando…":"Comprobar movimientos (sin excluir todavía)"}</button>
  </form>}
  {preview&&<div className="fm-manage-transfer-preview">
   <h3>Vista previa: todavía no se han modificado los informes</h3>
   <p><strong>{preview.documents} documentos y {new Intl.NumberFormat("es-ES",{maximumFractionDigits:2}).format(preview.units)} unidades netas</strong> asociados a este ID de cliente en el período.</p>
   <div className="fm-manage-domain-list">
    {preview.bySaleType.map(t=><div className="fm-manage-domain-item" key={t.saleType}>
     <strong>{t.saleType}</strong><span>{t.documents} documentos · {t.units} unidades</span>
    </div>)}
   </div>
   {!preview.documents&&<p role="status">No hay movimientos en estas fechas. Verifica el ID y el período antes de autorizar una exclusión.</p>}
   <label className="fm-supplier-check-field">
    <input type="checkbox" checked={confirmed}
     onChange={e=>setConfirmed(e.target.checked)}/>
    Confirmo en Farmatic que <strong>todas las ventas de este ID de cliente son traspasos internos</strong>,
    no ventas a pacientes ni a clientes externos.
   </label>
   <button type="button" className="btn btn-primary" disabled={!confirmed||busy}
    onClick={save}>{busy?"Guardando…":"Activar exclusión de salidas"}</button>
  </div>}
 </section>;
}
