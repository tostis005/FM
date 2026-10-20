// Importes de las líneas de promociones, compartidos por pantalla y Excel.
// Los importes de las devoluciones se PRESENTAN en positivo: no se modifica
// la venta sincronizada ni se confunde un valor ausente con un cero real.
const finite=value=>{
  if(value===null||value===undefined||value==="")return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
};
const magnitude=value=>{
  const n=finite(value);
  return n===null?null:Math.abs(n);
};

export function ticketLineAmounts(line={}){
  const pvp=magnitude(line.pvp);
  const quantity=magnitude(line.quantity);
  const lineDiscount=magnitude(line.lineDiscount);
  const net=magnitude(line.net);
  // El bruto real de una línea con descuento es neto + descuento.
  // Sólo usamos PVP x cantidad si no tenemos ambos importes.
  const gross=net!==null&&lineDiscount!==null
    ? net+lineDiscount
    : pvp!==null&&quantity!==null ? pvp*quantity : magnitude(line.gross);
  const discountRate=gross!==null&&gross>0&&lineDiscount!==null
    ? lineDiscount/gross : null;
  return {pvp,quantity,gross,lineDiscount,net,discountRate};
}
