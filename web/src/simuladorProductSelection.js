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

export function mergePromotionSelection(current,items){
 const result=new Map((current||[]).map(item=>[item.cn,item]));
 for(const item of items||[]){
  if(!isValidPromotionCN(item.cn))continue;
  const existing=result.get(item.cn);
  const label=String(item.description||"").trim();
  // Una ficha real nunca se sustituye por el texto genérico del pegado.
  const real=label&&label!=="CN introducido";
  result.set(item.cn,existing&&(!real||!existing.description||existing.description!=="CN introducido")?
   existing:{...existing,...item,description:label||"CN introducido"});
 }
 return [...result.values()];
}
