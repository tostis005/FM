// Facetas descriptivas construidas exclusivamente desde el nombre del conjunto DCPF oficial.
// No representan equivalencias terapéuticas adicionales ni sustituyen códigos clínicos AEMPS.
const clean=value=>String(value??"").trim();
export const foldGenericText=value=>clean(value).normalize("NFD")
 .replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("es")
 .replace(/\s+/g," ").trim();

const forms=[
 ["Comprimidos",/\b(comprimidos?|comps?\.?|tabletas?|tabs?\.?|grageas?)\b/i],
 ["Cápsulas",/\b(capsulas?|caps?\.?)\b/i],
 ["Sobres",/\b(sobres?)\b/i],
 ["Solución oral",/\b(solucion(?:\s+oral)?|gotas\s+orales|jarabe)\b/i],
 ["Suspensión",/\bsuspension\b/i],
 ["Inyectable",/\b(inyeccion|inyectable|vial(?:es)?|jeringa(?:s)?)\b/i],
 ["Crema",/\bcrema\b/i],
 ["Gel",/\bgel\b/i],
 ["Pomada",/\bpomada\b/i],
 ["Parche",/\bparches?\b/i],
 ["Colirio",/\bcolirios?\b/i],
 ["Supositorios",/\bsupositorios?\b/i],
 ["Óvulos",/\bovulos?\b/i],
 ["Aerosol / inhalación",/\b(aerosol|inhalacion|inhalador|pulverizacion|nebulizacion)\b/i],
 ["Polvo / granulado",/\b(polvo|granulado)\b/i]
];
const strengthPattern=/(\d+(?:[.,]\d+)?)\s*(microgramos?|mcg|ug|mg|g|ui|%)(?:\s*\/\s*(?:(\d+(?:[.,]\d+)?)\s*)?(ml|g|dosis))?(?=$|[\s,;.)])/i;
const packagePattern=/\b(\d{1,4})\s*(comprimidos?|capsulas?|sobres?|viales?|ampollas?|parches?|supositorios?|ovulos?|tabletas?)\b/i;
const liquidPackPattern=/\b(?:envase|frasco|botella)\s*(?:de\s*)?(\d{1,4})\s*(ml|g)\b/i;

export function describeGenericOfferGroup(group){
 const name=clean(group?.name);
 const description=foldGenericText(name);
 const doseMatch=description.match(strengthPattern);
 const strength=doseMatch?
  doseMatch[1].replace(",",".")+" "+doseMatch[2].replace(/^microgramos?$/,"mcg")+
    (doseMatch[4]?"/"+(doseMatch[3]?doseMatch[3].replace(",",".")+" ":"")+doseMatch[4]:""):
  "";
 const form=forms.find(([,re])=>re.test(description))?.[0]||"";
 const packMatch=description.match(packagePattern);
 const liquidPack=description.match(liquidPackPattern);
 const pack=packMatch?packMatch[1]+" "+packMatch[2]:
  liquidPack?liquidPack[1]+" "+liquidPack[2]:"";
 return {...group,
  principle:clean(group?.principle)||"Sin principio activo identificado",
  strength,form,pack};
}

export function genericOfferFacets(groups){
 const sorted=values=>[...new Set(values.filter(Boolean))].sort((a,b)=>
  a.localeCompare(b,"es",{numeric:true,sensitivity:"base"}));
 return {
  principles:sorted(groups.map(g=>g.principle).filter(x=>x!=="Sin principio activo identificado")),
  strengths:sorted(groups.map(g=>g.strength)),
  forms:sorted(groups.map(g=>g.form)),
  packs:sorted(groups.map(g=>g.pack))
 };
}
