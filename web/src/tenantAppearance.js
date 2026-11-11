// Contrato ligero entre el contexto del cliente y los tokens CSS de la SPA.
export const DEFAULT_APPEARANCE=Object.freeze({
 brandName:"",logoUrl:"",primaryColor:"#079B6D",secondaryColor:"#145C49",menuMode:"claro",pageColor:""
});
const HEX=/^#[0-9A-Fa-f]{6}$/;
export function normalizeClientAppearance(input={}){
 const a=input&&typeof input==="object"?input:{};
 return {
  brandName:typeof a.brandName==="string"?a.brandName:"",
  logoUrl:typeof a.logoUrl==="string"?a.logoUrl:"",
  primaryColor:HEX.test(a.primaryColor||"")?a.primaryColor.toUpperCase():DEFAULT_APPEARANCE.primaryColor,
  secondaryColor:HEX.test(a.secondaryColor||"")?a.secondaryColor.toUpperCase():DEFAULT_APPEARANCE.secondaryColor,
  pageColor:HEX.test(a.pageColor||"")?a.pageColor.toUpperCase():"",
  menuMode:a.menuMode==="oscuro"?"oscuro":"claro"
 };
}
export function contrastText(hex){
 const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
  .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
 const luminance=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
 return (1.05/(luminance+.05))>=4.5?"#FFFFFF":"#142C2A";
}
// Oscurecer automáticamente una cabecera elegida demasiado clara hasta asegurar
// contraste blanco WCAG AA (4.5:1), sin alterar el color guardado por el cliente.
export function tableHeaderColor(color){
 const base=HEX.test(color||"")?color:DEFAULT_APPEARANCE.secondaryColor;
 const rgb=[1,3,5].map(i=>parseInt(base.slice(i,i+2),16));
 const ratio=arr=>{
  const lin=arr.map(v=>{const x=v/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});
  return 1.05/(.2126*lin[0]+.7152*lin[1]+.0722*lin[2]+.05);
 };
 if(ratio(rgb)>=4.5)return "#"+rgb.map(v=>v.toString(16).padStart(2,"0")).join("").toUpperCase();
 let low=0,high=1;
 for(let i=0;i<18;i++){
  const mid=(low+high)/2;
  if(ratio(rgb.map(v=>Math.floor(v*mid)))>=4.5)low=mid;else high=mid;
 }
 return "#"+rgb.map(v=>Math.floor(v*low).toString(16).padStart(2,"0")).join("").toUpperCase();
}
export function isCustomAppearance(input){
 const a=normalizeClientAppearance(input);
 return Boolean(a.brandName||a.logoUrl||a.menuMode!=="claro"||
  a.primaryColor!==DEFAULT_APPEARANCE.primaryColor||
  a.secondaryColor!==DEFAULT_APPEARANCE.secondaryColor||Boolean(a.pageColor));
}
export function clientAppearanceStyle(input){
 const a=normalizeClientAppearance(input);
 return {
  "--fm-brand-primary":a.primaryColor,
  "--fm-brand-secondary":a.secondaryColor,
  "--fm-brand-on-primary":contrastText(a.primaryColor),
  "--fm-brand-on-secondary":contrastText(a.secondaryColor),
  "--fm-table-header":tableHeaderColor(a.secondaryColor),
  "--fm-page-background":a.pageColor||"#F5F8F7"
 };
}
