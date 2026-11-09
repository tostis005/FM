// Una única ruta de migas de pan para toda la SPA.
// Los ancestros sin permiso se muestran como texto, nunca como enlaces.
const GROUPS={
 configuracion:{label:"Configuración",ids:["farmacias","usuarios","estado","ajustes"]},
 administracion:{label:"Administración",ids:["clientes","fuentes","solicitudes","accesos"]}
};
const SPECIAL={ "seguimiento-global":{label:"Seguimiento",childOf:"promociones"} };
export function navigationBreadcrumbs(page,items=[],canAccess=()=>false,{editingObjectives=false}={}){
 const byId=new Map(items.map(item=>[item.id,item]));
 const route=page==="seguimiento-global"?SPECIAL[page]:byId.get(page);
 const currentLabel=page==="promociones-objetivos"&&editingObjectives?"Editar objetivos":
  route?.label||page||"Inicio";
 const trail=[],seen=new Set();
 let item=page==="seguimiento-global"?{id:page,...SPECIAL[page]}:route;
 while(item?.id&&!seen.has(item.id)){
  seen.add(item.id);
  trail.unshift({id:item.id,label:item.id===page?currentLabel:item.label||item.id});
  item=item.childOf?byId.get(item.childOf):null;
 }
 if(!trail.length)trail.push({id:page||"dashboard",label:currentLabel});
 const group=Object.values(GROUPS).find(g=>g.ids.includes(page));
 if(group)trail.unshift({id:null,label:group.label});
 if(page!=="dashboard"&&canAccess("dashboard"))
  trail.unshift({id:"dashboard",label:"Inicio"});
 if(page==="dashboard")return [{id:"dashboard",label:"Inicio",current:true,link:false}];
 return trail.map((entry,i)=>({...entry,current:i===trail.length-1,
  link:i<trail.length-1&&Boolean(entry.id)&&canAccess(entry.id)}));
}
