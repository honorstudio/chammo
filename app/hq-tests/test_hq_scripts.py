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


class ShowPoint(unittest.TestCase):
    """show — 짚어 보여 주기·누가 띄웠나·어디 떴나(0.2.0 에서 원본과 맞춤)"""

    def test_parse_args(self):
        self.assertEqual(show.parse_args(['a.md']), [('a.md', None)])
        self.assertEqual(show.parse_args(['a.md', '--find', 'hello', '--line', '3-5']), [('a.md', {'find': 'hello', 'line': 3, 'lineEnd': 5})])
        self.assertEqual(show.parse_args(['a.md:12', 'b.pdf', '--page', '2']), [('a.md', {'line': 12}), ('b.pdf', {'page': 2})])
        self.assertEqual(show.parse_args(['c.png', '--box', '0.1,0.2,0.3,0.4']), [('c.png', {'box': [0.1, 0.2, 0.3, 0.4]})])

    def test_record_from_and_at(self):
        r = show.record('/h/a.md', {'CLAUDE_JOB_DIR': '/h/.claude/jobs/abcd1234'}, '/h/p', 't', {'page': 2})
        self.assertEqual(r, {'ts': 't', 'path': '/h/a.md', 'from': 'abcd1234', 'cwd': '/h/p', 'at': {'page': 2}})

    def test_shown_where(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertIn('reader', show.shown_where(d))
            with open(os.path.join(d, 'view.json'), 'w') as f:
                json.dump({'view': 'chat'}, f)
            self.assertIn('space', show.shown_where(d))


class Windows(unittest.TestCase):
    """윈도우 참모도 같은 도구를 쓴다 — 유닉스 전용 모듈을 맨 위에서 불러오면 스크립트 전체가 죽는다(윈도우판)"""
    UNIX_ONLY = {'pty', 'termios', 'fcntl', 'tty', 'resource', 'pwd', 'grp'}

    def test_맨_위에서_유닉스_전용_모듈을_안_부른다(self):
        import ast
        for p in SCRIPTS.iterdir():
            if not p.is_file() or p.read_text(encoding='utf-8').startswith('#!/bin/sh'):
                continue
            tree = ast.parse(p.read_text(encoding='utf-8'))
            for node in tree.body:  # 맨 위 수준만 — 함수 안에서 부르는 건 그 기능을 쓸 때만 막힌다
                names = [a.name.split('.')[0] for a in node.names] if isinstance(node, ast.Import) else [node.module.split('.')[0]] if isinstance(node, ast.ImportFrom) and node.module else []
                self.assertFalse(self.UNIX_ONLY & set(names), f'{p.name}: {self.UNIX_ONLY & set(names)}')

    def test_파일은_utf8_로_연다(self):
        import re
        for p in SCRIPTS.iterdir():
            if not p.is_file():
                continue
            for i, line in enumerate(p.read_text(encoding='utf-8').splitlines(), 1):
                for m in re.finditer(r'\bopen\(([^()]|\([^()]*\))*\)', line):
                    call = m.group(0)
                    if "'wb'" in call or "'rb'" in call or 'os.open' in line[max(0, m.start() - 3):m.start() + 5]:
                        continue
                    self.assertIn('encoding=', call, f'{p.name}:{i} {call}')


class Launcher(unittest.TestCase):
    """윈도우의 python3 는 마이크로소프트 스토어 대리 실행기라(종료 코드 49) #!/usr/bin/env python3 로는 도구가 전부 죽었다.
    맨 위를 sh 머리로 — 맥은 python3, 윈도우는 py -3 → python 중 실제로 도는 것. 파이썬에선 그냥 글자라 그대로 돈다"""
    PY = [p for p in SCRIPTS.iterdir() if p.is_file() and p.name != 'voice-hint']

    def test_모든_파이썬_도구가_같은_머리(self):
        for p in self.PY:
            lines = p.read_text(encoding='utf-8').splitlines()
            self.assertEqual(lines[0], '#!/bin/sh', p.name)
            self.assertEqual(lines[1], "''':'", p.name)

    def test_설명글은_그대로(self):
        for name in ('task', 'app', 'say'):
            self.assertTrue(load(name).__doc__.strip().startswith(('Chammo', 'Operate', 'Voice')), name)

    def test_맥은_python3_로(self):
        r = subprocess.run(['sh', str(SCRIPTS / 'task'), '--help'], capture_output=True, text=True)
        self.assertIn('Chammo task log', r.stdout)

    def test_윈도우는_스토어_python3_를_건너뛴다(self):
        with tempfile.TemporaryDirectory() as d:
            fake = pathlib.Path(d)
            (fake / 'python3').write_text('#!/bin/sh\necho Python; exit 49\n')  # 스토어 대리 실행기 흉내
            (fake / 'python').write_text(f'#!/bin/sh\nexec {sys.executable} "$@"\n')
            for f in fake.iterdir():
                f.chmod(0o755)
            env = {**os.environ, 'OS': 'Windows_NT', 'PATH': f'{d}:/usr/bin:/bin'}
            r = subprocess.run(['sh', str(SCRIPTS / 'task'), '--help'], capture_output=True, text=True, env=env)
            self.assertIn('Chammo task log', r.stdout, r.stderr)


class ChoiceOnWindows(unittest.TestCase):
    """윈도우엔 가짜 터미널(pty)이 없다 — 앱에 app.jsonl 한 줄로 부탁하면 앱(appctl)이 붙어서 누른다"""
    def test_앱에_키_넣기를_부탁한다(self):
        choice = load('choice')
        with tempfile.TemporaryDirectory() as d:
            choice.ask_app_keys('9b9042fe', ['\x1b[B', '\r'], d)
            line = json.loads(open(os.path.join(d, 'app.jsonl'), encoding='utf-8').read().strip())
            self.assertEqual(line['action'], 'keys')
            self.assertEqual(line['arg'], {'id': '9b9042fe', 'keys': '\x1b[B\r'})
