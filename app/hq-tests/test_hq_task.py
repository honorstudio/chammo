"""HQ 템플릿 scripts/task 테스트 (공개판): python3 -m unittest discover -s app/hq-tests"""
import contextlib, datetime, importlib.machinery, importlib.util, io, json, os, pathlib, subprocess, sys, tempfile, unittest

sys.dont_write_bytecode = True  # 템플릿 폴더에 __pycache__ 가 생기지 않게

SCRIPTS = pathlib.Path(__file__).resolve().parent.parent / 'hq-template' / 'scripts'


def load(name):
    loader = importlib.machinery.SourceFileLoader(f'hq_{name}', str(SCRIPTS / name))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


task, say, show = load('task'), load('say'), load('show')



class Payment(unittest.TestCase):
    def test_결제는_묻는다(self):
        for t in ['실결제 테스트', '환불 처리', 'payment flow E2E', 'refund the order', 'billing account', 'checkout page charges']:
            self.assertTrue(task.needs_confirm(t), t)

    def test_나머지는_안_묻는다(self):
        for t in ['운영 DB 삭제', 'push to main', 'deploy to production', 'PR 머지', 'discharge summary copy', 'change button color']:
            self.assertFalse(task.needs_confirm(t), t)


class Send(unittest.TestCase):
    def run_send(self, title):
        out, err = io.StringIO(), io.StringIO()
        with tempfile.TemporaryDirectory() as d:
            task.LOG = os.path.join(d, 'tasks.jsonl')
            task.LESSONS = os.path.join(d, 'lessons')
            task.load_agents = lambda: []
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = task.main(['send', 'web', title])
            events = [json.loads(l) for l in open(task.LOG, encoding='utf-8')]
        return code, out.getvalue(), err.getvalue(), events

    def test_보통_일은_머지_규칙을_준다(self):
        code, out, err, events = self.run_send('button color')
        self.assertEqual(code, 0)
        self.assertRegex(out, r'^\d{4}-\d{4}-[0-9a-f]{4}\n$')  # stdout = task id 한 줄
        self.assertIn(task.MERGE_RULE, err)
        self.assertEqual([e['type'] for e in events], ['send'])

    def test_시킨_참모를_from_으로_남긴다(self):
        # 채팅 뷰 대시보드가 참모마다 잡은 세션을 가른다 — 없으면 공개판에서 맡긴 일이 전부 '누가 시켰는지 모르는 일'(0.2.0 검증)
        old = os.environ.get('CLAUDE_JOB_DIR')
        os.environ['CLAUDE_JOB_DIR'] = '/h/.claude/jobs/abcd1234'
        try:
            _, _, _, events = self.run_send('button color')
        finally:
            if old is None:
                os.environ.pop('CLAUDE_JOB_DIR', None)
            else:
                os.environ['CLAUDE_JOB_DIR'] = old
        self.assertEqual(events[0]['from'], 'abcd1234')

    def test_결제_일은_코드_3과_결정_대기(self):
        code, _, _, events = self.run_send('refund flow')
        self.assertEqual(code, 3)
        self.assertEqual([e['type'] for e in events], ['send', 'ask'])


class OpenTasks(unittest.TestCase):
    def test_only_open_tasks_of_that_session(self):
        with tempfile.TemporaryDirectory() as d:
            task.LOG = os.path.join(d, 'tasks.jsonl')
            task.append({'ts': 't', 'type': 'send', 'task': 'a', 'target': 'api', 'title': 'first'})
            task.append({'ts': 't', 'type': 'send', 'task': 'b', 'target': 'api', 'title': 'second'})
            task.append({'ts': 't', 'type': 'done', 'task': 'b', 'note': '#12 merged'})
            task.append({'ts': 't', 'type': 'send', 'task': 'c', 'target': 'web', 'title': 'other'})
            self.assertEqual(task.open_tasks('api'), [('a', 'first')])


class Effort(unittest.TestCase):
    def test_강도(self):
        self.assertEqual(task.effort_for('fix login bug')[0], 'high')
        self.assertEqual(task.effort_for('마이그레이션 적용')[0], 'high')
        self.assertEqual(task.effort_for('draft the README')[0], 'low')
        self.assertEqual(task.effort_for('add an approve button')[0], 'medium')



