// Mostrar todas las referencias sin montar miles de celdas simultáneamente.
export const ALL_LAB_ROWS=0;
export const LAB_VIRTUAL_ROW_HEIGHT=38;
export const LAB_VIRTUAL_THRESHOLD=250;

export function laboratoryTablePage(groups,size=ALL_LAB_ROWS,page=0){
 const count=Array.isArray(groups)?groups.length:0;
 const finite=Number(size)>0;
 const totalPages=finite?Math.max(1,Math.ceil(count/Number(size))):1;
 const safePage=Math.max(0,Math.min(Number(page)||0,totalPages-1));
 const selected=finite?groups.slice(safePage*Number(size),(safePage+1)*Number(size)):groups;
 return {totalPages,safePage,rows:selected.flatMap(group=>group.rows)};
}

export function laboratoryTableViewport(rowCount,firstVisibleRow){
 if(rowCount<=LAB_VIRTUAL_THRESHOLD)
  return {virtualized:false,start:0,end:rowCount,top:0,bottom:0};
 const row=Math.max(0,Math.min(rowCount-1,Number(firstVisibleRow)||0));
 const start=Math.max(0,row-15);
 const end=Math.min(rowCount,start+65);
 return {virtualized:true,start,end,
  top:start*LAB_VIRTUAL_ROW_HEIGHT,
  bottom:(rowCount-end)*LAB_VIRTUAL_ROW_HEIGHT};
}
