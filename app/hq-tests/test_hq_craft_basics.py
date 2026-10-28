"""HQ scripts/craft 기본 참모 앱 미리 받기 — 표·PDF·슬라이드·문서·벡터 5개는 뒤에서 깔고 나머지는 쓸 때:
python3 -m unittest discover -s app/hq-tests -p 'test_hq_craft_basics.py' — 진짜 설치 없이 가짜 설치기로"""
import importlib.machinery, importlib.util, json, os, pathlib, sys, tempfile, unittest
from unittest import mock

sys.dont_write_bytecode = True

SCRIPT = pathlib.Path(__file__).resolve().parent.parent / 'hq-template' / 'scripts' / 'craft'


def load():
    loader = importlib.machinery.SourceFileLoader('hq_craft', str(SCRIPT))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


craft = load()
GB = 1024 ** 3


class Basics(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        self.d = self.t.name
        os.makedirs(os.path.join(self.d, 'craft-native'))
        self.have, self.got = set(), []

    def tearDown(self):
        self.t.cleanup()

    def install(self, app):
        self.got.append(app)
        self.have.add(app)

    def run_(self, free=50 * GB, install=None):
        return craft.prefetch(self.d, install=install or self.install, have=lambda a: a in self.have, free=lambda: free)

    def test_기본은_다섯_작은_것부터(self):
        self.assertEqual(craft.basics(), ['gridcraft', 'pdfcraft', 'deckcraft', 'wordcraft', 'vectorcraft'])
        self.assertTrue(craft.is_basic('gridcraft-2'))
        self.assertFalse(craft.is_basic('photocraft'))

    def test_윈도우는_준비된_앱만(self):
        with mock.patch.object(craft.craft_win, 'supported', lambda a: a != 'pdfcraft'):
            with mock.patch.object(craft, 'IS_WIN', True):
                self.assertNotIn('pdfcraft', craft.basics())

    def test_없는_것만_차례로_깔고_끝을_적는다(self):
        self.have.add('pdfcraft')  # 사람이 이미 깐 것
        st = self.run_()
        self.assertEqual(self.got, ['gridcraft', 'deckcraft', 'wordcraft', 'vectorcraft'])
        self.assertEqual(st['state'], 'done')
        self.assertEqual(craft.prefetch_state(self.d)['state'], 'done')
        self.assertIsNone(craft.prefetch_state(self.d)['app'])

    def test_다_깔려_있으면_아무것도_안_받는다(self):
        self.have.update(craft.BASICS)
        self.assertEqual(self.run_()['state'], 'done')
        self.assertEqual(self.got, [])

    def test_디스크가_5GB_아래면_건너뛴다(self):
        st = self.run_(free=4 * GB)
        self.assertEqual(self.got, [])
        self.assertEqual(st['state'], 'low-disk')

    def test_설정에서_끄면_안_받는다(self):
        with open(os.path.join(self.d, 'config.json'), 'w') as f:
            json.dump({'features': {'craftBasics': False}}, f)
        self.assertEqual(self.run_()['state'], 'off')
        self.assertEqual(self.got, [])

    def test_하나가_실패해도_나머지는_깐다(self):
        def install(app):
            if app == 'deckcraft':
                raise craft.CraftError('SHA-256 mismatch')
            self.install(app)
        st = self.run_(install=install)
        self.assertEqual(self.got, ['gridcraft', 'pdfcraft', 'wordcraft', 'vectorcraft'])
        self.assertIn('deckcraft', st['failed'])
        self.assertEqual(st['state'], 'done')

    def test_받는_중엔_그_앱을_적어_둔다(self):
        seen = []
        self.run_(install=lambda a: (seen.append(craft.prefetch_state(self.d).get('app')), self.install(a)))
        self.assertEqual(seen, list(craft.BASICS))
        self.assertTrue(craft.prefetching(self.d, 'gridcraft') is False)  # 끝난 뒤엔 아무것도 받는 중 아님

    def test_다른_스크립트가_받는_중이면_또_안_돈다(self):
        craft._write_json(craft.prefetch_file(self.d), {'state': 'running', 'app': 'gridcraft', 'pid': os.getppid()})
        self.assertEqual(self.run_()['state'], 'busy')
        self.assertEqual(self.got, [])
        self.assertTrue(craft.prefetching(self.d, 'gridcraft'))

    def test_죽은_받기는_받는_중으로_안_본다(self):
        craft._write_json(craft.prefetch_file(self.d), {'state': 'running', 'app': 'gridcraft', 'pid': 99999999})
        self.assertFalse(craft.prefetching(self.d, 'gridcraft'))
        self.assertEqual(self.run_()['state'], 'done')


class Marks(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        self.d = self.t.name
        self.apps = os.path.join(self.d, 'Applications')
        os.makedirs(self.apps)

    def tearDown(self):
        self.t.cleanup()

    def test_목록에_기본_표시(self):
        out = craft.listing(os.path.join(self.d, 'craft'), self.d, apps_dir=self.apps)
        grid = next(l for l in out.splitlines() if l.startswith('GridCraft'))
        photo = next(l for l in out.splitlines() if l.startswith('PhotoCraft'))
        self.assertIn('basic / 기본', grid)
        self.assertNotIn('기본', photo)

    def test_서랍_줄에_기본과_받는_중(self):
        craft._write_json(craft.prefetch_file(self.d), {'state': 'running', 'app': 'pdfcraft', 'pid': os.getpid()})

        def offline(u):
            raise craft.FetchError('offline')
        rows = {r['app']: r for r in craft.drawer_rows(self.d, os.path.join(self.d, 'craft'), apps_dir=self.apps, get=offline, icons=False, fast=True)}
        self.assertTrue(rows['vectorcraft']['basic'])
        self.assertFalse(rows['filmcraft']['basic'])
        self.assertTrue(rows['pdfcraft']['prefetching'])
        self.assertFalse(rows['gridcraft']['prefetching'])


class Declined(unittest.TestCase):
    """사람이 서랍에서 지운 기본 앱은 다시 안 받는다 — 다시 깔거나(열기) 설정을 껐다 켜면(--reset) 다시"""

    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        b = self.t.name
        self.d, self.apps, self.trash = os.path.join(b, 'data'), os.path.join(b, 'Applications'), os.path.join(b, 'Trash')
        for x in (os.path.join(self.d, 'craft-native'), self.apps, self.trash):
            os.makedirs(x)
        self.got = []

    def tearDown(self):
        self.t.cleanup()

    def run_(self, **k):
        return craft.prefetch(self.d, install=self.got.append, have=lambda a: False, free=lambda: 50 * GB, **k)

    def test_지운_기본_앱은_다시_안_받는다(self):
        craft.remove_app(self.d, 'deckcraft', apps_dir=self.apps, trash=self.trash)
        self.run_()
        self.assertEqual(self.got, ['gridcraft', 'pdfcraft', 'wordcraft', 'vectorcraft'])
        self.assertIn('deckcraft', craft.prefetch_state(self.d)['declined'])

    def test_기본_아닌_앱은_적지_않는다(self):
        craft.remove_app(self.d, 'photocraft', apps_dir=self.apps, trash=self.trash)
        self.assertEqual(craft.declined(self.d), {})

    def test_다시_깔면_지운_기록이_풀린다(self):
        craft.remove_app(self.d, 'deckcraft', apps_dir=self.apps, trash=self.trash)
        craft.record_install(self.d, 'deckcraft', os.path.join(self.apps, 'Chammo Deck.app'), '0.7.0')
        self.assertEqual(craft.declined(self.d), {})
        self.assertEqual(craft.load_installs(self.d)['deckcraft']['ver'], '0.7.0')

    def test_설정을_껐다_켜면_다시_받는다(self):
        craft.remove_app(self.d, 'deckcraft', apps_dir=self.apps, trash=self.trash)
        self.run_(reset=True)
        self.assertIn('deckcraft', self.got)
        self.assertEqual(craft.declined(self.d), {})


class InstallOnly(unittest.TestCase):
    """서랍 '받기' = 깔기만(10/28 사용자 "설치하면 자동으로 띄워주는 거 없어야") — 여는 건 사람이 다시 누를 때"""

    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        self.d = self.t.name
        os.makedirs(os.path.join(self.d, 'craft-native'))
        self.have, self.got = set(), []

    def tearDown(self):
        self.t.cleanup()

    def run_(self, app):
        return craft.install_only(self.d, app, install=lambda a: (self.got.append(a), self.have.add(a)), have=lambda a: a in self.have)

    def test_안_깔린_앱은_깔기만_하고_띄우지_않는다(self):
        with mock.patch.object(craft, 'open_native_ctl') as opened, mock.patch.object(craft.subprocess, 'Popen') as spawned:
            self.assertEqual(self.run_('photocraft'), 'installed')
        self.assertEqual(self.got, ['photocraft'])
        opened.assert_not_called()
        spawned.assert_not_called()

    def test_이미_깔렸으면_다시_안_받는다(self):
        self.have.add('photocraft')
        self.assertEqual(self.run_('photocraft'), 'already')
        self.assertEqual(self.got, [])

    def test_인스턴스_키도_앱으로(self):
        self.run_('gridcraft-2')
        self.assertEqual(self.got, ['gridcraft'])


if __name__ == '__main__':
    unittest.main()
