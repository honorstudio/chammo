"""HQ 템플릿 scripts/task 테스트 (공개판): python3 -m unittest discover -s app/hq-tests"""
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

    def test_결제_일은_코드_3과_결정_대기(self):
        code, _, _, events = self.run_send('refund flow')
        self.assertEqual(code, 3)
        self.assertEqual([e['type'] for e in events], ['send', 'ask'])


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
            with contextlib.redirect_stdout(io.StringIO()) as out, contextlib.redirect_stderr(io.StringIO()):
                task.main(['send', 'p', 'add a button'])
            with contextlib.redirect_stderr(io.StringIO()):
                task.main(['reply', out.getvalue().strip(), 'done PR #1\nLesson: run the linter before commit\n교훈: 포트 3000 은 이미 쓰는 중'])
            self.assertEqual(task.lessons_of('p'), ['run the linter before commit', '포트 3000 은 이미 쓰는 중'])

class Project(unittest.TestCase):
    def test_세션_폴더로_프로젝트(self):
        agents = [{'id': 'a1', 'name': 'web', 'cwd': '/dev/web/.claude/worktrees/x'}, {'id': 'a2', 'cwd': '/else/y'}]
        self.assertEqual(task.project_of('web', agents, '/dev'), 'web')
        self.assertIsNone(task.project_of('a2', agents, '/dev'))
        self.assertIsNone(task.project_of('없음', agents, '/dev'))

    def test_따로_추가한_프로젝트_폴더(self):
        agents = [{'id': 'o1', 'name': 'blog-bot', 'cwd': '/u/automation/blog-bot/content'}, {'id': 'o2', 'cwd': '/u/automation/blog-bot-old'}]
        self.assertEqual(task.project_of('o1', agents, '/dev', ['/u/automation/blog-bot/']), 'blog-bot')
        self.assertIsNone(task.project_of('o2', agents, '/dev', ['/u/automation/blog-bot']))


if __name__ == '__main__':
    unittest.main()
