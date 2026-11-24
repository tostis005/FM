import {NAVIGATION_GROUPS} from "./navigationSections.js";
// Exact sidebar order and tab labels. Internal entitlement keys remain stable.
// Reposición and Informes retain independent plan settings within their actual
// menu groups; Ahorro verificado shares Rentabilidad's existing permission.
const auxiliary={reposicion:"reposicion",informes:"informes", "rentabilidad-retorno":"rentabilidad"};
const fixed=new Set(["configuracion","administracion"]);
export function clientMenuSettings(client){
 const flags=client?.modules||{};
 return NAVIGATION_GROUPS.map(group=>{
  const id=group.id;
  if(fixed.has(id))return {...group,kind:"role",controls:[],tabs:group.tabs.map(([id,label])=>({id,label,roleOnly:true}))};
  if(id==="auditoria")return {...group,kind:"audit",controls:[{id,label:group.label,enabled:!client?.demoSourceSlug&&client?.auditEnabled===true,disabled:Boolean(client?.demoSourceSlug)}],tabs:[]};
  const controls=[{id,label:group.label,enabled:flags[id]===true}];
  const tabs=group.tabs.map(([tab,label])=>{
   const module=auxiliary[tab]||id;
   if(module!==id&&tab!=="rentabilidad-retorno"&&!controls.some(c=>c.id===module))
    controls.push({id:module,label,enabled:flags[module]===true});
   return {id:tab,label,module,enabled:flags[module]===true};
  });
  return {...group,kind:"module",controls,tabs};
 });
}
