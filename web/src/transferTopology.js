// Las acciones de redistribución dependen de los establecimientos activos y
// autorizados del cliente, no de que se trate de una demo.
export function transferCapabilities(pharmacies=[],warehouses=[]){
 const sites=(Array.isArray(pharmacies)?pharmacies:[])
  .filter(p=>p&&p.active!==false&&p.establishmentType!=="almacen");
 const depots=(Array.isArray(warehouses)?warehouses:[])
  .filter(p=>p&&p.active!==false&&
   (p.establishmentType==="almacen"||p.kind==="almacen"));
 return {
  canTransferBetweenPharmacies:sites.length>1,
  canUseTransferidor:sites.length>1||(sites.length>0&&depots.length>0)
 };
}
