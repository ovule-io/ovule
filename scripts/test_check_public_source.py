"""Publication-boundary regressions; fixtures never contain real credentials."""
from pathlib import Path
import json
import re
import tempfile
import unittest

from check_public_source import source_violation


class PublicSourceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()

    def write(self, name, source):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source, encoding='utf-8')
        return path

    def test_tracked_credentials_are_rejected_even_if_gitignore_would_hide_them(self):
        for name in ('.env', '.env.production', 'certificate.pem', 'mise.local.toml', '.aws/config'):
            self.write(name, 'placeholder')
            self.assertIsNotNone(source_violation(self.root, name), name)
        self.write('.env.example', 'API_TOKEN=replace-me')
        self.assertIsNone(source_violation(self.root, '.env.example'))

    def test_secret_signatures_in_source_and_escaped_json(self):
        credentials = ('gh' + 'p_' + 'a' * 36, 'AK' + 'IA' + 'A' * 16,
                       '-----BEGIN ' + 'PRIVATE KEY-----')
        for credential in credentials:
            self.write('source.txt', credential)
            self.assertEqual(source_violation(self.root, 'source.txt'), 'credential signature')
        escaped = ''.join('\\u%04x' % ord(char) for char in credentials[0])
        self.write('config.json', '{"token":"' + escaped + '"}')
        self.assertEqual(source_violation(self.root, 'config.json'), 'credential signature')

    def test_private_terms_and_pending_deletions(self):
        self.write('config.json', json.dumps({'name': '\u79c1\u6709'}, ensure_ascii=True))
        self.assertEqual(source_violation(self.root, 'config.json', re.compile('\u79c1\u6709')),
                         'private term in content')
        self.assertIsNone(source_violation(self.root, 'deleted.rs'))

    def test_machine_user_paths_are_rejected_but_examples_are_allowed(self):
        for value in ('/Users/' + 'private-person/project', 'C:\\Users\\' + 'private-person\\project'):
            self.write('notes.md', value)
            self.assertEqual(source_violation(self.root, 'notes.md'), 'machine-specific user path')
        for value in ('/Users/example/project', 'C:\\Users\\example\\project'):
            self.write('notes.md', value)
            self.assertIsNone(source_violation(self.root, 'notes.md'))

    def test_symlinks_are_rejected_before_reading_targets(self):
        # The absent target also proves the checker does not try to read it.
        try:
            (self.root / 'external').symlink_to(self.root.parent / 'absent-secret')
        except OSError as error:
            self.skipTest(f'Symlinks unavailable: {error}')
        self.assertEqual(source_violation(self.root, 'external'), 'symlink outside repository')
        self.write('plugins/private/source.txt', 'private')
        (self.root / 'alias').symlink_to(self.root / 'plugins/private/source.txt')
        self.assertEqual(source_violation(self.root, 'alias'), 'symlink into optional repository')
        self.write('.env', 'private')
        (self.root / 'innocent.txt').symlink_to(self.root / '.env')
        self.assertIn('symlink', source_violation(self.root, 'innocent.txt'))


if __name__ == '__main__':
    unittest.main()
