"""scripts/locker 시험(공개판): python3 -m unittest discover -s app/hq-tests"""
import contextlib, importlib.machinery, importlib.util, io, json, os, pathlib, sys, tempfile, unittest
from unittest import mock

sys.dont_write_bytecode = True

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / 'hq-template' / 'scripts'
RULES = ROOT / 'src-tauri' / 'src' / 'locker_rules.fixture.json'


def load(name):
    loader = importlib.machinery.SourceFileLoader(f'hq_{name}', str(SCRIPTS / name))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


locker = load('locker')


def put(p, text):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    pathlib.Path(p).write_text(text, encoding='utf-8')


class Rules(unittest.TestCase):
    def test_앱과_같은_표(self):
        fx = json.loads(RULES.read_text(encoding='utf-8'))
        self.assertEqual(fx['big'], locker.BIG)
        home, data = '/h', '/h/.chammo'
        settled = [os.path.join(home, s) for s in fx['settled']]
        for p, size, want in fx['decide']:
            real = os.path.join(data, 'attach', p[len('@attach/'):]) if p.startswith('@attach/') else os.path.join(home, p)
            self.assertEqual(locker.decide(real, size, home, data, settled), want, p)
        for name, fb, want in fx['names']:
            self.assertEqual(locker.safe_name(name, fb), want, name)

    def test_뿌리(self):
        self.assertEqual(locker.root_of('/h', '/h/.chammo'), '/h/Documents/Chammo')
        self.assertEqual(locker.root_of('/h', '/h/.chammo-test'), '/h/.chammo-test/Documents-Chammo')
        self.assertEqual(locker.root_of('/h', '/h/.chammo', '/x'), '/x')


