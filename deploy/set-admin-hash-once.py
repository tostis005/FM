#!/usr/bin/env python3
"""One-time install of a strongly random admin password verifier in the VPS .env.

The password itself is NOT in this file, GitHub Actions, or logs.
"""
import os
import re
import stat
import sys
import tempfile
from pathlib import Path

ENV = Path("/srv/.env")
ACCOUNT = "jose.fraga@gmail.com"
VERIFIER = "scrypt$16384$8$1$9be9d5b5e44f3b2ca15ac983f4741791$5b72585484e5cd44719a6052674703d64ec5b41151003dc5394dce4e9dc8a5e9a6ccd68c1bb10720167f7a81215b4d5ed5654e3dca37ed3231f184218c4bf36a"

def apply():
    if not re.fullmatch(r"scrypt\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}", VERIFIER):
        sys.exit("Verifier format invalid")
    original = ENV.read_text(encoding="utf-8")
    if not re.search(r"(?m)^TEMP_ADMIN_EMAIL=" + re.escape(ACCOUNT) + r"\s*$", original):
        sys.exit("Expected administrator account not found; refusing to change any credentials")
    if "TEMP_ADMIN_PASSWORD_HASH=" not in original or "SESSION_SECRET=" not in original:
        sys.exit("Existing local authentication configuration incomplete")
    updated, changes = re.subn(r"(?m)^TEMP_ADMIN_PASSWORD_HASH=.*$", lambda m: "TEMP_ADMIN_PASSWORD_HASH='" + VERIFIER + "'", original, count=1)
    if changes != 1:
        sys.exit("Unable to replace existing verifier")
    if updated == original:
        print("ADMIN_PASSWORD_ALREADY_SET")
        return
    old = ENV.stat()
    fd, tmp = tempfile.mkstemp(prefix=".farmawao-env-rotate-", dir=str(ENV.parent), text=True)
    try:
        os.fchmod(fd, stat.S_IMODE(old.st_mode))
        os.fchown(fd, old.st_uid, old.st_gid)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(updated)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, ENV)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    print("ADMIN_PASSWORD_UPDATED")

if __name__ == "__main__":
    apply()
