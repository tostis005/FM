// Credenciales internas: scrypt con sal aleatoria por usuario. Sin dependencias
// de hashing nativas adicionales y sin devolver nunca el hash al navegador.
import {randomBytes,scrypt as scryptCallback,timingSafeEqual} from "node:crypto";
import {promisify} from "node:util";
const scrypt=promisify(scryptCallback);
const PATTERN=/^scrypt\$16384\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/;
const OPTIONS={N:16384,r:8,p:1,maxmem:64*1024*1024};
export function validInternalPassword(password){
 return typeof password==="string"&&password.length>=12&&password.length<=128;
}
export async function hashInternalPassword(password){
 if(!validInternalPassword(password))throw Error("La contraseña debe tener entre 12 y 128 caracteres");
 const salt=randomBytes(16);
 const key=await scrypt(password,salt,64,OPTIONS);
 return "scrypt$16384$8$1$"+salt.toString("hex")+"$"+key.toString("hex");
}
export async function verifyInternalPassword(password,stored){
 if(typeof password!=="string"||password.length>256)return false;
 const match=PATTERN.exec(stored||"");
 if(!match)return false;
 const key=await scrypt(password,Buffer.from(match[1],"hex"),64,OPTIONS);
 return timingSafeEqual(key,Buffer.from(match[2],"hex"));
}
