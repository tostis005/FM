import React from "react";
import {RefreshCw} from "lucide-react";
import {MultiSelectFilter} from "./MultiSelectFilter.jsx";
import {SALES_PERIODS} from "./salesPeriods.js";
import "./reportControls.css";

// El mismo conjunto de atajos se utiliza en cada pantalla con intervalo de fechas.
export const QUICK_PERIODS=[
 ["today","Hoy"],["yesterday","Ayer"],["this_week","Esta semana"],
 ["this_month","Este mes"],["this_year","Este año"]
];

const formatDay=value=>value&&/^\d{4}-\d{2}-\d{2}$/.test(value)
 ? value.slice(8,10)+"/"+value.slice(5,7)+"/"+value.slice(0,4) : "";

export function ReportPageHeader({title,description,period,updatedAt,onRefresh,refreshing=false,actions}){
 const dates=period?.valid?(period.from===period.to?formatDay(period.from):
  formatDay(period.from)+" – "+formatDay(period.to)):"";
 return <div className="page-header fm-unified-header">
  <div className="fm-unified-heading"><h1>{title}</h1>{description&&<p>{description}</p>}</div>
  <div className="fm-unified-header-right">
   {(dates||updatedAt)&&<div className="fm-unified-header-meta" aria-live="polite">
    {dates&&<span>Período: {dates}</span>}
    {updatedAt&&<small>Última actualización: {updatedAt.toLocaleString("es-ES",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</small>}
   </div>}
   {onRefresh&&<button className="btn btn-secondary" type="button" disabled={refreshing} onClick={onRefresh}>
    <RefreshCw size={16}/> Actualizar
   </button>}
   {actions}
  </div>
 </div>;
}

// El alcance por farmacia y el período comparten orden, etiquetas y aspecto en todos los informes.
export function ReportFilterBar({periodKey,onPeriodChange,pharmacies=[],pharmacyIds=[],onPharmacyChange,
 showPeriod=true,showPharmacies=true,customFrom="",customTo="",onCustomFromChange,onCustomToChange,
 quickPeriodKey, onQuickPeriodChange,children}){
 return <div className="card fm-unified-filters">
  {showPeriod&&<label className="fm-unified-filter"><span>Período</span>
   <select value={periodKey} onChange={e=>onPeriodChange?.(e.target.value)}>
    {SALES_PERIODS.map(([id,label])=><option key={id} value={id}>{label}</option>)}
   </select></label>}
  {showPharmacies&&<div className="fm-unified-filter"><span>Farmacias</span>
   <MultiSelectFilter label="Farmacias" placeholder="Todas las farmacias"
    options={pharmacies.map(f=>({value:String(f.id),label:f.name}))}
    value={pharmacyIds} onChange={onPharmacyChange}/></div>}
  {children}
  {showPeriod&&periodKey==="custom"&&<>
   <label className="fm-unified-filter"><span>Desde</span><input type="date" value={customFrom}
    onChange={e=>onCustomFromChange?.(e.target.value)}/></label>
   <label className="fm-unified-filter"><span>Hasta</span><input type="date" value={customTo}
    onChange={e=>onCustomToChange?.(e.target.value)}/></label>
  </>}
  {(showPeriod||onQuickPeriodChange)&&<div className="fm-period-shortcuts"
   role="group" aria-label="Períodos rápidos">
   {QUICK_PERIODS.map(([key,label])=><button key={key} type="button"
    className={"fm-period-shortcut "+((quickPeriodKey===undefined?periodKey:quickPeriodKey)===key?"is-selected":"")}
    aria-pressed={(quickPeriodKey===undefined?periodKey:quickPeriodKey)===key}
    onClick={()=>{(onQuickPeriodChange||onPeriodChange)?.(key)}}>
    {label}</button>)}
  </div>}
 </div>;
}
