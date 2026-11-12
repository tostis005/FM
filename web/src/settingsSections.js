// Cada área de ajustes tiene una entrada estable, independiente de sus formularios.
export const SETTINGS_SECTIONS=[
 {id:"general",label:"General"},
 {id:"compras",label:"Preparador de pedidos"},
 {id:"transferidor",label:"Transferidor"},
 {id:"genericos",label:"Genéricos"},
 {id:"picking-list",label:"Picking List"}
];
const knownSections=new Set(SETTINGS_SECTIONS.map(section=>section.id));

export function readSettingsSection(search=""){
 const value=new URLSearchParams(search).get("seccion");
 return knownSections.has(value)?value:null;
}
export function settingsSectionUrl(section){
 return knownSections.has(section)?"/ajustes?seccion="+encodeURIComponent(section):"/ajustes";
}
