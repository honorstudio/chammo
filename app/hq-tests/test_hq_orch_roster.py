"""HQ 템플릿 scripts/orch-roster(참모 이름표 훅) 테스트: python3 -m unittest discover -s app/hq-tests"""
import datetime, importlib.machinery, importlib.util, json, pathlib, sys, unittest

sys.dont_write_bytecode = True

SCRIPTS = pathlib.Path(__file__).resolve().parent.parent / 'hq-template' / 'scripts'
loader = importlib.machinery.SourceFileLoader('hq_orch_roster', str(SCRIPTS / 'orch-roster'))
roster = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(roster)

NOW = datetime.datetime(2026, 10, 4, 12, 0, tzinfo=datetime.timezone.utc)
ago = lambda h: (NOW - datetime.timedelta(hours=h)).isoformat(timespec='seconds')
CFG = {'assistantName': '참모', 'language': 'ko', 'devRoot': '/d/dev', 'hqDir': '/d/hq'}
AGENTS = [
    {'id': 'aaaa0001', 'sessionId': 'sid-1', 'name': '참모 · 뽀삐', 'cwd': '/d/hq'},
    {'id': 'bbbb0002', 'sessionId': 'sid-2', 'name': '참모-2 · 두부', 'cwd': '/d/hq'},
    {'id': 'cccc0003', 'sessionId': 'sid-3', 'name': '참모-3', 'cwd': '/d/hq'},
    {'id': 'dddd0004', 'sessionId': 'sid-4', 'name': 'alpha-shop', 'cwd': '/d/dev/alpha-shop'},
    {'id': 'eeee0005', 'sessionId': 'sid-5', 'name': 'fix-cart', 'cwd': '/d/dev/gamma-app/.claude/worktrees/fix-cart'},
    {'id': 'ffff0006', 'sessionId': 'sid-6', 'name': '참모-9', 'cwd': '/elsewhere'},  # 다른 폴더 — 참모 아님
]


def send(task, target, frm, h, **more):
    return {'ts': ago(h), 'type': 'send', 'task': task, 'target': target, 'from': frm, **more}