class Harness(unittest.TestCase):
    # 시안→구현은 스케치가 아님, 공통 교훈, 세 번 되돌림, 증거 없는 done
    def test_시안이라도_구현이면_low_아님(self):
        self.assertNotEqual(task.effort_for('로그인 화면 시안 확정 → 구현')[0], 'low')
        self.assertNotEqual(task.effort_for('implement the approved mockup')[0], 'low')
        self.assertEqual(task.effort_for('OTA preview')[0], 'high')

    def test_교훈_공통과_CLAUDE_local(self):
        with tempfile.TemporaryDirectory() as d:
            task.LESSONS, task.DEV = os.path.join(d, 'lessons'), d
            os.makedirs(os.path.join(d, 'p'))
            subprocess.run(['git', 'init', '-q', os.path.join(d, 'p')], check=True)
            with open(os.path.join(d, 'p', '.gitignore'), 'w') as f:
                f.write('CLAUDE.local.md\n')
            with contextlib.redirect_stderr(io.StringIO()):
                task.main(['lesson', '--all', 'common'])
                task.main(['lesson', 'p', 'mine'])
            self.assertEqual(task.lessons_of('p'), ['common', 'mine'])
            with open(os.path.join(d, 'p', 'CLAUDE.local.md'), encoding='utf-8') as f:
                self.assertIn('- mine\n', f.read())

    def test_세_번째_되돌림과_증거(self):
        with tempfile.TemporaryDirectory() as d:
            task.LOG = os.path.join(d, 'tasks.jsonl')
            err = io.StringIO()
            with contextlib.redirect_stderr(err):
                for i in range(3):
                    task.main(['retry', 't', str(i)])
            self.assertEqual(task.retries('t'), 3)
            self.assertTrue(err.getvalue().strip())
            err = io.StringIO()
            with contextlib.redirect_stderr(err):
                task.main(['done', 't', 'PR #3 merged'])
            self.assertEqual(err.getvalue(), '')

    def test_운영_관문과_출시_전(self):
        with tempfile.TemporaryDirectory() as d:
            task.LOG, task.LESSONS, task.OPS_FREE = os.path.join(d, 't.jsonl'), os.path.join(d, 'l'), os.path.join(d, 'o.json')
            task.load_agents = lambda: []
            def send():
                err = io.StringIO()
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                    task.main(['send', 'p', 'add a button'])
                return err.getvalue()
            self.assertIn(task.OPS_RULE, send())
            task.main(['prelaunch', 'p', 'on', 'pre-launch'])
            self.assertNotIn(task.OPS_RULE, send())
            task.main(['prelaunch', 'p', 'off'])
            self.assertIn(task.OPS_RULE, send())

    def test_회신의_교훈_줄을_적는다(self):
        with tempfile.TemporaryDirectory() as d:
            task.LOG, task.LESSONS, task.DEV = os.path.join(d, 't.jsonl'), os.path.join(d, 'l'), d
            task.load_agents = lambda: []
            os.makedirs(os.path.join(d, 'p'))  # a session named after its project folder — found by folder name even when not listed
            with contextlib.redirect_stdout(io.StringIO()) as out, contextlib.redirect_stderr(io.StringIO()):
                task.main(['send', 'p', 'add a button'])
            with contextlib.redirect_stderr(io.StringIO()):
                task.main(['reply', out.getvalue().strip(), 'done PR #1\nLesson: run the linter before commit\n교훈: 포트 3000 은 이미 쓰는 중'])
            self.assertEqual(task.lessons_of('p'), ['run the linter before commit', '포트 3000 은 이미 쓰는 중'])

class ReplyProject(unittest.TestCase):
    # reply lessons leaked into lessons/<session name>.md — send was recorded before the session started (no project),
    # and an unlisted session's name (or "name [id]") became the project
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.saved = (task.LOG, task.LESSONS, task.DEV, task.DATA, task.EXTRAS, task.load_agents)
        task.LOG, task.LESSONS, task.DEV, task.DATA, task.EXTRAS = os.path.join(self.d, 't.jsonl'), os.path.join(self.d, 'l'), self.d, self.d, []

    def tearDown(self):
        task.LOG, task.LESSONS, task.DEV, task.DATA, task.EXTRAS, task.load_agents = self.saved

    def flow(self, target, at_send, at_reply):
        task.load_agents = lambda: at_send
        with contextlib.redirect_stdout(io.StringIO()) as out, contextlib.redirect_stderr(io.StringIO()):
            task.main(['send', target, 'debt batch'])
        task.load_agents = lambda: at_reply
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            task.main(['reply', out.getvalue().strip(), 'done\nLesson: use a temp folder'])
        return err.getvalue(), sorted(os.listdir(task.LESSONS)) if os.path.isdir(task.LESSONS) else []

    def test_worktree_session_started_after_send(self):
        wt = {'id': 'b1', 'name': 'debt-q', 'cwd': os.path.join(self.d, 'web', '.claude', 'worktrees', 'debt-q')}
        _, files = self.flow('debt-q', [], [wt])
        self.assertEqual(files, ['web.md'])

    def test_project_recorded_at_send_wins(self):
        _, files = self.flow('debt-q', [{'id': 'b1', 'name': 'debt-q', 'cwd': os.path.join(self.d, 'web')}], [])
        self.assertEqual(files, ['web.md'])

    def test_live_json_when_agents_fail(self):
        with open(os.path.join(self.d, 'live.json'), 'w', encoding='utf-8') as f:
            json.dump({'sessions': [{'id': 'b1', 'name': 'debt-q', 'cwd': os.path.join(self.d, 'web')}]}, f)
        _, files = self.flow('debt-q', [], [])
        self.assertEqual(files, ['web.md'])

    def test_name_with_id_form(self):
        _, files = self.flow('film-cut [7c3e9d]', [], [{'id': '7c3e9dff', 'name': 'film-cut', 'cwd': os.path.join(self.d, 'film')}])
        self.assertEqual(files, ['film.md'])

    def test_unknown_session_is_not_a_lesson_file(self):
        err, files = self.flow('debt-q', [], [])
        self.assertEqual(files, [])
        self.assertIn('scripts/task lesson', err)


