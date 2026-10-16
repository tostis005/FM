import { generateKeyPairSync, privateDecrypt, randomBytes, scryptSync, constants } from "node:crypto";
import fs from "node:fs";

const KEY_PATH = "/keys/.farmawao_rotation_private.pem";
const CIPHER_PATH = "/keys/.farmawao_rotation_cipher.txt";
const ENV_PATH = "/srv/.env";
const EMAIL = "jose.fraga@gmail.com";

function keyInit(){
  if (fs.existsSync(KEY_PATH)) {
    throw new Error("Existe una clave de rotación pendiente: no se genera otra.");
  }
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicKeyEncoding: { type:"spki", format:"pem" },
    privateKeyEncoding: { type:"pkcs8", format:"pem" },
  });
  fs.writeFileSync(KEY_PATH, keys.privateKey, { mode: 0o600, flag: "wx" });
  process.stdout.write("ROTATION_PUBLIC_BASE64=" + Buffer.from(keys.publicKey).toString("base64") + "\n");
}
function decrypt(){
  const key=fs.readFileSync(KEY_PATH, "utf8");
  const cipher=Buffer.from(fs.readFileSync(CIPHER_PATH,"utf8").trim(),"base64");
  const value=privateDecrypt({key,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:"sha256"},cipher).toString("utf8");
  if(value.length < 20 || value.length > 128)throw Error("Clave recibida inválida");
  return value;
}
function rotate(){
  const password=decrypt();
  const salt=randomBytes(16);
  const digest=scryptSync(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  const passwordHash="scrypt$16384$8$1$"+salt.toString("hex")+"$"+digest.toString("hex");
  const old=fs.readFileSync(ENV_PATH,"utf8");
  if(!old.match(/^TEMP_ADMIN_EMAIL=jose\.fraga@gmail\.com\s*$/m))throw Error("El correo configurado no coincide con el superadministrador previsto");
  if(!old.match(/^TEMP_ADMIN_PASSWORD_HASH=/m))throw Error("No existe la contraseña provisional");
  const updated=old.replace(/^TEMP_ADMIN_PASSWORD_HASH=.*$/m,"TEMP_ADMIN_PASSWORD_HASH='"+passwordHash+"'");
  const stat=fs.statSync(ENV_PATH);
  const temp=ENV_PATH+".rotate-temp-"+process.pid;
  try {
    fs.writeFileSync(temp,updated,{mode:stat.mode & 0o777,flag:"wx"});
    fs.chmodSync(temp,stat.mode & 0o777);
    fs.chownSync(temp,stat.uid,stat.gid);
    fs.renameSync(temp,ENV_PATH);
  } finally {
    if(fs.existsSync(temp))fs.unlinkSync(temp);
  }
  console.log("NUEVA_CONTRASENA_INSTALADA_EN_ENV");
}
async function smoke(){
  const password=decrypt();
  const origin="http://127.0.0.1:18080";
  const anon=await fetch(origin+"/",{redirect:"manual"});
  if(anon.status !== 302 || !anon.headers.get("location")?.startsWith("/login"))throw Error("SPA no está protegida");
  const result=await fetch(origin+"/api/auth/local",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({email:EMAIL,password})
  });
  if(result.status !== 200)throw Error("El login no acepta la contraseña actualizada (estado "+result.status+")");
  const cookie=result.headers.get("set-cookie")?.split(";",1)[0];
  if(!cookie?.startsWith("fm_session="))throw Error("Falta cookie de sesión");
  const me=await fetch(origin+"/api/auth/me",{headers:{Cookie:cookie}});
  const user=(await me.json()).user;
  if(me.status !== 200 || user?.email !== EMAIL || user?.role !== "administrador")throw Error("Rol admin no validado");
  const sales=await fetch(origin+"/api/ventas/cobertura",{headers:{Cookie:cookie}});
  const coverage=await sales.json();
  if(sales.status !== 200 || coverage.pharmacies?.length < 5)throw Error("No se pueden consultar las cinco farmacias");
  console.log("LOGIN_ADMIN_OK; DATOS_REALES_OK; ACCESO_ANONIMO_BLOQUEADO");
}
function cleanup(){
  fs.rmSync(KEY_PATH,{force:true});
  fs.rmSync(CIPHER_PATH,{force:true});
  // Las credenciales anteriores ya no son válidas. Evitar mostrar contraseña obsoleta.
  if(fs.existsSync("/root-host/.farmawao-initial-access")){
    fs.rmSync("/root-host/.farmawao-initial-access");
  }
  console.log("ARCHIVOS_PROVISIONALES_DE_ROTACION_ELIMINADOS");
}
const mode=process.argv[2];
if (mode==="init")keyInit();
else if(mode==="rotate")rotate();
else if(mode==="smoke")await smoke();
else if(mode==="cleanup")cleanup();
else throw Error("Modo de rotación no reconocido");
