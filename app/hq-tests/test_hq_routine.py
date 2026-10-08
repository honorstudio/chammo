"""HQ 템플릿 scripts/routine 테스트: python3 -m unittest discover -s app/hq-tests"""
import contextlib, datetime, importlib.machinery, importlib.util, io, json, os, pathlib, sys, tempfile, unittest, unittest.mock

sys.dont_write_bytecode = True
SCRIPTS = pathlib.Path(__file__).resolve().parent.parent / 'hq-template' / 'scripts'


def load(name):
    loader = importlib.machinery.SourceFileLoader(f'hq_{name}', str(SCRIPTS / name))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


rt = load('routine')
_HOME = None


def setUpModule():
    # home 을 안 넘긴 run_now 가 진짜 ~/.claude.json 을 건드리지 않게 — HOME 을 임시 폴더로
    global _HOME
    _HOME = tempfile.TemporaryDirectory()
    unittest.mock.patch.dict(os.environ, {'HOME': _HOME.name}).start()


def tearDownModule():
    unittest.mock.patch.stopall()
    _HOME.cleanup()


class Calls:
    """launchctl·claude 를 부른 기록 — 진짜로 부르지 않는다"""
    def __init__(self, agents='[]', spawn_out='backgrounded · 1a2b3c4d · routine-x\n'):
        self.calls, self.agents, self.spawn_out = [], agents, spawn_out

    def __call__(self, argv, **kw):
        self.calls.append(argv)
        out = ''
        if argv[1:3] == ['agents', '--json']:
            out = self.agents
        elif '--bg' in argv:
            out = self.spawn_out
        return type('R', (), {'returncode': 0, 'stdout': out, 'stderr': ''})()


class Schedule(unittest.TestCase):
    def test_영어와_한국어(self):
        self.assertEqual(rt.parse_schedule('daily 09:00'), {'StartCalendarInterval': {'Hour': 9, 'Minute': 0}})
        self.assertEqual(rt.parse_schedule('매일 7:30'), {'StartCalendarInterval': {'Hour': 7, 'Minute': 30}})
        self.assertEqual(rt.parse_schedule('weekdays 18:05')['StartCalendarInterval'][0], {'Weekday': 1, 'Hour': 18, 'Minute': 5})
        self.assertEqual(len(rt.parse_schedule('평일 18:05')['StartCalendarInterval']), 5)
        self.assertEqual(rt.parse_schedule('weekly sun 10:00'), {'StartCalendarInterval': {'Weekday': 0, 'Hour': 10, 'Minute': 0}})
        self.assertEqual(rt.parse_schedule('매주 월 10:00'), {'StartCalendarInterval': {'Weekday': 1, 'Hour': 10, 'Minute': 0}})
        self.assertEqual(rt.parse_schedule('every 30m'), {'StartInterval': 1800})
        self.assertEqual(rt.parse_schedule('2시간마다'), {'StartInterval': 7200})
        self.assertEqual(rt.parse_schedule('30분마다'), {'StartInterval': 1800})

    def test_틀린_일정은_거절(self):
        for bad in ['', 'sometimes', 'daily 25:00', 'every 0m', 'weekly xyz 10:00', '매일']:
            with self.assertRaises(ValueError, msg=bad):
                rt.parse_schedule(bad)

    def test_다음_실행_시각(self):
        now = datetime.datetime(2026, 9, 28, 15, 0)  # 월요일
        self.assertEqual(rt.next_run('daily 09:00', now), datetime.datetime(2026, 9, 29, 9, 0))
        self.assertEqual(rt.next_run('daily 16:00', now), datetime.datetime(2026, 9, 28, 16, 0))
        self.assertEqual(rt.next_run('weekly sun 10:00', now), datetime.datetime(2026, 10, 4, 10, 0))
        self.assertEqual(rt.next_run('weekdays 09:00', datetime.datetime(2026, 10, 2, 10, 0)), datetime.datetime(2026, 10, 5, 9, 0))  # 금 → 월
        self.assertEqual(rt.next_run('every 2h', now, last=datetime.datetime(2026, 9, 28, 14, 0)), datetime.datetime(2026, 9, 28, 16, 0))


class Lifecycle(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.tmp.name)
        self.home, self.data = root, root / 'data'
        self.data.mkdir()
        (root / '.claude.json').write_text(json.dumps({'projects': {}}))

    def tearDown(self):
        self.tmp.cleanup()

    def new(self, calls, name='blog-daily', sched='daily 09:00', what='Write and publish one blog post.', cwd=None):
        return rt.new(name, sched, what, cwd=cwd, data=str(self.data), home=str(self.home), run=calls, claude='/bin/claude', python='/usr/bin/python3', uid=501, apps=[], allow_test=True)

    def test_만들면_지침서_설정_launchd_가_생긴다(self):
        calls = Calls()
        out = self.new(calls)
        d = self.data / 'routines/blog-daily'
        self.assertIn('Write and publish one blog post.', (d / 'ROUTINE.md').read_text())
        cfg = json.loads((d / 'routine.json').read_text())
        self.assertEqual((cfg['schedule'], cfg['enabled'], cfg['cwd']), ('daily 09:00', True, str(d)))
        plist = pathlib.Path(out['plist'])
        self.assertTrue(plist.is_file())
        self.assertIn(b'app.chammo.routines.data', plist.read_bytes())  # 예약마다가 아니라 tick 하나
        self.assertIn(['launchctl', 'bootstrap', 'gui/501', str(plist)], calls.calls)
        # 루틴 폴더는 claude --bg 가 뜰 수 있게 믿음으로
        self.assertTrue(json.loads((self.home / '.claude.json').read_text())['projects'][str(d)]['hasTrustDialogAccepted'])

    def test_이름·일정이_틀리면_아무것도_안_만든다(self):
        for name, sched in [('Blog Daily', 'daily 09:00'), ('blog', 'whenever')]:
            with self.assertRaises(ValueError):
                self.new(Calls(), name=name, sched=sched)
        self.assertFalse((self.data / 'routines').exists())

    def test_실행하면_세션을_띄우고_기록한다(self):
        self.new(Calls())
        calls = Calls()
        r = rt.run_now('blog-daily', data=str(self.data), run=calls)
        self.assertEqual(r['session'], '1a2b3c4d')
        spawn = [c for c in calls.calls if '--bg' in c][0]
        self.assertEqual(spawn[:2], ['/bin/claude', '--bg'])
        self.assertIn('routine-blog-daily', spawn)
        self.assertIn('ROUTINE.md', spawn[-1])
        self.assertIn('report blog-daily', spawn[-1])
        runs = [json.loads(l) for l in (self.data / 'routines/blog-daily/runs.jsonl').read_text().splitlines()]
        self.assertEqual((runs[-1]['event'], runs[-1]['session']), ('start', '1a2b3c4d'))

    def test_지난_실행이_아직_돌면_건너뛴다(self):
        self.new(Calls())
        busy = json.dumps([{'id': 'old1', 'name': 'routine-blog-daily', 'status': 'busy'}])
        calls = Calls(agents=busy)
        r = rt.run_now('blog-daily', data=str(self.data), run=calls)
        self.assertEqual(r['skipped'], 'still running')
        self.assertFalse(any('--bg' in c for c in calls.calls))

    def test_끝난_지난_세션은_치우고_새로(self):
        self.new(Calls())
        idle = json.dumps([{'id': 'old1', 'name': 'routine-blog-daily', 'status': 'idle'}])
        calls = Calls(agents=idle)
        rt.run_now('blog-daily', data=str(self.data), run=calls)
        self.assertIn(['/bin/claude', 'rm', 'old1'], calls.calls)

    def test_꺼둔_루틴은_실행_안_함(self):
        self.new(Calls())
        rt.set_enabled('blog-daily', False, data=str(self.data), home=str(self.home), run=Calls(), uid=501)
        calls = Calls()
        r = rt.run_now('blog-daily', data=str(self.data), run=calls, scheduled=True)
        self.assertEqual(r['skipped'], 'paused')
        # 사람이 "지금 실행"을 누르면 꺼 둬도 돈다
        self.assertEqual(rt.run_now('blog-daily', data=str(self.data), run=Calls())['session'], '1a2b3c4d')

    def test_보고와_목록(self):
        self.new(Calls())
        rt.run_now('blog-daily', data=str(self.data), run=Calls())
        rt.report('blog-daily', 'fail', 'login expired', data=str(self.data))
        lst = rt.list_routines(data=str(self.data), now=datetime.datetime(2026, 9, 28, 15, 0))
        self.assertEqual(len(lst), 1)
        r = lst[0]
        self.assertEqual((r['name'], r['enabled'], r['last']['result'], r['last']['note']), ('blog-daily', True, 'fail', 'login expired'))
        self.assertEqual(r['next'], '2026-09-29T09:00')

    def test_지우면_launchd_도_내린다(self):
        calls = Calls()
        out = self.new(calls)
        rt.remove('blog-daily', data=str(self.data), home=str(self.home), run=calls, uid=501)
        self.assertIn(['launchctl', 'bootout', 'gui/501/app.chammo.routine.blog-daily'], calls.calls)  # 옛 항목이 남아 있었어도
        self.assertFalse(pathlib.Path(rt._plist_path('blog-daily', str(self.home))).exists())
        self.assertFalse((self.data / 'routines/blog-daily').exists())


