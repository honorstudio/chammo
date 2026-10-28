"""HQ scripts/craft 닫을 때 저장 — 새 문서는 앞 문서를 덮지 않고, 덮는 길은 직전 사본을 휴지통에:
python3 -m unittest discover -s app/hq-tests -p 'test_hq_craft_save.py' — 진짜 앱·휴지통 없이"""
import importlib.machinery, importlib.util, os, pathlib, sys, tempfile, unittest

sys.dont_write_bytecode = True

SCRIPT = pathlib.Path(__file__).resolve().parent.parent / 'hq-template' / 'scripts' / 'craft'


def load():
    loader = importlib.machinery.SourceFileLoader('hq_craft_save', str(SCRIPT))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


craft = load()


class Save(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        self.d = self.t.name
        self.trash = os.path.join(self.d, 'trash')
        os.makedirs(self.trash)
        self.old, craft.TRASH = craft.TRASH, self.trash

    def tearDown(self):
        craft.TRASH = self.old
        self.t.cleanup()

    def test_새_문서는_우리가_써_둔_untitled_도_덮지_않는다(self):
        old = os.path.join(self.d, 'untitled.vectorcraft')
        pathlib.Path(old).write_bytes(b'EARLIER')
        plan = craft.close_plan({'name': ''}, {}, self.d, '/w', {old}, '.vectorcraft')
        self.assertEqual(plan, [('untitled.vectorcraft', os.path.join(self.d, 'untitled 2.vectorcraft'))])

    def test_사람_파일_되저장은_그_자리(self):
        self.assertEqual(craft.close_plan({'name': 'a.docx'}, {'a.docx': '/u/a.docx'}, self.d, '/w', ext='.docx'), [('a.docx', '/u/a.docx')])

    def test_덮기_직전_사본은_휴지통에(self):
        dest = os.path.join(self.d, 'card.ai')
        pathlib.Path(dest).write_bytes(b'BEFORE')
        new = os.path.join(self.d, 'new.ai')
        pathlib.Path(new).write_bytes(b'AFTER')
        craft._copy_over(new, dest)
        self.assertEqual(pathlib.Path(dest).read_bytes(), b'AFTER')
        kept = os.listdir(self.trash)
        self.assertEqual([pathlib.Path(self.trash, k).read_bytes() for k in kept], [b'BEFORE'])
        self.assertTrue(kept[0].startswith('card (') and kept[0].endswith('.ai'), kept)

    def test_사본을_못_남기면_덮지_않는다(self):
        dest = os.path.join(self.d, 'card.ai')
        pathlib.Path(dest).write_bytes(b'BEFORE')
        new = os.path.join(self.d, 'new.ai')
        pathlib.Path(new).write_bytes(b'AFTER')
        craft.TRASH = os.path.join(self.d, 'missing')
        with self.assertRaises(craft.CraftError):
            craft._copy_over(new, dest)
        self.assertEqual(pathlib.Path(dest).read_bytes(), b'BEFORE')

    def test_같은_내용이면_같은_파일(self):
        a, b, c = (os.path.join(self.d, n) for n in 'abc')
        pathlib.Path(a).write_bytes(b'SAME')
        pathlib.Path(b).write_bytes(b'SAME')
        pathlib.Path(c).write_bytes(b'DIFF')
        self.assertTrue(craft.same_file(a, b))
        self.assertFalse(craft.same_file(a, c))
        self.assertFalse(craft.same_file(a, os.path.join(self.d, 'none')))


if __name__ == '__main__':
    unittest.main()
