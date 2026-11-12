import React,{Suspense,useEffect,useState} from "react";
import {ArrowLeft,ArrowRightLeft,ChevronRight,ClipboardList,Pill,ShoppingCart,SlidersHorizontal} from "lucide-react";
import {readSettingsSection,settingsSectionUrl} from "./settingsSections.js";
import "./settingsLayout.css";
import "./ajustesPanel.css";

// Los formularios solo se cargan cuando se abre su área.
const ConfiguracionAnalisisVentas=React.lazy(()=>import("./ConfiguracionAnalisisVentas.jsx"));
const ConfiguracionDiasStock=React.lazy(()=>import("./ConfiguracionDiasStock.jsx"));
const ConfiguracionPreparador=React.lazy(()=>import("./ConfiguracionPreparador.jsx"));
const ConfiguracionStockTransferidor=React.lazy(()=>import("./ConfiguracionStockTransferidor.jsx"));
const ConfiguracionPrecios=React.lazy(()=>import("./ConfiguracionPrecios.jsx"));
const ConfiguracionPickingList=React.lazy(()=>import("./ConfiguracionPickingList.jsx"));

const AREAS=[
 {id:"general",label:"General",description:"Parámetros compartidos por las farmacias.",detail:"Análisis de productos",icon:SlidersHorizontal},
 {id:"compras",label:"Preparador de pedidos",description:"Cobertura de stock y exclusiones.",detail:"Compras y reposición",icon:ShoppingCart},
 {id:"transferidor",label:"Transferidor",description:"Rotación y exposición por farmacia.",detail:"Reposición entre farmacias",icon:ArrowRightLeft},
 {id:"genericos",label:"Genéricos",description:"Precios de referencia y comparación.",detail:"Política de precios",icon:Pill},
 {id:"picking-list",label:"Picking List",description:"Origen de los pedidos pendientes.",detail:"Conexión con Dropbox",icon:ClipboardList}
];

export default function AjustesPanel({clientSlug,pharmacies=[],analysisMonths=12,onAnalysisSaved}){
 const [section,setSection]=useState(()=>readSettingsSection(window.location.search));
 useEffect(()=>{
  const sync=()=>setSection(readSettingsSection(window.location.search));
  window.addEventListener("popstate",sync);
  window.addEventListener("fm-settings-navigate",sync);
  return()=>{
   window.removeEventListener("popstate",sync);
   window.removeEventListener("fm-settings-navigate",sync);
  };
 },[]);
 const active=AREAS.find(area=>area.id===section);
 function navigateTo(id){
  const url=settingsSectionUrl(id);
  if(window.location.pathname+window.location.search!==url)
   window.history.pushState({page:"ajustes",settingsSection:id||null},"",url);
  setSection(readSettingsSection(window.location.search));
  window.scrollTo(0,0);
 }
 const content=<Suspense fallback={<div className="card fm-settings-loading" role="status">Cargando ajustes…</div>}>
  {section==="general"&&
   <ConfiguracionAnalisisVentas clientSlug={clientSlug} initialMonths={analysisMonths} onSaved={onAnalysisSaved}/>}
  {section==="compras"&&<>
   <ConfiguracionDiasStock clientSlug={clientSlug}/>
   <ConfiguracionPreparador clientSlug={clientSlug}/>
  </>}
  {section==="transferidor"&&
   <ConfiguracionStockTransferidor clientSlug={clientSlug} pharmacies={pharmacies}/>}
  {section==="genericos"&&
   <ConfiguracionPrecios clientSlug={clientSlug} pharmacies={pharmacies}/>}
  {section==="picking-list"&&
   <ConfiguracionPickingList clientSlug={clientSlug}/>}
 </Suspense>;
 return <section className="fm-production-settings fm-settings-hub">
  <header className="page-header fm-settings-page-heading">
   <div><h1>Ajustes</h1>
    {!active&&<p>Selecciona el área que quieres configurar.</p>}
   </div>
  </header>
  {!active?
   <div className="fm-settings-overview">
    {AREAS.map(area=><button key={area.id} type="button" className="fm-settings-area-card"
     onClick={()=>navigateTo(area.id)} aria-label={"Abrir ajustes de "+area.label}>
     <span className="fm-settings-area-icon"><area.icon size={22} aria-hidden="true"/></span>
     <span className="fm-settings-area-copy"><strong>{area.label}</strong>
      <span>{area.description}</span></span>
     <ChevronRight size={19} className="fm-settings-area-arrow" aria-hidden="true"/>
    </button>)}
   </div>:
   <div className="fm-settings-layout">
    <nav className="fm-settings-rail" aria-label="Áreas de ajustes">
     <button className="fm-settings-rail-back" type="button" onClick={()=>navigateTo(null)}>
      <ArrowLeft size={16} aria-hidden="true"/> Todos los ajustes
     </button>
     {AREAS.map(area=><button key={area.id} type="button"
      className={"fm-settings-rail-item"+(section===area.id?" is-active":"")}
      aria-current={section===area.id?"page":undefined} onClick={()=>navigateTo(area.id)}>
      <area.icon size={17} aria-hidden="true"/><span>{area.label}</span>
     </button>)}
    </nav>
    <div className="fm-settings-detail">
     <div className="fm-settings-detail-heading">
      <span className="fm-settings-detail-icon"><active.icon size={22} aria-hidden="true"/></span>
      <div><h2>{active.label}</h2><p>{active.detail}</p></div>
     </div>
     <div className="fm-settings-detail-content">{content}</div>
    </div>
   </div>}
 </section>;
}
