"""HQ scripts/app 테스트 — 참모가 앱을 대신 조작: python3 -m unittest discover -s app/hq-tests"""
import importlib.machinery, importlib.util, json, os, pathlib, subprocess, sys, tempfile, unittest

sys.dont_write_bytecode = True  # 템플릿 폴더에 __pycache__ 가 생기지 않게

SCRIPTS = pathlib.Path(__file__).resolve().parent.parent / 'hq-template' / 'scripts'
SCRIPT = SCRIPTS / 'app'


def load():
    loader = importlib.machinery.SourceFileLoader('hq_app', str(SCRIPT))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


app = load()


def run(data, *args, home=None):
    env = {'CHAMMO_HOME': data, 'HOME': home or data, 'PATH': '/usr/bin:/bin'}
    return subprocess.run([sys.executable, str(SCRIPT), *args], env=env, capture_output=True, text=True)


def lines(data, name='app.jsonl'):
    p = os.path.join(data, name)
    if not os.path.exists(p):
        return []
    with open(p, encoding='utf-8') as f:
        return [json.loads(l) for l in f]


class DataDir(unittest.TestCase):
    def test_다른_스크립트와_같은_규칙(self):
        self.assertEqual(app.data_dir('/h', '/x', lambda p: True), '/x')
        self.assertEqual(app.data_dir('/h', '', lambda p: False), '/h/.chammo')
        self.assertEqual(app.data_dir('/h', '', lambda p: p == '/h/.honor-orchestrator'), '/h/.honor-orchestrator')


class Parse(unittest.TestCase):
    def test_맞는_명령(self):
        self.assertEqual(app.parse(['voice', 'on']), ('voice', 'on'))
        self.assertEqual(app.parse(['feature', 'office', 'off']), ('feature', 'office off'))
        self.assertEqual(app.parse(['open', 'settings']), ('open', 'settings'))
        self.assertEqual(app.parse(['close', 'reader']), ('close', 'reader'))
        self.assertEqual(app.parse(['focus', 'acme-shop']), ('focus', 'acme-shop'))
        self.assertEqual(app.parse(['pet', 'hide']), ('pet', 'hide'))
        self.assertEqual(app.parse(['status']), ('status', ''))

    def test_틀린_명령은_None(self):
        for bad in ([], ['voice'], ['voice', 'loud'], ['feature', 'gold', 'on'], ['feature', 'office'],
                    ['open', 'kitchen'], ['close', 'tour'], ['focus'], ['pet', 'dance'], ['rm', '-rf'],
                    ['status', 'x'], ['voice', 'on', 'now']):
            self.assertIsNone(app.parse(bad), bad)


class Status(unittest.TestCase):
    def test_설정_음성_브라우저(self):
        with tempfile.TemporaryDirectory() as d:
            json.dump({'language': 'en', 'assistantName': 'Max', 'devRoot': '~/Projects',
                       'features': {'office': False}}, open(os.path.join(d, 'config.json'), 'w'))
            open(os.path.join(d, 'voice.json'), 'w').write('{"on":true}')
            s = app.status(d)
            self.assertEqual((s['language'], s['assistantName'], s['devRoot']), ('en', 'Max', '~/Projects'))
            self.assertEqual(s['features'], {'office': False, 'tama': True, 'gacha': True, 'review': True, 'voice': True})
            self.assertTrue(s['voiceMode'])
            self.assertFalse(s['browserAutomation'])
            pkg = os.path.join(d, 'tools/chammo-browser/node_modules/@playwright/mcp')
            os.makedirs(pkg); open(os.path.join(pkg, 'package.json'), 'w').write('{}')
            self.assertTrue(app.status(d)['browserAutomation'])

    def test_파일이_없어도(self):
        with tempfile.TemporaryDirectory() as d:
            s = app.status(d)
            self.assertFalse(s['voiceMode'])
            self.assertTrue(all(s['features'].values()))

    def test_명령으로_JSON(self):
        with tempfile.TemporaryDirectory() as d:
            r = run(d, 'status')
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn('features', json.loads(r.stdout))
            self.assertEqual(lines(d), [])  # status 는 앱에 아무것도 안 보낸다


class Send(unittest.TestCase):
    def test_한_줄씩_쌓인다(self):
        with tempfile.TemporaryDirectory() as d:
            for args in (['voice', 'on'], ['feature', 'tama', 'off'], ['open', 'settings'], ['focus', 'acme-shop'], ['pet', 'show']):
                r = run(d, *args)
                self.assertEqual(r.returncode, 0, r.stderr)
                self.assertEqual(len(r.stdout.strip().splitlines()), 1)  # 확인은 한 줄
            got = [(l['action'], l['arg']) for l in lines(d)]
            self.assertEqual(got, [('voice', 'on'), ('feature', 'tama off'), ('open', 'settings'), ('focus', 'acme-shop'), ('pet', 'show')])
            self.assertTrue(all(l['ts'] for l in lines(d)))

    def test_틀리면_사용법과_2(self):
        with tempfile.TemporaryDirectory() as d:
            for args in ([], ['open', 'kitchen'], ['feature', 'office']):
                r = run(d, *args)
                self.assertEqual(r.returncode, 2, args)
                self.assertIn('scripts/app', r.stderr)
            self.assertEqual(lines(d), [])

    def test_꺼둔_기능은_알려준다(self):
        with tempfile.TemporaryDirectory() as d:
            json.dump({'features': {'office': False, 'tama': False}}, open(os.path.join(d, 'config.json'), 'w'))
            r = run(d, 'open', 'office')
            self.assertEqual(r.returncode, 0)
            self.assertIn('feature office on', r.stderr)
            self.assertIn('feature tama on', run(d, 'pet', 'show').stderr)

    def test_리더는_show_로(self):
        with tempfile.TemporaryDirectory() as d:
            d = os.path.realpath(d)
            doc = os.path.join(d, 'a.md'); open(doc, 'w').write('# a')
            r = run(d, 'reader', doc, home=d)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual([l['path'] for l in lines(d, 'show.jsonl')], [doc])
            self.assertEqual(lines(d), [])


