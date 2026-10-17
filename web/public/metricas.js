(()=>{
  // Recuento agregado sin cookies ni URL de consulta; no registra ni identifica visitantes.
  const path=location.pathname;
  if(!/^\/(?:$|solicitar-demo\/$|(?:blog|integraciones|soluciones)\/(?:[a-z0-9-]+\/)?$)/.test(path))return;
  if(navigator.webdriver)return;
  try{
   fetch("/api/public/metricas",{method:"POST",credentials:"omit",keepalive:true,
     headers:{"Content-Type":"application/json"},body:JSON.stringify({tipo:"vista",ruta:path})
   }).catch(()=>{});
  }catch{}
})();
