"""알아서 기억 — 사람 말 뽑기·묶기(scan) 시험: python3 -m unittest discover -s app/hq-tests -p "test_hq_automem_scan*" (지어낸 기록으로만)"""
import pathlib, sys, unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from test_hq_automem import automem
from test_hq_automem_lines import Logs, ts


class Scan(Logs):
    def scan(self):
        return automem.scan(self.d, root=str(self.root))

    def test_한_참모에게_세_번_한_말은_그_참모_칸_후보(self):
        self.session(self.hq_folder(), '참모-2 · 디자인', [
            (9, '시안 텍스트는 항상 소넷 미디엄으로 써줘'),
            (5, '텍스트는 소넷 미디엄으로 좀 쓰라고'),
            (1, '왜 또 텍스트를 소넷 미디엄 말고 다른걸로 썼어'),
            (1, '[앱] 정리할 세션: shop-app(1234) — 갱신 없이 바로 끄기'),
            (1, '<cross-session-message from-name="참모">텍스트 소넷 미디엄</cross-session-message>'),
            (2, '텍스트는 소넷 미디엄 첫 지시', {'index': 1}),
            (3, '텍스트는 소넷 미디엄 아님', {'kind': 'model'}),
        ])
        r = self.scan()
        self.assertEqual(len(r['new']), 1)
        c = r['new'][0]
        self.assertEqual((c['n'], c['scope']), (3, 'orch:참모-2'))
        self.assertFalse(any('[앱]' in s['text'] or '첫 지시' in s['text'] for s in c['samples']))

    def test_두_참모에_걸치면_공통(self):
        self.session(self.hq_folder(), '참모-2 · 디자인', [(6, '설명 같은 글자 좀 붙이지 마'), (4, '화면에 설명 글자 붙이지 말자')])
        self.session(self.hq_folder(), '참모-3', [(2, '왜 또 설명 글자 붙였어 붙이지 마')])
        c = self.scan()['new'][0]
        self.assertEqual(c['scope'], 'common')

    def test_프로젝트_세션에서_끼어든_말은_그_프로젝트(self):
        cwd = str(self.dev / 'shop-app')
        self.session(automem.launch_key(cwd), 'shop-app', [(8, '버튼 아래 설명 줄 붙이지 마', {'cwd': cwd}),
                                                           (4, '버튼 설명 줄 또 붙였네 붙이지 말라고', {'cwd': cwd}),
                                                           (1, '왜 버튼 아래 설명 줄 자꾸 붙여', {'cwd': cwd})])
        c = self.scan()['new'][0]
        self.assertEqual(c['scope'], 'project:shop-app')

    def test_두_번은_총_2로_알린다(self):
        self.session(self.hq_folder(), '참모-2', [(3, '시안은 늘 세 방향으로 줘'), (1, '시안은 세 방향으로 늘 줘')])
        self.assertEqual(self.scan()['new'][0]['total'], 2)

    def test_같은_뜻_다른_말은_find_로_센다(self):
        self.session(self.hq_folder(), '참모-2', [(6, '한국말 좀 써'), (4, '영어 쓰지 마'), (2, '또 영어로 답하네')])
        r = self.scan()
        f = automem.find_said(self.d, '한국말|한글|영어')
        self.assertEqual((f['n'], f['scope']), (3, 'orch:참모-2'))
        got = automem.resolve(self.d, f['cid'])
        self.assertEqual(len(got['lines']), 3)
        automem.skip(self.d, automem.fresh_lines(self.d))
        self.assertEqual(self.scan()['fresh'], 0)

    def test_옛_말이_이웃으로_붙는다(self):
        self.session(self.hq_folder(), '참모-2', [(9, '설명 같은 글자 붙이지 마'), (8, '설명 글자 좀 붙이지 마')])
        self.scan()
        automem.skip(self.d, automem.fresh_lines(self.d))
        self.session(self.hq_folder(), '참모-2', [(1, '설명 글자 왜 또 붙였어')])
        c = self.scan()['new'][0]
        self.assertEqual((c['n'], c['total']), (1, 3))

    def test_본_줄은_다시_안_올라온다_새_줄이_오면_다시(self):
        self.session(self.hq_folder(), '참모-2', [(6, '답은 한국말로 좀 해'), (4, '한국말로 좀 답해'), (2, '왜 또 영어야 한국말로 해')])
        c = self.scan()['new'][0]
        automem.skip(self.d, automem.resolve(self.d, c['cid'])['lines'], '시험')
        self.assertEqual(self.scan()['new'], [])

    def test_규칙_뒤에_또_한_말은_또_후보(self):
        sid = self.session(self.hq_folder(), '참모-2', [(9, '답은 한국말로 좀 해'), (8, '한국말로 좀 답해'), (7, '왜 또 영어야 한국말로 해')])
        c = self.scan()['new'][0]
        got = automem.resolve(self.d, c['cid'])
        rule, _ = automem.add(self.d, 'common', '답은 늘 한글로', lines=got['lines'], said=got['said'])
        st = automem.load(self.d)
        st['rules'][0]['created'] = ts(6)
        automem.save(self.d, st)
        self.session(self.hq_folder(), '참모-2', [(1, '한국말로 좀 하라니까')])
        r = self.scan()
        self.assertEqual(r['new'], [])
        self.assertEqual(len(r['again']), 1)
        a = r['again'][0]
        self.assertEqual(a['rule'], rule['id'])
        automem.up(self.d, rule['id'], lines=automem.resolve(self.d, a['cid'])['lines'])
        self.assertEqual(self.scan()['again'], [])

    def test_결제_말은_위험_표시(self):
        self.session(self.hq_folder(), '참모', [(5, '결제 화면 테스트는 묻지 말고 해'), (3, '결제 테스트 왜 또 묻냐 묻지 말고 해'), (1, '결제 테스트는 묻지 말라고')])
        self.assertTrue(self.scan()['new'][0]['risky'])

    def test_그림_붙은_묶음은_뒤로_못_보여준_묶음은_다음_판에(self):
        self.session(self.hq_folder(), '참모-2', [(5, '[Image #3] 왜 또 이래 버튼'), (4, '[Image #4] 버튼 왜 또 이래'), (3, '[Image #5] 또 이래 버튼 왜'),
                                                (6, '시안은 늘 세 방향으로 줘'), (2, '시안은 세 방향으로 늘 줘')])
        r = automem.scan(self.d, root=str(self.root), limit=1)
        self.assertEqual(r['new'][0]['total'], 2)  # 그림 묶음(3)보다 앞
        self.assertEqual(r['more'], 1)
        automem.skip(self.d, automem.fresh_lines(self.d))
        r2 = automem.scan(self.d, root=str(self.root))
        self.assertEqual(r2['fresh'], 3)
        self.assertTrue(r2['new'][0]['shot'])


if __name__ == '__main__':
    unittest.main()