class SpawnTrust(unittest.TestCase):
    """띄우기 직전에 루틴 폴더 믿음을 다시 본다 — 떠 있던 claude 가 ~/.claude.json 을 제 메모리 값으로 덮어 False 로 돌려놓는다(2026-10-05 예약 하나가 시작부터 실패)"""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.tmp.name)
        self.home, self.data = root, root / 'data'
        self.data.mkdir()
        self.cj = root / '.claude.json'
        self.cj.write_text(json.dumps({'projects': {}}))
        rt.new('k-check', 'daily 09:00', 'Check.', data=str(self.data), home=str(self.home), run=Calls(), claude='/bin/claude',
               python='/usr/bin/python3', uid=501, apps=[], allow_test=True)
        self.d = str(self.data / 'routines/k-check')

    def tearDown(self):
        self.tmp.cleanup()

    def clobber(self):
        """claude 가 덮어쓴 모양 — 키는 있고 False, 다른 칸·다른 최상위 값은 살아 있어야 한다"""
        cfg = json.loads(self.cj.read_text())
        cfg['projects'][self.d] = {'hasTrustDialogAccepted': False, 'allowedTools': []}
        cfg['userID'] = 'keep-me'
        self.cj.write_text(json.dumps(cfg))

    def trust(self):
        return json.loads(self.cj.read_text())['projects'].get(self.d, {}).get('hasTrustDialogAccepted')

    def runs(self):
        return [json.loads(l) for l in (self.data / 'routines/k-check/runs.jsonl').read_text().splitlines()]

    def test_지워진_믿음은_띄우기_전에_다시_적는다(self):
        self.clobber()
        calls = Calls()
        r = rt.run_now('k-check', data=str(self.data), run=calls, home=str(self.home))
        self.assertEqual(r['session'], '1a2b3c4d')
        self.assertIs(self.trust(), True)
        cfg = json.loads(self.cj.read_text())
        self.assertEqual((cfg['userID'], cfg['projects'][self.d]['allowedTools']), ('keep-me', []))  # 한 키만 바꾼다
        self.assertFalse(any(n.startswith('.claude.json.') for n in os.listdir(self.home)))  # 임시 파일이 안 남는다

    def test_키가_없어도_적는다(self):
        self.cj.write_text(json.dumps({'projects': {}}))
        rt.run_now('k-check', data=str(self.data), run=Calls(), home=str(self.home))
        self.assertIs(self.trust(), True)

    def test_이미_믿으면_파일을_안_쓴다(self):
        before = self.cj.read_bytes()
        os.utime(self.cj, (1_000_000, 1_000_000))
        rt.run_now('k-check', data=str(self.data), run=Calls(), home=str(self.home))
        self.assertEqual((self.cj.read_bytes(), self.cj.stat().st_mtime), (before, 1_000_000))

    def test_파일_권한을_지킨다(self):
        self.clobber()
        os.chmod(self.cj, 0o600)
        rt.run_now('k-check', data=str(self.data), run=Calls(), home=str(self.home))
        self.assertEqual(self.cj.stat().st_mode & 0o777, 0o600)

    def test_tick_도_띄우기_전에_믿음을_본다(self):
        rt._tick_mark('k-check', str(self.data), datetime.datetime(2026, 10, 5, 8, 0))
        self.clobber()
        out = rt.tick(data=str(self.data), now=datetime.datetime(2026, 10, 5, 9, 0), run=Calls(), home=str(self.home), uid=501)
        self.assertEqual(out[0]['session'], '1a2b3c4d')
        self.assertIs(self.trust(), True)

    def test_프로젝트_폴더는_믿음을_안_적는다(self):
        # --in 폴더는 사람이 고른 곳 — 믿음은 아래 폴더로 번지니 ~ 같은 넓은 폴더를 조용히 믿지 않는다
        proj = self.home / 'proj'
        proj.mkdir()
        rt.new('in-proj', 'daily 09:00', 'x', cwd=str(proj), data=str(self.data), home=str(self.home), run=Calls(), claude='/bin/claude',
               python='/usr/bin/python3', uid=501, apps=[], allow_test=True)
        rt.run_now('in-proj', data=str(self.data), run=Calls(), home=str(self.home))
        self.assertNotIn(str(proj), json.loads(self.cj.read_text())['projects'])

    def test_믿음_실패로_죽으면_다시_적고_한_번만_다시(self):
        test = self

        class Untrusted(Calls):
            def __init__(self, fails):
                super().__init__()
                self.fails = fails

            def __call__(self, argv, **kw):
                if '--bg' in argv and self.fails:
                    self.fails -= 1
                    self.calls.append(argv)
                    test.clobber()  # 띄우는 사이에 또 덮였다
                    return type('R', (), {'returncode': 1, 'stdout': '',
                                          'stderr': f'Workspace not trusted. Run `claude` in {test.d} once and accept the trust prompt'})()
                return super().__call__(argv, **kw)

        calls = Untrusted(1)
        r = rt.run_now('k-check', data=str(self.data), run=calls, home=str(self.home))
        self.assertEqual(r['session'], '1a2b3c4d')
        self.assertEqual(len([c for c in calls.calls if '--bg' in c]), 2)
        self.assertIs(self.trust(), True)
        runs = self.runs()
        self.assertEqual([e['event'] for e in runs], ['retry', 'start'])
        self.assertIn('not trusted', runs[0]['reason'])
        self.assertEqual(runs[1]['session'], '1a2b3c4d')
        # 두 번 다 실패하면 세 번째는 안 하고 오류를 남긴다
        calls = Untrusted(5)
        r = rt.run_now('k-check', data=str(self.data), run=calls, home=str(self.home))
        self.assertIsNone(r['session'])
        self.assertEqual(len([c for c in calls.calls if '--bg' in c]), 2)
        self.assertIn('Workspace not trusted', self.runs()[-1]['error'])

    def test_다른_오류는_다시_안_한다(self):
        calls = Calls(spawn_out='error: low max file descriptors\n')
        r = rt.run_now('k-check', data=str(self.data), run=calls, home=str(self.home))
        self.assertIsNone(r['session'])
        self.assertEqual(len([c for c in calls.calls if '--bg' in c]), 1)