class Roster(unittest.TestCase):
    def build(self, me='sid-1', roles=None, events=(), agents=AGENTS, cfg=CFG):
        return roster.build(me, agents, roles or {}, list(events), cfg, NOW)

    def test_맡은_일과_최근_기록을_싣고_넘기기_규칙(self):
        roles = {'참모-2': {'role': '예약·반복 일', 'at': 1}}
        events = [send('t1', 'alpha-shop', 'cccc0003', 5), send('t2', 'fix-cart', 'cccc0003', 3), send('t3', 'alpha-shop', 'cccc0003', 1)]
        out = self.build(roles=roles, events=events)
        self.assertIn('너 = 참모 · 뽀삐', out)
        self.assertIn('참모-2 · 두부 — 맡은 일: 예약·반복 일', out)
        self.assertIn('참모-3 — 최근 7일: 주로 alpha-shop·gamma-app', out)
        self.assertIn('넘기고', out)
        self.assertNotIn('참모-9', out)  # HQ 밖 세션은 참모가 아니다

    def test_내_맡은_일도_싣는다(self):
        out = self.build(roles={'참모': {'role': '쇼핑몰 개발 — 앱 코드는 안 맡음', 'at': 1}})
        self.assertIn('너 = 참모 · 뽀삐 — 맡은 일: 쇼핑몰 개발 — 앱 코드는 안 맡음', out)

    def test_사람이_적은_게_먼저_추론은_뒤에_참고로(self):
        roles = {'참모-3': {'role': '디자인', 'at': 1}}
        out = self.build(roles=roles, events=[send('t1', 'alpha-shop', 'cccc0003', 2)])
        self.assertIn('참모-3 — 맡은 일: 디자인(최근 7일: 주로 alpha-shop)', out)

    def test_아무_정보_없으면_넘기기_규칙은_안_붙인다(self):
        out = self.build()
        self.assertIn('다른 참모:', out)
        self.assertNotIn('넘기고', out)

    def test_참모가_나_하나뿐이고_맡은_일도_없으면_아무것도_안_찍는다(self):
        self.assertEqual(self.build(agents=AGENTS[:1]), '')
        self.assertIn('맡은 일: 개발', self.build(agents=AGENTS[:1], roles={'참모': {'role': '개발', 'at': 1}}))

    def test_추론에서_빼는_것(self):
        events = [
            send('t1', '참모-2 · 두부', 'cccc0003', 2),                    # 참모끼리 넘김
            send('t2', 'alpha-shop', 'cccc0003', 8 * 24),                   # 7일 넘음
            {'ts': ago(1), 'type': 'send', 'task': 't3', 'target': 'alpha-shop'},  # 주인 모름
            send('t4', '사라진-세션', 'cccc0003', 1),                         # 프로젝트 모름
        ]
        self.assertNotIn('최근 7일', self.build(events=events))

    def test_fromName_project_와_own_을_따른다(self):
        events = [send('t1', '사라진-세션', 'old00001', 3, fromName='참모-3', project='delta-api'),
                  send('t2', 'alpha-shop', 'aaaa0001', 2), {'ts': ago(1), 'type': 'own', 'task': 't2', 'from': 'cccc0003'}]
        out = self.build(events=events)
        self.assertIn('참모-3 — 최근 7일: 주로 alpha-shop·delta-api', out)

    def test_번호를_다시_쓴_새_참모는_태어나기_전_기록을_안_센다(self):
        roles = {'참모-3': {'role': '', 'at': 1, 'born': (NOW - datetime.timedelta(hours=10)).timestamp() * 1000}}
        events = [send('t1', 'alpha-shop', 'old00001', 30, fromName='참모-3'), send('t2', 'fix-cart', 'cccc0003', 2)]
        out = self.build(roles=roles, events=events)
        self.assertIn('참모-3 — 최근 7일: 주로 gamma-app', out)
        self.assertNotIn('alpha-shop·', out)

    def test_HQ_도우미에게_보낸_일은_프로젝트가_아니다(self):
        cfg = {**CFG, 'devRoot': '/d', 'hqDir': '/d/hq'}  # HQ 가 dev 루트 안
        agents = AGENTS + [{'id': 'hhhh0007', 'sessionId': 'sid-7', 'name': 'sns-post', 'cwd': '/d/hq'}]
        out = self.build(agents=agents, cfg=cfg, events=[send('t1', 'sns-post', 'cccc0003', 1, project='hq')])
        self.assertNotIn('최근 7일', out)

    def test_이상한_기록에도_죽지_않는다(self):
        events = [{'ts': '2026-10-04T11:00:00', 'type': 'send', 'task': 't1', 'target': 'alpha-shop', 'from': 'cccc0003'},  # 시간대 없음
                  ['줄이', '배열'], {'type': 'send'}, {'ts': 5, 'type': 'send', 'task': 't2', 'target': 'x', 'from': 'cccc0003'}]
        out = self.build(events=events, roles={'참모-2': '글자만', '참모-3': {'role': 7}})
        self.assertIn('참모-3 — 최근 7일: 주로 alpha-shop', out)

    def test_조사는_이름_받침대로(self):
        self.assertEqual((roster.ga('참모'), roster.ga('비서실장'), roster.ga('Chammo')), ('가', '이', '가'))
        cfg = {**CFG, 'assistantName': '비서실장'}
        agents = [{**a, 'name': a['name'].replace('참모', '비서실장')} for a in AGENTS]
        out = self.build(agents=agents, cfg=cfg, roles={'비서실장-2': {'role': '예약', 'at': 1}})
        self.assertIn('맞는 비서실장이 없거나', out)

    def test_영어(self):
        cfg = {**CFG, 'language': 'en', 'assistantName': 'Chammo'}
        agents = [{**a, 'name': a['name'].replace('참모', 'Chammo')} for a in AGENTS]
        out = self.build(agents=agents, cfg=cfg, roles={'Chammo-2': {'role': 'Schedules', 'at': 1}})
        self.assertIn('You = Chammo · 뽀삐', out)
        self.assertIn('Chammo-2 · 두부 — handles: Schedules', out)
        self.assertIn('hand it to', out)

    def test_설정_이름으로_참모를_가른다(self):
        cfg = {**CFG, 'assistantName': '비서'}
        agents = [{'id': 'a1', 'sessionId': 's1', 'name': '비서-2 · 개발', 'cwd': '/d/hq'}, {'id': 'a2', 'sessionId': 's2', 'name': '비서-5', 'cwd': '/d/hq'}]
        out = self.build(me='s1', agents=agents, cfg=cfg, roles={'비서-5': {'role': '예약', 'at': 1}})
        self.assertIn('비서-5 — 맡은 일: 예약', out)


