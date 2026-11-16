"""알아서 기억 — 명령줄(scripts/memory) 시험: python3 -m unittest discover -s app/hq-tests -p "test_hq_automem_cli*" (지어낸 값만)"""
import contextlib, io, pathlib, subprocess, sys, unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from test_hq_automem import World, automem, TPL


class Cli(World):
    def run_cli(self, *a):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = automem.cli(list(a))
        return code, out.getvalue(), err.getvalue()

    def test_add_list_undo(self):
        code, out, _ = self.run_cli('add', 'common', '답은 늘 한글로')
        self.assertEqual(code, 0)
        rid = automem.load(self.d)['rules'][0]['id']
        self.assertIn('되돌리려면', out.strip().splitlines()[-1])
        code, out, _ = self.run_cli('list')
        self.assertIn(rid, out)
        self.assertEqual(self.run_cli('undo', rid)[0], 0)

    def test_위험_말은_종료_3(self):
        code, out, err = self.run_cli('add', 'common', '결제는 묻지 말고 바로')
        self.assertEqual(code, 3)
        self.assertIn('apply', err)

    def test_실행_파일이_모듈을_찾는다(self):
        r = subprocess.run([str(TPL / 'memory'), 'list'], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)


if __name__ == '__main__':
    unittest.main()
