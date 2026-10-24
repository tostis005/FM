import React,{useEffect,useState} from "react";
import {Database,Upload,ExternalLink,RefreshCcw,FileDown} from "lucide-react";
import "./sourceAdmin.css";

const formatDate=value=>value?new Date(value).toLocaleString("es-ES"):"Todavía no importado";
const count=n=>Number.isFinite(Number(n))?new Intl.NumberFormat("es-ES").format(n):"—";
const SOURCE_INFO=[
 {key:"nomenclator",name:"Nomenclátor AEMPS",extension:".zip",mimes:".zip",
  url:"https://cima.aemps.es/cima/publico/nomenclator.html",
  download:"https://listadomedicamentos.aemps.gob.es/prescripcion.zip",
  description:"Medicamentos autorizados, genéricos, DCPF, códigos nacionales y laboratorios. Alimenta Genéricos y Medicación del preparador.",
  guidance:"Descarga prescripcion.zip desde la AEMPS y cárgalo sin descomprimir. Su contenido se valida antes de reemplazar la versión vigente.",
  cadence:"AEMPS actualiza el nomenclátor diariamente; Farmétrica intenta sincronizarlo de forma automática el día 4 de cada mes."},
 {key:"vademecum",name:"Catálogo de artículos y laboratorios",extension:".csv",mimes:".csv,text/csv",
  description:"Relación CN/EAN → artículo → laboratorio. Alimenta el preparador de pedidos, especialmente parafarmacia.",
  guidance:"Carga un CSV de tu proveedor autorizado. Columnas obligatorias: codigo_nacional,nombre,laboratorio. Se admiten CN de 6/7 cifras y EAN de 13. Conserva los ceros iniciales.",
  cadence:"La periodicidad depende del proveedor del catálogo; no hay un vademécum completo gratuito precargado."}
];
function SourceCard({item,data,refresh}){
 const [file,setFile]=useState(null),[version,setVersion]=useState(()=>new Date().toISOString().slice(0,7));
 const [origin,setOrigin]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
 async function upload(event){
  event.preventDefault();
  if(!file||!version.trim())return;
  setBusy(true);setError("");setMessage("");
  try{
   const query=new URLSearchParams({version:version.trim(),filename:file.name,origin:origin.trim()});
   const response=await fetch("/api/admin/fuentes/"+item.key+"/cargar?"+query,{
    method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/octet-stream"},
    body:file});
   const json=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(json.error||"No se pudo validar el fichero");
   setMessage("Nueva fuente cargada: "+count(json.total)+" referencias. Versión "+json.version+".");
   setFile(null);await refresh();
  }catch(e){setError(e.message)}
  finally{setBusy(false)}
 }
 function downloadTemplate(){
  const csv="\uFEFFcodigo_nacional;nombre;laboratorio;tipo\n000123;Artículo ejemplo;Laboratorio ejemplo;parafarmacia\n";
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");link.href=url;link.download="plantilla-articulos-laboratorio.csv";
  document.body.appendChild(link);link.click();link.remove();
  URL.revokeObjectURL(url);
 }
 return <section className="card fm-source-card">
  <div className="fm-source-head"><div><h2><Database size={19}/>{item.name}</h2>
   <p>{item.description}</p></div></div>
  <div className="fm-source-meta">
   <div><span>Versión activa</span><strong>{data?.version||"Sin fichero"}</strong></div>
   <div><span>Última carga</span><strong>{formatDate(data?.updatedAt)}</strong></div>
   <div><span>Referencias</span><strong>{count(data?.total??data?.indexed)}</strong></div>
   <div><span>Identificador SHA-256</span><strong title={data?.sha256||""}>{data?.sha256?data.sha256.slice(0,16)+"…":"—"}</strong></div>
  </div>
  <p className="fm-source-cadence">{item.cadence}</p>
  <div className="fm-source-links">
   {item.url&&<a href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/> Página oficial</a>}
   {item.download&&<a href={item.download} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/> ZIP AEMPS</a>}
   {data?.sourceUrl&&<a href={data.sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/> Origen del catálogo cargado</a>}
   {item.key==="nomenclator"&&<a href="https://github.com/tostis005/FM/actions/workflows/nomenclator.yml" target="_blank" rel="noopener noreferrer"><RefreshCcw size={14}/> Actualización automática</a>}
   {item.key==="vademecum"&&<button type="button" className="btn btn-secondary btn-sm" onClick={downloadTemplate}><FileDown size={14}/> Descargar plantilla CSV</button>}
  </div>
  <div className="fm-source-upload">
   <h3>Actualizar fichero</h3><p>{item.guidance}</p>
   <form onSubmit={upload}>
    <label>Versión o edición del fichero
     <input value={version} onChange={e=>setVersion(e.target.value)}
      maxLength={70} required placeholder="2026-10"/>
    </label>
    {item.key==="vademecum"&&<label>Enlace al proveedor o fuente (opcional)
     <input type="url" value={origin} onChange={e=>setOrigin(e.target.value)}
      placeholder="https://proveedor.ejemplo/catalogo" /></label>}
    <label>Fichero {item.extension}
     <input key={file?.name||"empty"} type="file" accept={item.mimes} required
      onChange={e=>setFile(e.target.files?.[0]||null)} />
    </label>
    <button className="btn btn-primary" type="submit" disabled={!file||busy}>
     <Upload size={15}/> {busy?"Validando e importando…":"Cargar nueva versión"}
    </button>
   </form>
   {busy&&<p role="status">Validando integridad y contenido. La versión anterior se conserva si la importación falla.</p>}
   {error&&<p className="fm-source-error" role="alert">{error}</p>}
   {message&&<p className="fm-source-success" role="status">{message}</p>}
  </div>
 </section>;
}
export default function FuentesMaestras(){
 const [sources,setSources]=useState(null),[error,setError]=useState(""),[loading,setLoading]=useState(true);
 async function load(){
  setError("");setLoading(true);
  try{
   const r=await fetch("/api/admin/fuentes",{credentials:"same-origin",cache:"no-store"});
   const result=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(result.error||"No se pudo consultar el origen de datos");
   setSources(result);
  }catch(e){setError(e.message)}
  finally{setLoading(false)}
 }
 useEffect(()=>{void load()},[]);
 return <div className="fm-source-admin">
  <div className="page-header"><div><h1>Fuentes de datos</h1><p>Versiones y actualización de los catálogos maestros compartidos por Farmétrica.</p></div>
   <button className="btn btn-secondary" type="button" onClick={load} disabled={loading}><RefreshCcw size={15}/> Actualizar estado</button></div>
  {error&&<p role="alert" className="fm-source-error">{error}</p>}
  {loading&&!sources&&<p>Cargando versiones de las fuentes…</p>}
  {sources&&<div className="fm-source-grid">
   {SOURCE_INFO.map(item=><SourceCard key={item.key} item={item} data={sources[item.key]} refresh={load}/>)}
  </div>}
 </div>;
}
