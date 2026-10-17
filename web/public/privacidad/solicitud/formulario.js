(()=>{
 const form=document.getElementById("privacy-request-form"),status=document.getElementById("privacy-feedback"),button=document.getElementById("privacy-submit");
 form.addEventListener("submit",async e=>{
  e.preventDefault();if(!form.reportValidity())return;
  button.disabled=true;status.hidden=true;
  const d=new FormData(form);
  try{
    const r=await fetch("/api/public/privacidad",{method:"POST",credentials:"omit",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(d))});
    const result=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(result.error||"No se ha podido registrar la solicitud");
    form.hidden=true;document.getElementById("privacy-success").hidden=false;
    if(result.reference)document.getElementById("privacy-reference").textContent="Referencia: "+result.reference;
  }catch(err){status.hidden=false;status.textContent=err.message;status.className="demo-feedback demo-feedback-error"}
  finally{button.disabled=false}
 });
})();