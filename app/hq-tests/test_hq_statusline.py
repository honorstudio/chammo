"""HQ 템플릿 scripts/statusline 테스트: python3 -m unittest discover -s app/hq-tests"""
import importlib.machinery, importlib.util, io, json, os, pathlib, sys, tempfile, unittest

sys.dont_write_bytecode = True
SCRIPTS = pathlib.Path(__file__).resolve().parent.parent / 'hq-template' / 'scripts'


def load(name):
    loader = importlib.machinery.SourceFileLoader(f'hq_{name}', str(SCRIPTS / name))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


sl = load('statusline')
INPUT = {'session_id': 'abc', 'cwd': '/p', 'session_name': 'acme', 'model': {'id': 'claude-opus-5-5', 'display_name': 'Opus'}, 'effort': {'level': 'high'},
         'context_window': {'used_percentage': 42.4, 'context_window_size': 200000},
         'rate_limits': {'five_hour': {'used_percentage': 10}, 'seven_day': {'used_percentage': 30}}}


class Record(unittest.TestCase):
    # 상단 바 5시간·주간과 세션별 대화 % 는 이 파일들을 읽는다 — 예전엔 주인 개인 상태줄만 써서 새 사용자는 영영 안 떴다
    def test_사용량과_세션_컨텍스트를_데이터_폴더에(self):
        with tempfile.TemporaryDirectory() as d:
            sl.record(json.dumps(INPUT), d, now=1000)
            self.assertEqual(json.loads(pathlib.Path(d, 'statusline.json').read_text())['rate_limits']['five_hour']['used_percentage'], 10)
            ctx = json.loads(pathlib.Path(d, 'ctx/abc.json').read_text())
            self.assertEqual(ctx, {'sessionId': 'abc', 'used': 42.4, 'size': 200000, 'model': 'Opus', 'modelId': 'claude-opus-5-5', 'effort': 'high', 'name': 'acme', 'cwd': '/p', 'ts': 1000})

    def test_에포트가_없는_입력도_쓴다(self):
        # 옛 Claude Code 는 effort 를 안 준다 — 칩은 모델만 보여 주면 된다
        with tempfile.TemporaryDirectory() as d:
            sl.record(json.dumps({'session_id': 'z', 'model': {'display_name': 'Haiku'}}), d, now=5)
            ctx = json.loads(pathlib.Path(d, 'ctx/z.json').read_text())
            self.assertIsNone(ctx['effort'])
            self.assertIsNone(ctx['modelId'])

    def test_사용량이_없는_입력은_사용량_파일을_안_덮는다(self):
        # 세션이 아직 API 를 안 불렀으면 rate_limits 가 없다 — 다른 세션이 남긴 사용량을 지우면 상단 바가 비었다(아이맥 실측)
        with tempfile.TemporaryDirectory() as d:
            sl.record(json.dumps(INPUT), d, now=1)
            quiet = dict(INPUT, session_id='zzz'); quiet.pop('rate_limits')
            sl.record(json.dumps(quiet), d, now=2)
            self.assertIn('rate_limits', json.loads(pathlib.Path(d, 'statusline.json').read_text()))
            self.assertTrue(pathlib.Path(d, 'ctx/zzz.json').is_file())  # 세션별 대화 % 는 그대로 남긴다

    def test_깨진_입력이면_아무것도_안_쓴다(self):
        with tempfile.TemporaryDirectory() as d:
            sl.record('{nope', d, now=1)
            self.assertEqual(os.listdir(d), [])