class SpawnStagger(unittest.TestCase):
    """같은 tick 에 때가 된 예약 여럿은 차례로, 사이를 띄워 띄운다. 시작이 일시 오류로 죽으면 잠깐 쉬고 한 번 더
    (2026-10-06 09:00 예약 둘이 'An unknown error occurred (Unexpected)' 로 둘 다 시작 실패 — 26분 뒤 손으로 돌리니 둘 다 됐다)"""
    UNEXPECTED = 'error: An unknown error occurred (Unexpected)\n'
    NOW = datetime.datetime(2026, 10, 6, 8, 0)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.tmp.name)
        self.home, self.data = root, root / 'data'
        self.data.mkdir()
        (root / '.claude.json').write_text(json.dumps({'projects': {}}))
        self.slept = []

    def tearDown(self):
        self.tmp.cleanup()

    def new(self, name, sched='daily 09:00', cwd=None):
        rt.new(name, sched, 'x', cwd=cwd, data=str(self.data), home=str(self.home), run=Calls(), claude='/bin/claude',
               python='/usr/bin/python3', uid=501, now=self.NOW, apps=[], allow_test=True)

    def sleep(self, s):
        self.slept.append(s)

    def tick(self, calls, now=datetime.datetime(2026, 10, 6, 9, 0, 8)):
        return rt.tick(data=str(self.data), now=now, run=calls, home=str(self.home), uid=501, sleep=self.sleep)

    def run_now(self, name, calls):
        return rt.run_now(name, data=str(self.data), run=calls, home=str(self.home), sleep=self.sleep)

    def runs(self, name):
        return [json.loads(l) for l in (self.data / f'routines/{name}/runs.jsonl').read_text().splitlines()]

    @staticmethod
    def spawns(calls):
        return [c[c.index('-n') + 1] for c in calls.calls if '--bg' in c]

    class Flaky(Calls):
        """--bg 를 차례대로 outs 의 답으로 — None 이면 성공. 실패할 때 세션이 생겼으면(made) agents 에 보인다"""
        def __init__(self, outs, made=False):
            super().__init__()
            self.outs, self.made, self.live = list(outs), made, []

        def __call__(self, argv, **kw):
            if argv[1:3] == ['agents', '--json']:
                self.calls.append(argv)
                return type('R', (), {'returncode': 0, 'stdout': json.dumps(self.live), 'stderr': ''})()
            if '--bg' in argv and self.outs:
                out = self.outs.pop(0)
                if out is not None:
                    self.calls.append(argv)
                    if self.made:
                        self.live.append({'id': 'feedface', 'name': argv[argv.index('-n') + 1], 'status': 'busy'})
                    return type('R', (), {'returncode': 1, 'stdout': '', 'stderr': out})()
            return super().__call__(argv, **kw)

    def test_같은_tick_두_예약은_차례로_사이를_띄운다(self):
        self.new('nightly-check')
        self.new('weekly-cleanup', sched='10/06 09:00, 10/13 09:00')
        rt._tick_mark('nightly-check', str(self.data), self.NOW)
        rt._tick_mark('weekly-cleanup', str(self.data), self.NOW)
        calls = Calls()
        out = self.tick(calls)
        self.assertEqual([(r['name'], r.get('session')) for r in out], [('nightly-check', '1a2b3c4d'), ('weekly-cleanup', '1a2b3c4d')])
        self.assertEqual(self.spawns(calls), ['routine-nightly-check', 'routine-weekly-cleanup'])
        self.assertEqual(self.slept, [rt.SPAWN_GAP])  # 두 번 띄우는 사이에 한 번 — 첫 예약 앞엔 안 쉰다

    def test_세_예약이면_간격_두_번_혼자면_안_쉰다(self):
        for n in ('a', 'b', 'c'):
            self.new(n)
            rt._tick_mark(n, str(self.data), self.NOW)
        self.tick(Calls())
        self.assertEqual(self.slept, [rt.SPAWN_GAP] * 2)
        self.slept.clear()
        self.tick(Calls(), now=datetime.datetime(2026, 10, 7, 9, 0))
        self.assertEqual(len(self.slept), 2)
        self.new('solo', sched='daily 07:30')
        rt._tick_mark('solo', str(self.data), datetime.datetime(2026, 10, 7, 9, 1))
        self.slept.clear()
        self.tick(Calls(), now=datetime.datetime(2026, 10, 8, 7, 30))
        self.assertEqual(self.slept, [])

    def test_안_띄운_예약은_간격을_쓰지_않는다(self):
        # 지난 실행이 아직 도는 예약은 건너뛴다 — 그 앞뒤로 쉴 까닭이 없다
        for n in ('a', 'b', 'c'):
            self.new(n)
            rt._tick_mark(n, str(self.data), self.NOW)
        calls = Calls(agents=json.dumps([{'id': 'x1', 'name': 'routine-a', 'status': 'busy'}]))
        out = self.tick(calls)
        self.assertEqual([r.get('skipped') or r.get('session') for r in out], ['still running', '1a2b3c4d', '1a2b3c4d'])
        self.assertEqual(self.slept, [rt.SPAWN_GAP])

    def test_unknown_error_면_쉬고_한_번_다시(self):
        self.new('nightly-check')
        calls = self.Flaky([self.UNEXPECTED])
        r = self.run_now('nightly-check', calls)
        self.assertEqual(r['session'], '1a2b3c4d')
        self.assertEqual(len(self.spawns(calls)), 2)
        self.assertEqual(self.slept, [rt.RETRY_WAIT])
        runs = self.runs('nightly-check')
        self.assertEqual([e['event'] for e in runs], ['retry', 'start'])
        self.assertIn('An unknown error occurred (Unexpected)', runs[0]['reason'])
        self.assertEqual((runs[1]['session'], runs[1]['error']), ('1a2b3c4d', None))

    def test_두_번_다_실패하면_원문을_남기고_세_번째는_없다(self):
        self.new('nightly-check')
        calls = self.Flaky([self.UNEXPECTED, 'error: An unknown error occurred (Unexpected) again\n', self.UNEXPECTED])
        r = self.run_now('nightly-check', calls)
        self.assertIsNone(r['session'])
        self.assertEqual(len(self.spawns(calls)), 2)
        last = self.runs('nightly-check')[-1]
        self.assertEqual((last['event'], last['error']), ('start', 'error: An unknown error occurred (Unexpected) again'))

    def test_빈_답으로_죽어도_다시(self):
        self.new('nightly-check')
        calls = self.Flaky([''])
        self.assertEqual(self.run_now('nightly-check', calls)['session'], '1a2b3c4d')
        self.assertIn('no output', self.runs('nightly-check')[0]['reason'])

    def test_파일_한도_오류는_다시_안_한다(self):
        # 같은 프로세스 한도로는 다시 해도 똑같다 — raise_open_files 가 맡는다
        self.new('nightly-check')
        calls = self.Flaky(['error: An unknown error occurred, possibly due to low max file descriptors (Unexpected)\n\nCurrent limit: 256\n'])
        self.assertIsNone(self.run_now('nightly-check', calls)['session'])
        self.assertEqual((len(self.spawns(calls)), self.slept), (1, []))
        self.assertIn('max file descriptors', self.runs('nightly-check')[-1]['error'])

    def test_실패했는데_세션이_생겼으면_다시_안_띄운다(self):
        # 답 모양만 못 읽었고 세션은 떴다 — 또 띄우면 같은 이름 세션이 둘
        self.new('nightly-check')
        calls = self.Flaky([self.UNEXPECTED], made=True)
        r = self.run_now('nightly-check', calls)
        self.assertEqual(len(self.spawns(calls)), 1)
        self.assertIsNone(r['session'])
        self.assertEqual([e['event'] for e in self.runs('nightly-check')], ['start'])

    def test_못_치운_지난_세션은_이번_세션으로_안_센다(self):
        self.new('nightly-check')
        calls = self.Flaky([self.UNEXPECTED])
        calls.live = [{'id': 'old1', 'name': 'routine-nightly-check', 'status': 'idle'}]  # 끝난 지난 세션 — rm 이 안 먹었다
        self.assertEqual(self.run_now('nightly-check', calls)['session'], '1a2b3c4d')
        self.assertEqual(len(self.spawns(calls)), 2)

    def test_프로젝트_폴더_예약도_일시_오류는_다시(self):
        proj = self.home / 'proj'
        proj.mkdir()
        self.new('in-proj', cwd=str(proj))
        calls = self.Flaky([self.UNEXPECTED])
        self.assertEqual(self.run_now('in-proj', calls)['session'], '1a2b3c4d')
        self.assertNotIn(str(proj), json.loads((self.home / '.claude.json').read_text())['projects'])  # 믿음은 여전히 안 적는다

    def test_tick_에서_앞_예약이_끝내_실패해도_뒤_예약은_뜬다(self):
        self.new('a')
        self.new('b')
        rt._tick_mark('a', str(self.data), self.NOW)
        rt._tick_mark('b', str(self.data), self.NOW)
        calls = self.Flaky([self.UNEXPECTED, self.UNEXPECTED])
        out = self.tick(calls)
        self.assertEqual([r.get('session') for r in out], [None, '1a2b3c4d'])
        self.assertEqual(self.spawns(calls), ['routine-a', 'routine-a', 'routine-b'])
        self.assertEqual(self.slept, [rt.RETRY_WAIT, rt.SPAWN_GAP])


class FakeClaudeE2E(unittest.TestCase):
    """진짜 프로세스로 — 가짜 claude 는 $HOME/.claude.json 에서 cwd 믿음이 True 가 아니면 진짜처럼 'Workspace not trusted' 로 죽는다"""
    FAKE = ('''#!/usr/bin/env python3
import json, os, sys
if sys.argv[1:3] == ['agents', '--json']:
    print('[]'); sys.exit(0)
cj = json.load(open(os.path.join(os.environ['HOME'], '.claude.json')))
if (cj.get('projects', {}).get(os.getcwd(), {}) or {}).get('hasTrustDialogAccepted') is not True:
    print('Workspace not trusted. Run `claude` in ' + os.getcwd() + ' once and accept the trust prompt', file=sys.stderr); sys.exit(1)
print('backgrounded \u00b7 deadbeef \u00b7 routine-x')
''')

    def test_routine_run_명령이_덮인_믿음을_되살려_띄운다(self):
        import subprocess
        with tempfile.TemporaryDirectory() as t:
            root = pathlib.Path(os.path.realpath(t))
            data, claude = root / 'data', root / 'claude'
            claude.write_text(self.FAKE)
            claude.chmod(0o755)
            (root / '.claude.json').write_text(json.dumps({'projects': {}}))
            rt.new('e2e', 'daily 09:00', 'x', data=str(data), home=str(root), run=Calls(), claude=str(claude),
                   python='/usr/bin/python3', uid=501, apps=[], allow_test=True)
            d = str(data / 'routines/e2e')
            (root / '.claude.json').write_text(json.dumps({'projects': {d: {'hasTrustDialogAccepted': False}}}))
            env = dict(os.environ, HOME=str(root), CHAMMO_HOME=str(data))
            p = subprocess.run([sys.executable, str(SCRIPTS / 'routine'), 'run', 'e2e'], env=env, capture_output=True, text=True, timeout=30)
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertEqual(json.loads(p.stdout)['session'], 'deadbeef')
            last = json.loads((data / 'routines/e2e/runs.jsonl').read_text().splitlines()[-1])
            self.assertEqual((last['event'], last['session'], last['error']), ('start', 'deadbeef', None))


class FakeClaudeTickE2E(unittest.TestCase):
    """진짜 프로세스로 `routine tick` — 가짜 claude 는 ① 맨 처음 --bg 를 'unknown error (Unexpected)' 로 죽이고
    ② 앞 세션을 띄운 지 2초 안에 또 오면 같은 오류로 죽는다(daemon 이 대기 세션을 다시 데우는 중 흉내). 실제로 쉬어서 8초쯤 걸린다"""
    FAKE = ('''#!/usr/bin/env python3
import json, os, sys, time
st = os.environ['FAKE_STATE']
if sys.argv[1:3] == ['agents', '--json']:
    print('[]'); sys.exit(0)
cj = json.load(open(os.path.join(os.environ['HOME'], '.claude.json')))
if (cj.get('projects', {}).get(os.getcwd(), {}) or {}).get('hasTrustDialogAccepted') is not True:
    print('Workspace not trusted', file=sys.stderr); sys.exit(1)
now = time.time()
name = sys.argv[sys.argv.index('-n') + 1]
first = not os.path.exists(st + '.first')
last = float(open(st + '.last').read()) if os.path.exists(st + '.last') else 0
ok = not first and now - last >= 2
open(st + '.first', 'w').close()
with open(st + '.log', 'a') as f:
    f.write(json.dumps({'t': now, 'name': name, 'ok': ok}) + '\\n')
if not ok:
    print('error: An unknown error occurred (Unexpected)', file=sys.stderr); sys.exit(1)
open(st + '.last', 'w').write(str(now))
print('backgrounded \\u00b7 %08x \\u00b7 %s' % (int(now * 1000) & 0xffffffff, name))
''')

    def test_같은_tick_두_예약_첫_실패는_재시도_둘째는_간격_두고(self):
        import subprocess
        with tempfile.TemporaryDirectory() as t:
            root = pathlib.Path(os.path.realpath(t))
            data, claude, st = root / 'data', root / 'claude', root / 'state'
            claude.write_text(self.FAKE)
            claude.chmod(0o755)
            (root / '.claude.json').write_text(json.dumps({'projects': {}}))
            earlier = datetime.datetime.now() - datetime.timedelta(hours=2)
            for n in ('nightly-check', 'weekly-cleanup'):
                rt.new(n, 'every 30m', 'x', data=str(data), home=str(root), run=Calls(), claude=str(claude),
                       python='/usr/bin/python3', uid=501, now=earlier, apps=[], allow_test=True)
                rt._tick_mark(n, str(data), earlier)
            env = dict(os.environ, HOME=str(root), CHAMMO_HOME=str(data), FAKE_STATE=str(st))
            p = subprocess.run([sys.executable, str(SCRIPTS / 'routine'), 'tick'], env=env, capture_output=True, text=True, timeout=60)
            self.assertEqual(p.returncode, 0, p.stderr)
            out = json.loads(p.stdout)
            self.assertEqual([r['name'] for r in out], ['nightly-check', 'weekly-cleanup'])
            self.assertTrue(all(r['session'] for r in out), out)
            log = [json.loads(l) for l in (root / 'state.log').read_text().splitlines()]
            self.assertEqual([(c['name'], c['ok']) for c in log],
                             [('routine-nightly-check', False), ('routine-nightly-check', True), ('routine-weekly-cleanup', True)])
            self.assertGreaterEqual(log[1]['t'] - log[0]['t'], rt.RETRY_WAIT)
            self.assertGreaterEqual(log[2]['t'] - log[1]['t'], rt.SPAWN_GAP)
            runs = [json.loads(l) for l in (data / 'routines/nightly-check/runs.jsonl').read_text().splitlines()]
            self.assertEqual([e['event'] for e in runs], ['retry', 'start'])
            self.assertIn('Unexpected', runs[0]['reason'])


