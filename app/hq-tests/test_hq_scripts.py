"""HQ 템플릿 스크립트 테스트 (공개판): python3 -m unittest discover -s app/hq-tests"""
import contextlib, importlib.machinery, importlib.util, io, json, os, pathlib, subprocess, sys, tempfile, unittest

sys.dont_write_bytecode = True  # 템플릿 폴더에 __pycache__ 가 생기지 않게

SCRIPTS = pathlib.Path(__file__).resolve().parent.parent / 'hq-template' / 'scripts'


def load(name):
    loader = importlib.machinery.SourceFileLoader(f'hq_{name}', str(SCRIPTS / name))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


task, say, show = load('task'), load('say'), load('show')



class DataDir(unittest.TestCase):
    def test_세_스크립트가_같은_규칙(self):
        for m in (task, say, show):
            self.assertEqual(m.data_dir('/h', '/x', lambda p: True), '/x')
            self.assertEqual(m.data_dir('/h', '', lambda p: False), '/h/.chammo')
            self.assertEqual(m.data_dir('/h', '', lambda p: p == '/h/.honor-orchestrator'), '/h/.honor-orchestrator')
            self.assertEqual(m.data_dir('/h', '', lambda p: True), '/h/.chammo')


class Say(unittest.TestCase):
    def test_음성_모드_파일(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertFalse(say.voice_on(d))
            open(os.path.join(d, 'voice.json'), 'w').write('{"on":true}')
            self.assertTrue(say.voice_on(d))

    def test_언어(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(say.lang(d), 'ko')
            open(os.path.join(d, 'config.json'), 'w').write('{"language":"en"}')
            self.assertEqual(say.lang(d), 'en')


class Show(unittest.TestCase):
    def test_홈_밖은_거절(self):
        with tempfile.TemporaryDirectory() as d:
            d = os.path.realpath(d)
            home = os.path.join(d, 'home'); os.makedirs(home)
            open(os.path.join(home, 'a.md'), 'w').write('# a')
            open(os.path.join(d, 'secret.txt'), 'w').write('x')
            self.assertEqual(show.resolve('a.md', cwd=home, home=home), os.path.join(home, 'a.md'))
            self.assertIsNone(show.resolve('../secret.txt', cwd=home, home=home))


class VoiceHint(unittest.TestCase):
    def hint(self, files):
        with tempfile.TemporaryDirectory() as d:
            for k, v in files.items():
                open(os.path.join(d, k), 'w').write(v)
            r = subprocess.run(['sh', str(SCRIPTS / 'voice-hint')], env={'CHAMMO_HOME': d, 'HOME': d, 'PATH': '/usr/bin:/bin'}, capture_output=True, text=True)
        return r.stdout

    def test_꺼져_있으면_조용(self):
        self.assertEqual(self.hint({}), '')

    def test_켜져_있으면_언어대로(self):
        self.assertIn('scripts/say', self.hint({'voice.json': '{"on":true}'}))
        self.assertIn('Voice mode is on', self.hint({'voice.json': '{"on":true}', 'config.json': '{\n  "language": "en"\n}'}))


class NoPersonalNames(unittest.TestCase):
    # 공개 템플릿엔 사람·거래처 이름이 없어야 한다
    def test_이름_없음(self):
        root = SCRIPTS.parent
        for p in root.rglob('*'):
            if p.is_file() and '__pycache__' not in p.parts:
                text = p.read_text(encoding='utf-8').lower()
                for bad in ['honorstudio', 'desktop/dev', '/users/']:
                    self.assertNotIn(bad, text, f'{p.name}: {bad}')


if __name__ == '__main__':
    unittest.main()
