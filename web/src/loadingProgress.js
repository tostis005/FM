// Mostrar avance en términos comprensibles para el usuario, no en ventanas SQL.
// Mientras la respuesta aún se está consolidando, nunca afirmar el 100 %.
export function taskPercent(progress,scope,completed=false){
 if(completed)return 100;
 if(!progress||progress.scope!==scope||!Number.isFinite(progress.total)||progress.total<=0||
  !Number.isFinite(progress.done))return null;
 const fraction=progress.done/progress.total;
 return Math.min(99,Math.max(0,Math.floor(fraction*100)));
}
export function combinedPercent(tasks){
 if(!tasks.length)return null;
 const percentages=tasks.map(t=>taskPercent(t.progress,t.scope,t.completed));
 // Si no conocemos el tamaño de todas las partes, no inventar un porcentaje global.
 if(percentages.some(x=>x===null))return null;
 return Math.min(99,Math.floor(percentages.reduce((a,b)=>a+b,0)/percentages.length));
}
export function userLoadingText(percent,what="Cargando datos"){
 return percent===null?`${what}…`:`${what} · ${percent} %`;
}