class Project(unittest.TestCase):
    def test_세션_폴더로_프로젝트(self):
        agents = [{'id': 'a1', 'name': 'web', 'cwd': '/dev/web/.claude/worktrees/x'}, {'id': 'a2', 'cwd': '/else/y'}]
        self.assertEqual(task.project_of('web', agents, '/dev'), 'web')
        self.assertEqual(task.project_of('a2', agents, '/dev'), 'y')  # dev 밖은 폴더 이름 — 앱 classifyWorkspace·훅과 같은 규칙(2026-10-09)
        self.assertIsNone(task.project_of('없음', agents, '/dev'))

    def test_따로_추가한_프로젝트_폴더(self):
        agents = [{'id': 'o1', 'name': 'blog-bot', 'cwd': '/u/automation/blog-bot/content'}, {'id': 'o2', 'cwd': '/u/automation/blog-bot-old'}]
        self.assertEqual(task.project_of('o1', agents, '/dev', ['/u/automation/blog-bot/']), 'blog-bot')
        self.assertEqual(task.project_of('o2', agents, '/dev', ['/u/automation/blog-bot']), 'blog-bot-old')  # 이름이 앞만 같은 옆 폴더는 그 추가 폴더가 아니다


class OrchRoles(unittest.TestCase):
    # 2026-10-04 참모 역할 — send 가 project·fromName 을 남기고, 같은 프로젝트를 다른 참모가 최근 맡겨 왔으면 한 번 알린다
    DEV = '/d/dev'
    AGENTS = [
        {'id': 'aaaa0001', 'name': '참모 · 뽀삐', 'cwd': '/d/hq'},
        {'id': 'bbbb0002', 'name': '참모-2 · 두부', 'cwd': '/d/hq'},
        {'id': 'cccc0003', 'name': 'alpha-shop', 'cwd': '/d/dev/alpha-shop'},
        {'id': 'dddd0004', 'name': 'fix-cart', 'cwd': '/d/dev/alpha-shop/.claude/worktrees/fix-cart'},
    ]

    def run_send(self, target, me='aaaa0001', seed=(), agents=None, again=False):
        task.load_agents = lambda: agents if agents is not None else self.AGENTS
        task.DEV = self.DEV
        out, err = io.StringIO(), io.StringIO()
        old = os.environ.get('CLAUDE_JOB_DIR')
        os.environ['CLAUDE_JOB_DIR'] = f'/h/.claude/jobs/{me}'
        try:
            with tempfile.TemporaryDirectory() as d:
                task.LOG = os.path.join(d, 'tasks.jsonl')
                task.LESSONS = os.path.join(d, 'lessons')
                with open(task.LOG, 'w', encoding='utf-8') as f:
                    for e in seed:
                        f.write(json.dumps(e, ensure_ascii=False) + '\n')
                with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                    task.main(['send', target, '장바구니 버그'])
                    if again:
                        task.main(['send', target, '장바구니 버그 2'])
                events = [json.loads(l) for l in open(task.LOG, encoding='utf-8')]
        finally:
            if old is None:
                os.environ.pop('CLAUDE_JOB_DIR', None)
            else:
                os.environ['CLAUDE_JOB_DIR'] = old
        return err.getvalue(), events

    def ago(self, h):
        return (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=h)).isoformat(timespec='seconds')

    def test_send_는_프로젝트와_시킨_참모_기본_이름을_남긴다(self):
        _, ev = self.run_send('fix-cart')
        self.assertEqual((ev[-1]['project'], ev[-1]['fromName'], ev[-1]['from']), ('alpha-shop', '참모', 'aaaa0001'))

    def test_참모에게_넘긴_일은_프로젝트를_안_적는다(self):
        _, ev = self.run_send('참모-2 · 두부')
        self.assertNotIn('project', ev[-1])

    def test_다른_참모가_최근_맡긴_프로젝트면_한_번_알린다(self):
        seed = [{'ts': self.ago(20), 'type': 'send', 'task': 't1', 'target': 'alpha-shop', 'from': 'bbbb0002'}]
        err, _ = self.run_send('fix-cart', seed=seed, again=True)
        self.assertEqual(err.count('참모-2 · 두부'), 1, err)
        self.assertIn('handoff', err)

    def test_기록의_fromName_과_project_로도_찾는다(self):
        seed = [{'ts': self.ago(5), 'type': 'send', 'task': 't1', 'target': '사라진-세션', 'from': 'zzzz9999', 'fromName': '참모-2', 'project': 'alpha-shop'}]
        err, _ = self.run_send('alpha-shop', seed=seed)
        self.assertIn('참모-2 · 두부', err)

    def test_알리지_않는_때(self):
        old = [{'ts': self.ago(4 * 24), 'type': 'send', 'task': 't1', 'target': 'alpha-shop', 'from': 'bbbb0002'}]
        mine = [{'ts': self.ago(2), 'type': 'send', 'task': 't2', 'target': 'alpha-shop', 'from': 'aaaa0001'}]
        gone = [{'ts': self.ago(2), 'type': 'send', 'task': 't3', 'target': 'alpha-shop', 'from': 'eeee0005', 'fromName': '참모-5'}]
        other_project = [{'ts': self.ago(2), 'type': 'send', 'task': 't4', 'target': 'beta', 'from': 'bbbb0002', 'project': 'beta-blog'}]
        for seed in (old, mine, gone, other_project):
            err, _ = self.run_send('alpha-shop', seed=seed)
            self.assertNotIn('handoff', err, seed)

    def test_넘겨받은_일은_새_주인으로(self):
        # 두부가 맡긴 일을 뽀삐가 넘겨받았으면(own) 뽀삐 몫 — 겹침 아님
        seed = [{'ts': self.ago(5), 'type': 'send', 'task': 't1', 'target': 'alpha-shop', 'from': 'bbbb0002'},
                {'ts': self.ago(4), 'type': 'own', 'task': 't1', 'from': 'aaaa0001'}]
        err, _ = self.run_send('alpha-shop', seed=seed)
        self.assertNotIn('handoff', err)

    def test_HQ_도우미에게_보낸_일은_프로젝트를_안_적는다(self):
        agents = self.AGENTS + [{'id': 'hhhh0007', 'name': 'sns-post', 'cwd': '/d/dev/hq'}]
        old = task.HQ
        task.HQ = '/d/dev/hq'
        try:
            _, ev = self.run_send('sns-post', agents=agents)
        finally:
            task.HQ = old
        self.assertNotIn('project', ev[-1])

    def test_번호를_다시_쓴_새_참모의_옛_기록은_겹침이_아니다(self):
        seed = [{'ts': self.ago(20), 'type': 'send', 'task': 't1', 'target': 'alpha-shop', 'from': 'old00002', 'fromName': '참모-2'}]
        with tempfile.TemporaryDirectory() as d:
            born = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=5)).timestamp() * 1000
            with open(os.path.join(d, 'orch-roles.json'), 'w', encoding='utf-8') as f:
                json.dump({'참모-2': {'role': '', 'at': 1, 'born': born}}, f)
            self.assertIsNone(task.overlap_with('alpha-shop', '참모', self.AGENTS, seed, roles_dir=d))
            self.assertEqual(task.overlap_with('alpha-shop', '참모', self.AGENTS, seed), '참모-2 · 두부')

    def test_겹침_확인이_터져도_send_는_성공(self):
        seed = [{'ts': 12345, 'type': 'send', 'task': 't1', 'target': 'alpha-shop', 'from': 'bbbb0002'}, {'type': 'own'}]
        err, ev = self.run_send('alpha-shop', seed=seed)
        self.assertEqual(ev[-1]['target'], 'alpha-shop')

    def test_handoff_는_새_주인_기본_이름도_남긴다(self):
        task.load_agents = lambda: self.AGENTS
        with tempfile.TemporaryDirectory() as d:
            task.LOG = os.path.join(d, 'tasks.jsonl')
            with open(task.LOG, 'w', encoding='utf-8') as f:
                f.write(json.dumps({'ts': self.ago(1), 'type': 'send', 'task': 't1', 'target': 'alpha-shop', 'from': 'aaaa0001'}) + '\n')
            with contextlib.redirect_stdout(io.StringIO()):
                task.handoff('alpha-shop', '두부')
            last = [json.loads(l) for l in open(task.LOG, encoding='utf-8')][-1]
        self.assertEqual((last['type'], last['from'], last['fromName']), ('own', 'bbbb0002', '참모-2'))


if __name__ == '__main__':
    unittest.main()
