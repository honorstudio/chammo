"""HQ 템플릿 scripts/routine 테스트: python3 -m unittest discover -s app/hq-tests"""
import contextlib, datetime, importlib.machinery, importlib.util, io, json, os, pathlib, sys, tempfile, unittest

sys.dont_write_bytecode = True
SCRIPTS = pathlib.Path(__file__).resolve().parent.parent / 'hq-template' / 'scripts'


def load(name):
    loader = importlib.machinery.SourceFileLoader(f'hq_{name}', str(SCRIPTS / name))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


rt = load('routine')


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
        return rt.new(name, sched, what, cwd=cwd, data=str(self.data), home=str(self.home), run=calls, claude='/bin/claude', python='/usr/bin/python3', uid=501)

    def test_만들면_지침서_설정_launchd_가_생긴다(self):
        calls = Calls()
        out = self.new(calls)
        d = self.data / 'routines/blog-daily'
        self.assertIn('Write and publish one blog post.', (d / 'ROUTINE.md').read_text())
        cfg = json.loads((d / 'routine.json').read_text())
        self.assertEqual((cfg['schedule'], cfg['enabled'], cfg['cwd']), ('daily 09:00', True, str(d)))
        plist = pathlib.Path(out['plist'])
        self.assertTrue(plist.is_file())
        self.assertIn(b'app.chammo.routine.blog-daily', plist.read_bytes())
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
        self.assertIn(['launchctl', 'bootout', 'gui/501/app.chammo.routine.blog-daily'], calls.calls)
        self.assertFalse(pathlib.Path(out['plist']).exists())
        self.assertFalse((self.data / 'routines/blog-daily').exists())


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
        return rt.new(name, 'daily 09:00', 'x', data=str(self.data), home=str(self.home), run=Calls(), claude='/bin/claude', python='/usr/bin/python3', uid=501)

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
