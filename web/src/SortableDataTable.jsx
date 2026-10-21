import React,{useMemo,useState} from "react";
import HorizontalTableScroll from "./HorizontalTableScroll.jsx";
import {ListPagination} from "./ListTable.jsx";
import {MultiSelectFilter} from "./MultiSelectFilter.jsx";
import {Download} from "lucide-react";
import {downloadTableCSV} from "./tableExport.js";
import {searchText} from "./listLogic.js";

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
// Misma tabla que Artículos: exportación, filtro por cabecera, ordenación y
// paginación incluso para tablas con celdas React (selectores y acciones).
export default function SortableDataTable({
 headers,rows=[],empty="No hay resultados para esta selección.",
 label="registros",tableClass="fm-preview-table",filterModes={},showExport=true
}){
 const [sort,setSort]=useState(null),[page,setPage]=useState(0);
 const [pageSize,setPageSize]=useState(50),[filters,setFilters]=useState({});
 const isAction=index=>/^(acciones?|historial|quitar|reparto|seleccionar)$/iu.test(String(headers[index]||""));
 const filterMode=index=>{
  if(isAction(index))return "none";
  if(filterModes[index])return filterModes[index];
  return /farmacia|estado|\\babcd\\b|clasificaci[oó]n|prioridad|\\btipo\\b|categor[ií]a|responsable/iu.test(String(headers[index]))?"multi":"text";
 };
 const filtered=useMemo(()=>(rows||[]).filter(row=>headers.every((_,i)=>{
  const condition=filters[i],text=readableCell(row[i]);
  if(Array.isArray(condition))return !condition.length||condition.includes(text);
  return !condition||searchText(text).includes(searchText(condition).trim());
 })),[rows,filters,headers]);
 const sorted=useMemo(()=>{
  if(!sort)return filtered;
  return [...filtered].sort((a,b)=>{
   const result=compareTableValues(a[sort.index],b[sort.index]);
   return sort.direction==="asc"?result:-result;
  });
 },[filtered,sort]);
 const pages=Math.max(1,Math.ceil(sorted.length/pageSize)),safePage=Math.min(page,pages-1);
 const shown=sorted.slice(safePage*pageSize,(safePage+1)*pageSize);
 const changeSort=index=>{
  setSort(old=>old?.index===index?{index,direction:old.direction==="asc"?"desc":"asc"}:{index,direction:"asc"});
  setPage(0);
 };
 const changeFilter=(index,value)=>{setFilters(old=>({...old,[index]:value}));setPage(0)};
 const toPage=value=>{setPage(value);if(typeof window!=="undefined")window.scrollTo({top:0,behavior:"instant"})};
 return <>
  {showExport&&<div className="fm-table-toolbar">
   <span className="fm-table-export-scope">{sorted.length} resultados disponibles</span>
   <button className="btn btn-secondary btn-sm" type="button" disabled={!sorted.length}
    onClick={()=>downloadTableCSV("farmetrica-"+label.toLowerCase(),headers,
      sorted.map(row=>row.map(readableCell)))}>
    <Download size={15}/> Exportar CSV</button>
  </div>}
  <HorizontalTableScroll className="fm-preview-scroll" label={label}>
   <table className={tableClass+" fm-unified-table smart-table"}>
    <thead><tr>{headers.map((header,i)=><th key={i}
       aria-sort={isAction(i)||sort?.index!==i?"none":sort.direction==="asc"?"ascending":"descending"}>
      {!isAction(i)?<button className="smart-sort" type="button" onClick={()=>changeSort(i)}
        aria-label={"Ordenar "+header}>
       <span>{header}</span><span className="smart-sort-arrow" aria-hidden="true">
        {sort?.index===i?(sort.direction==="asc"?"▲":"▼"):"↕"}</span></button>:
       <span className="smart-th-label">{header}</span>}
     </th>)}</tr>
     <tr className="smart-filter-row">{headers.map((header,i)=><th key={i}>
      {filterMode(i)==="none"?<span className="smart-filter-blank"/>:
       filterMode(i)==="multi"?<MultiSelectFilter label={String(header)}
        options={[...new Set((rows||[]).map(row=>readableCell(row[i])).filter(Boolean))].sort((a,b)=>collator.compare(a,b))}
        value={Array.isArray(filters[i])?filters[i]:[]}
        onChange={values=>changeFilter(i,values)}/>:
       <input type="search" className="smart-column-filter" aria-label={"Buscar en "+header}
        placeholder={"Filtrar "+String(header).toLowerCase()} value={filters[i]||""}
        onChange={e=>changeFilter(i,e.target.value)}/>}
     </th>)}</tr>
    </thead>
    <tbody>{shown.length?shown.map((r,i)=><tr key={safePage*pageSize+i}>
      {r.map((v,j)=><td key={j}>{v}</td>)}</tr>):
     <tr><td colSpan={headers.length}>{empty}</td></tr>}</tbody>
   </table>
  </HorizontalTableScroll>
  <ListPagination total={sorted.length} page={safePage} pageSize={pageSize}
   label={label} onPageChange={toPage} onPageSizeChange={n=>{setPageSize(n);setPage(0)}}/>
 </>;
}