class Cloud(unittest.TestCase):
    """클라우드 루틴(claude.ai 원격 트리거) — 목록 파일만 적고 읽는다. 실행·예약은 claude.ai 가 한다"""
    URL = 'https://claude.ai/code/routines/trig_01abc'

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.tmp.name)
        self.home, self.data = root, root / 'data'
        self.data.mkdir()
        (root / '.claude.json').write_text(json.dumps({'projects': {}}))

    def tearDown(self):
        self.tmp.cleanup()

    def add(self, name='sentry-morning', sched='매일 07:05', url=URL, note='Sentry 아침 점검'):
        return rt.cloud_add(name, sched, url, note, data=str(self.data))

    def local(self, name='blog-daily'):
        return rt.new(name, 'daily 09:00', 'x', data=str(self.data), home=str(self.home), run=Calls(), claude='/bin/claude', python='/usr/bin/python3', uid=501, apps=[], allow_test=True)

    def file(self):
        return json.loads((self.data / 'cloud-routines.json').read_text())

    def test_추가하면_목록_파일에_적힌다(self):
        self.add()
        self.assertEqual(self.file(), [{'name': 'sentry-morning', 'schedule': '매일 07:05', 'url': self.URL, 'note': 'Sentry 아침 점검'}])

    def test_같은_이름으로_다시_추가하면_고쳐_쓴다(self):
        self.add()
        self.add(sched='매일 08:00', note='')
        self.assertEqual([(c['name'], c['schedule'], c['note']) for c in self.file()], [('sentry-morning', '매일 08:00', '')])

    def test_이름·주소·일정이_틀리면_거절(self):
        for kw in [{'name': 'Sentry Morning'}, {'url': 'http://claude.ai/x'}, {'url': 'file:///etc/passwd'}, {'url': 'javascript:alert(1)'}, {'sched': '  '}]:
            with self.assertRaises(ValueError, msg=kw):
                self.add(**kw)
        self.assertFalse((self.data / 'cloud-routines.json').exists())

    def test_로컬_루틴과_이름이_겹치면_거절(self):
        self.local()
        with self.assertRaises(ValueError):
            self.add(name='blog-daily')
        self.add()
        with self.assertRaises(ValueError):
            self.local('sentry-morning')

    def test_목록에_kind_로_합쳐진다(self):
        self.local()
        self.add()
        lst = rt.list_routines(data=str(self.data), now=datetime.datetime(2026, 9, 28, 15, 0))
        self.assertEqual([(r['name'], r['kind']) for r in lst], [('blog-daily', 'local'), ('sentry-morning', 'cloud')])
        c = lst[1]
        self.assertEqual((c['schedule'], c['url'], c['note'], c['enabled'], c['next'], c['last'], c['lastStart'], c['runs']),
                         ('매일 07:05', self.URL, 'Sentry 아침 점검', True, None, None, None, []))

    def test_목록_파일이_깨져도_로컬_목록은_나온다(self):
        (self.data / 'cloud-routines.json').write_text('{nope')
        self.assertEqual(rt.list_routines(data=str(self.data)), [])
        (self.data / 'cloud-routines.json').write_text(json.dumps([{'name': 'ok', 'schedule': 's', 'url': self.URL}, {'name': 'bad', 'url': 'file:///x'}, 'junk']))
        self.assertEqual([r['name'] for r in rt.list_routines(data=str(self.data))], ['ok'])

    def test_깨진_목록_파일은_추가로_덮어쓰지_않는다(self):
        (self.data / 'cloud-routines.json').write_text('{nope')
        with self.assertRaises(ValueError):
            self.add()
        self.assertEqual((self.data / 'cloud-routines.json').read_text(), '{nope')

    def test_실행·일시정지·지우기·보고는_클라우드_이름을_거절(self):
        self.add()
        calls = Calls()
        for f in [lambda: rt.run_now('sentry-morning', data=str(self.data), run=calls),
                  lambda: rt.set_enabled('sentry-morning', False, data=str(self.data), home=str(self.home), run=calls, uid=501),
                  lambda: rt.remove('sentry-morning', data=str(self.data), home=str(self.home), run=calls, uid=501),
                  lambda: rt.report('sentry-morning', 'ok', 'x', data=str(self.data))]:
            with self.assertRaisesRegex(ValueError, 'cloud'):
                f()
        self.assertEqual(calls.calls, [])  # launchctl·claude 를 한 번도 안 불렀다
        self.assertEqual(len(self.file()), 1)

    def test_클라우드_목록에서_빼기(self):
        self.add()
        self.add(name='other')
        rt.cloud_remove('sentry-morning', data=str(self.data))
        self.assertEqual([c['name'] for c in self.file()], ['other'])
        with self.assertRaises(ValueError):
            rt.cloud_remove('sentry-morning', data=str(self.data))

    def test_명령줄(self):
        os.environ['CHAMMO_HOME'] = str(self.data)
        quiet = contextlib.ExitStack()
        quiet.enter_context(contextlib.redirect_stdout(io.StringIO()))
        quiet.enter_context(contextlib.redirect_stderr(io.StringIO()))
        try:
            self.assertEqual(rt.main(['cloud', 'add', 'sentry-morning', '매일 07:05', self.URL, 'Sentry', '점검']), 0)
            self.assertEqual(self.file()[0]['note'], 'Sentry 점검')
            self.assertEqual(rt.main(['cloud', 'add', 'x', 'daily 07:00']), 2)  # 주소 빠짐
            self.assertEqual(rt.main(['run', 'sentry-morning']), 2)
            self.assertEqual(rt.main(['cloud', 'remove', 'sentry-morning']), 0)
            self.assertEqual(self.file(), [])
        finally:
            quiet.close()
            del os.environ['CHAMMO_HOME']


if __name__ == '__main__':
    unittest.main()


class WindowsScheduler(unittest.TestCase):
    """윈도우엔 launchd 가 없다 — 작업 스케줄러(schtasks)로. 일정 네 모양이 그대로 옮겨진다"""
    CMD = '"C:/Py/pythonw.exe" "C:/d/tools/routine" run x --scheduled'

    def args(self, sched):
        a = rt.schtasks_args('x', sched, self.CMD)
        self.assertEqual(a[:7], ['schtasks', '/Create', '/F', '/TN', 'Chammo\\x', '/TR', self.CMD])
        return a[7:]

    def test_일정_네_모양(self):
        self.assertEqual(self.args('every 2h'), ['/SC', 'HOURLY', '/MO', '2'])
        self.assertEqual(self.args('30분마다'), ['/SC', 'MINUTE', '/MO', '30'])
        self.assertEqual(self.args('매일 09:05'), ['/SC', 'DAILY', '/ST', '09:05'])
        self.assertEqual(self.args('평일 18:00'), ['/SC', 'WEEKLY', '/D', 'MON,TUE,WED,THU,FRI', '/ST', '18:00'])
        self.assertEqual(self.args('weekly sun 07:30'), ['/SC', 'WEEKLY', '/D', 'SUN', '/ST', '07:30'])

    def test_만들고_멈추고_지우기(self):
        with tempfile.TemporaryDirectory() as t:
            root = pathlib.Path(t)
            data = root / 'data'
            data.mkdir()
            (root / '.claude.json').write_text(json.dumps({'projects': {}}))
            calls = Calls()
            out = rt.new('x', 'daily 09:00', 'y', data=str(data), home=str(root), run=calls, claude='C:/c/claude.exe', python='C:/Py/python.exe', win=True)
            self.assertEqual(out['task'], 'Chammo\\x')
            self.assertEqual(calls.calls[-1][:2], ['schtasks', '/Create'])
            self.assertFalse(any('launchctl' in c for c in calls.calls))
            rt.set_enabled('x', False, data=str(data), home=str(root), run=calls, win=True)
            self.assertEqual(calls.calls[-1], ['schtasks', '/Change', '/TN', 'Chammo\\x', '/DISABLE'])
            rt.remove('x', data=str(data), home=str(root), run=calls, win=True)
            self.assertEqual(calls.calls[-1], ['schtasks', '/Delete', '/TN', 'Chammo\\x', '/F'])


