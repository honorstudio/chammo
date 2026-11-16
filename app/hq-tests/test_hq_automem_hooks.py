"""알아서 기억 — 훅(세션 시작·매 지시·끝내기 전 영어 검사) 시험: python3 -m unittest discover -s app/hq-tests -p "test_hq_automem_hooks*" (지어낸 값만)"""
import contextlib, io, json, pathlib, sys, unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from test_hq_automem import World, automem


class Hooks(World):
    def setUp(self):
        super().setUp()
        self.root = pathlib.Path(self.tmp.name) / 'projects'

    def inp(self, sid, name=None, folder=None, extra=None):
        folder = folder or automem.launch_key(str(self.hq))
        d = self.root / folder
        d.mkdir(parents=True, exist_ok=True)
        tp = d / f'{sid}.jsonl'
        if name and not tp.exists():
            tp.write_text(json.dumps({'type': 'agent-name', 'agentName': name, 'sessionId': sid}, ensure_ascii=False) + '\n', encoding='utf-8')
        return {'session_id': sid, 'transcript_path': str(tp), 'cwd': str(self.hq), **(extra or {})}

    def run_hook(self, fn, inp):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = fn(self.d, inp)
        return code, out.getvalue()

    def say(self, inp, text):
        with open(inp['transcript_path'], 'a', encoding='utf-8') as f:
            f.write(json.dumps({'type': 'assistant', 'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': text}]}}, ensure_ascii=False) + '\n')


class Start(Hooks):
    def test_참모는_자기_칸과_공통만(self):
        automem.add(self.d, 'common', '답은 늘 한글로', lines=[])
        automem.add(self.d, 'orch:참모-2', '시안은 세 방향', lines=[])
        automem.add(self.d, 'orch:참모-3', '숫자는 표로', lines=[])
        _, out = self.run_hook(automem.hook_start, self.inp('s2', '참모-2 · 디자인'))
        self.assertIn('시안은 세 방향', out)
        self.assertIn('답은 늘 한글로', out)
        self.assertNotIn('숫자는 표로', out)
        self.assertIn(str(self.data / 'memory' / 'orch' / '참모-2'), out)

    def test_도우미는_공통만_프로젝트_세션은_아무것도(self):
        automem.add(self.d, 'common', '답은 늘 한글로', lines=[])
        automem.add(self.d, 'orch:참모-2', '시안은 세 방향', lines=[])
        _, out = self.run_hook(automem.hook_start, self.inp('h1', 'buy-domain'))
        self.assertIn('답은 늘 한글로', out)
        self.assertNotIn('시안은', out)
        _, out = self.run_hook(automem.hook_start, self.inp('p1', 'shop-app', folder=automem.launch_key(str(self.dev / 'shop-app'))))
        self.assertEqual(out.strip(), '')

    def test_같은_이름으로_새로_태어나면_옛_칸은_비킨다(self):
        automem.add(self.d, 'orch:참모-4', '옛 참모 규칙', lines=[])
        (self.data / 'orch-roles.json').write_text(json.dumps({'참모-4': {'role': '', 'born': 1}}))
        self.run_hook(automem.hook_start, self.inp('s4', '참모-4'))
        (self.data / 'orch-roles.json').write_text(json.dumps({'참모-4': {'role': '새 일', 'born': 99}}))
        _, out = self.run_hook(automem.hook_start, self.inp('s5', '참모-4'))
        self.assertNotIn('옛 참모 규칙', out)
        self.assertTrue(any(p.name.startswith('orch-참모-4') for p in (self.data / 'memory' / '_archive').iterdir()))


class Prompt(Hooks):
    def test_2단계_규칙만_매_지시에(self):
        a, _ = automem.add(self.d, 'common', '답은 늘 한글로', lines=[])
        automem.add(self.d, 'common', '아직 1단계', lines=[])
        _, out = self.run_hook(automem.hook_prompt, self.inp('s2', '참모-2'))
        self.assertEqual(out.strip(), '')
        automem.up(self.d, a['id'])
        _, out = self.run_hook(automem.hook_prompt, self.inp('s2', '참모-2'))
        self.assertIn('답은 늘 한글로', out)
        self.assertNotIn('아직 1단계', out)


