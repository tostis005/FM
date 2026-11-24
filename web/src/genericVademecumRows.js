// A DCPF is the only comparison key. An unmatched CN remains visible without invented equivalents.
export function makeVademecumRows(items,laboratory){
 const byGroup=new Map();
 for(const x of items){
  if(!x.dcpf||x.net==null||!Number.isFinite(Number(x.net)))continue;
  const group=byGroup.get(String(x.dcpf))||new Map();
  const current=group.get(x.laboratory);
  if(!current||Number(x.net)<Number(current.net)||Number(x.net)===Number(current.net)&&String(x.cn)<String(current.cn))
   group.set(x.laboratory,x);
  byGroup.set(String(x.dcpf),group);
 }
 return items.filter(x=>x.laboratory===laboratory).map(x=>{
  const peers=new Map(x.dcpf?byGroup.get(String(x.dcpf)):[]);
  peers.set(laboratory,x); // compare the actual selected CN, not another CN from its lab
  const prices=[...new Set([...peers.values()].filter(p=>p.net!=null&&Number.isFinite(Number(p.net))).map(p=>Math.round(Number(p.net)*1e4)))].sort((a,b)=>a-b);
  const comparable=peers.size>1;
  const cells=Object.fromEntries([...peers].map(([name,p])=>{
   const rank=comparable&&p.net!=null?prices.indexOf(Math.round(Number(p.net)*1e4))+1:null;
   const tone=!rank?null:rank===1?"best":rank===prices.length?"worst":rank===2?"second":rank===3?"third":null;
   return [name,{...p,rank,tone}];
  }));
  return {...x,cells};
 });
}
