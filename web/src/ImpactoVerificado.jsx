import React,{useEffect,useMemo,useState} from "react";
import {ArrowRight,CheckCircle2,Target} from "lucide-react";
import {euro} from "./localeES.js";
import {KpiValue} from "./LoadingState.jsx";
import "./centroTrabajo.css";

// Sólo contabiliza registros contrastados del libro de resultados.
// Un pedido preparado o una oportunidad aplicada NO es ahorro realizado.
export default function ImpactoVerificado({clientSlug,pharmacies=[],pharmacyIds=[],onNavigate,canNavigate}){
 const permitted=canNavigate?.("rentabilidad-retorno");
 const scope=useMemo(()=>pharmacyIds.length?pharmacyIds:pharmacies.map(p=>String(p.id)),
  [pharmacyIds.join(","),pharmacies.map(p=>String(p.id)).join(",")]);
 const [data,setData]=useState({status:"loading",items:[]});
 useEffect(()=>{
  if(!permitted||!scope.length){setData({status:"unavailable",items:[]});return;}
  let alive=true;
  setData({status:"loading",items:[]});
  Promise.allSettled(scope.map(async farmacia=>{
   const query=new URLSearchParams({recurso:"resultados",farmacia:String(farmacia)});
   const response=await fetch("/api/operativa?"+query,{credentials:"same-origin",cache:"no-store",
    headers:{"X-Farmetrica-Cliente":clientSlug}});
   if(!response.ok)throw Error("Consulta de resultados no disponible");
   return (await response.json()).items||[];
  })).then(results=>{
   if(!alive)return;
   const errors=results.filter(r=>r.status==="rejected").length;
   if(errors){setData({status:"error",items:[]});return;}
   setData({status:"ready",items:results.flatMap(r=>r.value)});
  });
  return()=>{alive=false;};
 },[clientSlug,scope.join(","),permitted]);
 if(!permitted)return null;
 const total=type=>data.items.filter(x=>x.tipo===type).reduce((s,x)=>s+Number(x.importe||0),0);
 const hasEvidence=data.status==="ready"&&data.items.length>0;
 return <section className="card fm-verified-impact">
  <div className="section-heading"><div><h2>Impacto económico de las acciones</h2>
   <p>Resultados acreditados, independientes de las oportunidades estimadas.</p></div>
   <button type="button" className="btn btn-secondary" onClick={()=>onNavigate?.("rentabilidad-retorno")}>
    Consultar evidencia <ArrowRight size={16}/></button>
  </div>
  {data.status==="loading"?<div className="kpi-grid small-kpis" role="status" aria-label="Consultando resultados verificados">
    {["Ahorro verificado","Mejora de margen verificada","Capital liberado","Resultados contrastados"].map(label=>
     <div className="card" key={label}><span>{label}</span>
      <KpiValue loading label={label} loadingText="Consultando…"/></div>)}
   </div>:
   data.status==="error"?<p role="alert">No se pueden verificar los resultados ahora. No mostramos una cifra incompleta.</p>:
   data.status==="unavailable"?<p>No hay farmacias disponibles para el seguimiento.</p>:
   <div className="kpi-grid small-kpis">
    <div className="card"><span><CheckCircle2 size={16}/> Ahorro verificado</span>
     <strong>{hasEvidence?euro(total("ahorro_verificado")):"Sin verificar"}</strong></div>
    <div className="card"><span><Target size={16}/> Mejora de margen verificada</span>
     <strong>{hasEvidence?euro(total("margen_verificado")):"Sin verificar"}</strong></div>
    <div className="card"><span>Capital liberado</span>
     <strong>{hasEvidence?euro(total("capital_liberado")):"Sin verificar"}</strong></div>
    <div className="card"><span>Resultados contrastados</span>
     <strong>{data.items.length}</strong></div>
   </div>}
  <p className="fm-insight-foot">El capital liberado no se suma al ahorro. Cambiar el estado de una oportunidad a «Aplicada» no genera un resultado verificado.</p>
 </section>;
}
