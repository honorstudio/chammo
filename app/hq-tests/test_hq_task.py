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