class WindowsSchedulerFails(unittest.TestCase):
    """schtasks 가 실패하면 조용히 넘어가지 않는다 — 윈도우 첫 시험에서 작업이 안 생겼는데 이유를 알 수 없었다"""
    def test_등록_실패는_오류로(self):
        def fail(argv, **kw):
            ok = argv[:1] != ['schtasks']
            return type('R', (), {'returncode': 0 if ok else 1, 'stdout': '', 'stderr': '' if ok else '오류: 액세스가 거부되었습니다.'})()
        with tempfile.TemporaryDirectory() as t:
            root = pathlib.Path(t)
            (root / 'data').mkdir()
            (root / '.claude.json').write_text(json.dumps({'projects': {}}))
            with self.assertRaises(ValueError) as e:
                rt.new('x', 'daily 09:00', 'y', data=str(root / 'data'), home=str(root), run=fail, claude='C:/c/claude.exe', python='C:/Py/python.exe', win=True)
            self.assertIn('액세스가 거부', str(e.exception))


class Dated(unittest.TestCase):
    """한 번짜리(날짜) 예약 — '10/06 09:00' · '2026-10-06 09:00' · 쉼표로 여러 개. 마지막 날짜가 끝나면 스스로 꺼진다"""
    NOW = datetime.datetime(2026, 10, 2, 15, 0)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.tmp.name)
        self.home, self.data = root, root / 'data'
        self.data.mkdir()
        (root / '.claude.json').write_text(json.dumps({'projects': {}}))

    def tearDown(self):
        self.tmp.cleanup()

    def new(self, sched, calls=None, now=NOW, name='ad-revert'):
        return rt.new(name, sched, 'Revert the ad.', data=str(self.data), home=str(self.home), run=calls or Calls(),
                      claude='/bin/claude', python='/usr/bin/python3', uid=501, now=now, apps=[], allow_test=True)

    def cfg(self, name='ad-revert'):
        return json.loads((self.data / f'routines/{name}/routine.json').read_text())

    def test_launchd_키는_월·일·시·분(self):
        self.assertEqual(rt.parse_schedule('10/06 09:00'), {'StartCalendarInterval': [{'Month': 10, 'Day': 6, 'Hour': 9, 'Minute': 0}]})
        self.assertEqual(rt.parse_schedule('2026-10-06 9:05'), {'StartCalendarInterval': [{'Month': 10, 'Day': 6, 'Hour': 9, 'Minute': 5}]})
        self.assertEqual(rt.parse_schedule('10/13 09:00, 10/06 09:00')['StartCalendarInterval'],
                         [{'Month': 10, 'Day': 6, 'Hour': 9, 'Minute': 0}, {'Month': 10, 'Day': 13, 'Hour': 9, 'Minute': 0}])

    def test_틀린_날짜는_거절(self):
        for bad in ['13/01 09:00', '02/30 09:00', '10/06', '10/06 25:00', '2026-10-06', '10/06 09:00,', 'daily 09:00, 10/06 09:00']:
            with self.assertRaises(ValueError, msg=bad):
                rt.parse_schedule(bad)

    def test_날짜_모양인지(self):
        self.assertTrue(rt.is_dated('10/06 09:00, 10/13 09:00'))
        self.assertFalse(rt.is_dated('daily 09:00'))

    def test_연도_없으면_지나지_않은_가까운_해(self):
        self.assertEqual(rt.dated_slots('10/06 09:00', base=datetime.date(2026, 10, 2)), [datetime.datetime(2026, 10, 6, 9, 0)])
        self.assertEqual(rt.dated_slots('01/05 09:00', base=datetime.date(2026, 10, 2)), [datetime.datetime(2027, 1, 5, 9, 0)])
        self.assertEqual(rt.dated_slots('10/02 09:00', base=datetime.date(2026, 10, 2)), [datetime.datetime(2026, 10, 2, 9, 0)])  # 오늘은 올해
        self.assertEqual(rt.dated_slots('10/01 09:00', base=datetime.date(2026, 10, 2)), [datetime.datetime(2026, 10, 1, 9, 0)])  # 어제 = 잘못 친 것, 내년으로 안 넘김
        self.assertEqual(rt.dated_slots('02/29 09:00', base=datetime.date(2026, 10, 2)), [datetime.datetime(2028, 2, 29, 9, 0)])

    def test_다음_실행과_남은_횟수(self):
        s = '2026-10-06 09:00, 2026-10-13 09:00'
        self.assertEqual(rt.next_run(s, self.NOW), datetime.datetime(2026, 10, 6, 9, 0))
        self.assertEqual(rt.next_run(s, datetime.datetime(2026, 10, 6, 9, 30)), datetime.datetime(2026, 10, 13, 9, 0))
        self.assertIsNone(rt.next_run(s, datetime.datetime(2026, 10, 13, 9, 1)))
        self.assertEqual(rt.remaining(s, self.NOW), 2)
        self.assertEqual(rt.remaining(s, datetime.datetime(2026, 10, 13, 9, 1)), 0)

    def test_만들면_연도를_박고_지난_날짜는_뺀다(self):
        calls = Calls()
        out = self.new('10/01 09:00, 10/06 09:00, 10/13 09:00', calls)
        self.assertEqual(self.cfg()['schedule'], '2026-10-06 09:00, 2026-10-13 09:00')
        self.assertEqual(out['next'], '2026-10-06T09:00')
        self.assertEqual(json.loads((self.data / 'routines/ad-revert/tick.json').read_text())['last'], '2026-10-02T15:00')

    def test_지난_날짜만_남으면_거절(self):
        with self.assertRaisesRegex(ValueError, 'past'):
            self.new('10/01 09:00, 2026-10-02 14:59')
        self.assertFalse((self.data / 'routines').exists())

    def test_내년_날짜는_올해_launchd_가_깨워도_안_돈다(self):
        self.new('2027-10-06 09:00')
        calls = Calls()
        r = rt.run_now('ad-revert', data=str(self.data), run=calls, scheduled=True, now=datetime.datetime(2026, 10, 6, 9, 0))
        self.assertEqual(r['skipped'], 'not due')
        self.assertFalse(any('--bg' in c for c in calls.calls))
        self.assertTrue(self.cfg()['enabled'])  # 아직 남았으니 그대로
        r = rt.run_now('ad-revert', data=str(self.data), run=Calls(), scheduled=True, now=datetime.datetime(2027, 10, 6, 9, 0))
        self.assertEqual(r['session'], '1a2b3c4d')

    def test_잠자다_늦게_깨도_놓친_날짜는_돈다(self):
        self.new('10/06 09:00, 10/13 09:00')
        r = rt.run_now('ad-revert', data=str(self.data), run=Calls(), scheduled=True, now=datetime.datetime(2026, 10, 6, 11, 40))
        self.assertEqual(r['session'], '1a2b3c4d')

    def test_마지막_날짜_보고가_오면_스스로_꺼진다(self):
        self.new('10/06 09:00, 10/13 09:00')
        rt.run_now('ad-revert', data=str(self.data), run=Calls(), scheduled=True, now=datetime.datetime(2026, 10, 6, 9, 0))
        rt.report('ad-revert', 'ok', 'reverted', data=str(self.data), home=str(self.home), run=Calls(), uid=501, now=datetime.datetime(2026, 10, 6, 9, 10))
        self.assertTrue(self.cfg()['enabled'])  # 10/13 이 남았다
        self.assertNotIn('finished', self.cfg())
        rt.run_now('ad-revert', data=str(self.data), run=Calls(), scheduled=True, now=datetime.datetime(2026, 10, 13, 9, 0))
        calls = Calls()
        rt.report('ad-revert', 'ok', 'reverted', data=str(self.data), home=str(self.home), run=calls, uid=501, now=datetime.datetime(2026, 10, 13, 9, 10))
        cfg = self.cfg()
        self.assertFalse(cfg['enabled'])
        self.assertEqual(cfg['finished'], '2026-10-13T09:10:00')
        self.assertIn(['launchctl', 'bootout', 'gui/501/app.chammo.routine.ad-revert'], calls.calls)
        self.assertFalse(pathlib.Path(rt._plist_path('ad-revert', str(self.home))).exists())
        r = rt.list_routines(data=str(self.data), now=datetime.datetime(2026, 10, 13, 9, 11))[0]
        self.assertEqual((r['once'], r['remaining'], r['next'], r['finished']), (True, 0, None, '2026-10-13T09:10:00'))

    def test_보고_없이_해가_바뀌어_다시_깨면_그때_끈다(self):
        self.new('10/06 09:00')
        rt.run_now('ad-revert', data=str(self.data), run=Calls(), scheduled=True, now=datetime.datetime(2026, 10, 6, 9, 0))
        calls = Calls()
        r = rt.run_now('ad-revert', data=str(self.data), run=calls, scheduled=True, now=datetime.datetime(2027, 10, 6, 9, 0))
        self.assertEqual(r['skipped'], 'not due')
        self.assertFalse(self.cfg()['enabled'])
        self.assertFalse(any('--bg' in c for c in calls.calls))
        self.assertEqual(calls.calls[-1], ['launchctl', 'bootout', 'gui/501/app.chammo.routine.ad-revert'])  # 자기 자신을 내리는 건 맨 끝에

    def test_시험_실행은_날짜를_써버리지_않는다(self):
        self.new('10/06 09:00')
        rt.run_now('ad-revert', data=str(self.data), run=Calls(), now=datetime.datetime(2026, 10, 3, 10, 0))  # 사람이 '지금 실행'
        rt.report('ad-revert', 'ok', 'test', data=str(self.data), home=str(self.home), run=Calls(), uid=501, now=datetime.datetime(2026, 10, 3, 10, 5))
        self.assertTrue(self.cfg()['enabled'])
        r = rt.run_now('ad-revert', data=str(self.data), run=Calls(), scheduled=True, now=datetime.datetime(2026, 10, 6, 9, 0))
        self.assertEqual(r['session'], '1a2b3c4d')

    def test_끝난_예약은_다시_켜지_않는다(self):
        self.new('10/06 09:00')
        with self.assertRaisesRegex(ValueError, 'past'):
            rt.set_enabled('ad-revert', True, data=str(self.data), home=str(self.home), run=Calls(), uid=501, now=datetime.datetime(2026, 10, 7, 9, 0))

    def test_목록에_한_번짜리_표시(self):
        self.new('10/06 09:00, 10/13 09:00')
        r = rt.list_routines(data=str(self.data), now=self.NOW)[0]
        self.assertEqual((r['once'], r['remaining'], r['next'], r.get('finished')), (True, 2, '2026-10-06T09:00', None))
        self.new('daily 09:00', name='daily')
        d = [x for x in rt.list_routines(data=str(self.data), now=self.NOW) if x['name'] == 'daily'][0]
        self.assertFalse(d['once'])

    def test_윈도우는_같은_시각이면_매일_깨워_날짜로_거른다(self):
        a = rt.schtasks_args('x', '2026-10-06 09:00, 2026-10-13 09:00', 'cmd')
        self.assertEqual(a[7:], ['/SC', 'DAILY', '/ST', '09:00'])
        with self.assertRaises(ValueError):
            rt.schtasks_args('x', '10/06 09:00, 10/13 10:00', 'cmd')