class Stop(Hooks):
    def english_on(self):
        r, _ = automem.add(self.d, 'common', '답은 늘 한글로', lines=[])
        automem.set_level(self.d, r['id'], 3, check='english')

    def test_검사가_꺼져_있으면_통과(self):
        inp = self.inp('s2', '참모-2')
        self.say(inp, 'I answered above and sent the same answer out loud, waiting on whether to rewrite it.')
        self.assertEqual(self.run_hook(automem.hook_stop, inp)[1].strip(), '')

    def test_영어_문장이_섞이면_한_번_막는다(self):
        self.english_on()
        inp = self.inp('s2', '참모-2')
        self.say(inp, '정리했어.\nI answered above and sent the same answer out loud, waiting on whether to rewrite it.')
        out = json.loads(self.run_hook(automem.hook_stop, inp)[1])
        self.assertEqual(out['decision'], 'block')
        self.assertIn('한글', out['reason'])
        inp2 = dict(inp, stop_hook_active=True)
        self.assertEqual(self.run_hook(automem.hook_stop, inp2)[1].strip(), '')

    def test_코드_경로_오류_글은_영어가_아니다(self):
        self.english_on()
        inp = self.inp('s2', '참모-2')
        self.say(inp, '고쳤어 — `scripts/task done abc "fixed the build and it passes now on every machine"`\n'
                      '```\nTraceback (most recent call last): the file was not found in the given directory path\n```\n'
                      '오류: Error: ENOENT no such file or directory, open the config file in the home folder\n'
                      'https://example.com/docs/this-is-a-long-english-url-path-with-many-words-in-it')
        self.assertEqual(self.run_hook(automem.hook_stop, inp)[1].strip(), '')

    def test_영어_설정이면_검사_안_함(self):
        self.english_on()
        cfg = json.loads((self.data / 'config.json').read_text())
        (self.data / 'config.json').write_text(json.dumps({**cfg, 'language': 'en'}))
        inp = self.inp('s2', '참모-2')
        self.say(inp, 'I answered above and sent the same answer out loud, waiting on whether to rewrite it.')
        self.assertEqual(self.run_hook(automem.hook_stop, inp)[1].strip(), '')

    def test_영어_찾기(self):
        self.assertTrue(automem.english_leak('This is the whole reply and it is written in English for you.'))
        self.assertFalse(automem.english_leak('PR #12 머지했어(CI green, tests passed).'))
        self.assertFalse(automem.english_leak('| name | status |\n| shop-app | done and merged into the main branch today |'))


class VoiceHint(Hooks):
    """매 지시 훅(voice-hint)이 2단계 규칙 줄을 붙인다 — 없으면 파이썬을 안 띄운다(셸 grep 빠른 길)"""
    def hint(self, inp):
        import os, subprocess
        from test_hq_automem import TPL
        env = {k: v for k, v in os.environ.items() if k not in ('CHAMMO_ORCH_LEGACY', 'CHAMMO_HQ', 'HONOR_ORCH_CWD')}
        env.update(CHAMMO_HOME=self.d, HOME=self.d, PATH='/usr/bin:/bin')
        return subprocess.run(['sh', str(TPL / 'voice-hint')], input=json.dumps(inp), capture_output=True, text=True, env=env, timeout=30).stdout

    def test_2단계_규칙이_매_지시에_붙는다(self):
        r, _ = automem.add(self.d, 'common', '답은 늘 한글로', lines=[])
        inp = self.inp('s2', '참모-2', extra={'prompt': 'x'})
        self.assertNotIn('답은 늘 한글로', self.hint(inp))
        automem.up(self.d, r['id'])
        self.assertIn('답은 늘 한글로', self.hint(inp))


if __name__ == '__main__':
    unittest.main()