class Chain(unittest.TestCase):
    def test_사용자_상태줄이_있으면_그걸_쓴다(self):
        with tempfile.TemporaryDirectory() as home:
            pathlib.Path(home, '.claude').mkdir()
            pathlib.Path(home, '.claude/settings.json').write_text(json.dumps({'statusLine': {'type': 'command', 'command': 'bash ~/my-line.sh'}}))
            self.assertEqual(sl.user_command(home), 'bash ~/my-line.sh')

    def test_우리_것이면_다시_부르지_않는다(self):
        with tempfile.TemporaryDirectory() as home:
            pathlib.Path(home, '.claude').mkdir()
            pathlib.Path(home, '.claude/settings.json').write_text(json.dumps({'statusLine': {'command': '/x/.chammo/tools/statusline'}}))
            self.assertIsNone(sl.user_command(home))
            pathlib.Path(home, '.claude/settings.json').write_text('{}')
            self.assertIsNone(sl.user_command(home))

    def test_사용자_것이_없으면_짧은_한_줄(self):
        # 저장소가 아니면 가지 없이 모델 · 노력 · 대화 %(60 아래는 흐리게)
        self.assertEqual(sl.plain(sl.fallback(INPUT, branch_of=lambda d: '')), 'Opus · high · 42%')

    def test_가지와_색(self):
        # 가지(고친 것 *, 올린 것 +)·쓴 % 60 노랑·80 빨강(2026-10-09 앱으로 옮김)
        hot = dict(INPUT, workspace={'current_dir': '/repo'}, context_window={'used_percentage': 81})
        seen = []
        line = sl.fallback(hot, branch_of=lambda d: seen.append(d) or 'main*')
        self.assertEqual(seen, ['/repo'])
        self.assertEqual(sl.plain(line), 'main* · Opus · high · 81%')
        self.assertIn('\x1b[31m81%', line)
        self.assertIn('\x1b[33m60%', sl.fallback(dict(INPUT, context_window={'used_percentage': 60}), branch_of=lambda d: ''))
        self.assertEqual(sl.plain(sl.fallback({'model': {'display_name': 'Haiku'}}, branch_of=lambda d: '')), 'Haiku')

    def test_가지_읽기(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(sl.branch(d), '')  # 저장소 아님
            git = lambda *a: __import__('subprocess').run(['git', '-C', d, *a], capture_output=True, check=True)
            git('init', '-q', '-b', 'feat'); git('config', 'user.email', 'a@b'); git('config', 'user.name', 'a')
            pathlib.Path(d, 'f').write_text('1'); git('add', 'f'); git('commit', '-qm', 'x')
            self.assertEqual(sl.branch(d), 'feat')
            pathlib.Path(d, 'f').write_text('2')
            self.assertEqual(sl.branch(d), 'feat*')
            git('add', 'f')
            self.assertEqual(sl.branch(d), 'feat+')


class Cheap(unittest.TestCase):
    """상태줄은 바쁜 세션마다 초에 몇 번 돈다(11-07 맥 전체 새 프로세스 초당 75개의 대부분) — 프로세스를 아낀다"""

    def run_script(self, path_dirs, stdin='{}', env=None):
        import subprocess
        e = {'PATH': ':'.join(path_dirs), 'HOME': env.pop('HOME') if env and 'HOME' in env else tempfile.gettempdir(), **(env or {})}
        return subprocess.run([str(SCRIPTS / 'statusline')], input=stdin, capture_output=True, text=True, env=e, timeout=30)

    def fake_shim(self, d, log):
        shims = pathlib.Path(d, '.pyenv/shims')
        shims.mkdir(parents=True)
        real = sys.executable
        shim = shims / 'python3'
        shim.write_text(f'#!/bin/sh\necho shim >> {log}\nexec {real} "$@"\n')
        shim.chmod(0o755)
        return str(shims)

    def real_dir(self, d):
        r = pathlib.Path(d, 'real')
        r.mkdir()
        (r / 'python3').symlink_to(sys.executable)
        return str(r)

    def test_pyenv_심을_건너뛰고_진짜_파이썬으로(self):
        # 심 한 번에 bash 20개·1초 — 진짜 파이썬이 PATH 에 있으면 그걸로
        with tempfile.TemporaryDirectory() as d:
            log = pathlib.Path(d, 'log')
            shims = self.fake_shim(d, log)
            r = self.run_script([shims, self.real_dir(d), '/usr/bin', '/bin'], env={'CHAMMO_HOME': d, 'HOME': d})
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertFalse(log.exists(), '심을 탔다')

    def test_심밖에_없으면_심으로(self):
        with tempfile.TemporaryDirectory() as d:
            log = pathlib.Path(d, 'log')
            r = self.run_script([self.fake_shim(d, log), '/bin'], env={'CHAMMO_HOME': d, 'HOME': d})
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertTrue(log.exists(), '심밖에 없으면 심으로')

    def test_사용자_상태줄은_원래_PATH_로_돈다(self):
        # 심을 뺀 PATH 가 사용자 명령까지 가면 그 사람 pyenv 파이썬이 바뀐다
        with tempfile.TemporaryDirectory() as d:
            home = pathlib.Path(d, 'home')
            (home / '.claude').mkdir(parents=True)
            (home / '.claude/settings.json').write_text(json.dumps({'statusLine': {'command': 'printf %s "$PATH"'}}))
            log = pathlib.Path(d, 'log')
            shims = self.fake_shim(d, log)
            r = self.run_script([shims, self.real_dir(d), '/usr/bin', '/bin'], stdin=json.dumps({'session_id': 'p1'}), env={'CHAMMO_HOME': str(pathlib.Path(d, 'data')), 'HOME': str(home)})
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertTrue(r.stdout.startswith(shims), r.stdout)

    def test_사용자_상태줄은_세션마다_10초에_한_번만_돌린다(self):
        calls = []
        def run(cmd, raw):
            calls.append(raw)
            return f'줄{len(calls)}'
        with tempfile.TemporaryDirectory() as d:
            raw = json.dumps({'session_id': 'c1'})
            self.assertEqual(sl.user_line('cmd', raw, d, run=run, now=100), '줄1')
            self.assertEqual(sl.user_line('cmd', raw, d, run=run, now=105), '줄1', '10초 안이면 지난 줄')
            self.assertEqual(sl.user_line('cmd', raw, d, run=run, now=111), '줄2', '지나면 새로')
            self.assertEqual(sl.user_line('cmd', json.dumps({'session_id': 'c2'}), d, run=run, now=111), '줄3', '세션마다 따로')
            self.assertEqual(sl.user_line('cmd', '{깨짐', d, run=run, now=111), '줄4', '세션을 모르면 늘 돌린다')
            self.assertEqual(len(calls), 4)

    def test_끝난_세션_줄은_하루_뒤_지워진다(self):
        with tempfile.TemporaryDirectory() as d:
            sl.user_line('cmd', json.dumps({'session_id': 'old'}), d, run=lambda c, r: 'x', now=1000)
            sl.user_line('cmd', json.dumps({'session_id': 'new'}), d, run=lambda c, r: 'y', now=64 * 2000)
            names = os.listdir(pathlib.Path(d, 'tmp/statusline'))
            self.assertEqual(names, ['new.txt'])

    def test_세션_번호에_경로가_섞여도_데이터_폴더_밖에_안_쓴다(self):
        with tempfile.TemporaryDirectory() as d:
            sl.user_line('cmd', json.dumps({'session_id': '../../밖'}), d, run=lambda c, r: 'x', now=1)
            self.assertFalse(pathlib.Path(d).parent.joinpath('밖').exists())

    def test_시작_때_subprocess_를_안_읽는다(self):
        # 파이썬 시작 비용의 큰 몫 — 사용자 명령을 돌릴 때만 읽는다
        src = (SCRIPTS / 'statusline').read_text()
        self.assertNotRegex(src.split('def data_dir')[0], r'import [^\n]*subprocess')


if __name__ == '__main__':
    unittest.main()
