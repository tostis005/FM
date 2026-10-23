// Reglas de unidades que pueden atribuirse a campañas: solo tickets completos.
// Unidades sueltas fuera de los lotes 2x1/3x2/segunda unidad no cuentan.
export function promotionBundle(promo={}) {
  switch(promo.type){
    case "dos_por_uno": return 2;
    case "tres_por_dos": return 3;
    case "segunda_porcentaje":
      return Number(promo.discountPercent)>0 ? 2 : null;
    case "segunda_importe":
      return Number(promo.discountAmount)>0 ? 2 : null;
    case "otras_unidades": {
      const text=[promo.formula,promo.originalOffer,promo.description,promo.name].filter(Boolean).join(" ");
      const match=text.match(/\b(\d{1,2})\s*\+\s*(\d{1,2})\b/);
      return match ? Number(match[1])+Number(match[2]) : null;
    }
    case "descuento_porcentaje": return Number(promo.discountPercent)>0 ? 1 : null;
    case "descuento_importe": return Number(promo.discountAmount)>0 ? 1 : null;
    case "escalonado": {
      const formula=[promo.formula,promo.originalOffer,promo.description,promo.name].filter(Boolean).join(" ");
      const threshold=[...formula.matchAll(/(\d{1,3})\s*%\s*(?:DTO\s*)?(?:POR\s*)?(\d{1,2})\s*(?:UD|UNIDAD)/gi)];
      return threshold.length ? Math.min(...threshold.map(x=>Number(x[2]))) : null;
    }
    // No inferir condiciones de promociones sin fórmula comercial inequívoca.
    default: return null;
  }
}
