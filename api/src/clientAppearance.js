// Preferencias visuales aisladas por tenant. Nunca mezclan datos ni permisos.
export const DEFAULT_APPEARANCE=Object.freeze({
 brandName:"",logoUrl:"",primaryColor:"#079B6D",secondaryColor:"#145C49",menuMode:"claro"
});
const HEX=/^#[0-9A-Fa-f]{6}$/;
const IMAGE_DATA=/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export function normalizeAppearance(row={}){
 return {
  brandName:typeof row?.brandName==="string"?row.brandName:DEFAULT_APPEARANCE.brandName,
  logoUrl:typeof row?.logoUrl==="string"?row.logoUrl:DEFAULT_APPEARANCE.logoUrl,
  primaryColor:HEX.test(row?.primaryColor||"")?row.primaryColor.toUpperCase():DEFAULT_APPEARANCE.primaryColor,
  secondaryColor:HEX.test(row?.secondaryColor||"")?row.secondaryColor.toUpperCase():DEFAULT_APPEARANCE.secondaryColor,
  menuMode:row?.menuMode==="oscuro"?"oscuro":"claro"
 };
}
export function appearanceFromDatabase(row={}){
 return normalizeAppearance({
  brandName:row?.nombre_marca ?? row?.brandName,
  logoUrl:row?.logo_url ?? row?.logoUrl,
  primaryColor:row?.color_primario ?? row?.primaryColor,
  secondaryColor:row?.color_secundario ?? row?.secondaryColor,
  menuMode:row?.estilo_menu ?? row?.menuMode
 });
}
export function validateAppearance(payload){
 if(!payload||typeof payload!=="object"||Array.isArray(payload))
  return {error:"Configuración de apariencia inválida"};
 const fields=["brandName","logoUrl","primaryColor","secondaryColor","menuMode"];
 if(Object.keys(payload).some(key=>!fields.includes(key)))
  return {error:"La configuración contiene campos no admitidos"};
 if(fields.some(field=>typeof payload[field]!=="string"))
  return {error:"Completa los campos de apariencia"};
 const brandName=payload.brandName.trim(),logoUrl=payload.logoUrl.trim();
 if(brandName.length>80)return {error:"El nombre de marca supera los 80 caracteres"};
 if(!HEX.test(payload.primaryColor)||!HEX.test(payload.secondaryColor))
  return {error:"Los colores deben estar en formato hexadecimal (#RRGGBB)"};
 if(!["claro","oscuro"].includes(payload.menuMode))
  return {error:"Selecciona un estilo de menú válido"};
 if(logoUrl){
  if(logoUrl.startsWith("data:")){
   if(logoUrl.length>450000||!IMAGE_DATA.test(logoUrl))
    return {error:"El logo debe ser PNG, JPG o WebP de menos de 330 KB"};
  }else{
   try{
    const url=new URL(logoUrl);
    if(url.protocol!=="https:"||url.username||url.password||logoUrl.length>2048)
     return {error:"Utiliza una URL HTTPS válida para el logo"};
   }catch{return {error:"Utiliza una URL HTTPS válida para el logo"}}
  }
 }
 return {appearance:normalizeAppearance({...payload,brandName,logoUrl})};
}
