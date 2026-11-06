// El Simulador ofrece dos métodos exclusivos de entrada: búsqueda o pegado.
// Un código pegado es válido aunque el ERP de la farmacia no tenga su ficha.
export const isValidPromotionCN=value=>/^\d{6}$/.test(String(value||""));

export function parsePromotionCNs(text){
 const values=[...new Set(String(text||"").split(/[\s,;]+/).map(s=>s.trim()).filter(Boolean))];
 return {codes:values.filter(isValidPromotionCN),
  invalid:values.filter(v=>!isValidPromotionCN(v))};
}

export function selectablePromotionProducts(items){
 const products=[],unavailable=[];
 for(const item of items||[]){
  if(isValidPromotionCN(item.cn))products.push(item);
  else unavailable.push(item);
 }
 return {products,unavailableCount:unavailable.length};
}

export const UNKNOWN_PRODUCT_NAME="Nombre no disponible";
export function promotionProductName(item){
 const name=String(item?.description||"").trim();
 return name&&name!=="CN introducido"?name:UNKNOWN_PRODUCT_NAME;
}
export function promotionProductLabel(item){
 return String(item.cn)+" - "+promotionProductName(item);
}

export function mergePromotionSelection(current,items){
 const result=new Map((current||[]).map(item=>[item.cn,item]));
 for(const item of items||[]){
  if(!isValidPromotionCN(item.cn))continue;
  const existing=result.get(item.cn);
  const label=String(item.description||"").trim();
  // La ficha real prevalece siempre sobre un marcador temporal.
  const real=label&&label!=="CN introducido"&&label!==UNKNOWN_PRODUCT_NAME;
  const existingReal=existing&&promotionProductName(existing)!==UNKNOWN_PRODUCT_NAME;
  result.set(item.cn,existingReal||existing&&!real?
   existing:{...existing,...item,description:real?label:UNKNOWN_PRODUCT_NAME});
 }
 return [...result.values()];
}
