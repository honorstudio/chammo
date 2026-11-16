"""공개판 정리꾼(hq-template/scripts/tidy) 시험: python3 -m unittest discover -s app/hq-tests -p "test_hq_tidy*"
공개판 task 엔 폰 앱 칸(_app)이 없다 — 그래도 돌고, 아무 설정이 없으면 30일 넘게 안 열린 교훈 스킬을 보관한다(알아서 기억 ④, 2026-11-16). 지어낸 값만"""
import contextlib, datetime, importlib.machinery, importlib.util, io, json, os, pathlib, shutil, sys, tempfile, unittest
from unittest import mock

SCRIPTS = pathlib.Path(__file__).resolve().parent.parent / 'hq-template' / 'scripts'


def ago(days):
    return (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)).isoformat(timespec='seconds')


class PublicTidy(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.old = os.environ.get('CHAMMO_HOME')
        os.environ['CHAMMO_HOME'] = self.d
        pathlib.Path(self.d, 'config.json').write_text(json.dumps({'devRoot': os.path.join(self.d, 'dev')}))
        os.makedirs(os.path.join(self.d, 'dev'))
        ld = importlib.machinery.SourceFileLoader('pub_tidy', str(SCRIPTS / 'tidy'))
        self.tidy = importlib.util.module_from_spec(importlib.util.spec_from_loader(ld.name, ld))
        ld.exec_module(self.tidy)
        self.task = self.tidy.task
        self.tidy.MEM_ROOT = os.path.join(self.d, 'projects')
        self.home = os.path.join(self.d, 'skills')
        self.p = mock.patch.object(self.task.lesson_skill, 'default_skills_home', lambda: self.home)
        self.p.start()
        os.makedirs(self.task.LESSONS, exist_ok=True)

    def tearDown(self):
        self.p.stop()
        if self.old is None:
            os.environ.pop('CHAMMO_HOME', None)
        else:
            os.environ['CHAMMO_HOME'] = self.old
        shutil.rmtree(self.d, ignore_errors=True)

    def skill(self, name, days_old):
        os.makedirs(os.path.join(self.home, name))
        path = os.path.join(self.home, name, 'SKILL.md')
        pathlib.Path(path).write_text('x')
        with open(os.path.join(self.task.LESSONS, 'skills.jsonl'), 'a', encoding='utf-8') as f:
            f.write(json.dumps({'ts': ago(days_old), 'action': 'promote', 'project': '_common', 'skill': name, 'desc': '지어낸 설명', 'path': path, 'lines': ['l']}) + '\n')
        return path

    def run_(self, *a):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = self.tidy.main(list(a))
        return code, out.getvalue()

    def test_공개판_task_로도_돌고_기본은_보관(self):
        path = self.skill('lesson-common-old', 40)
        self.assertEqual(self.tidy.mode(), 'apply')
        code, out = self.run_('run')
        self.assertEqual(code, 0)
        self.assertFalse(os.path.exists(path))
        self.assertIn('보관 1', out.splitlines()[0])
        self.assertEqual(self.run_('restore', 'lesson-common-old')[0], 0)
        self.assertTrue(os.path.exists(path))

    def test_사람이_report_로_끄면_보관_안_함(self):
        path = self.skill('lesson-common-old', 40)
        self.run_('mode', 'report')
        self.run_('run')
        self.assertTrue(os.path.exists(path))


if __name__ == '__main__':
    unittest.main()
