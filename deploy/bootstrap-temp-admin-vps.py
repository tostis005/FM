#!/usr/bin/env python3
"""Provision a strong temporary FARMAWAO password only on the VPS.

Never prints a password, session secret, cookie, or password hash.
"""
import json
import os
import secrets
import hashlib
import stat
import sys
import tempfile
import urllib.request
import urllib.error
from pathlib import Path

ENV=Path("/srv/.env")
VAULT=Path("/root-host/.farmawao-initial-access")
EMAIL="jose.fraga@gmail.com"

def existing_values(lines):
    result={}
    for line in lines:
        if "=" not in line or line.lstrip().startswith("#"):
            continue
        key,value=line.split("=",1)
        result[key.strip()]=value.strip().strip("'").strip('"')
    return result

def safe_replace(path, contents):
    st=path.stat()
    fd, temp=tempfile.mkstemp(prefix=".farmawao-tmp-",dir=str(path.parent))
    try:
        os.fchmod(fd,stat.S_IMODE(st.st_mode))
        os.fchown(fd,st.st_uid,st.st_gid)
        with os.fdopen(fd,"w",encoding="utf-8") as out:
            out.write(contents)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp,path)
    finally:
        if os.path.exists(temp):os.unlink(temp)

def setup():
    if not ENV.is_file() or not VAULT.parent.is_dir():
        sys.exit("Falta archivo .env privado o directorio /root de Contabo")
    lines=ENV.read_text(encoding="utf-8").splitlines()
    values=existing_values(lines)
    if VAULT.is_file() and values.get("TEMP_ADMIN_EMAIL") == EMAIL and values.get("TEMP_ADMIN_PASSWORD_HASH","").startswith("scrypt$"):
        print("CUENTA_YA_CONFIGURADA")
        return
    if values.get("TEMP_ADMIN_PASSWORD_HASH","").startswith("scrypt$"):
        sys.exit("Ya hay una contraseña provisional configurada: no se ha sobrescrito")
    password=secrets.token_urlsafe(28)
    salt=secrets.token_bytes(16)
    digest=hashlib.scrypt(password.encode("utf-8"),salt=salt,n=16384,r=8,p=1,dklen=64,maxmem=64*1024*1024)
    hash_string="scrypt$16384$8$1$"+salt.hex()+"$"+digest.hex()
    secret=values.get("SESSION_SECRET","")
    if len(secret)<32:
        secret=secrets.token_hex(32)
    changes={
        "TEMP_ADMIN_EMAIL":EMAIL,
        "TEMP_ADMIN_PASSWORD_HASH":"'"+hash_string+"'",
        "SESSION_SECRET":secret,
        "COOKIE_SECURE":"true"
    }
    descriptor, name=tempfile.mkstemp(prefix=".farmawao-auth-",dir=str(VAULT.parent))
    try:
        os.fchmod(descriptor,0o600)
        with os.fdopen(descriptor,"w",encoding="utf-8") as output:
            output.write("Correo: "+EMAIL+"\nContraseña temporal: "+password+"\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(name,VAULT)
    finally:
        if os.path.exists(name):os.unlink(name)

    result=[]
    seen=set()
    for line in lines:
        name=line.split("=",1)[0].strip() if "=" in line else ""
        if name in changes and not line.lstrip().startswith("#"):
            if name not in seen:
                result.append(name+"="+changes[name])
                seen.add(name)
        else:result.append(line)
    for name,value in changes.items():
        if name not in seen:result.append(name+"="+value)
    safe_replace(ENV,"\n".join(result)+"\n")
    print("CUENTA_PROVISIONAL_CONFIGURADA; CONTRASEÑA_SOLO_EN_ROOT")

def smoke():
    if not VAULT.is_file():
        sys.exit("No existe credencial privada de acceso")
    data=VAULT.read_text(encoding="utf-8").splitlines()
    email=data[0].split(": ",1)[1]
    password=data[1].split(": ",1)[1]

    def request(route,body=None,cookie=None):
        headers={}
        if body is not None:headers["Content-Type"]="application/json"
        if cookie:headers["Cookie"]=cookie
        req=urllib.request.Request("http://127.0.0.1:18080"+route,
                data=json.dumps(body).encode("utf-8") if body is not None else None,
                headers=headers,method="POST" if body is not None else "GET")
        return urllib.request.urlopen(req,timeout=10)

    # Anonymous access must never return the application or its bundles.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    no_redirect=urllib.request.build_opener(NoRedirect())
    for route in ("/", "/index.html", "/farmacias"):
        try:
            no_redirect.open("http://127.0.0.1:18080"+route,timeout=10)
        except urllib.error.HTTPError as err:
            assert err.code == 302, "La web no redirige a login"
        else:
            raise AssertionError("La web se ha servido sin sesión")

    with request("/api/auth/config") as resp:
        config=json.load(resp)
        assert config.get("temporaryLoginEnabled") is True, "Acceso temporal no habilitado"
    with request("/login") as resp:
        assert resp.status==200, "Página pública de login no responde"
    with request("/api/auth/local",{"email":email,"password":password}) as resp:
        assert resp.status==200, "Credenciales provisionales no admitidas"
        cookie=resp.headers.get("Set-Cookie","").split(";",1)[0]
        assert cookie.startswith("fm_session="), "Cookie de sesión ausente"
    with request("/api/auth/me",cookie=cookie) as resp:
        user=json.load(resp)["user"]
        assert user["email"]==EMAIL and user["role"]=="administrador", "Rol admin incorrecto"
    with request("/api/ventas/cobertura",cookie=cookie) as resp:
        coverage=json.load(resp)
        assert len(coverage.get("pharmacies",[]))>=5, "Faltan farmacias reales"
    with request("/api/ventas/seguimiento",{
        "promotions":[{
            "id":"gum-verificacion",
            "start":"2026-10-01","end":"2026-10-31",
            "cns":["339588","180678","179327","197003","176584",
                   "176585","176587","211451","198676","201975",
                   "306472","217842","170095","176082","176083",
                   "208871","170097","316963","361279","361261",
                   "156319","180036","180038","221655","218254"]
        }]
    },cookie=cookie) as resp:
        result=json.load(resp)
        assert isinstance(result.get("sales",{}).get("gum-verificacion"),dict), "Seguimiento Farmatic inválido"
    print("LOGIN_ADMIN_OK; POSTGRES_VENTAS_OK; CINCO_FARMACIAS_OK; SEGUIMIENTO_REAL_OK; ANONIMO_BLOQUEADO_OK")

if __name__=="__main__":
    try:
        smoke() if sys.argv[1:]==["--smoke"] else setup()
    except Exception as exc:
        print("ERROR_EN_VERIFICACION: "+type(exc).__name__,file=sys.stderr)
        sys.exit(1)
