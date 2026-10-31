"""Privacy checks use synthetic secrets; no saved page content is printed."""
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools import sanitize_snapshots
from tools.sanitize_snapshots import Sanitizer


class PrivacyChecks(unittest.TestCase):
    def test_identity_and_active_content_removed(self):
        raw = '''<html><head><title>PRIVATE_NAME</title>
        <meta name="account" content="PRIVATE_META">
        <script>const account = "PRIVATE_SESSION";</script>
        <style>.center-content{width:800px;background-image:url(https://example.test/PRIVATE_CSS)}
        @media (min-width:1006px){.center-content{max-width:1200px}}</style>
        </head><body data-user="PRIVATE_USER_ID">
        <!-- PRIVATE_COMMENT -->
        <a href="https://example.test/?token=PRIVATE_TOKEN" title="PRIVATE_TITLE">PRIVATE_NAME</a>
        <input value="PRIVATE_FORM" onfocus="PRIVATE_HANDLER">
        <img src="https://example.test/PRIVATE_AVATAR" alt="PRIVATE_ALT">
        <iframe srcdoc="PRIVATE_IFRAME"></iframe>
        <div class="center-content" data-v-123abc>消息</div>
        <svg><symbol id="account-icon-message"><path d="M0 0L24 24Z"/></symbol>
        <use xlink:href="#account-icon-message"/></svg>
        </body></html>'''
        parser = Sanitizer()
        parser.feed(raw)
        result = ''.join(parser.out)
        self.assertNotIn('PRIVATE_', result)
        self.assertNotIn('account-icon', result)
        self.assertNotIn('https://', result)
        self.assertIn('class="center-content"', result)
        self.assertIn('data-v-123abc', result)
        self.assertIn('消息', result)
        self.assertIn('safe-icon-0-message', result)
        self.assertIn('@media (min-width:1006px)', result)

    def test_existing_userscript_styles_removed(self):
        parser = Sanitizer()
        parser.feed('<style id="tn-style">.x{width:99px}</style><div data-tn-wide style="width:999px">PRIVATE_TEXT</div>')
        result = ''.join(parser.out)
        self.assertNotIn('99px', result)
        self.assertNotIn('999px', result)
        self.assertNotIn('PRIVATE_TEXT', result)

    def test_archived_and_root_snapshots_generate_safe_fixtures(self):
        with TemporaryDirectory(prefix='tieba-neat-input-') as temp:
            root = Path(temp)
            raw = root / 'snapshots' / 'raw'
            dest = root / 'snapshots' / 'sanitized'
            raw.mkdir(parents=True)
            originals = {
                raw / 'PRIVATE_ARCHIVE_NAME.html': '<div class="pb-page-wrapper">PRIVATE_ACCOUNT</div>',
                root / 'PRIVATE_ROOT_NAME.html': '<div class="home-page-wrapper">PRIVATE_SESSION</div>',
            }
            for path, content in originals.items():
                path.write_text(content, encoding='utf-8')
            log = StringIO()
            with patch.multiple(sanitize_snapshots, ROOT=root, RAW=raw, DEST=dest), redirect_stdout(log):
                sanitize_snapshots.main()
            fixtures = list(dest.glob('*.html'))
            self.assertEqual(len(fixtures), 2)
            self.assertEqual({p.name.split('-')[1] for p in fixtures}, {'post.html', 'home.html'})
            self.assertNotIn('PRIVATE_', log.getvalue())
            for fixture in fixtures:
                self.assertNotIn('PRIVATE_', fixture.read_text(encoding='utf-8'))
            for path, content in originals.items():
                self.assertEqual(path.read_text(encoding='utf-8'), content)


if __name__ == '__main__':
    unittest.main()