class Due(unittest.TestCase):
    """예약 깨우기 하나(1분 tick) — 지난번 처리한 시각(last) 뒤로 지난 칸이 있으면 돈다. 여러 칸이 밀려도 한 번"""
    T = datetime.datetime

    def test_매일(self):
        last = self.T(2026, 10, 2, 9, 5)
        self.assertFalse(rt.due('매일 09:00', last, self.T(2026, 10, 3, 8, 59)))
        self.assertTrue(rt.due('매일 09:00', last, self.T(2026, 10, 3, 9, 0, 40)))
        self.assertFalse(rt.due('매일 09:00', self.T(2026, 10, 3, 9, 0), self.T(2026, 10, 3, 9, 1)))  # 같은 칸을 두 번 안 돈다

    def test_밀린_칸은_한_번(self):
        last = self.T(2026, 9, 28, 9, 0)
        now = self.T(2026, 10, 3, 18, 0)  # 맥이 닷새 꺼져 있었다
        self.assertTrue(rt.due('daily 09:00', last, now))
        self.assertFalse(rt.due('daily 09:00', now, now + datetime.timedelta(minutes=1)))  # 돌고 나면 다음 날까지 없음

    def test_평일_매주(self):
        fri = self.T(2026, 10, 2, 9, 30)
        self.assertFalse(rt.due('평일 09:00', fri, self.T(2026, 10, 4, 12, 0)))  # 토·일은 칸 없음
        self.assertTrue(rt.due('평일 09:00', fri, self.T(2026, 10, 5, 9, 0)))   # 월
        self.assertFalse(rt.due('매주 일 10:00', self.T(2026, 10, 3, 0, 0), self.T(2026, 10, 3, 23, 59)))
        self.assertTrue(rt.due('weekly sun 10:00', self.T(2026, 10, 3, 0, 0), self.T(2026, 10, 4, 10, 0)))

    def test_N시간마다(self):
        last = self.T(2026, 10, 3, 9, 0)
        self.assertFalse(rt.due('2시간마다', last, self.T(2026, 10, 3, 10, 59, 59)))
        self.assertTrue(rt.due('2시간마다', last, self.T(2026, 10, 3, 11, 0, 5)))
        self.assertTrue(rt.due('every 30m', last, self.T(2026, 10, 3, 17, 0)))  # 오래 밀려도 한 번(다음 기준은 그때)

    def test_날짜_한_번과_여러_날짜(self):
        s = '2026-10-06 09:00, 2026-10-13 09:00'
        self.assertFalse(rt.due(s, self.T(2026, 10, 3, 3, 0), self.T(2026, 10, 6, 8, 59)))
        self.assertTrue(rt.due(s, self.T(2026, 10, 3, 3, 0), self.T(2026, 10, 6, 9, 0)))
        self.assertFalse(rt.due(s, self.T(2026, 10, 6, 9, 0), self.T(2026, 10, 10, 9, 0)))
        self.assertTrue(rt.due(s, self.T(2026, 10, 6, 9, 0), self.T(2026, 10, 20, 9, 0)))  # 꺼져 있다 늦게 깨도
        self.assertFalse(rt.due(s, self.T(2026, 10, 13, 9, 0), self.T(2027, 10, 6, 9, 0)))  # 다 돈 뒤엔 해가 바뀌어도 없음

    def test_틀린_일정은_돌지_않는다(self):
        with self.assertRaises(ValueError):
            rt.due('whenever', self.T(2026, 10, 3), self.T(2026, 10, 4))


def fake_app(root, name, exe, tick=True, ident='app.chammo.desktop'):
    """/Applications/<name>.app 흉내 — ChammoRoutineTick 표시가 있는 판만 실행기가 된다"""
    import plistlib
    app = pathlib.Path(root) / f'{name}.app'
    (app / 'Contents/MacOS').mkdir(parents=True)
    (app / 'Contents/MacOS' / exe).write_text('#!/bin/sh\n')
    info = {'CFBundleExecutable': exe, 'CFBundleIdentifier': ident, **({'ChammoRoutineTick': True} if tick else {})}
    with open(app / 'Contents/Info.plist', 'wb') as f:
        plistlib.dump(info, f)
    return str(app), str(app / 'Contents/MacOS' / exe)


