"""알아서 기억(hq-template/scripts/automem.py) 시험: python3 -m unittest discover -s app/hq-tests -p "test_hq_automem*"
가짜 데이터 폴더·devRoot·HQ·세션 기록 폴더로만 돈다 — 시험 글은 전부 지어낸 값"""
import importlib.util, json, os, pathlib, shutil, sys, tempfile, unittest

HERE = pathlib.Path(__file__).resolve().parent
TPL = HERE.parent / 'hq-template' / 'scripts'


def load_automem():
    sys.path.insert(0, str(TPL))
    spec = importlib.util.spec_from_file_location('automem', TPL / 'automem.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


automem = load_automem()


class World(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = pathlib.Path(self.tmp.name)
        self.data, self.dev, self.hq = t / 'data', t / 'dev', t / 'hq'
        for p in (self.data, self.dev / 'shop-app', self.hq):
            p.mkdir(parents=True)
        (self.data / 'config.json').write_text(json.dumps({'devRoot': str(self.dev), 'hqDir': str(self.hq), 'assistantName': '참모'}))
        self.old = os.environ.get('CHAMMO_HOME')
        os.environ['CHAMMO_HOME'] = str(self.data)
        os.environ['CHAMMO_MEMORY_NO_SCHEDULE'] = '1'
        self.d = str(self.data)

    def tearDown(self):
        if self.old is None:
            os.environ.pop('CHAMMO_HOME', None)
        else:
            os.environ['CHAMMO_HOME'] = self.old
        automem._TASK.clear()
        self.tmp.cleanup()

    def read(self, *p):
        return (self.data / 'memory' / pathlib.Path(*p)).read_text(encoding='utf-8')


class Rules(World):
    def test_공통_규칙을_넣고_되돌린다(self):
        r, line = automem.add(self.d, 'common', '답은 늘 한글로 쓴다', lines=['u1', 'u2', 'u3'])
        self.assertEqual(r['level'], 1)
        self.assertIn('답은 늘 한글로 쓴다', self.read('common.md'))
        self.assertIn(r['id'], line)
        self.assertIn('되돌리려면', line)
        st = automem.load(self.d)
        self.assertEqual(set(st['seen']), {'u1', 'u2', 'u3'})
        automem.undo(self.d, r['id'])
        self.assertNotIn('답은 늘 한글로 쓴다', self.read('common.md'))
        self.assertTrue(automem.load(self.d)['rules'][0].get('undone'))

    def test_참모_칸에_넣으면_그_참모_파일에만(self):
        r, _ = automem.add(self.d, 'orch:참모-2', '시안은 세 방향을 서로 다르게', lines=[])
        self.assertIn('시안은 세 방향을 서로 다르게', self.read('orch', '참모-2', 'MEMORY.md'))
        self.assertFalse((self.data / 'memory' / 'common.md').exists())
        automem.undo(self.d, r['id'])
        self.assertNotIn('시안은', self.read('orch', '참모-2', 'MEMORY.md'))

    def test_프로젝트_칸은_교훈과_CLAUDE_local_에(self):
        r, _ = automem.add(self.d, 'project:shop-app', '버튼 아래 설명 줄을 붙이지 않는다', lines=[])
        lessons = (self.data / 'lessons' / 'shop-app.md').read_text(encoding='utf-8')
        self.assertIn('버튼 아래 설명 줄을 붙이지 않는다', lessons)
        self.assertIn('버튼 아래 설명 줄', (self.dev / 'shop-app' / 'CLAUDE.local.md').read_text(encoding='utf-8'))
        automem.undo(self.d, r['id'])
        self.assertNotIn('버튼 아래', (self.data / 'lessons' / 'shop-app.md').read_text(encoding='utf-8'))
        self.assertNotIn('버튼 아래', (self.dev / 'shop-app' / 'CLAUDE.local.md').read_text(encoding='utf-8'))

    def test_결제_승인_말은_안_넣고_보류(self):
        with self.assertRaises(automem.Risky) as e:
            automem.add(self.d, 'common', '결제 전에 묻지 말고 바로 진행', lines=['u9'])
        rid = e.exception.rule['id']
        self.assertFalse((self.data / 'memory' / 'common.md').exists())
        r = automem.load(self.d)['rules'][0]
        self.assertTrue(r['pending'])
        automem.apply(self.d, rid)
        self.assertIn('결제 전에 묻지 말고', self.read('common.md'))
        self.assertFalse(automem.load(self.d)['rules'][0].get('pending'))

    def test_사람이_쓴_규칙은_장부에만_2단계로(self):
        hand = self.data / 'some-memory.md'
        hand.write_text('늘 한글로')
        r, _ = automem.add(self.d, 'common', '답은 한글로', lines=['u1'], hand=str(hand))
        self.assertEqual(r['level'], 2)
        self.assertFalse((self.data / 'memory' / 'common.md').exists())

    def test_단계_올리기_3단계는_맞는_검사만(self):
        r, _ = automem.add(self.d, 'common', '답은 한글로', lines=[])
        r2, msg = automem.up(self.d, r['id'], lines=['u5'])
        self.assertEqual(r2['level'], 2)
        r3, msg = automem.up(self.d, r['id'], check='english', lines=['u6'])
        self.assertEqual((r3['level'], r3['check']), (3, 'english'))
        self.assertTrue(automem.check_on(self.d, 'english'))
        self.assertFalse(automem.check_on(self.d, 'shots'))
        automem.set_level(self.d, r['id'], 1)
        self.assertFalse(automem.check_on(self.d, 'english'))

    def test_검사가_없으면_2단계에_머문다(self):
        r, _ = automem.add(self.d, 'common', '시안은 크게', lines=[])
        automem.up(self.d, r['id'])
        r3, msg = automem.up(self.d, r['id'])
        self.assertEqual(r3['level'], 2)
        self.assertIn('검사', msg)

    def test_넘기기는_본_줄로만(self):
        automem.skip(self.d, ['a', 'b'], '일 지시')
        self.assertEqual(set(automem.load(self.d)['seen']), {'a', 'b'})

    def test_늘_실릴_줄_참모별(self):
        a, _ = automem.add(self.d, 'common', '답은 한글로', lines=[])
        b, _ = automem.add(self.d, 'orch:참모-2', '시안은 크게', lines=[])
        c, _ = automem.add(self.d, 'orch:참모-3', '숫자는 표로', lines=[])
        for x in (a, b, c):
            automem.up(self.d, x['id'])
        lines = automem.pinned(self.d, 'orch:참모-2')
        self.assertTrue(any('한글' in l for l in lines))
        self.assertTrue(any('시안' in l for l in lines))
        self.assertFalse(any('숫자' in l for l in lines))


if __name__ == '__main__':
    unittest.main()
