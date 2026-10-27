// Reglas de unidades que pueden atribuirse a campañas: exclusivamente
// tickets completos de promociones clasificadas con condiciones válidas.
const finite=value=>{
 if(value===null||value===undefined||value==="")return null;
 const number=Number(value);
 return Number.isFinite(number)?number:null;
};
const offerText=promo=>[promo.formula,promo.originalOffer,promo.description,promo.name]
 .filter(Boolean).join(" ");
const giftBundle=promo=>{
 const match=offerText(promo).match(/\b(\d{1,2})\s*\+\s*(\d{1,2})\b/);
 if(!match||Number(match[1])<=0||Number(match[2])<=0)return null;
 return Number(match[1])+Number(match[2]);
};
export function promotionBundle(promo={}) {
 const pct=finite(promo.discountPercent),amount=finite(promo.discountAmount);
 switch(promo.type){
  case "dos_por_uno": return 2;
  case "tres_por_dos": return 3;
  case "segunda_porcentaje": return pct>0&&pct<=100?2:null;
  case "segunda_importe": return amount>0?2:null;
  case "otras_unidades": return giftBundle(promo);
  case "descuento_porcentaje": return pct>0&&pct<=100?1:null;
  case "precio_especial": {
   const price=finite(promo.specialPrice);
   return price!==null&&price>=0?1:null;
  }
  case "descuento_importe": return amount>0?1:null;
  case "escalonado": {
   const tiers=[...offerText(promo).matchAll(/(\d{1,3})\s*%\s*(?:DTO\s*)?(?:POR\s*)?(\d{1,2})\s*(?:UD|UNIDAD)/gi)]
    .map(match=>({percent:Number(match[1]),minimum:Number(match[2])}))
    .filter(tier=>tier.percent>0&&tier.percent<=100&&tier.minimum>0);
   return tiers.length?Math.min(...tiers.map(tier=>tier.minimum)):null;
  }
  case "regalo": return giftBundle(promo);
  // No atribuir ventas de promociones sin clasificar o incompletas.
  default: return null;
 }
}