class Ticker(unittest.TestCase):
    """launchd 항목 하나(app.chammo.routines.<데이터 폴더>)가 1분마다 `routine tick` — 예약을 만들어도 맥 알림이 다시 안 뜬다"""
    NOW = datetime.datetime(2026, 10, 3, 3, 0)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.tmp.name)
        self.home, self.data, self.apps = root, root / 'data', root / 'Applications'
        self.data.mkdir()
        self.apps.mkdir()
        (root / '.claude.json').write_text(json.dumps({'projects': {}}))

    def tearDown(self):
        self.tmp.cleanup()

    def new(self, name='blog', sched='daily 09:00', now=NOW, calls=None):
        return rt.new(name, sched, 'x', data=str(self.data), home=str(self.home), run=calls or Calls(), claude='/bin/claude',
                      python='/usr/bin/python3', uid=501, now=now, apps=[], allow_test=True)

    def tick(self, now, calls=None):
        return rt.tick(data=str(self.data), now=now, run=calls or Calls(), home=str(self.home), uid=501, sleep=lambda s: None)

    def plist(self):
        import plistlib
        with open(rt._tick_plist(str(self.data), str(self.home)), 'rb') as f:
            return plistlib.load(f)

    def cfg(self, name):
        return json.loads((self.data / f'routines/{name}/routine.json').read_text())

    def test_라벨은_데이터_폴더마다(self):
        self.assertEqual(rt.tick_label('/Users/a/.honor-orchestrator'), 'app.chammo.routines.honor-orchestrator')
        self.assertEqual(rt.tick_label('/Users/a/.chammo-test/'), 'app.chammo.routines.chammo-test')  # 시험 폴더가 진짜를 덮지 않게

    def test_예약을_여럿_만들어도_launchd_항목은_하나(self):
        calls = Calls()
        self.new('a', calls=calls)
        self.new('b', sched='2시간마다', calls=calls)
        agents = sorted(os.listdir(self.home / 'Library/LaunchAgents'))
        self.assertEqual(agents, ['app.chammo.routines.data.plist'])
        p = self.plist()
        self.assertEqual((p['Label'], p['StartInterval'], p['RunAtLoad']), ('app.chammo.routines.data', 60, True))
        self.assertEqual(p['ProgramArguments'][-1], 'tick')  # 앱이 없으면 파이썬으로
        self.assertEqual(p['EnvironmentVariables']['CHAMMO_HOME'], str(self.data))
        boots = [c for c in calls.calls if c[:2] == ['launchctl', 'bootstrap']]
        self.assertEqual(len(boots), 1)  # 두 번째 예약은 이미 걸린 항목을 그대로 둔다(다시 등록 = 알림)

    def test_틱은_때가_된_것만_돌린다(self):
        self.new('morning', sched='daily 09:00')
        self.new('often', sched='2시간마다')
        self.new('once', sched='10/03 12:10')
        out = self.tick(datetime.datetime(2026, 10, 3, 9, 0, 30))
        self.assertEqual([r['name'] for r in out], ['morning', 'often'])
        self.assertEqual(self.tick(datetime.datetime(2026, 10, 3, 9, 1, 30)), [])  # 같은 칸 두 번 안 돎
        out = self.tick(datetime.datetime(2026, 10, 3, 12, 10, 10))
        self.assertEqual(sorted(r['name'] for r in out), ['often', 'once'])
        self.assertTrue(all(r.get('session') == '1a2b3c4d' for r in out))
        starts = [json.loads(l) for l in (self.data / 'routines/once/runs.jsonl').read_text().splitlines()]
        self.assertTrue(starts[-1]['scheduled'])

    def test_일시정지는_안_돌고_다시_켜면_그때부터(self):
        self.new('morning')
        rt.set_enabled('morning', False, data=str(self.data), home=str(self.home), run=Calls(), uid=501)
        self.assertEqual(self.tick(datetime.datetime(2026, 10, 3, 9, 0)), [])
        rt.set_enabled('morning', True, data=str(self.data), home=str(self.home), run=Calls(), uid=501,
                       now=datetime.datetime(2026, 10, 3, 10, 0), apps=[], allow_test=True)
        self.assertEqual(self.tick(datetime.datetime(2026, 10, 3, 10, 1)), [])  # 꺼 둔 동안 지난 09:00 을 몰아 돌리지 않는다
        self.assertEqual([r['name'] for r in self.tick(datetime.datetime(2026, 10, 4, 9, 0))], ['morning'])

    def test_끝난_한_번짜리는_다시_안_돈다(self):
        self.new('once', sched='10/03 12:10')
        self.tick(datetime.datetime(2026, 10, 3, 12, 10))
        rt.report('once', 'ok', 'done', data=str(self.data), home=str(self.home), run=Calls(), uid=501, now=datetime.datetime(2026, 10, 3, 12, 20))
        self.assertFalse(self.cfg('once')['enabled'])
        self.assertEqual(self.tick(datetime.datetime(2027, 10, 3, 12, 10)), [])

    def test_보고_없이_끝난_한_번짜리는_하루_뒤_tick_이_끈다(self):
        self.new('once', sched='10/03 12:10')
        self.tick(datetime.datetime(2026, 10, 3, 12, 10))
        self.tick(datetime.datetime(2026, 10, 3, 18, 0))
        self.assertTrue(self.cfg('once')['enabled'])  # 아직 도는 중일 수 있다
        self.tick(datetime.datetime(2026, 10, 4, 12, 11))
        self.assertFalse(self.cfg('once')['enabled'])
        self.assertIn('finished', self.cfg('once'))

    def test_기준_시각이_없는_예약은_그때부터_센다(self):
        self.new('morning')
        (self.data / 'routines/morning/tick.json').unlink()
        self.assertEqual(self.tick(datetime.datetime(2026, 10, 3, 15, 0)), [])  # 오늘 09:00 을 뒤늦게 돌리지 않는다
        self.assertEqual([r['name'] for r in self.tick(datetime.datetime(2026, 10, 4, 9, 0))], ['morning'])

    def test_다음_실행_목록은_그대로(self):
        self.new('morning')
        self.new('often', sched='2시간마다')
        lst = {r['name']: r['next'] for r in rt.list_routines(data=str(self.data), now=self.NOW)}
        self.assertEqual(lst, {'morning': '2026-10-03T09:00', 'often': '2026-10-03T05:00'})

    def test_실행기는_표시가_있는_앱만_직접_빌드한_판_먼저(self):
        _, old = fake_app(self.apps, 'Mine', 'Mine', tick=False, ident='com.example.mine')  # 옛 판 — 인자를 주면 창이 뜬다
        _, chammo = fake_app(self.apps, 'Chammo', 'Chammo')
        apps = [str(self.apps / 'Chammo.app'), str(self.apps / 'Mine.app')]
        self.assertEqual(rt.pick_launcher(apps=apps), chammo)
        _, mine2 = fake_app(self.apps, 'Mine2', 'Mine2', ident='com.example.mine')
        self.assertEqual(rt.pick_launcher(apps=apps + [str(self.apps / 'Mine2.app')]), mine2)
        self.assertIsNone(rt.pick_launcher(given=old, apps=[]))
        self.assertIsNone(rt.pick_launcher(given='/tmp/target/debug/honor-orchestrator', apps=[]))  # 번들 밖(개발판)은 안 씀

    def test_걸린_앱이_멀쩡하면_바꾸지_않는다(self):
        _, mine = fake_app(self.apps, 'honor-orchestrator', 'honor-orchestrator')
        _, chammo = fake_app(self.apps, 'Chammo', 'Chammo')
        self.assertEqual(rt.pick_launcher(given=chammo, current=mine, apps=[]), mine)  # 두 앱이 데이터를 같이 쓰면 켤 때마다 뒤바뀌지 않게
        self.assertEqual(rt.pick_launcher(given=chammo, current='/gone/X.app/Contents/MacOS/X', apps=[]), chammo)

    def test_개인_앱_번들_이름을_바꾸면_다음_켤_때_새_경로로_다시_건다(self):
        # 2026-10-06 honor-orchestrator.app → 'Chammo Dev.app'(번들 id·실행 파일 이름은 그대로). 옛 번들을 치워야 새 앱이 켤 때 갈아 건다
        old_app, old = fake_app(self.apps, 'honor-orchestrator', 'honor-orchestrator', ident='com.honorstudio.honor-orchestrator')
        self.new('morning')
        rt.install(data=str(self.data), home=str(self.home), run=Calls(), uid=501, python='/usr/bin/python3', launcher=old, now=self.NOW, apps=[], allow_test=True)
        self.assertEqual(self.plist()['ProgramArguments'][0], old)
        _, new = fake_app(self.apps, 'Chammo Dev', 'honor-orchestrator', ident='com.honorstudio.honor-orchestrator')
        rt.install(data=str(self.data), home=str(self.home), run=Calls(), uid=501, python='/usr/bin/python3', launcher=new, now=self.NOW, apps=[], allow_test=True)
        self.assertEqual(self.plist()['ProgramArguments'][0], old)  # 옛 번들이 남아 있으면 그대로 — 그래서 교체 때 옛 번들을 먼저 치운다
        import shutil
        shutil.rmtree(old_app)
        calls = Calls()
        rt.install(data=str(self.data), home=str(self.home), run=calls, uid=501, python='/usr/bin/python3', launcher=new, now=self.NOW, apps=[], allow_test=True)
        p = self.plist()
        self.assertEqual(p['ProgramArguments'], [new, '--routine-tick'])
        self.assertIn('Chammo Dev.app/Contents/MacOS/honor-orchestrator', new)
        self.assertEqual(p['AssociatedBundleIdentifiers'], ['com.honorstudio.honor-orchestrator'])
        self.assertTrue(any(c[:2] == ['launchctl', 'bootstrap'] for c in calls.calls))

    def test_앱이_있으면_앱_실행_파일로_건다(self):
        _, mine = fake_app(self.apps, 'honor-orchestrator', 'honor-orchestrator')
        rt.install(data=str(self.data), home=str(self.home), run=Calls(), uid=501, python='/usr/bin/python3', launcher=mine, now=self.NOW, apps=[], allow_test=True)
        self.assertFalse((self.home / 'Library/LaunchAgents').exists())  # 예약이 없으면 아무것도 안 건다(알림이 괜히 안 뜨게)
        self.new('morning')
        rt.install(data=str(self.data), home=str(self.home), run=Calls(), uid=501, python='/usr/bin/python3', launcher=mine, now=self.NOW, apps=[], allow_test=True)
        p = self.plist()
        self.assertEqual(p['ProgramArguments'], [mine, '--routine-tick'])
        self.assertEqual(p['AssociatedBundleIdentifiers'], ['app.chammo.desktop'])

    def test_옛_예약별_항목을_내리고_하나로(self):
        import plistlib
        la = self.home / 'Library/LaunchAgents'
        la.mkdir(parents=True)
        for name in ['morning', 'once']:
            self.new(name, sched='daily 09:00' if name == 'morning' else '10/03 12:10')
        for f in la.iterdir():
            f.unlink()  # 옮기기 전 모양을 흉내 낸다 — 예약마다 항목, tick 기준 없음
        for name in ['morning', 'once']:
            (self.data / f'routines/{name}/tick.json').unlink()
            with open(la / f'app.chammo.routine.{name}.plist', 'wb') as f:
                plistlib.dump({'Label': f'app.chammo.routine.{name}', 'ProgramArguments': ['/py', 'x'],
                               'EnvironmentVariables': {'CHAMMO_HOME': str(self.data), 'PATH': f'{self.home}:/usr/bin'}}, f)
        with open(la / 'app.chammo.routine.other.plist', 'wb') as f:  # 다른 데이터 폴더(시험 앱) 것은 그대로
            plistlib.dump({'Label': 'app.chammo.routine.other', 'EnvironmentVariables': {'CHAMMO_HOME': '/elsewhere'}}, f)
        calls = Calls()
        out = rt.install(data=str(self.data), home=str(self.home), run=calls, uid=501, python='/usr/bin/python3', now=self.NOW, apps=[], allow_test=True)
        self.assertEqual(out['removed'], ['morning', 'once'])
        self.assertEqual(sorted(os.listdir(la)), ['app.chammo.routine.other.plist', 'app.chammo.routines.data.plist'])
        outs = [i for i, c in enumerate(calls.calls) if c[:2] == ['launchctl', 'bootout'] and 'routine.' in c[2]]
        boot = [i for i, c in enumerate(calls.calls) if c[:2] == ['launchctl', 'bootstrap']]
        self.assertEqual(len(outs), 2)
        self.assertLess(max(outs), boot[0])  # 옛 것을 먼저 내린다(두 번 도는 칸이 없게)
        self.assertIn(str(self.home), self.plist()['EnvironmentVariables']['PATH'].split(':'))  # 옛 항목 PATH 에서 있는 폴더는 이어받는다
        self.assertEqual(json.loads((self.data / 'routines/once/tick.json').read_text())['last'], '2026-10-03T03:00')
        self.assertEqual([r['name'] for r in self.tick(datetime.datetime(2026, 10, 3, 9, 0))], ['morning'])
        again = Calls()
        self.assertEqual(rt.install(data=str(self.data), home=str(self.home), run=again, uid=501, python='/usr/bin/python3', now=self.NOW, apps=[], allow_test=True)['removed'], [])
        self.assertFalse(any(c[:2] == ['launchctl', 'bootstrap'] for c in again.calls))  # 여러 번 불러도 다시 등록 안 함

    def test_옮길_때_N마다는_마지막_시작부터_센다(self):
        self.new('often', sched='every 12h', now=datetime.datetime(2026, 10, 2, 9, 0))
        rt._log('often', str(self.data), now=datetime.datetime(2026, 10, 2, 16, 13, 20), event='start', scheduled=True)
        (self.data / 'routines/often/tick.json').unlink()  # 옮기기 전 — 기준 없음
        rt.install(data=str(self.data), home=str(self.home), run=Calls(), uid=501, python='/usr/bin/python3', now=self.NOW, apps=[], allow_test=True)
        r = rt.list_routines(data=str(self.data), now=self.NOW)[0]
        self.assertEqual(r['next'], '2026-10-03T04:13')  # 옮긴 시각(03:00)+12h 로 밀리지 않는다
        self.assertEqual(self.tick(datetime.datetime(2026, 10, 3, 4, 12)), [])
        self.assertEqual([x['name'] for x in self.tick(datetime.datetime(2026, 10, 3, 4, 13))], ['often'])

    def test_지우기는_데이터만(self):
        calls = Calls()
        self.new('morning', calls=calls)
        rt.remove('morning', data=str(self.data), home=str(self.home), run=calls, uid=501)
        self.assertFalse((self.data / 'routines/morning').exists())
        self.assertTrue(pathlib.Path(rt._tick_plist(str(self.data), str(self.home))).exists())  # 하나뿐인 tick 은 남긴다


