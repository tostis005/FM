// Agrupaciones visuales del preparador: cada referencia conserva su pedido,
// stock, CN y precio. Nunca agregar cantidades entre variantes o dúplos.
const normalizeName=value=>String(value||"")
 .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
 .toLocaleUpperCase("es").replace(/[^A-Z0-9]+/g," ").trim().replace(/\s+/g," ");
const code=value=>/^\d{6,7}$/.test(String(value||"").trim())?String(value).trim():null;

export function parseLaboratoryVariant(row){
 const name=String(row?.nombre||"").trim();
 // R1, R2, R3... al final; CN raíz opcional tras el marcador.
 // No confundir nombres que contienen la letra R en mitad de una palabra.
 const gift=/^(.*?)\s+R([1-9]\d*)(?:\s+(\d{6,7}))?\s*$/i.exec(name);
 if(gift&&normalizeName(gift[1]))
  return {kind:"regalo",number:Number(gift[2]),rootCode:gift[3]||null,
   baseName:normalizeName(gift[1]),label:"Regalo R"+gift[2]};
 // El pack es exactamente de dos unidades. Evitar agrupar otros tamaños
 // de pack (x3, lotes, formatos con volumen distinto, etc.).
 const duplo=/(?:^|\s)DUPLO\s*(?:X\s*)?2(?=\s|$)/i;
 if(duplo.test(name)){
  const baseName=normalizeName(name.replace(duplo," "));
  if(baseName)return {kind:"duplo",number:2,rootCode:null,
   baseName,label:"Dúplo ×2"};
 }
 return null;
}

export function groupedLaboratoryRows(rows,sort="original"){
 const input=Array.isArray(rows)?rows:[];
 const parsed=input.map(parseLaboratoryVariant);
 const rootsByCN=new Map(),rootsByName=new Map();
 input.forEach((row,i)=>{
  if(parsed[i])return;
  const cn=code(row.cn)||code(row.referencia);
  if(cn&&!rootsByCN.has(cn))rootsByCN.set(cn,i);
  const name=normalizeName(row.nombre);
  if(!rootsByName.has(name))rootsByName.set(name,[]);
  rootsByName.get(name).push(i);
 });
 const groupByIndex=new Map(),members=new Map(),unmatched=new Map();
 input.forEach((row,i)=>{
  const variant=parsed[i];
  if(!variant)return;
  let root=variant.rootCode==null?undefined:rootsByCN.get(variant.rootCode);
  if(root===undefined){
   const candidates=rootsByName.get(variant.baseName)||[];
   if(candidates.length===1)root=candidates[0];
  }
  if(root!==undefined){
   groupByIndex.set(i,"root:"+root);
   groupByIndex.set(root,"root:"+root);
  }else{
   const orphan=variant.kind+":"+variant.baseName;
   if(!unmatched.has(orphan))unmatched.set(orphan,[]);
   unmatched.get(orphan).push(i);
  }
 });
 // Solo agrupar variantes sin raíz si hay por lo menos dos homónimas.
 for(const [name,indices] of unmatched)
  if(indices.length>1)for(const i of indices)groupByIndex.set(i,"orphan:"+name);
 input.forEach((row,i)=>{
  const id=groupByIndex.get(i)||"single:"+i;
  if(!members.has(id))members.set(id,[]);
  members.get(id).push(i);
 });
 const collator=new Intl.Collator("es",{numeric:true,sensitivity:"base"});
 const groups=[...members.entries()].map(([id,indices])=>{
  const root=indices.find(i=>!parsed[i]);
  const sorted=[...indices].sort((a,b)=>{
   if(a===root)return -1;
   if(b===root)return 1;
   const pa=parsed[a],pb=parsed[b];
   if(pa&&pb&&pa.kind!==pb.kind)return pa.kind==="regalo"?-1:1;
   if(pa&&pb&&pa.kind==="regalo")return pa.number-pb.number||a-b;
   return a-b;
  });
  const representative=input[root===undefined?sorted[0]:root];
  return {id,firstIndex:Math.min(...indices),representative,
   rows:sorted.map((i,pos)=>({
    ...input[i],
    _visualGroup:id,
    _visualGroupSize:indices.length,
    _visualGroupFirst:pos===0,
    _visualGroupLast:pos===indices.length-1,
    _visualKind:parsed[i]?.kind||"raiz",
    _visualLabel:parsed[i]?.label||(indices.length>1?"Producto base":null)
   }))};
 });
 // La ordenación elegida mueve familias completas, nunca separa variantes.
 if(sort==="original")groups.sort((a,b)=>a.firstIndex-b.firstIndex);
 else{
  const [field,direction]=sort.split(":");
  groups.sort((a,b)=>{
   const x=field==="cn"?String(a.representative.cn||a.representative.referencia||""):
    String(a.representative.nombre||"");
   const y=field==="cn"?String(b.representative.cn||b.representative.referencia||""):
    String(b.representative.nombre||"");
   const diff=collator.compare(x,y)||a.firstIndex-b.firstIndex;
   return direction==="desc"?-diff:diff;
  });
 }
 return groups;
}
