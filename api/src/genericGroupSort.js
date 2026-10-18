// Ordenación estable de todos los conjuntos DCPF ANTES de devolver las primeras 500 filas.
export const GENERIC_GROUP_SORT_KEYS=[
 "name","skuCount","abcdClass","salesUnits","revenue","averagePuc","averagePvp",
 "unitMargin","pvpMarginPct","bestPuc","indicativeSavings"
];
const numeric=new Set(GENERIC_GROUP_SORT_KEYS.filter(k=>!["name","abcdClass"].includes(k)));
function value(group,key){
 if(key==="name")return group.principle||group.name||group.dcpf;
 if(key==="unitMargin")return group.averagePvp==null||group.averagePuc==null?
  null:Number(group.averagePvp)-Number(group.averagePuc);
 return group[key];
}
export function sortGenericGroups(groups,key="revenue",direction="desc"){
 if(!GENERIC_GROUP_SORT_KEYS.includes(key)||!["asc","desc"].includes(direction))
  throw Error("Ordenación de genéricos inválida");
 const collator=new Intl.Collator("es",{numeric:true,sensitivity:"base"});
 const sign=direction==="desc"?-1:1;
 return [...groups].sort((a,b)=>{
  const x=value(a,key),y=value(b,key);
  const emptyX=x==null||x==="",emptyY=y==null||y==="";
  if(emptyX!==emptyY)return emptyX?1:-1;
  const compare=numeric.has(key)?Number(x||0)-Number(y||0):
   collator.compare(String(x??""),String(y??""));
  return sign*compare||collator.compare(String(a.dcpf),String(b.dcpf));
 });
}
