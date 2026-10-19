import React,{useMemo,useState} from "react";
import HorizontalTableScroll from "./HorizontalTableScroll.jsx";
import {ListPagination} from "./ListTable.jsx";

const collator=new Intl.Collator("es",{numeric:true,sensitivity:"base"});
export function readableCell(value){
 if(value==null)return "";
 if(typeof value==="number"||typeof value==="string")return String(value);
 if(Array.isArray(value))return value.map(readableCell).join(" ");
 if(React.isValidElement(value)){
  if(value.props?.value!==undefined)return readableCell(value.props.value);
  return readableCell(value.props?.children);
 }
 return "";
}
export function compareTableValues(a,b){
 const s=readableCell(a).trim(),t=readableCell(b).trim();
 const number=v=>{
  const normalized=v.replace(/\u2212/g,"-").replace(/\u00a0/g," ").trim();
  if(!/^-?[\d.,\s]+\s*(?:€|%|uds?\.?|días?)?$/iu.test(normalized))return null;
  const n=Number(normalized.replace(/\s*(?:€|%|uds?\.?|días?)\s*$/iu,"")
   .replace(/\s/g,"").replace(/\./g,"").replace(",","."));
  return Number.isFinite(n)?n:null;
 };
 const x=number(s),y=number(t);
 if(x!==null&&y!==null)return x-y;
 const date=v=>{const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  return m?Number(m[3]+m[2]+m[1]):null;};
 const dx=date(s),dy=date(t);
 if(dx!==null&&dy!==null)return dx-dy;
 return collator.compare(s,t);
}
export default function SortableDataTable({
 headers,rows,empty="No hay resultados para esta selección.",label="registros",tableClass="fm-preview-table"
}){
 const [sort,setSort]=useState(null),[page,setPage]=useState(0),[pageSize,setPageSize]=useState(50);
 const sortable=index=>!/^(acciones|historial|quitar|reparto|seleccionar)$/iu.test(String(headers[index]||""));
 const sorted=useMemo(()=>{
  if(!sort)return rows;
  return [...rows].sort((a,b)=>{
   const result=compareTableValues(a[sort.index],b[sort.index]);
   return sort.direction==="asc"?result:-result;
  });
 },[rows,sort]);
 const pages=Math.max(1,Math.ceil(sorted.length/pageSize)),safePage=Math.min(page,pages-1);
 const shown=sorted.slice(safePage*pageSize,(safePage+1)*pageSize);
 const changeSort=index=>{
  setSort(old=>old?.index===index?{index,direction:old.direction==="asc"?"desc":"asc"}:{index,direction:"asc"});
  setPage(0);
 };
 const toPage=value=>{setPage(value);window.scrollTo({top:0,behavior:"instant"})};
 return <>
  <HorizontalTableScroll className="fm-preview-scroll" label={label}>
   <table className={tableClass+" fm-unified-table"}>
    <thead><tr>{headers.map((header,i)=><th key={i}
       aria-sort={!sortable(i)||sort?.index!==i?"none":sort.direction==="asc"?"ascending":"descending"}>
      {sortable(i)?<button className="smart-sort" type="button" onClick={()=>changeSort(i)}
        aria-label={"Ordenar "+header}>
       <span>{header}</span><span className="smart-sort-arrow" aria-hidden="true">
        {sort?.index===i?(sort.direction==="asc"?"▲":"▼"):"↕"}</span></button>:
       <span className="smart-th-label">{header}</span>}
     </th>)}</tr></thead>
    <tbody>{shown.length?shown.map((r,i)=><tr key={safePage*pageSize+i}>
      {r.map((v,j)=><td key={j}>{v}</td>)}</tr>):
     <tr><td colSpan={headers.length}>{empty}</td></tr>}</tbody>
   </table>
  </HorizontalTableScroll>
  {sorted.length>50&&<ListPagination total={sorted.length} page={safePage} pageSize={pageSize}
   label={label} onPageChange={toPage} onPageSizeChange={n=>{setPageSize(n);setPage(0)}}/>}
 </>;
}
