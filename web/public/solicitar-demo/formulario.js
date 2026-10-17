(() => {
 "use strict";
 const form=document.getElementById("demo-request-form");
 const feedback=document.getElementById("demo-feedback");
 const submit=document.getElementById("demo-submit");
 const success=document.getElementById("demo-success");
 const reference=document.getElementById("demo-reference");
 const source=new URLSearchParams(location.search).get("origen")||"directo";
 const origin=/^[a-z0-9_/-]{1,100}$/.test(source)?source:"directo";
 const message=(text,type)=>{
   feedback.hidden=false;
   feedback.className="demo-feedback "+(type==="error"?"demo-feedback-error":"");
   feedback.textContent=text;
 };
 form.addEventListener("submit",async(event)=>{
  event.preventDefault();
  if(!form.reportValidity())return;
  const data=new FormData(form);
  const payload={
    nombre:String(data.get("nombre")||"").trim(),
    email:String(data.get("email")||"").trim(),
    telefono:String(data.get("telefono")||"").trim(),
    pais:String(data.get("pais")||"").trim(),
    farmacias:String(data.get("farmacias")||""),
    programa:String(data.get("programa")||""),
    interes:String(data.get("interes")||""),
    mensaje:String(data.get("mensaje")||"").trim(),
    consentimiento:data.get("consentimiento")==="on",
    website:String(data.get("website")||""),
    origen:origin,
  };
  feedback.hidden=true;
  submit.disabled=true;
  submit.textContent="Enviando solicitud…";
  try{
   const response=await fetch("/api/public/solicitudes-demo",{
    method:"POST",credentials:"omit",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),
   });
   let result={};
   try{result=await response.json()}catch{}
   if(!response.ok)throw Error(result.error||"No se ha podido enviar. Inténtalo de nuevo.");
   form.hidden=true;success.hidden=false;
   if(result.reference)reference.textContent="Referencia: "+result.reference;
   success.scrollIntoView({behavior:"smooth",block:"center"});
  }catch(error){
    message(error.message||"No se ha podido completar la solicitud. Comprueba tu conexión.","error");
  }finally{
    submit.disabled=false;
    submit.textContent="Enviar solicitud ↗";
  }
 });
})();
