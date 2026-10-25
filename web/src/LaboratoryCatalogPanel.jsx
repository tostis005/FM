import React,{useEffect,useState} from "react";
import LaboratoryPicker from "./LaboratoryPicker.jsx";
import {LoadingStatus} from "./LoadingState.jsx";
import "./laboratoryCatalog.css";
import {collectLaboratoryCatalog,LAB_CATALOG_BATCH} from "./laboratoryLoadAll.js";

async function getJson(path,clientSlug,signal){
 const response=await fetch(path,{credentials:"same-origin",cache:"no-store",
  headers:{"X-Farmetrica-Cliente":clientSlug},signal});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(payload.error||"No se pudo consultar el catálogo");
 return payload;
}
export default function LaboratoryCatalogPanel({clientSlug,pharmacyIds=[]}){
 const [laboratories,setLaboratories]=useState([]);
 const [selected,setSelected]=useState("");
 const [tab,setTab]=useState("parafarmacia");
 const [search,setSearch]=useState("");
 const [result,setResult]=useState({rows:[],total:0,page:1,size:50});
 const [loading,setLoading]=useState(false),[loadingLabs,setLoadingLabs]=useState(true);
 const [error,setError]=useState("");
 const pharmacyCodes=pharmacyIds.map(String).join(",");
 useEffect(()=>{
  const ac=new AbortController();
  setLoadingLabs(true);
  const q=new URLSearchParams({uso:"preparador",farmacias:pharmacyCodes});
  getJson("/api/analytics/pedidos/catalogo-laboratorios?"+q,clientSlug,ac.signal)
   .then(data=>{if(!ac.signal.aborted){
    const available=data.laboratories||[];setLaboratories(available);
    setSelected(current=>current&&!available.some(l=>l.key===current)?"":current);
   }})
   .catch(e=>{if(!ac.signal.aborted)setError(e.message)})
   .finally(()=>{if(!ac.signal.aborted)setLoadingLabs(false)});
  return ()=>ac.abort();
 },[clientSlug,pharmacyCodes]);
 useEffect(()=>{
  if(!selected){setResult({rows:[],total:0});setLoading(false);return}
  const ac=new AbortController();
  setLoading(true);setError("");setResult({rows:[],total:0});
  const timer=setTimeout(async()=>{
   try{
    await collectLaboratoryCatalog((number,size)=>{
     const query=new URLSearchParams({laboratorio:selected,tipo:tab,buscar:search,
      farmacias:pharmacyCodes,pagina:String(number),tamano:String(size)});
     return getJson("/api/analytics/pedidos/catalogo-directo?"+query,clientSlug,ac.signal);
    },{signal:ac.signal,batchSize:LAB_CATALOG_BATCH,
     onBatch:({rows,total})=>{if(!ac.signal.aborted)setResult({rows,total})}});
   }catch(e){if(!ac.signal.aborted)setError("No se pudieron cargar todos los artículos: "+e.message)}
   finally{if(!ac.signal.aborted)setLoading(false)}
  },200);
  return ()=>{clearTimeout(timer);ac.abort()};
 },[clientSlug,selected,tab,search,pharmacyCodes]);
 return <section className="card fm-laboratory-catalog" aria-label="Catálogo por laboratorio">
  <div className="fm-laboratory-heading">
   <div><h2>Artículos por laboratorio</h2>
    <p>Solo laboratorios con compras o artículos con código nacional en las farmacias seleccionadas. El Nomenclátor por sí solo no añade laboratorios.</p>
   </div>
   {loadingLabs&&<LoadingStatus compact label="Cargando laboratorios…"/>}
  </div>
  <div className="fm-laboratory-filters fm-laboratory-single-filter">
   <div className="fm-supplier-laboratory-picker">
    <span>Buscar y seleccionar laboratorio</span>
    <LaboratoryPicker laboratories={laboratories} selected={selected}
     loading={loadingLabs} onSelect={key=>{
      setSelected(key);setSearch("");setTab("parafarmacia");
     }} ariaLabel="Seleccionar laboratorio del catálogo"/>
   </div>
  </div>
  {error&&<p role="alert" className="fm-op-message fm-op-error">{error}</p>}
  {!selected?<p className="fm-laboratory-empty">Escribe y selecciona un laboratorio en el mismo campo para consultar sus referencias.</p>:<>
   <div className="fm-laboratory-tabs" role="tablist" aria-label="Tipo de producto">
    {["parafarmacia","medicacion"].map(type=>
     <button type="button" role="tab" aria-selected={tab===type} key={type}
      className={tab===type?"active":""} onClick={()=>{setTab(type)}}>
      {type==="medicacion"?"Medicación":"Parafarmacia"}</button>)}
   </div>
   <div className="fm-laboratory-toolbar">
    <label><span>Buscar artículo o CN/EAN</span><input type="search" value={search}
     onChange={e=>{setSearch(e.target.value)}}
     placeholder="Artículo, código nacional o ERP…"/></label>
    <span>{(result.rows||[]).length+" de "+result.total+" artículos"+(loading?" · cargando…":"")}</span>
   </div>
   <div className="fm-laboratory-scroll" role="tabpanel">
    <table><thead><tr><th>Código nacional / ERP</th><th>Artículo</th><th>Origen</th><th>Farmacias con movimientos</th></tr></thead>
     <tbody>{(result.rows||[]).map(r=><tr key={r.referencia}>
      <td><strong>{r.cn||r.referencia}</strong></td>
      <td>{r.nombre}{r.provisional&&<small className="fm-laboratory-provisional"> · Clasificación provisional (no figura en el maestro)</small>}</td>
      <td>{r.inMaster&&r.inReceipts?"Nomenclátor + movimientos":r.inMaster?"Nomenclátor":"Ventas o recepciones ERP"}</td>
      <td>{r.pharmacyIds||"—"}</td>
     </tr>)}
     {!loading&&!(result.rows||[]).length&&<tr><td colSpan={4}>No se han encontrado artículos en esta categoría para el laboratorio seleccionado.</td></tr>}
     </tbody>
    </table>
   </div>
   <small className="fm-op-fine">Fuente de los medicamentos: Agencia Española de Medicamentos y Productos Sanitarios (AEMPS). Las ventas y recepciones se asocian mediante sus códigos nacionales y las correspondencias ERP configuradas por farmacia. Un proveedor puede no ser el fabricante físico.</small>
  </>}
 </section>;
}
