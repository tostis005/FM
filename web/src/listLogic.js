export const searchText=value=>String(value??"").normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("es");
export function filterSortRows(rows,columns,filters={},sort=null){
  const result=(rows||[]).filter(row=>columns.every(col=>{
    const term=searchText(filters[col.key]).trim();
    return !term||searchText(col.value(row)).includes(term);
  }));
  if(!sort?.key)return result;
  const col=columns.find(c=>c.key===sort.key);
  if(!col)return result;
  const collator=new Intl.Collator("es",{numeric:true,sensitivity:"base"});
  return result.map((item,i)=>({item,i})).sort((a,b)=>{
    const x=col.value(a.item),y=col.value(b.item);
    const missingX=x===null||x===undefined||x==="";
    const missingY=y===null||y===undefined||y==="";
    if(missingX!==missingY)return missingX?1:-1;
    let comparison=0;
    if(typeof x==="number"&&typeof y==="number")comparison=x-y;
    else comparison=collator.compare(String(x??""),String(y??""));
    return (sort.direction==="desc"?-comparison:comparison)||a.i-b.i;
  }).map(x=>x.item);
}

export function pageRows(rows,page,pageSize){
  const total=(rows||[]).length;
  const current=Math.max(0,Math.min(page,Math.max(0,Math.ceil(total/pageSize)-1)));
  return {page:current,items:(rows||[]).slice(current*pageSize,(current+1)*pageSize)};
}