class Cli(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = os.path.realpath(self.tmp.name)
        self.home = os.path.join(base, 'home')
        self.data = os.path.join(self.home, '.chammo-test')
        os.makedirs(os.path.join(self.home, 'Downloads'))
        os.makedirs(self.data)
        put(os.path.join(self.data, 'live.json'), json.dumps({'sessions': [{'id': 'aaaa0001', 'sessionId': 'aaaa0001-0000', 'name': '참모-2 · 시험'}]}))
        put(os.path.join(self.data, 'config.json'), json.dumps({'devRoot': '~/Desktop/dev'}))
        self.env = mock.patch.dict(os.environ, {'HOME': self.home, 'CHAMMO_HOME': self.data})
        self.env.start()
        self.root = os.path.join(self.data, 'Documents-Chammo')
        self.mine = os.path.join(self.root, '참모-2 · 시험')
        self.outside = os.path.join(base, 'outside.pdf')
        put(self.outside, 'x')

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def run_(self, *argv, job='/h/.claude/jobs/aaaa0001'):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = locker.main(list(argv), env={'CLAUDE_JOB_DIR': job} if job else {}, cwd=self.home)
        return code, out.getvalue(), err.getvalue()

    def test_다운로드는_복사_프로젝트는_바로가기(self):
        put(os.path.join(self.home, 'Downloads', '견적.xlsx'), '원본')
        proj = os.path.join(self.home, 'Desktop', 'dev', 'shop-video', 'cut.png')
        put(proj, 'c')
        code, out, _ = self.run_('add', 'Downloads/견적.xlsx', 'Desktop/dev/shop-video/cut.png', '--folder', '10월 보고/세부')
        self.assertEqual(code, 0, out)
        got = os.path.join(self.mine, '10월 보고', '세부', '견적.xlsx')
        self.assertEqual(pathlib.Path(got).read_text(encoding='utf-8'), '원본')
        self.assertFalse(os.path.islink(got))
        self.assertTrue(os.path.exists(os.path.join(self.home, 'Downloads', '견적.xlsx')), '원본은 그대로')
        self.assertEqual(os.readlink(os.path.join(self.mine, '10월 보고', '세부', 'cut.png')), proj)
        self.assertEqual(locker.id_of(self.mine), 'aaaa0001')
        code, out, _ = self.run_('ls')
        self.assertIn('10월 보고/세부/견적.xlsx', out)
        self.assertIn('→ ' + proj, out)
        # 같은 이름은 번호
        self.run_('add', 'Downloads/견적.xlsx', '--folder', '10월 보고/세부')
        self.assertTrue(os.path.exists(os.path.join(self.mine, '10월 보고', '세부', '견적 2.xlsx')))

    def test_홈_밖·데이터_폴더·링크로_빠져나가기·폴더는_거절(self):
        put(os.path.join(self.data, 'accounts.json'), '{}')
        os.symlink(self.outside, os.path.join(self.home, 'Downloads', '밖.pdf'))
        for a in (self.outside, os.path.join(self.data, 'accounts.json'), 'Downloads/밖.pdf', 'Downloads', 'Downloads/없음.pdf'):
            code, _, err = self.run_('add', a)
            self.assertEqual(code, 1, a)
            self.assertTrue(err.startswith('locker: '), err)
        self.assertEqual([n for n in os.listdir(self.mine) if not n.startswith('.') and not os.path.isdir(os.path.join(self.mine, n))], [])

    def test_주인을_모르면_멈추고_to_로_고른다(self):
        put(os.path.join(self.home, 'Downloads', 'a.md'), '# a')
        code, _, err = self.run_('add', 'Downloads/a.md', job='')
        self.assertEqual(code, 2)
        self.assertIn('--to', err)
        code, _, _ = self.run_('add', 'Downloads/a.md', '--to', '참모-2 · 시험', job='')
        self.assertEqual(code, 0)
        self.assertTrue(os.path.exists(os.path.join(self.mine, 'a.md')))

    def test_폴더_없이_넣으면_보관함_맨_위·새_참모엔_자료_하나(self):
        put(os.path.join(self.home, 'Downloads', 'b.md'), '# b')
        self.assertEqual(self.run_('add', 'Downloads/b.md')[0], 0)
        self.assertTrue(os.path.isfile(os.path.join(self.mine, 'b.md')))
        self.assertTrue(os.path.isdir(os.path.join(self.mine, '자료')))
        self.assertFalse(os.path.exists(os.path.join(self.mine, '받은 것')))

    def test_이상한_폴더_이름은_거절(self):
        self.assertEqual(self.run_('folder', '../밖')[0], 2)
        self.assertEqual(self.run_('folder', '.숨김')[0], 2)
        self.assertEqual(self.run_('folder', '견적/세부')[0], 0)
        self.assertTrue(os.path.isdir(os.path.join(self.mine, '견적', '세부')))

    def test_바로가기를_못_만드는_PC_에선_이사하지_않는다(self):
        # 윈도우(개발자 모드 꺼짐)에서 바로가기 대신 복사가 놓이는데도 성공으로 끝나 보관함·프로젝트에 따로 노는 두 벌이 생겼다(2026-10-21 리뷰)
        put(os.path.join(self.home, 'Downloads', '컷.png'), 'img')
        self.run_('add', 'Downloads/컷.png')
        at = os.path.join(self.mine, '컷.png')
        proj = os.path.join(self.home, 'Desktop', 'dev', 'shop-video')
        os.makedirs(proj)
        with mock.patch.object(locker.os, 'symlink', side_effect=OSError(1314, 'A required privilege is not held by the client')):
            code, _, err = self.run_('give', at, proj)
        self.assertNotEqual(code, 0)
        self.assertFalse(os.path.islink(at))
        self.assertEqual(pathlib.Path(at).read_text(encoding='utf-8'), 'img', '보관함 파일은 제자리에 그대로')
        self.assertFalse(os.path.exists(os.path.join(proj, 'assets', '보관함', '컷.png')), '프로젝트엔 안 남는다')
        self.assertEqual([x for x in os.listdir(self.mine) if x.startswith('.컷')], [], '치워 둔 원본·조각이 안 남는다')

    def test_이사와_되돌리기(self):
        put(os.path.join(self.home, 'Downloads', '컷.png'), 'img')
        self.run_('add', 'Downloads/컷.png')
        at = os.path.join(self.mine, '컷.png')
        proj = os.path.join(self.home, 'Desktop', 'dev', 'shop-video')
        os.makedirs(proj)
        code, out, err = self.run_('give', at, proj)
        self.assertEqual(code, 0, err)
        to = os.path.join(proj, 'assets', '보관함', '컷.png')
        self.assertEqual(out.strip(), to)
        self.assertEqual(os.readlink(at), to)
        # 둘째 프로젝트엔 복사
        p2 = os.path.join(self.home, 'Desktop', 'dev', 'shop-reel')
        os.makedirs(p2)
        code, out, _ = self.run_('give', at, p2)
        self.assertEqual(pathlib.Path(out.strip()).read_text(encoding='utf-8'), 'img')
        self.assertEqual(os.readlink(at), to)
        code, _, err = self.run_('back', at)
        self.assertEqual(code, 0, err)
        self.assertFalse(os.path.islink(at))
        self.assertFalse(os.path.exists(to))
        # 보관함 밖 파일·홈 밖 프로젝트는 거절
        self.assertEqual(self.run_('give', os.path.join(self.home, 'Downloads', '컷.png'), proj)[0], 1)
        self.assertEqual(self.run_('give', at, os.path.dirname(self.outside))[0], 1)

    def test_데이터_폴더_안_프로젝트는_이유를_말하고_거절한다(self):
        # soak 004 — devRoot 가 데이터 폴더 안이면 give 가 "can't use this as a project" 만 찍어 이유를 몰랐다
        put(os.path.join(self.home, 'Downloads', '컷.png'), 'img')
        self.run_('add', 'Downloads/컷.png')
        at = os.path.join(self.mine, '컷.png')
        proj = os.path.join(self.data, 'dev', 'soak-page')
        os.makedirs(proj)
        code, _, err = self.run_('give', at, proj)
        self.assertEqual(code, 1)
        self.assertIn('data folder', err)
        self.assertIn('devRoot', err)
        self.assertFalse(os.path.islink(at), '거절이면 보관함 파일은 제자리')

    def test_심어_둔_조각_링크를_안_따라간다(self):
        victim = os.path.join(self.home, 'Documents', '소중.txt')
        put(victim, '소중')
        os.makedirs(self.mine, exist_ok=True)
        locker.id_of(self.mine) or put(os.path.join(self.mine, '.chammo'), 'aaaa0001\n')
        os.symlink(victim, os.path.join(self.mine, '.a.txt' + locker.PART))
        put(os.path.join(self.home, 'Downloads', 'a.txt'), '새것')
        self.assertEqual(self.run_('add', 'Downloads/a.txt')[0], 0)
        self.assertEqual(pathlib.Path(victim).read_text(encoding='utf-8'), '소중')

    def test_폴더_중간이_링크면_거절(self):
        self.run_('folder', '자료')
        out = os.path.join(os.path.dirname(self.home), 'out')
        os.makedirs(out)
        os.symlink(out, os.path.join(self.mine, '탈출'))
        self.assertEqual(self.run_('folder', '탈출/x')[0], 2)
        self.assertEqual(os.listdir(out), [])

    def test_assets_가_링크인_프로젝트엔_이사_안_함(self):
        put(os.path.join(self.home, 'Downloads', '컷.png'), 'img')
        self.run_('add', 'Downloads/컷.png')
        at = os.path.join(self.mine, '컷.png')
        proj = os.path.join(self.home, 'Desktop', 'dev', 'cloned')
        os.makedirs(proj)
        out = os.path.join(os.path.dirname(self.home), 'out2')
        os.makedirs(out)
        os.symlink(out, os.path.join(proj, 'assets'))
        self.assertEqual(self.run_('give', at, proj)[0], 1)
        self.assertEqual(os.listdir(out), [])
        self.assertFalse(os.path.islink(at))

    def test_다른_보관함이_쓰면_되돌려도_프로젝트_쪽은_남긴다(self):
        put(os.path.join(self.home, 'Downloads', '컷.png'), 'img')
        self.run_('add', 'Downloads/컷.png')
        at = os.path.join(self.mine, '컷.png')
        proj = os.path.join(self.home, 'Desktop', 'dev', 'shop-video')
        os.makedirs(proj)
        to = self.run_('give', at, proj)[1].strip()
        other = os.path.join(self.root, '총무')
        os.makedirs(other)
        put(os.path.join(self.root, '총무', '.chammo'), 'zzzz9999\n')
        os.symlink(to, os.path.join(other, '컷.png'))
        self.assertEqual(self.run_('back', at)[0], 0)
        self.assertTrue(os.path.isfile(to))

    def test_이름이_바뀐_참모는_폴더도_따라간다(self):
        self.run_('folder', '자료')
        put(os.path.join(self.data, 'live.json'), json.dumps({'sessions': [{'id': 'aaaa0001', 'name': '총무'}]}))
        self.run_('ls')
        self.assertTrue(os.path.isdir(os.path.join(self.root, '총무', '자료')))
        self.assertFalse(os.path.exists(self.mine))


if __name__ == '__main__':
    unittest.main()
