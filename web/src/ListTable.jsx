import React,{useMemo,useState} from "react";
import {Download} from "lucide-react";
import {downloadTableCSV} from "./tableExport.js";
import {filterSortRows,pageRows} from "./listLogic.js";
import {MultiSelectFilter} from "./MultiSelectFilter.jsx";
import {LoadingPanel,LoadingFrame} from "./LoadingState.jsx";
import HorizontalTableScroll from "./HorizontalTableScroll.jsx";
import {integer} from "./localeES.js";

// Tablas consistentes para promociones, farmacias, usuarios y accesos.
// La búsqueda por cabecera, ordenación y paginación operan sobre todos los
// registros de la tabla, no sobre la página visible.
export const PAGE_SIZES=[10,25,50,100];
export function ListPagination({total,page,pageSize,onPageChange,onPageSizeChange,label="registros",loading=false,pageSizes=PAGE_SIZES,hasMore=false,pageCount=0}){
  const unknownTotal=total==null;
  const pages=unknownTotal?null:Math.max(1,Math.ceil(total/pageSize));
  const current=unknownTotal?Math.max(0,page):Math.max(0,Math.min(page,pages-1));
  return <div className="list-pagination" aria-label={"Paginación de "+label}>
    <span className="list-page-count">{unknownTotal?
      (pageCount?integer(current*pageSize+1)+"–"+integer(current*pageSize+pageCount)+" "+label:
       "Sin "+label+" en esta página") :
      integer(total?current*pageSize+1:0)+"–"+integer(Math.min((current+1)*pageSize,total))+
      " de "+integer(total)+" "+label}</span>
    <label className="list-page-size">Por página
      <select value={pageSize} onChange={e=>onPageSizeChange(Number(e.target.value))} aria-label={"Registros por página de "+label}>
        {pageSizes.map(n=><option value={n} key={n}>{n}</option>)}
      </select>
    </label>
    <div className="list-page-buttons">
      <button type="button" disabled={current===0||loading} onClick={()=>onPageChange(0)} aria-label="Primera página">«</button>
      <button type="button" disabled={current===0||loading} onClick={()=>onPageChange(current-1)}>Anterior</button>
      <span>Página {integer(current+1)}{unknownTotal?"":" de "+integer(pages)}</span>
      <button type="button" disabled={(unknownTotal?!hasMore:current>=pages-1)||loading} onClick={()=>onPageChange(current+1)}>Siguiente</button>
      {!unknownTotal&&<button type="button" disabled={current>=pages-1||loading} onClick={()=>onPageChange(pages-1)} aria-label="Última página">»</button>}
    </div>
  </div>;
}
export default function ListTable({rows,columns,rowKey,onRowClick,emptyText="No hay registros",label="registros",tableClass="",loading=false,loadingLabel="Cargando registros…",defaultSort=null,sort:serverSort,onSortChange,serverFilters=null,onServerFiltersChange=null,filterOptions=null,serverPagination=null,selection=null,showExport=true,onExport=null,exportFileName="",renderExpandedRow=null,expandedRowKeys=[]}){
  const [localFilters,setLocalFilters]=useState({});
 const remotelyFiltered=serverFilters!==null&&typeof onServerFiltersChange==="function";
 const filters=remotelyFiltered?serverFilters:localFilters;
  const [localSort,setLocalSort]=useState(defaultSort);
  const remote=serverSort!==undefined&&typeof onSortChange==="function";
  const sort=remote?serverSort:localSort;
  const [page,setPage]=useState(0);
  const [pageSize,setPageSize]=useState(50);
  const externalPage=Boolean(serverPagination);
  const activeSize=externalPage?serverPagination.pageSize:pageSize;
  // Con paginación remota, SQL ya ordenó el universo antes de LIMIT/OFFSET.
  // Ordenar solamente la respuesta truncada produciría resultados engañosos.
  const filtered=useMemo(()=>remotelyFiltered?rows:filterSortRows(rows,columns,filters,remote?null:sort),
    [rows,columns,filters,sort,remote,remotelyFiltered]);
  const selected=new Set(selection?.selectedKeys||[]);
  const allFilteredKeys=filtered.map(row=>String(rowKey(row)));
  const allSelected=allFilteredKeys.length>0&&allFilteredKeys.every(key=>selected.has(key));
  const toggleSelection=key=>selection?.onChange?.(selected.has(key)?
   [...selected].filter(id=>id!==key):[...selected,key]);
  const selectFiltered=checked=>{
   const ids=new Set(selected);
   for(const key of allFilteredKeys){if(checked)ids.add(key);else ids.delete(key);}
   selection?.onChange?.([...ids]);
  };
  const {page:safePage,items:slice}=externalPage?
    {page:Math.max(0,serverPagination.page-1),items:filtered}:
    pageRows(filtered,page,activeSize);
  // Volver al comienzo de la página al paginar o cambiar cuántas filas se ven.
  // Sin ello se conserva el scroll al fondo de la tabla y parece vacía.
  const goToPage=next=>{
   if(externalPage)serverPagination.onPageChange(next+1);
   else setPage(next);
   if(typeof window!=="undefined")window.scrollTo({top:0,behavior:"instant"});
  };
  const changePageSize=n=>{
   if(externalPage)serverPagination.onPageSizeChange(n);
   else{setPageSize(n);setPage(0)}
   if(typeof window!=="undefined")window.scrollTo({top:0,behavior:"instant"});
  };
  const changeFilter=(key,value)=>{
  const next={...filters,[key]:value};
  if(remotelyFiltered)onServerFiltersChange(next);
  else setLocalFilters(next);
  if(!externalPage)setPage(0);
 };
  const changeSort=key=>{
    const next=sort?.key!==key?{key,direction:"asc"}:
      sort.direction==="asc"?{key,direction:"desc"}:
      remote?{key,direction:"asc"}:null;
    if(remote)onSortChange(next);else setLocalSort(next);
    if(!externalPage)setPage(0);
  };
  const csvColumns=columns.filter(col=>col.exportable!==false&&
   col.label&&col.key!=="actions"&&col.key!=="action");
  const exportCurrent=()=>{
    if(onExport)return onExport();
    downloadTableCSV(exportFileName||"farmetrica-"+label.trim().toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-"),
      csvColumns.map(c=>c.label),filtered.map(row=>csvColumns.map(c=>
       c.exportValue?c.exportValue(row):c.value(row))));
  };
  return <>
    {showExport&&<div className="fm-table-toolbar">
      <span className="fm-table-export-scope">{externalPage?
       "Exportación de las filas de esta página":filtered.length+" resultados disponibles"}</span>
      <button type="button" className="btn btn-secondary btn-sm"
       onClick={exportCurrent} disabled={loading||(!onExport&&!filtered.length)}>
       <Download size={15}/> Exportar CSV{externalPage&&!onExport?" (página actual)":""}
      </button>
    </div>}
    <LoadingFrame loading={loading&&rows.length>0} label={loadingLabel}>
    <HorizontalTableScroll className="table-scroll" label={label}>
      <table className={"data-table smart-table "+tableClass}>
        <thead>
          <tr>{selection&&<th scope="col" className="fm-selection-column">
            <input type="checkbox" aria-label={"Seleccionar todas las "+label+" filtradas"}
             checked={allSelected} disabled={Boolean(selection.disabled)||!allFilteredKeys.length}
             onChange={e=>selectFiltered(e.target.checked)}/></th>}{columns.map(col=><th key={col.key} scope="col" aria-sort={sort?.key===col.key?(sort.direction==="asc"?"ascending":"descending"):"none"}>
            {col.sortable===false?<span className="smart-th-label">{col.label}</span>:
              <button className="smart-sort" type="button" onClick={()=>changeSort(col.key)} aria-label={"Ordenar "+col.label}>
                <span>{col.label}</span><span aria-hidden="true" className="smart-sort-arrow">{sort?.key===col.key?(sort.direction==="asc"?"▲":"▼"):"↕"}</span>
              </button>}
          </th>)}</tr>
          <tr className="smart-filter-row">{selection&&<th className="fm-selection-column">
            <span className="smart-filter-blank"/></th>}{columns.map(col=><th key={col.key}>
            {col.searchable===false?<span className="smart-filter-blank"/>:
              (col.filterMode==="multi"||(!externalPage&&col.filterMode!=="text"&&/farmacia|\babcd\b|clasificaci[oó]n|estado|\btipo\b|prioridad|categor[ií]a/i.test(col.label)))?<MultiSelectFilter label={col.label}
                options={filterOptions?.[col.key]||
                  (typeof col.options==="function"?col.options(rows):col.options||
                  [...new Set(rows.flatMap(r=>col.filterValues?.(r)||[col.value(r)]))])}
                value={Array.isArray(filters[col.key])?filters[col.key]:[]}
                onChange={next=>changeFilter(col.key,next)}/>:
              <input className="smart-column-filter" type="search" value={filters[col.key]||""}
                aria-label={"Buscar en "+col.label} placeholder={"Filtrar "+col.label.toLowerCase()} title={"Buscar en "+col.label}
                onChange={e=>changeFilter(col.key,e.target.value)}/>}
          </th>)}</tr>
        </thead>
        <tbody>{loading&&!rows.length?<tr><td colSpan={columns.length+(selection?1:0)}><LoadingPanel kind="table" label={loadingLabel} rows={Math.min(activeSize,5)}/></td></tr>:slice.map(row=><React.Fragment key={rowKey(row)}><tr className={onRowClick?"click-row":undefined}
          tabIndex={onRowClick?0:undefined} aria-label={onRowClick?"Abrir registro":undefined}
          onKeyDown={onRowClick?e=>{if(e.target===e.currentTarget&&(e.key==="Enter"||e.key===" ")){e.preventDefault();onRowClick(row);}}:undefined}
          onClick={onRowClick?()=>onRowClick(row):undefined}>
          {selection&&<td className="fm-selection-column">
            <input type="checkbox" aria-label={"Seleccionar "+(row.name||String(rowKey(row)))}
             checked={selected.has(String(rowKey(row)))} disabled={Boolean(selection.disabled)}
             onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}
             onChange={e=>{e.stopPropagation();toggleSelection(String(rowKey(row)))}}/>
           </td>}
          {columns.map(col=><td key={col.key}>{col.render?col.render(row):String(col.value(row)??"—")}</td>)}
        </tr>
        {renderExpandedRow&&expandedRowKeys.includes(String(rowKey(row)))&&<tr className="fm-expanded-row">
         <td colSpan={columns.length+(selection?1:0)}>{renderExpandedRow(row)}</td>
        </tr>}
       </React.Fragment>)}</tbody>
      </table>
      {!filtered.length&&!loading&&<div className="empty-state"><strong>{emptyText}</strong>{!remotelyFiltered&&rows?.length>0&&<p>Prueba a borrar algún filtro de columna.</p>}</div>}
    </HorizontalTableScroll>
    <p className="table-scroll-hint" aria-hidden="true">Desliza la tabla horizontalmente para ver más columnas →</p>
    <ListPagination total={externalPage?serverPagination.total:filtered.length} page={safePage} pageSize={activeSize} onPageChange={goToPage}
      onPageSizeChange={changePageSize} label={label} loading={loading}
      hasMore={externalPage&&Boolean(serverPagination.hasMore)} pageCount={filtered.length}/>
    </LoadingFrame>
  </>;
}