class TickGuard(unittest.TestCase):
    """시험 데이터 폴더(CHAMMO_HOME=~/.chammo-qa 등)는 진짜 launchd tick 을 걸지 않는다 — 개발판이 걸어 둔 tick 이
    매일 9시에 시험 HQ 에 진짜 claude 세션을 띄울 뻔했다(2026-10-03 qa-chat). 시험에 꼭 필요하면 --allow-test-tick"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = pathlib.Path(self.tmp.name)
        (self.home / '.claude.json').write_text(json.dumps({'projects': {}}))

    def tearDown(self):
        self.tmp.cleanup()

    def data(self, name):
        d = self.home / name
        d.mkdir(exist_ok=True)
        return d

    def new(self, data, calls, **kw):
        return rt.new('daily', 'daily 09:00', 'x', data=str(data), home=str(self.home), run=calls, claude='/bin/claude',
                      python='/usr/bin/python3', uid=501, apps=[], **kw)

    def agents(self):
        la = self.home / 'Library/LaunchAgents'
        return sorted(os.listdir(la)) if la.is_dir() else []

    def test_진짜_데이터_폴더만(self):
        h = str(self.home)
        self.assertTrue(rt.real_data(f'{h}/.honor-orchestrator', h))
        self.assertTrue(rt.real_data(f'{h}/.chammo/', h))
        for d in ['.chammo-qa', '.chammo-test', 'data', '.honor-orchestrator/x']:
            self.assertFalse(rt.real_data(f'{h}/{d}', h), d)

    def test_시험_폴더는_예약을_만들어도_깨우기를_안_건다(self):
        calls = Calls()
        out = self.new(self.data('.chammo-qa'), calls, allow_test=False)
        self.assertTrue((self.home / '.chammo-qa/routines/daily/routine.json').is_file())  # 예약 자체는 생긴다
        self.assertEqual((out['plist'], out['skipped']), (None, rt.SKIP_TEST))
        self.assertEqual(self.agents(), [])
        self.assertFalse(any('launchctl' in c for c in calls.calls))

    def test_시험_폴더에_이미_걸린_tick_은_내린다(self):
        qa = self.data('.chammo-qa')
        self.new(qa, Calls(), allow_test=True)
        self.assertEqual(self.agents(), ['app.chammo.routines.chammo-qa.plist'])
        calls = Calls()
        out = rt.install(data=str(qa), home=str(self.home), run=calls, uid=501, python='/usr/bin/python3', apps=[], allow_test=False)
        self.assertEqual(out['skipped'], rt.SKIP_TEST)
        self.assertEqual(self.agents(), [])
        self.assertIn(['launchctl', 'bootout', 'gui/501/app.chammo.routines.chammo-qa'], calls.calls)

    def test_다시_켜도_시험_폴더는_안_건다(self):
        qa = self.data('.chammo-qa')
        self.new(qa, Calls(), allow_test=False)
        rt.set_enabled('daily', False, data=str(qa), home=str(self.home), run=Calls(), uid=501)
        calls = Calls()
        rt.set_enabled('daily', True, data=str(qa), home=str(self.home), run=calls, uid=501, apps=[], allow_test=False)
        self.assertEqual(self.agents(), [])
        self.assertFalse(any(c[:2] == ['launchctl', 'bootstrap'] for c in calls.calls))

    def test_진짜_폴더는_건다(self):
        for name in ['.honor-orchestrator', '.chammo']:
            self.new(self.data(name), Calls(), allow_test=False)
        self.assertEqual(self.agents(), ['app.chammo.routines.chammo.plist', 'app.chammo.routines.honor-orchestrator.plist'])

    def test_환경변수로_시험_허용(self):
        os.environ['CHAMMO_ALLOW_TEST_TICK'] = '1'
        try:
            self.new(self.data('.chammo-test'), Calls())
        finally:
            del os.environ['CHAMMO_ALLOW_TEST_TICK']
        self.assertEqual(self.agents(), ['app.chammo.routines.chammo-test.plist'])

    def test_명령줄은_한_줄_알리고_성공(self):
        qa = self.data('.chammo-clitest-x9')  # 진짜 홈의 LaunchAgents 를 보므로 실제로 없는 이름으로
        os.environ['CHAMMO_HOME'] = str(qa)
        err = io.StringIO()
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                self.assertEqual(rt.main(['install']), 0)  # 예약이 없어도·시험 폴더여도 실패는 아니다
        finally:
            del os.environ['CHAMMO_HOME']
        self.assertIn('--allow-test-tick', err.getvalue())


class TickPath(unittest.TestCase):
    """tick 의 PATH — 앱·셸 환경을 그대로 잇지 않는다. 기본 + 옛 항목에서 실제로 있는 폴더만(fnm 임시·node_modules·작업 폴더는 빼고)"""

    def test_있는_폴더만_임시는_빼고(self):
        with tempfile.TemporaryDirectory() as t:
            root = pathlib.Path(t)
            keep, fnm, nm = root / 'tools/bin', root / '.local/state/fnm_multishells/938_17909/bin', root / 'wt/node_modules/.bin'
            job = root / '.claude/jobs/x/tmp'
            for d in (keep, fnm, nm, job):
                d.mkdir(parents=True)
            old = ':'.join(map(str, [fnm, keep, nm, root / 'gone', job, '/usr/bin', keep]))
            os.environ['PATH'] = f'{root}:' + os.environ.get('PATH', '')  # 부른 쪽 환경은 이어받지 않는다
            try:
                got = rt.tick_path([old], claude_dirs=['/bin'], home=str(root)).split(':')
            finally:
                os.environ['PATH'] = os.environ['PATH'].split(':', 1)[1]
            self.assertEqual(got[:2], ['/bin', str(keep)])
            for bad in (fnm, nm, root / 'gone', job, root):
                self.assertNotIn(str(bad), got)
            self.assertIn('/usr/bin', got)
            self.assertEqual(len(got), len(set(got)))


class FakeResource:
    """resource 모듈 대역 — setrlimit 가 받은 값을 적고, fail 에 든 값은 거절한다"""
    RLIMIT_NOFILE, RLIM_INFINITY = 8, -1

    def __init__(self, soft, hard, fail=()):
        self.limit, self.fail, self.set = (soft, hard), set(fail), []

    def getrlimit(self, which):
        return self.limit

    def setrlimit(self, which, lim):
        self.set.append(lim)
        if lim[0] in self.fail or 'all' in self.fail:
            raise ValueError('not allowed to raise maximum limit')
        self.limit = lim


class OpenFileLimit(unittest.TestCase):
    """launchd 로 깬 프로세스는 파일 열기 소프트 제한이 256 이라 claude --bg 가 시작부터 죽었다(2026-10-03 nightly-check)"""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.tmp.name)
        self.home, self.data = root, root / 'data'
        self.data.mkdir()
        (root / '.claude.json').write_text(json.dumps({'projects': {}}))
        rt.new('nightly-check', 'daily 09:00', 'Check spend.', data=str(self.data), home=str(self.home), run=Calls(),
               claude='/bin/claude', python='/usr/bin/python3', uid=501, apps=[], allow_test=True)

    def tearDown(self):
        self.tmp.cleanup()

    def test_소프트_제한을_하드까지_올린다(self):
        res = FakeResource(256, 4096)
        with unittest.mock.patch.object(rt, 'resource', res):
            rt.run_now('nightly-check', data=str(self.data), run=Calls())
        self.assertEqual(res.limit, (4096, 4096))

    def test_하드가_무한이면_큰_값부터_되는_데까지_내린다(self):
        res = FakeResource(256, FakeResource.RLIM_INFINITY, fail={65536})  # 맥은 OPEN_MAX(10240) 넘으면 거절
        with unittest.mock.patch.object(rt, 'resource', res):
            rt.run_now('nightly-check', data=str(self.data), run=Calls())
        self.assertEqual(res.limit[0], 10240)

    def test_이미_넉넉하면_건드리지_않는다(self):
        res = FakeResource(65536, FakeResource.RLIM_INFINITY)
        with unittest.mock.patch.object(rt, 'resource', res):
            rt.run_now('nightly-check', data=str(self.data), run=Calls())
        self.assertEqual(res.set, [])

    def test_resource_가_없으면_넘어간다(self):  # 윈도우
        calls = Calls()
        with unittest.mock.patch.object(rt, 'resource', None):
            r = rt.run_now('nightly-check', data=str(self.data), run=calls)
        self.assertEqual(r['session'], '1a2b3c4d')

    def test_올리기가_다_실패해도_claude_는_띄운다(self):
        res, calls = FakeResource(256, 4096, fail={'all'}), Calls()
        with unittest.mock.patch.object(rt, 'resource', res):
            r = rt.run_now('nightly-check', data=str(self.data), run=calls)
        self.assertEqual(r['session'], '1a2b3c4d')
        self.assertTrue(any('--bg' in c for c in calls.calls))
        self.assertEqual(res.limit, (256, 4096))
