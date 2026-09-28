"""HQ 템플릿 scripts/routine 테스트: python3 -m unittest discover -s app/hq-tests"""
import datetime, importlib.machinery, importlib.util, json, os, pathlib, sys, tempfile, unittest

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


if __name__ == '__main__':
    unittest.main()
