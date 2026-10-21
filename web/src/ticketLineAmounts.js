// Pantalla: devoluciones con signo negativo. Excel de laboratorio: magnitudes
// positivas. No se altera nunca el origen sincronizado ni se inventan ceros.
const finite=value=>{
  if(value===null||value===undefined||value==="")return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
};
const magnitude=value=>{
  const n=finite(value);
  return n===null?null:Math.abs(n);
};

export function ticketLineAmounts(line={}, {absolute=false}={}){
  const pvp=magnitude(line.pvp);
  const isReturn=[line.quantity,line.net].some(v=>(finite(v)??0)<0) ||
    (finite(line.quantity)===null&&finite(line.net)===null&&
     [line.lineDiscount,line.gross].some(v=>(finite(v)??0)<0));
  const signed=value=>{
    const n=magnitude(value);
    return n===null?null:(isReturn&&!absolute?-n:n);
  };
  const quantity=signed(line.quantity);
  const lineDiscount=signed(line.lineDiscount);
  const net=signed(line.net);
  const grossMagnitude=magnitude(line.net)!==null&&magnitude(line.lineDiscount)!==null
    ? magnitude(line.net)+magnitude(line.lineDiscount)
    : pvp!==null&&magnitude(line.quantity)!==null
      ? pvp*magnitude(line.quantity) : magnitude(line.gross);
  const gross=grossMagnitude===null?null:isReturn&&!absolute?-grossMagnitude:grossMagnitude;
  const discountRate=grossMagnitude!==null&&grossMagnitude>0&&magnitude(line.lineDiscount)!==null
    ? magnitude(line.lineDiscount)/grossMagnitude : null;
  return {pvp,quantity,gross,lineDiscount,net,discountRate};
}
