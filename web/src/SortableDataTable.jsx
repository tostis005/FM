import React,{useMemo,useState} from "react";
import HorizontalTableScroll from "./HorizontalTableScroll.jsx";
import {ListPagination} from "./ListTable.jsx";
import {MultiSelectFilter} from "./MultiSelectFilter.jsx";
import {Download} from "lucide-react";
import {downloadTableCSV} from "./tableExport.js";
import {searchText} from "./listLogic.js";
import {filterModeForColumn} from "./tableFilterModes.js";
import {isPharmacyColumn} from "./pharmacyPresentation.js";
import {useSinglePharmacy} from "./PharmacyPresentationContext.jsx";

const collator=new Intl.Collator("es",{numeric:true,sensitivity:"base"});
export function readableCell(value){
 if(value==null)return "";
 if(typeof value==="number"||typeof value==="string")return String(value);
 if(Array.isArray(value))return value.map(readableCell).join(" ");
 if(React.isValidElement(value)){
  if(value.props?.value!==undefined)return readableCell(value.props.value);
  const children=readableCell(value.props?.children);
  if(children)return children;
  // Identificadores de artículo renderizados mediante un componente React
  // personalizado: exportar y filtrar CN/nombre en lugar de una celda vacía.
  return [value.props?.cn,value.props?.name,value.props?.sourceId,value.props?.label]
   .filter(v=>v!==undefined&&v!==null&&v!=="").map(readableCell).join(" ");
 }
 return "";
}
export function compareTableValues(a,b){
 if(typeof a==="number"&&typeof b==="number")return a-b;
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
 const date=v=>{const m=/^(\d{2})\/(\d{2})\/(\d{4})(?:[ ,]+(\d{2}):(\d{2}))?$/.exec(v);
  if(m)return Number(m[3]+m[2]+m[1]+(m[4]||"00")+(m[5]||"00"));
  const month=/^(\d{2})\/(\d{4})$/.exec(v);
  return month?Number(month[2]+month[1]+"010000"):null;};
 const dx=date(s),dy=date(t);
 if(dx!==null&&dy!==null)return dx-dy;
 return collator.compare(s,t);
}
// Misma tabla que Artículos: exportación, filtro por cabecera, ordenación y
// paginación incluso para tablas con celdas React (selectores y acciones).
export default function SortableDataTable({
 headers,rows=[],empty="No hay resultados para esta selección.",
 label="registros",tableClass="fm-preview-table",filterModes={},showExport=true,showPagination=true
}){
 const singlePharmacy=useSinglePharmacy();
 const visibleColumns=headers.map((header,index)=>({header,index}))
  .filter(({header})=>!singlePharmacy||!isPharmacyColumn(header));
 const [sort,setSort]=useState(null),[page,setPage]=useState(0);
 const [pageSize,setPageSize]=useState(50),[filters,setFilters]=useState({});
 const isAction=index=>/^(?:acciones?|historial|quitar|reparto|seleccionar|descargar|editar|detalle)?$/iu.test(String(headers[index]||"").trim());
 const filterMode=index=>filterModeForColumn({
  label:String(headers[index]||""),
  declared:isAction(index)?"none":filterModes[index],
  values:(rows||[]).map(row=>readableCell(row[index]))
 });
 const filtered=useMemo(()=>(rows||[]).filter(row=>headers.every((_,i)=>{
  const condition=filters[i],text=readableCell(row[i]);
  if(Array.isArray(condition))return !condition.length||condition.includes(text);
  return !condition||searchText(text).includes(searchText(condition).trim());
 })),[rows,filters,headers]);
 const sorted=useMemo(()=>{
  if(!sort)return filtered;
  return [...filtered].sort((a,b)=>{
   const missing=v=>["","—","–"].includes(readableCell(v).trim());
   const x=missing(a[sort.index]),y=missing(b[sort.index]);
   if(x!==y)return x?1:-1;
   const result=compareTableValues(a[sort.index],b[sort.index]);
   return sort.direction==="asc"?result:-result;
  });
 },[filtered,sort]);
 const pages=Math.max(1,Math.ceil(sorted.length/pageSize)),safePage=Math.min(page,pages-1);
 const shown=showPagination?sorted.slice(safePage*pageSize,(safePage+1)*pageSize):sorted;
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
    onClick={()=>downloadTableCSV("farmetrica-"+label.toLowerCase(),visibleColumns.map(c=>c.header),
      sorted.map(row=>visibleColumns.map(c=>readableCell(row[c.index]))))}>
    <Download size={15}/> Exportar CSV</button>
  </div>}
  <HorizontalTableScroll className="fm-preview-scroll" label={label}>
   <table className={tableClass+" fm-unified-table smart-table"}>
    <thead><tr>{visibleColumns.map(({header,index:i})=><th key={i}
       aria-sort={isAction(i)||sort?.index!==i?"none":sort.direction==="asc"?"ascending":"descending"}>
      {!isAction(i)?<button className="smart-sort" type="button" onClick={()=>changeSort(i)}
        aria-label={"Ordenar "+header}>
       <span>{header}</span><span className="smart-sort-arrow" aria-hidden="true">
        {sort?.index===i?(sort.direction==="asc"?"▲":"▼"):"↕"}</span></button>:
       <span className="smart-th-label">{header}</span>}
     </th>)}</tr>
     <tr className="smart-filter-row">{visibleColumns.map(({header,index:i})=><th key={i}>
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
      {visibleColumns.map(({index:j})=><td key={j}>{r[j]}</td>)}</tr>):
     <tr><td colSpan={visibleColumns.length}>{empty}</td></tr>}</tbody>
   </table>
  </HorizontalTableScroll>
  {showPagination&&<ListPagination total={sorted.length} page={safePage} pageSize={pageSize}
   label={label} onPageChange={toPage} onPageSizeChange={n=>{setPageSize(n);setPage(0)}}/>}
 </>;
}
