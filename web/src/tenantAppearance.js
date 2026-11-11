// Contrato ligero entre el contexto del cliente y los tokens CSS de la SPA.
export const DEFAULT_APPEARANCE=Object.freeze({
 brandName:"",logoUrl:"",primaryColor:"#079B6D",secondaryColor:"#145C49",menuMode:"claro"
});
const HEX=/^#[0-9A-Fa-f]{6}$/;
export function normalizeClientAppearance(input={}){
 const a=input&&typeof input==="object"?input:{};
 return {
  brandName:typeof a.brandName==="string"?a.brandName:"",
  logoUrl:typeof a.logoUrl==="string"?a.logoUrl:"",
  primaryColor:HEX.test(a.primaryColor||"")?a.primaryColor.toUpperCase():DEFAULT_APPEARANCE.primaryColor,
  secondaryColor:HEX.test(a.secondaryColor||"")?a.secondaryColor.toUpperCase():DEFAULT_APPEARANCE.secondaryColor,
  menuMode:a.menuMode==="oscuro"?"oscuro":"claro"
 };
}
export function contrastText(hex){
 const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
  .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
 const luminance=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
 return (1.05/(luminance+.05))>=4.5?"#FFFFFF":"#142C2A";
}
export function isCustomAppearance(input){
 const a=normalizeClientAppearance(input);
 return Boolean(a.brandName||a.logoUrl||a.menuMode!=="claro"||
  a.primaryColor!==DEFAULT_APPEARANCE.primaryColor||
  a.secondaryColor!==DEFAULT_APPEARANCE.secondaryColor);
}
export function clientAppearanceStyle(input){
 const a=normalizeClientAppearance(input);
 return {
  "--fm-brand-primary":a.primaryColor,
  "--fm-brand-secondary":a.secondaryColor,
  "--fm-brand-on-primary":contrastText(a.primaryColor),
  "--fm-brand-on-secondary":contrastText(a.secondaryColor)
 };
}
