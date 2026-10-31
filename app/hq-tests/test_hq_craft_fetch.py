"""HQ scripts/craft fetch — 인증서 확인 실패(윈도우 루트 저장소에 아직 없는 루트)면 certifi 로, 없으면 윈도우 curl.exe(Schannel)로 한 번 더.
확인을 끄는 길은 없다(공개 이슈 #14). python3 -m unittest discover -s app/hq-tests -p 'test_hq_craft_fetch.py'"""
import importlib.machinery, importlib.util, pathlib, ssl, subprocess, sys, types, unittest, urllib.error
from unittest import mock

sys.dont_write_bytecode = True

SCRIPT = pathlib.Path(__file__).resolve().parent.parent / 'hq-template' / 'scripts' / 'craft'


def load():
    loader = importlib.machinery.SourceFileLoader('hq_craft_fetch', str(SCRIPT))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


craft = load()
URL = 'https://github.com/x/releases/download/crafts-1/SHA256SUMS.txt'


def verify_failed():
    return urllib.error.URLError(ssl.SSLCertVerificationError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get issuer certificate'))


class Resp:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self.body


class Fetch(unittest.TestCase):
    def setUp(self):
        self.calls = []

    def opener(self, *results):
        """urlopen 대역 — 차례로 예외를 던지거나 바이트를 준다, 받은 context 를 적는다"""
        it = iter(results)

        def urlopen(req, timeout=None, context=None):
            self.calls.append(context)
            r = next(it)
            if isinstance(r, BaseException):
                raise r
            return Resp(r)
        return urlopen

    def no_certifi(self):
        return mock.patch.dict(sys.modules, {'certifi': None})

    def test_잘_되면_한_번만(self):
        with mock.patch.object(craft.urllib.request, 'urlopen', self.opener(b'ok')):
            self.assertEqual(craft.fetch(URL), b'ok')
        self.assertEqual(self.calls, [None])

    def test_확인_실패면_certifi_로_한_번_더_확인은_켠_채(self):
        made = []
        real = ssl.create_default_context

        def ctx(*a, **k):
            made.append(k)
            return real()
        fake = types.SimpleNamespace(where=lambda: '/certifi/cacert.pem')
        with mock.patch.dict(sys.modules, {'certifi': fake}), \
                mock.patch.object(craft.ssl, 'create_default_context', ctx), \
                mock.patch.object(craft.urllib.request, 'urlopen', self.opener(verify_failed(), b'sums')):
            self.assertEqual(craft.fetch(URL), b'sums')
        self.assertEqual(made, [{'cafile': '/certifi/cacert.pem'}])
        c = self.calls[1]
        self.assertEqual(c.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(c.check_hostname)

    def test_certifi_없으면_윈도우는_curl_exe_로(self):
        ran = []

        def run(argv, **k):
            ran.append((argv, k))
            return subprocess.CompletedProcess(argv, 0, b'from-curl', b'')
        with self.no_certifi(), mock.patch.object(craft, 'IS_WIN', True), \
                mock.patch.object(craft.subprocess, 'run', run), \
                mock.patch.object(craft.urllib.request, 'urlopen', self.opener(verify_failed())):
            self.assertEqual(craft.fetch(URL, timeout=30), b'from-curl')
        argv, k = ran[0]
        self.assertEqual(argv[0], 'curl.exe')
        self.assertEqual(argv[-1], URL)
        for bad in ('-k', '--insecure', '--ssl-no-revoke'):
            self.assertNotIn(bad, argv)  # 확인을 끄거나 줄이지 않는다
        self.assertIn('-f', ''.join(a for a in argv if a.startswith('-') and not a.startswith('--')))  # HTTP 오류는 실패로
        self.assertEqual(k.get('creationflags'), 0x08000000)  # CREATE_NO_WINDOW — 받는 동안 검은 창이 안 번쩍이게

    def test_curl_도_실패면_원래_오류를_같이(self):
        def run(argv, **k):
            return subprocess.CompletedProcess(argv, 35, b'', b'curl: (35) schannel: failed')
        with self.no_certifi(), mock.patch.object(craft, 'IS_WIN', True), \
                mock.patch.object(craft.subprocess, 'run', run), \
                mock.patch.object(craft.urllib.request, 'urlopen', self.opener(verify_failed())):
            with self.assertRaises(craft.FetchError) as e:
                craft.fetch(URL)
        self.assertIn('CERTIFICATE_VERIFY_FAILED', str(e.exception))
        self.assertIn('schannel', str(e.exception))

    def test_curl_오류_글은_윈도우_코드_페이지로(self):
        msg = 'curl: (35) schannel: 인증서가 만료되었습니다.'

        def run(argv, **k):
            return subprocess.CompletedProcess(argv, 35, b'', msg.encode('cp949'))
        with self.no_certifi(), mock.patch.object(craft, 'IS_WIN', True), \
                mock.patch.object(craft.locale, 'getencoding', lambda: 'cp949', create=True), \
                mock.patch.object(craft.subprocess, 'run', run), \
                mock.patch.object(craft.urllib.request, 'urlopen', self.opener(verify_failed())):
            with self.assertRaises(craft.FetchError) as e:
                craft.fetch(URL)
        self.assertIn(msg, str(e.exception))

    def test_curl_exe_가_없어도_FetchError(self):
        def run(argv, **k):
            raise FileNotFoundError('curl.exe')
        with self.no_certifi(), mock.patch.object(craft, 'IS_WIN', True), \
                mock.patch.object(craft.subprocess, 'run', run), \
                mock.patch.object(craft.urllib.request, 'urlopen', self.opener(verify_failed())):
            with self.assertRaises(craft.FetchError):
                craft.fetch(URL)

    def test_맥은_certifi_없으면_그대로_실패(self):
        with self.no_certifi(), mock.patch.object(craft, 'IS_WIN', False), \
                mock.patch.object(craft.subprocess, 'run', side_effect=AssertionError('curl 안 부름')), \
                mock.patch.object(craft.urllib.request, 'urlopen', self.opener(verify_failed())):
            with self.assertRaises(craft.FetchError) as e:
                craft.fetch(URL)
        self.assertIn('CERTIFICATE_VERIFY_FAILED', str(e.exception))

    def test_확인_실패가_아닌_오류는_다시_안_함(self):
        with mock.patch.object(craft, 'IS_WIN', True), \
                mock.patch.object(craft.subprocess, 'run', side_effect=AssertionError('curl 안 부름')), \
                mock.patch.object(craft.urllib.request, 'urlopen', self.opener(urllib.error.URLError('timed out'))):
            with self.assertRaises(craft.FetchError):
                craft.fetch(URL)
        self.assertEqual(len(self.calls), 1)


if __name__ == '__main__':
    unittest.main()
