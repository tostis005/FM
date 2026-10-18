import React from "react";
import "./loadingState.css";

// Estados explícitos sin representar cifras ficticias mientras llega la respuesta.
export function LoadingStatus({label="Cargando datos…",compact=false}){
 return <div className={"fm-load-status "+(compact?"fm-load-compact":"")} role="status" aria-live="polite">
   <span className="fm-load-spinner" aria-hidden="true"/>
   <span>{label}</span>
 </div>;
}
export function SkeletonLine({width="100%",height="14px"}){
 return <span className="fm-skeleton" aria-hidden="true" style={{width,height}}/>;
}
export function SkeletonKpis({count=4}){
 return <div className="fm-skeleton-kpis" role="status" aria-label="Cargando indicadores">
  {Array.from({length:count},(_,i)=><div className="card fm-skeleton-kpi" key={i}>
   <SkeletonLine width="60%" height="12px"/><SkeletonLine width="72%" height="29px"/>
  </div>)}
 </div>;
}
export function LoadingPanel({kind="table",label="Cargando datos…",rows=4}){
 return <div className={"fm-loading-panel fm-loading-"+kind} role="status" aria-label={label}>
   <LoadingStatus label={label}/>
   {kind==="chart"?<div className="fm-skeleton-chart" aria-hidden="true">
    {[40,74,53,88,61,70,42,82].map((height,i)=><span className="fm-skeleton" key={i} style={{height:height+"%"}}/>)}
   </div>:<div className="fm-skeleton-rows" aria-hidden="true">
    {Array.from({length:rows},(_,i)=><div className="fm-skeleton-row" key={i}>
      <SkeletonLine width={i%2?"33%":"27%"}/><SkeletonLine width="23%"/><SkeletonLine width="13%"/>
    </div>)}
   </div>}
 </div>;
}
export function LoadingFrame({loading=false,label="Actualizando datos…",children,className=""}){
 return <div className={"fm-loading-frame "+className+(loading?" fm-is-loading":"")}
   aria-busy={loading} >
   {children}
   {loading&&<div className="fm-loading-overlay"><LoadingStatus compact label={label}/></div>}
 </div>;
}
