#!/usr/bin/env python3
"""Rewrap existing Link identities using an original Ovule keychain key.

Requires macOS and Python's cryptography package. Defaults to a read-only check.
Keys and plaintext stay in memory; backups contain the original encrypted files.
"""

import argparse
import ctypes
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

HEADER = b"ovule-keychain-v1\0"
IDENTITIES = ("workspace-link-host.dpapi", "workspace-link-client.dpapi")
ACCOUNT = b"credential-encryption-key-v1"


def keychain_key(service, keychain=None):
    security = ctypes.CDLL("/System/Library/Frameworks/Security.framework/Security")
    security.SecKeychainOpen.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)]
    security.SecKeychainOpen.restype = ctypes.c_int32
    security.SecKeychainFindGenericPassword.argtypes = [
        ctypes.c_void_p, ctypes.c_uint32, ctypes.c_char_p,
        ctypes.c_uint32, ctypes.c_char_p, ctypes.POINTER(ctypes.c_uint32),
        ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p,
    ]
    security.SecKeychainFindGenericPassword.restype = ctypes.c_int32
    security.SecKeychainItemFreeContent.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    core = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
    core.CFRelease.argtypes = [ctypes.c_void_p]
    handle = ctypes.c_void_p()
    if keychain:
        status = security.SecKeychainOpen(os.fsencode(keychain), ctypes.byref(handle))
        if status:
            raise RuntimeError(f"Open legacy keychain failed (OSStatus {status})")
    data = ctypes.c_void_p()
    length = ctypes.c_uint32()
    try:
        service_bytes = service.encode()
        status = security.SecKeychainFindGenericPassword(
            handle, len(service_bytes), service_bytes, len(ACCOUNT), ACCOUNT,
            ctypes.byref(length), ctypes.byref(data), None,
        )
        if status:
            raise RuntimeError(f"Read Ovule key failed (OSStatus {status})")
        key = ctypes.string_at(data, length.value)
        if len(key) != 32:
            raise RuntimeError("Ovule encryption key must contain 32 bytes")
        return key
    finally:
        if data.value:
            security.SecKeychainItemFreeContent(None, data)
        if handle.value:
            core.CFRelease(handle)


def decrypt(blob, key):
    if not blob.startswith(HEADER) or len(blob) < len(HEADER) + 28:
        raise ValueError("Unsupported or truncated encrypted credential")
    payload = blob[len(HEADER):]
    return AESGCM(key).decrypt(payload[:12], payload[12:], None)


def encrypt(plain, key):
    nonce = os.urandom(12)
    return HEADER + nonce + AESGCM(key).encrypt(nonce, plain, None)


def replace_bytes(path, contents, mode):
    fd, name = tempfile.mkstemp(prefix=".link-recovery-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(contents)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def recover(root, old_key, current_key, apply=False):
    """Authenticate every identity before changing anything; leave access/config intact."""
    pending = []
    for name in IDENTITIES:
        path = root / name
        if not path.exists():
            continue
        if not stat.S_ISREG(path.lstat().st_mode):
            raise ValueError(f"Identity must be a regular file: {name}")
        blob = path.read_bytes()
        try:
            decrypt(blob, current_key)
            continue
        except InvalidTag:
            pass
        plain = decrypt(blob, old_key)
        identity = json.loads(plain)
        if not isinstance(identity, list) or len(identity) != 32 or any(
            type(value) is not int or not 0 <= value <= 255 for value in identity
        ):
            raise ValueError(f"Unsupported Link identity serialization: {name}")
        replacement = encrypt(plain, current_key)
        assert decrypt(replacement, current_key) == plain
        pending.append((path, blob, replacement, stat.S_IMODE(path.stat().st_mode)))
    if not pending or not apply:
        return [item[0].name for item in pending], None

    backup = Path(tempfile.mkdtemp(prefix="link-recovery-backup-", dir=root))
    for path in root.iterdir():
        if path.is_file() and not path.is_symlink():
            shutil.copy2(path, backup / path.name)
    changed = []
    try:
        for path, original, replacement, mode in pending:
            if path.read_bytes() != original:
                raise RuntimeError("Identity changed during recovery; close Ovule and retry")
            replace_bytes(path, replacement, mode)
            changed.append((path, original, mode))
            if path.read_bytes() != replacement:
                raise RuntimeError("Recovered identity verification failed")
    except Exception:
        for path, original, mode in changed:
            replace_bytes(path, original, mode)
        raise
    return [item[0].name for item in pending], backup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--legacy-keychain", type=Path, required=True)
    parser.add_argument("--service", choices=["io.ovule.desktop", "io.ovule.desktop.debug"],
                        default="io.ovule.desktop")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("Keychain recovery requires macOS")
    current = keychain_key(args.service)
    original = keychain_key(args.service, args.legacy_keychain)
    names, backup = recover(args.data_root / "secrets", original, current, args.apply)
    print(json.dumps({"applied": args.apply, "identities_rewrapped": names,
                      "encrypted_backup": str(backup) if backup else None}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Never include decrypted values, ciphertext or keys in diagnostics.
        print(f"Link recovery failed: {type(error).__name__}", file=sys.stderr)
        sys.exit(1)
