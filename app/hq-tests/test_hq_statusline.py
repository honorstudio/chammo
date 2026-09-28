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
INPUT = {'session_id': 'abc', 'cwd': '/p', 'session_name': 'acme', 'model': {'display_name': 'Opus'},
         'context_window': {'used_percentage': 42.4, 'context_window_size': 200000},
         'rate_limits': {'five_hour': {'used_percentage': 10}, 'seven_day': {'used_percentage': 30}}}


class Record(unittest.TestCase):
    # 상단 바 5시간·주간과 세션별 대화 % 는 이 파일들을 읽는다 — 예전엔 주인 개인 상태줄만 써서 새 사용자는 영영 안 떴다
    def test_사용량과_세션_컨텍스트를_데이터_폴더에(self):
        with tempfile.TemporaryDirectory() as d:
            sl.record(json.dumps(INPUT), d, now=1000)
            self.assertEqual(json.loads(pathlib.Path(d, 'statusline.json').read_text())['rate_limits']['five_hour']['used_percentage'], 10)
            ctx = json.loads(pathlib.Path(d, 'ctx/abc.json').read_text())
            self.assertEqual(ctx, {'sessionId': 'abc', 'used': 42.4, 'size': 200000, 'model': 'Opus', 'name': 'acme', 'cwd': '/p', 'ts': 1000})

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
        self.assertEqual(sl.fallback(INPUT), 'Opus · 42%')


if __name__ == '__main__':
    unittest.main()
