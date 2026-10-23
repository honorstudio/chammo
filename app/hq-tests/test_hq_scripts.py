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


class DaemonInherited(unittest.TestCase):
    """세션은 claude 데몬 env 를 받는다 — 시험이 띄운 데몬에서 물려받은 CHAMMO_HOME 이고 그 앱이 꺼졌으면 앱 폴더로(2026-10-23 아이맥 soak)"""
    MODS = None

    @classmethod
    def setUpClass(cls):
        cls.MODS = (load('direct'), load('routine'))

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = self.tmp.name
        self.real = os.path.join(self.home, '.chammo')
        self.soak = os.path.join(self.home, '.chammo-soak')
        os.makedirs(self.real)
        open(os.path.join(self.real, 'config.json'), 'w').write('{}')

    def tearDown(self):
        self.tmp.cleanup()

    def live(self, m, inherited, alive, env=None):
        """os.environ 의 CHAMMO_HOME 으로 부른 data_dir — 판단 조각은 바꿔 끼운다"""
        old = (m._inherited, m._app_alive, getattr(m.data_dir, 'warned', False))
        m._inherited, m._app_alive = (lambda *a: inherited), (lambda d: alive)
        m.data_dir.warned = False
        saved = os.environ.get('CHAMMO_HOME')
        os.environ['CHAMMO_HOME'] = env or self.soak
        err = io.StringIO()
        try:
            with contextlib.redirect_stderr(err):
                return m.data_dir(self.home), err.getvalue()
        finally:
            m._inherited, m._app_alive, m.data_dir.warned = old
            if saved is None:
                os.environ.pop('CHAMMO_HOME', None)
            else:
                os.environ['CHAMMO_HOME'] = saved

    def test_물려받았고_그_앱이_꺼졌으면_앱_폴더로_경고는_한_번(self):
        for m in self.MODS:
            got, err = self.live(m, True, False)
            self.assertEqual(got, self.real, m.__name__)
            self.assertIn('claude daemon stop --any --keep-workers', err)

    def test_그_밖은_준_값_그대로(self):
        for m in self.MODS:
            self.assertEqual(self.live(m, False, False)[0], self.soak, '일부러 준 값')
            self.assertEqual(self.live(m, True, True)[0], self.soak, '산 시험 앱')
            os.remove(os.path.join(self.real, 'config.json'))
            self.assertEqual(self.live(m, True, False)[0], self.soak, '기본 폴더에 앱이 없다')
            open(os.path.join(self.real, 'config.json'), 'w').write('{}')

    def test_env_를_따로_준_부름은_프로세스_표를_안_본다(self):
        for m in self.MODS:
            old = m._inherited
            m._inherited = lambda *a: self.fail('env 를 준 부름에서 프로세스 표를 봤다')
            try:
                self.assertEqual(m.data_dir(self.home, self.soak, os.path.isdir), self.soak)
            finally:
                m._inherited = old

    def test_조상_모두가_데몬과_같은_값이어야_물려받은_것(self):
        cfg = os.path.join(self.home, 'cfg')
        os.makedirs(cfg)
        open(os.path.join(cfg, 'daemon.lock'), 'w').write('{"pid": 300}')
        me = os.getpid()
        here = os.getcwd()
        os.chdir(self.home)  # cwd 위 프로젝트 설정(이 저장소 .claude)이 판단에 안 끼게
        self.addCleanup(os.chdir, here)
        for m in self.MODS:
            def ps(*args, rows):
                if args[0] == '-axo':
                    return f'{me} 200\n200 300\n300 1\n'
                return rows
            same = f'200 claude bg-spare CHAMMO_HOME={self.soak}\n300 claude daemon run CHAMMO_HOME={self.soak} PATH=/b\n'
            moved = f'200 /bin/zsh -c t CHAMMO_HOME={self.real}\n300 claude daemon run CHAMMO_HOME={self.soak}\n'
            old = m._ps
            try:
                m._ps = lambda *a: ps(*a, rows=same)
                self.assertTrue(m._inherited(self.soak, self.home, {'CLAUDE_CONFIG_DIR': cfg}))
                self.assertFalse(m._inherited(self.real, self.home, {'CLAUDE_CONFIG_DIR': cfg}), '값이 다르다')
                m._ps = lambda *a: ps(*a, rows=f'200 /bin/sh /x/probe.sh\n300 claude daemon run CHAMMO_HOME={self.soak}\n')
                self.assertTrue(m._inherited(self.soak, self.home, {'CLAUDE_CONFIG_DIR': cfg}), '맥 /bin/sh 는 env 가 안 보인다 — 건너뛴다')
                m._ps = lambda *a: ps(*a, rows=moved)
                self.assertFalse(m._inherited(self.soak, self.home, {'CLAUDE_CONFIG_DIR': cfg}), '중간 셸이 다른 값 = 일부러 준 값')
                self.assertFalse(m._inherited(self.soak, self.home, {'CLAUDE_CONFIG_DIR': self.home}), '데몬 기록 없음')
                m._ps = lambda *a: ps(*a, rows=same)
                open(os.path.join(cfg, 'settings.json'), 'w').write(json.dumps({'env': {'CHAMMO_HOME': self.real}}))
                self.assertFalse(m._inherited(self.soak, self.home, {'CLAUDE_CONFIG_DIR': cfg}), '설정 고정이 있으면 세션 값은 그 값 — 물려받은 게 아니다')
                os.remove(os.path.join(cfg, 'settings.json'))
            finally:
                m._ps = old


