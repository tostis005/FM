// Vista de un canal calculada con las asignaciones precalculadas por la API.
// El stock de cada local sigue siendo el mismo; solo cambia su propuesta
// para los pedidos del canal elegido, sin solicitar otro informe al servidor.
export function pickingListChannelView(report,channel){
 if(!report||!channel)return report;
 const rows=(report.rows||[]).flatMap(row=>{
  const part=row.channelSlices?.[channel];
  if(!part)return [];
  const {planned,...fields}=part;
  return [{...row,...fields,stock:(row.stock||[]).map((site,i)=>({
   ...site,planned:planned?.[i]||0
  }))}];
 });
 const totals=report.channelTotals?.[channel]||{
  orders:0,lines:0,products:0,units:0,allocated:0,pending:0,shortage:0,incomplete:0
 };
 return {...report,selectedChannel:channel,rows,totals};
}

/* En las pestañas de establecimientos se preparan únicamente artículos
   con al menos una unidad propuesta en esa ubicación. No basta tener stock. */
export function pickingListRowsForSite(rows,siteId){
 if(siteId===null||siteId===undefined||siteId==="")return rows||[];
 return (rows||[]).filter(row=>(row.stock||[]).some(site=>
  String(site.id)===String(siteId)&&Number(site.planned)>0));
}
