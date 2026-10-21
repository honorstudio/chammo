"""HQ scripts/sheet 테스트 — 참모가 엑셀 칸을 앱을 거쳐 읽고 쓴다: python3 -m unittest discover -s app/hq-tests"""
import importlib.machinery, importlib.util, json, os, pathlib, subprocess, sys, tempfile, threading, time, unittest

sys.dont_write_bytecode = True

SCRIPT = pathlib.Path(__file__).resolve().parent.parent / 'hq-template' / 'scripts' / 'sheet'


def load():
    loader = importlib.machinery.SourceFileLoader('hq_sheet', str(SCRIPT))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


sheet = load()


def fake_app(data, answer):
    """앱 흉내 — app.jsonl 에 줄이 생기면 그 id 로 sheet.txt 에 답을 쓴다. 받은 줄을 돌려준다"""
    got = {}

    def run():
        p = os.path.join(data, 'app.jsonl')
        for _ in range(100):
            if os.path.exists(p):
                with open(p, encoding='utf-8') as f:
                    text = f.read().strip()
                if text:
                    line = json.loads(text.splitlines()[-1])
                    got.update(line)
                    with open(os.path.join(data, 'sheet.txt'), 'w', encoding='utf-8') as f:
                        f.write(f"#id {line['id']}\n{json.dumps(answer, ensure_ascii=False)}\n")
                    return
            time.sleep(0.05)

    t = threading.Thread(target=run)
    t.start()
    return t, got


class Answers(unittest.TestCase):
    def test_겹친_부탁의_답이_한_칸을_덮어도_내_답을_받는다(self):
        # 앱이 답을 한 칸(sheet.txt)에만 써서 뒤 부탁 답이 앞 답을 덮으면 앞 스크립트는 '앱이 답하지 않았어'로 끝났다(2026-10-21 리뷰)
        d = tempfile.mkdtemp()

        def app():
            p = os.path.join(d, 'app.jsonl')
            for _ in range(100):
                if os.path.exists(p) and open(p, encoding='utf-8').read().strip():
                    rid = json.loads(open(p, encoding='utf-8').read().splitlines()[-1])['id']
                    os.makedirs(os.path.join(d, 'answers'), exist_ok=True)
                    with open(os.path.join(d, 'answers', f'sheet-{rid}.txt'), 'w', encoding='utf-8') as f:
                        f.write(f'#id {rid}\n{{"ok": true, "n": 1}}\n')
                    with open(os.path.join(d, 'sheet.txt'), 'w', encoding='utf-8') as f:
                        f.write('#id someone-else\n{"ok": true, "n": 2}\n')  # 곧바로 다른 부탁 답이 한 칸을 덮음
                    return
                time.sleep(0.02)
        t = threading.Thread(target=app); t.start()
        code, ans = sheet.ask(d, {'verb': 'get'}, 3)
        t.join()
        self.assertEqual((code, ans), (0, {'ok': True, 'n': 1}))
        self.assertEqual(os.listdir(os.path.join(d, 'answers')), [], '읽은 답은 지운다')


class Sheet(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.xlsx = os.path.join(self.d, '가계부.xlsx')
        with open(self.xlsx, 'wb') as f:
            f.write(b'PK')

    def run_script(self, *args, extra=None):
        env = {'CHAMMO_HOME': self.d, 'HOME': self.d, 'PATH': '/usr/bin:/bin', 'CHAMMO_SHEET_WAIT': '3', **(extra or {})}
        return subprocess.run([sys.executable, str(SCRIPT), *args], env=env, capture_output=True, text=True)

    def test_인자_짝과_값(self):
        arg, err = sheet.parse(['set', self.xlsx, '매출!B3', '12', 'C3', '=B3*2'])
        self.assertIsNone(err)
        self.assertEqual(arg['cells'], [{'at': '매출!B3', 'value': '12'}, {'at': 'C3', 'value': '=B3*2'}])
        self.assertTrue(sheet.parse(['set', self.xlsx, 'B3'])[1], '값이 빠지면 안 된다')
        self.assertTrue(sheet.parse(['get', os.path.join(self.d, 'a.csv')])[1], '엑셀만')
        self.assertEqual(sheet.parse(['get', self.xlsx])[0]['range'], '')

    def test_쓰기는_세션_id_를_붙여_앱에_보내고_답을_말한다(self):
        t, got = fake_app(self.d, {'ok': True, 'written': 2, 'shown': True, 'skipped': ['매출!B3']})
        r = self.run_script('set', self.xlsx, '매출!B3', '12', 'C3', '=B3*2', extra={'CLAUDE_JOB_DIR': '/tmp/jobs/aaaa1111'})
        t.join()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(got['action'], 'sheet')
        self.assertEqual(got['arg']['by'], 'aaaa1111')
        self.assertEqual(got['arg']['path'], os.path.realpath(self.xlsx))
        self.assertIn('wrote 2 cell(s)', r.stdout)
        self.assertIn('매출!B3', r.stdout)

    def test_읽기는_앱이_준_줄을_그대로(self):
        t, _ = fake_app(self.d, {'ok': True, 'text': '매출!A1\t품목\n매출!C2\t60000\t=A2*B2'})
        r = self.run_script('get', self.xlsx, '매출!A1:C2')
        t.join()
        self.assertEqual((r.returncode, r.stdout), (0, '매출!A1\t품목\n매출!C2\t60000\t=A2*B2\n'))

    def test_실패와_무응답(self):
        t, _ = fake_app(self.d, {'ok': False, 'error': "'없음' 시트가 없어"})
        r = self.run_script('get', self.xlsx, '없음!A1')
        t.join()
        self.assertEqual(r.returncode, 1)
        self.assertIn('시트가 없어', r.stderr)
        r = self.run_script('get', self.xlsx, extra={'CHAMMO_SHEET_WAIT': '0.5'})
        self.assertEqual(r.returncode, 1)
        self.assertIn('Chammo', r.stderr)
        self.assertEqual(self.run_script('set', self.xlsx, 'B3').returncode, 2)
        self.assertEqual(self.run_script('get', os.path.join(self.d, '없음.xlsx')).returncode, 1)


if __name__ == '__main__':
    unittest.main()
