export function foldGenericOffer(value){
 return String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toLocaleLowerCase("es").replace(/\s+/g," ").trim();
}
export function filterGenericOfferGroups(items,{text="",principle="",strength="",form="",pack=""}={}){
 const terms=foldGenericOffer(text).split(/\s+/).filter(Boolean);
 return (items||[]).filter(g=>{
  if(principle&&g.principle!==principle)return false;
  if(strength&&g.strength!==strength)return false;
  if(form&&g.form!==form)return false;
  if(pack&&g.pack!==pack)return false;
  const searchable=foldGenericOffer([
   g.principle,g.name,g.dcpf,g.strength,g.form,g.pack
  ].join(" "));
  return terms.every(term=>searchable.includes(term));
 });
}
export function genericOfferOptions(items,key){
 return [...new Set((items||[]).map(row=>row?.[key]).filter(Boolean))]
  .sort((a,b)=>String(a).localeCompare(String(b),"es",{numeric:true,sensitivity:"base"}));
}