class LiveFallback(unittest.TestCase):
    def test_claude_agents_가_늦으면_앱_세션_목록으로(self):
        import json, os, tempfile, subprocess as sp
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, 'live.json'), 'w', encoding='utf-8') as f:
                json.dump({'daemon': 1, 'sessions': [{'id': 'aaaa0001', 'sessionId': 'sid-1', 'name': '참모 · 뽀삐', 'cwd': '/d/hq'}]}, f)
            old = roster.subprocess.run
            def slow(*a, **k):
                raise sp.TimeoutExpired('claude', 4)
            roster.subprocess.run = slow
            try:
                self.assertEqual([x['name'] for x in roster.live_agents(d)], ['참모 · 뽀삐'])
            finally:
                roster.subprocess.run = old
            os.remove(os.path.join(d, 'live.json'))
            roster.subprocess.run = slow
            try:
                self.assertEqual(roster.live_agents(d), [])
            finally:
                roster.subprocess.run = old


DOMAIN = pathlib.Path(__file__).resolve().parent.parent / 'src' / 'domain'


class SameRulesAsApp(unittest.TestCase):
    """앱(TS)과 같은 표 — 맡은 일 추론(orchRoles.fixture.json)·경로 같은가(paths.fixture.json). 한쪽만 고치면 여기서 깨진다"""

    def test_맡은_일_추론은_앱_inferRoles_와_같은_표(self):
        fx = json.loads((DOMAIN / 'orchRoles.fixture.json').read_text(encoding='utf-8'))
        now = datetime.datetime.fromisoformat(fx['now'].replace('Z', '+00:00'))
        for c in fx['cases']:
            with self.subTest(c['name']):
                cfg = {'assistantName': '참모', **c['config']}
                self.assertEqual(roster.guess(c['agents'], c.get('roles', {}), c['events'], cfg, now), c['want'])

    def test_작업_기록_프로젝트는_같은_규칙(self):
        """scripts/task project_of(기록의 project 칸) — 공개판·참모판 둘 다 orch-roster(=앱 classifyWorkspace) 규칙과 같게.
        예전엔 realpath·relpath 로 따로 해서 추가 폴더 저장소의 워크트리·devRoot 밖·윈도우 대소문자에서 어긋났다(2026-10-04 orch-roles ①)"""
        fx = json.loads((DOMAIN / 'orchRoles.fixture.json').read_text(encoding='utf-8'))
        extra = [
            {'id': 'w1', 'name': 'wt', 'cwd': '/u/automation/.claude/worktrees/fix-a/project-x/src'},
            {'id': 'w2', 'name': 'win', 'cwd': 'C:/Users/me/DEV/shop/.claude/worktrees/x'},
            {'id': 'w3', 'name': 'out', 'cwd': '/u/other/tool'},
        ]
        cases = [(c['config']['devRoot'], c['config'].get('extraProjects', []), c['agents']) for c in fx['cases']]
        cases += [('/u/dev', ['/u/automation/project-x'], extra), ('C:/Users/me/dev', [], extra)]
        for path in (SCRIPTS / 'task', SCRIPTS.parent.parent.parent / 'scripts' / 'task'):
            if not path.exists():
                continue  # 공개본엔 주인판 scripts/task 가 없다
            ld = importlib.machinery.SourceFileLoader(f'task_{path.parent.parent.name}', str(path))
            mod = importlib.util.module_from_spec(importlib.util.spec_from_loader(ld.name, ld))
            ld.exec_module(mod)
            for dev, extras, agents in cases:
                for a in agents:
                    with self.subTest(f'{path} {a["cwd"]}'):
                        self.assertEqual(mod.project_of(a['id'], agents, dev, extras), roster.project_of(a['cwd'], dev, extras))

    def test_경로_같은가는_앱_samePath_와_같은_표(self):
        fx = json.loads((DOMAIN / 'paths.fixture.json').read_text(encoding='utf-8'))
        for a, b, same in fx['cases']:
            with self.subTest(f'{a} ~ {b}'):
                self.assertEqual(roster.same_dir(a, b), same)
                self.assertEqual(roster.same_dir(b, a), same)


if __name__ == '__main__':
    unittest.main()
