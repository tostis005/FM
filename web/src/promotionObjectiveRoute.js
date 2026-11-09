import {promotionMonthRange} from "./promotionMonthFilter.js";

// El editor tiene una ruta estable para campañas ya guardadas.
// Nunca incluir datos de objetivos ni permisos en la URL, solo sus referencias.
export function objectiveEditorUrl(id="",month=""){
 const params=new URLSearchParams();
 if(id)params.set("promocion",String(id));
 if(month&&promotionMonthRange(month))params.set("mes",month);
 return "/promociones/nueva"+(params.size?"?"+params.toString():"");
}
export function objectiveEditorRoute(pathname="",search=""){
 if(!/^\/promociones\/(?:nueva|simulador)\/?$/.test(pathname))return null;
 const params=new URLSearchParams(search),raw=params.get("promocion");
 const invalid=params.has("promocion")&&(!raw||raw.length>120||/[\x00-\x1f\x7f]/.test(raw));
 const month=params.get("mes");
 return {id:invalid?"":raw||"",invalid,month:promotionMonthRange(month)?month:""};
}
