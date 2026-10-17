#!/usr/bin/env python3
"""Configura un único administrador temporal en el .env privado del VPS.

No guarda ni muestra la contraseña en claro. Ejecutar como root en Contabo.
"""
import getpass
import hashlib
import os
import re
import secrets
import stat
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

ENV_PATH = Path("/opt/farmawao/.env")
EMAIL = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


def main() -> None:
    if os.geteuid() != 0:
        sys.exit("Ejecuta este comando como root en Contabo.")
    if not ENV_PATH.is_file():
        sys.exit("No existe /opt/farmawao/.env. No se ha modificado nada.")

    email = input("Correo del superadministrador: ").strip().lower()
    if not EMAIL.fullmatch(email) or len(email) > 254:
        sys.exit("Correo no válido.")
    password = getpass.getpass("Contraseña provisional (no se mostrará): ")
    if len(password) < 8 or len(password) > 256:
        sys.exit("Contraseña inválida: 8 a 256 caracteres.")
    confirm = getpass.getpass("Repite la contraseña: ")
    if password != confirm:
        sys.exit("Las contraseñas no coinciden. No se ha guardado nada.")

    existing = ENV_PATH.read_text(encoding="utf-8").splitlines()
    values = {}
    for line in existing:
        if "=" in line and not line.lstrip().startswith("#"):
            name, value = line.split("=", 1)
            values[name.strip()] = value.strip().strip('"').strip("'")

    origin = input("URL HTTPS de Farmétrica (ejemplo https://app.ejemplo.es): ").strip().rstrip("/")
    parsed = urlsplit(origin)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        sys.exit("El origen debe ser una URL HTTPS sin ruta, barra final ni parámetros.")

    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=64)
    password = ""
    confirm = ""
    # Comillas simples imprescindibles: Compose no debe expandir los signos $ del hash.
    hashed = f"'scrypt$16384$8$1${salt.hex()}${digest.hex()}'".replace("\\$", "$")
    secret = values.get("SESSION_SECRET", "")
    if len(secret) < 32:
        secret = secrets.token_hex(32)
    changes = {
        "TEMP_ADMIN_EMAIL": email,
        "TEMP_ADMIN_PASSWORD_HASH": hashed,
        "SESSION_SECRET": secret,
        "PUBLIC_APP_ORIGIN": origin,
        "COOKIE_SECURE": "true",
    }
    out = []
    changed = set()
    for line in existing:
        name = line.split("=", 1)[0].strip() if "=" in line else ""
        if name in changes and not line.lstrip().startswith("#"):
            if name not in changed:
                out.append(f"{name}={changes[name]}")
                changed.add(name)
        else:
            out.append(line)
    for name, value in changes.items():
        if name not in changed:
            out.append(f"{name}={value}")

    current = ENV_PATH.stat()
    fd, temp_name = tempfile.mkstemp(prefix=".env.login.", dir=str(ENV_PATH.parent), text=True)
    try:
        os.fchmod(fd, stat.S_IMODE(current.st_mode))
        os.fchown(fd, current.st_uid, current.st_gid)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write("\n".join(out) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, ENV_PATH)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
    print("Configuración segura guardada en Contabo. No se ha mostrado el hash ni la clave de sesión.")
    print("Ahora ejecuta: cd /opt/farmawao && docker compose -f compose.yaml -f compose.farmacias.yml up -d --build --no-deps api web")


if __name__ == "__main__":
    main()