class Say(unittest.TestCase):
    def test_음성_모드_파일(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertFalse(say.voice_on(d))
            open(os.path.join(d, 'voice.json'), 'w').write('{"on":true}')
            self.assertTrue(say.voice_on(d))

    def test_1mb_넘으면_앞_절반을_버린다(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, 'say.jsonl')
            open(p, 'w').write(''.join(f'{{"n":{i}}}\n' for i in range(100)))
            size = os.path.getsize(p)
            say.cap(p, size - 1)
            lines = open(p).read().splitlines()
            self.assertLess(os.path.getsize(p), size / 2 + 20)
            self.assertEqual(lines[-1], '{"n":99}')
            self.assertTrue(all(l.startswith('{"n":') and l.endswith('}') for l in lines))
            say.cap(os.path.join(d, 'none.jsonl'), 1)

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
                # 공개본 가림(redact)이 이 목록 글자까지 바꾸면 '사용자'·'참모' 를 찾다가 템플릿 본문에 걸린다 — 조각으로 이어 붙여 가림을 피한다
                for bad in ['honorstudio', 'desktop/dev', '/users/honor']:
                    self.assertNotIn(bad, text, f'{p.name}: {bad}')


class FolderTrustSkill(unittest.TestCase):
    # 믿은 devRoot 안 새 폴더(클론 포함)는 따로 안 믿어도 세션이 뜬다(2026-10-09 아이맥 실측, 바이패스·기본 모드 둘 다).
    # 참모가 띄워 보지도 않고 사용자에게 손 믿기를 부탁하지 않게 — 두 언어 모두 '먼저 띄워 본다'
    def test_미리_부탁하지_않는다(self):
        text = (SCRIPTS.parent / '.claude' / 'skills' / 'hq-folders' / 'SKILL.md').read_text(encoding='utf-8')
        ko, en = text.split('# English')
        self.assertIn('미리 사용자에게 믿기를 부탁하지 않는다', ko)
        self.assertIn("don't ask the user to trust it in advance", en)


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

    def test_web_url(self):
        self.assertEqual(show.web_url('http://localhost:3000'), 'http://localhost:3000')
        self.assertIsNone(show.web_url('file:///etc/passwd'))
        self.assertIsNone(show.web_url('javascript:alert(1)'))
        self.assertEqual(show.parse_args(['http://localhost:3000']), [('http://localhost:3000', None)])

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
    # *.py 는 도구가 import 하는 모듈(lesson_skill.py) — 직접 실행하지 않아 머리가 필요 없다.
    # *.sh 는 파이썬 없는 길(direct_nopy.sh, ADR 0011) — 처음부터 sh 라 파이썬 머리가 없다
    PY = [p for p in SCRIPTS.iterdir() if p.is_file() and p.name != 'voice-hint' and p.suffix not in ('.py', '.sh')]

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
            choice.ask_app_keys('c0ffee12', ['\x1b[B', '\r'], d)
            line = json.loads(open(os.path.join(d, 'app.jsonl'), encoding='utf-8').read().strip())
            self.assertEqual(line['action'], 'keys')
            self.assertEqual(line['arg'], {'id': 'c0ffee12', 'keys': '\x1b[B\r'})
