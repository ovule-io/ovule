import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from cryptography.exceptions import InvalidTag

from recover_macos_link_credentials import decrypt, encrypt, recover, replace_bytes


class RecoveryTests(unittest.TestCase):
    def test_rewrap_preserves_identities_pairing_config_and_original_ciphertext(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old, current = bytes(range(32)), bytes(reversed(range(32)))
            plain = json.dumps(list(range(32))).encode()
            original = encrypt(plain, old)
            identity = root / "workspace-link-host.dpapi"
            identity.write_bytes(original)
            client = root / "workspace-link-client.dpapi"
            client_plain = json.dumps(list(reversed(range(32)))).encode()
            client.write_bytes(encrypt(client_plain, old))
            client_original = client.read_bytes()
            config = root / "workspace-link-access.json"
            config.write_bytes(b'{"devices":{"existing-peer":{}}}')
            provider = root / "provider-deepseek-api-key.dpapi"
            provider.write_bytes(encrypt(b"synthetic-provider-key", current))
            provider_before = provider.read_bytes()
            names, backup = recover(root, old, current)
            self.assertEqual(names, [identity.name, client.name])
            self.assertIsNone(backup)
            self.assertEqual(identity.read_bytes(), original)
            names, backup = recover(root, old, current, apply=True)
            self.assertEqual(decrypt(identity.read_bytes(), current), plain)
            self.assertEqual(decrypt(client.read_bytes(), current), client_plain)
            self.assertEqual((backup / client.name).read_bytes(), client_original)
            self.assertEqual((backup / identity.name).read_bytes(), original)
            self.assertEqual(config.read_bytes(), (backup / config.name).read_bytes())
            self.assertEqual(provider.read_bytes(), provider_before)
            self.assertEqual(recover(root, old, current, apply=True), ([], None))

    def test_unrecoverable_client_prevents_partial_host_migration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old, current, wrong = bytes(range(32)), bytes([5] * 32), bytes([9] * 32)
            plain = json.dumps(list(range(32))).encode()
            host = root / "workspace-link-host.dpapi"
            host.write_bytes(encrypt(plain, old))
            before = host.read_bytes()
            (root / "workspace-link-client.dpapi").write_bytes(encrypt(plain, wrong))
            with self.assertRaises(InvalidTag):
                recover(root, old, current, apply=True)
            self.assertEqual(host.read_bytes(), before)
            self.assertEqual(list(root.glob("link-recovery-backup-*")), [])

    def test_failed_second_write_rolls_back_the_first_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old, current = bytes(range(32)), bytes([5] * 32)
            plain = json.dumps(list(range(32))).encode()
            originals = {}
            for name in ("workspace-link-host.dpapi", "workspace-link-client.dpapi"):
                originals[name] = encrypt(plain, old)
                (root / name).write_bytes(originals[name])
            attempts = 0

            def fail_second_write(path, contents, mode):
                nonlocal attempts
                attempts += 1
                if attempts == 2:
                    raise OSError("synthetic disk failure")
                replace_bytes(path, contents, mode)

            with patch("recover_macos_link_credentials.replace_bytes", fail_second_write):
                with self.assertRaisesRegex(OSError, "synthetic disk failure"):
                    recover(root, old, current, apply=True)
            for name, original in originals.items():
                self.assertEqual((root / name).read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