if __name__ == '__main__':
    unittest.main()


class Project(unittest.TestCase):
    """devRoot 밖 폴더를 프로젝트로 — 앱이 꺼져 있어도 반영되게 config.json 을 직접 고치고 앱엔 다시 읽으라고만(2026-09-28 사용자)"""

    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.data = os.path.join(self.home, '.chammo')
        os.makedirs(os.path.join(self.home, 'dev/shop'))
        os.makedirs(os.path.join(self.home, 'automation/blog-bot'))
        os.makedirs(self.data)
        with open(os.path.join(self.data, 'config.json'), 'w') as f:
            json.dump({'language': 'ko', 'devRoot': '~/dev', 'features': {'tama': False}}, f)

    def cfg(self):
        with open(os.path.join(self.data, 'config.json')) as f:
            return json.load(f)

    def test_추가하면_설정에_쌓이고_다른_칸은_그대로(self):
        r = run(self.data, 'project', 'add', os.path.join(self.home, 'automation/blog-bot/'), home=self.home)
        self.assertEqual(r.returncode, 0, r.stderr)
        c = self.cfg()
        self.assertEqual(c['extraProjects'], ['~/automation/blog-bot'])
        self.assertEqual(c['devRoot'], '~/dev')
        self.assertEqual(c['features'], {'tama': False})
        self.assertEqual(lines(self.data)[-1]['action'], 'config')
        self.assertEqual(lines(self.data)[-1]['arg'], 'reload')

    def test_두번_추가해도_한번(self):
        run(self.data, 'project', 'add', '~/automation/blog-bot', home=self.home)
        r = run(self.data, 'project', 'add', '~/automation/blog-bot', home=self.home)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self.cfg()['extraProjects'], ['~/automation/blog-bot'])

    def test_없는_폴더_devRoot_안_홈은_거절(self):
        for bad in ('~/없음', '~/dev/shop', '~/dev', '~'):
            r = run(self.data, 'project', 'add', bad, home=self.home)
            self.assertEqual(r.returncode, 1, bad)
        self.assertNotIn('extraProjects', self.cfg())

    def test_빼기는_경로나_이름으로(self):
        run(self.data, 'project', 'add', '~/automation/blog-bot', home=self.home)
        r = run(self.data, 'project', 'remove', 'blog-bot', home=self.home)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.cfg()['extraProjects'], [])
        self.assertEqual(run(self.data, 'project', 'remove', 'blog-bot', home=self.home).returncode, 1)

    def test_목록은_devRoot_와_추가한_것(self):
        run(self.data, 'project', 'add', '~/automation/blog-bot', home=self.home)
        r = run(self.data, 'project', 'list', home=self.home)
        got = json.loads(r.stdout)
        self.assertEqual(got['devRoot'], '~/dev')
        self.assertEqual(got['extraProjects'], ['~/automation/blog-bot'])
        self.assertIn('shop', got['projects'])
        self.assertIn('blog-bot', got['projects'])


class Load(unittest.TestCase):
    """참모가 부하를 읽는다 — 앱이 잴 때마다 남기는 <데이터>/load.json 을 사람 말로(2026-09-28 사용자)"""

    def setUp(self):
        self.data = tempfile.mkdtemp()

    def write(self, age_sec=5):
        import datetime
        at = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=age_sec)).isoformat()
        s = {'at': at, 'cores': 10, 'load1': 14.2, 'load5': 9.0, 'swapUsedGb': 4.5, 'level': 'warn',
             'sessions': [{'name': 'shop', 'project': 'shop', 'cpu': 180, 'mem': '2.1GB', 'top': ['Rust build 150% 1.2GB']}],
             'orphans': [{'pid': 400, 'what': 'next dev', 'mem': '300MB', 'cpu': 0, 'age': '1일'}],
             'outside': {'cpu': 20, 'mem': '1.0GB'}, 'rest': {'cpu': 30, 'mem': '5.0GB', 'top': ['WindowServer 12% 60MB']}}
        with open(os.path.join(self.data, 'load.json'), 'w') as f:
            json.dump(s, f)

    def test_세션별로_읽어준다(self):
        self.write()
        r = run(self.data, 'load')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('14.2', r.stdout)
        self.assertIn('shop', r.stdout)
        self.assertIn('Rust build', r.stdout)
        self.assertIn('next dev', r.stdout)

    def test_JSON_으로도(self):
        self.write()
        got = json.loads(run(self.data, 'load', '--json').stdout)
        self.assertEqual(got['sessions'][0]['name'], 'shop')

    def test_오래됐거나_없으면_알린다(self):
        self.assertEqual(run(self.data, 'load').returncode, 1)
        self.write(age_sec=600)
        r = run(self.data, 'load')
        self.assertEqual(r.returncode, 0)
        self.assertIn('old', r.stderr.lower())
