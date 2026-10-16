// Conciliación explícita de objetivos Excel con promociones FARMAWAO.
// Nunca importamos "vendidas" del Excel: esas cifras vienen de Farmatic/PostgreSQL.
const pharmacyIds = { ABADIA:"1", BUENAVISTA:"3", EUROPA:"2", VALDEMARIAS:"5" };
const clean = value => String(value ?? "").trim().replace(/\s+/g," ");
const key = value => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]/g,"");
function offerKey(value){
  const raw=clean(value).toUpperCase();
  const compact=key(raw);
  const units=raw.match(/\b([234])\s*X\s*([12])\b/);
  if(units)return "x"+units[1]+"_"+units[2];
  const percent=raw.match(/(\d{1,3})\s*%/);
  const second=/2\s*[ªºA]?\s*(?:UD|UNIDAD)|SEGUNDA|2DA/.test(raw);
  if(percent)return (second?"second_pct:":"pct:")+Number(percent[1]);
  return compact;
}
function offerComparable(a,b){
  if(key(a)===key(b))return true;
  const ka=offerKey(a),kb=offerKey(b);
  // Igualar descripciones largas sin confundir descuentos distintos.
  return ka===kb && (/^x\d|^pct:|^second_pct:/.test(ka));
}
function objectiveQuantity(value) {
  if(value===null || value===undefined || clean(value)==="")return null;
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>0?n:null;
}
export function extractObjectiveRecords(rows,year=2026) {
  const records=[],warnings=[];
  let pharmacy=null;
  (rows||[]).forEach((row,i)=>{
    if(Number(row?.[0])===year && key(row?.[1])==="OCTUBRE") {
      pharmacy=pharmacyIds[key(row?.[2])]||null;
      if(!pharmacy)warnings.push("Farmacia desconocida en fila "+(i+1)+": "+clean(row?.[2]));
      return;
    }
    if(!pharmacy || !clean(row?.[1]) || !clean(row?.[2]) || !clean(row?.[3]))return;
    const qty=objectiveQuantity(row?.[4]);
    if(qty===null)return; // Sin objetivo no significa cero ventas ni debe borrar datos.
    records.push({lab:clean(row[1]),range:clean(row[2]),offer:clean(row[3]),pharmacy,qty,row:i+1});
  });
  return {records,warnings};
}
function matchScore(p,r) {
  const lab=key(p.laboratory||p.subtitle),lab2=key(r.lab);
  const range=key(p.range||p.name),range2=key(r.range);
  const offer=p.originalOffer||p.name;
  if(!range||!range2||!offerComparable(offer,r.offer))return -1;
  const exactRange=range===range2;
  const extended=range.length>=4&&range2.length>=4&&
    (range.includes(range2)||range2.includes(range));
  if(!exactRange&&!extended)return -1;
  const sameLab=lab===lab2;
  // El catálogo Farmatic previo usa a veces la marca como laboratorio;
  // permitirlo solo para gamas claramente relacionadas.
  if(!sameLab&&!extended)return -1;
  return (exactRange?12:5)+(sameLab?8:0)+(key(offer)===key(r.offer)?4:1);
}
export function applyObjectiveRows(campaigns,rows,year=2026) {
  const {records,warnings}=extractObjectiveRecords(rows,year);
  const patch=new Map();
  let unmatched=0,ambiguous=0;
  for(const record of records) {
    const candidates=campaigns.map((p,index)=>({p,index,score:matchScore(p,record)}))
      .filter(x=>x.score>=0).sort((a,b)=>b.score-a.score);
    if(!candidates.length){unmatched++;continue;}
    if(candidates.length>1 && candidates[0].score===candidates[1].score &&
        candidates[0].p.id!==candidates[1].p.id){ambiguous++;continue;}
    const found=candidates[0];
    const entry=patch.get(found.index)||{};
    if(entry[record.pharmacy]!==undefined && entry[record.pharmacy]!==record.qty){
      ambiguous++;continue;
    }
    entry[record.pharmacy]=record.qty;
    patch.set(found.index,entry);
  }
  const promotions=campaigns.map((p,index)=>{
    const targets=patch.get(index);
    return targets ? {
      ...p,
      targets:{...(p.targets||{}),...targets},
      objectivesSource:"Excel objetivos octubre 2026",
    }:p;
  });
  return {promotions,assigned:[...patch.values()].reduce((sum,x)=>sum+Object.keys(x).length,0),
    unmatched,ambiguous,warnings};
}
