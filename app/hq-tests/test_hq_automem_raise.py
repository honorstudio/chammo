"""알아서 기억 — 규칙이 이미 있는데 또 나온 말은 넘김이 아니라 올림(11-16 첫 판 재현): python3 -m unittest discover -s app/hq-tests -p "test_hq_automem_raise*"
첫 판은 장부가 비어 있어 [또] 가 0 이었고, 사람이 쓴 규칙(전역 CLAUDE.md·메모리)과 짝짓기를 판단 세션에 맡겼다가 '이미 규칙 있음 = 넘김'으로 끝났다 — 짝짓기는 코드가 한다(지어낸 기록으로만)"""
import pathlib, sys, unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from test_hq_automem import automem
from test_hq_automem_lines import Logs, ts


class Raise(Logs):
    def setUp(self):
        super().setUp()
        self.claude = self.root.parent  # 가짜 ~/.claude — projects 옆에 CLAUDE.md
        self.claude.mkdir(parents=True, exist_ok=True)

    def written(self, text, name='CLAUDE.md'):
        p = self.claude / name
        p.write_text(f'# 내 규칙\n\n1. 계획은 짧게\n{text}\n', encoding='utf-8')
        return p

    def memory_file(self, name, text):
        d = self.root / self.hq_folder() / 'memory'
        d.mkdir(parents=True, exist_ok=True)
        (d / name).write_text(f'---\nname: x\n---\n\n{text}\n', encoding='utf-8')
        return d / name

    def scan(self):
        return automem.scan(self.d, root=str(self.root))

    def test_전역에_적힌_규칙이_있는데_또_하면_또_후보로_짝지어_준다(self):
        p = self.written('2. 사용자에게 보이는 글은 전부 한글 — 긴 작업 끝에도')
        self.session(self.hq_folder(), '참모-2', [(9, '한국말 좀 써'), (4, '한글로'), (1, '또 영어로 답하네')])
        r = self.scan()
        self.assertEqual(r['new'], [])
        self.assertEqual(len(r['again']), 1)
        a = r['again'][0]
        self.assertEqual((a['topic'], a['n'], a['rule']), ('korean', 3, None))
        self.assertEqual(a['file'], str(p))
        self.assertIn('전부 한글', a['text'])

    def test_raise_는_늘_실리는_파일_규칙을_검사_단계로_올린다(self):
        self.written('2. 사용자에게 보이는 글은 전부 한글 — 긴 작업 끝에도')
        self.session(self.hq_folder(), '참모-2', [(4, '한국말 좀 써'), (1, '한글로 좀 써')])
        a = self.scan()['again'][0]
        rule, msg = automem.raise_group(self.d, a['cid'])
        self.assertEqual((rule['level'], rule['check'], rule['topic'], rule['scope']), (3, 'english', 'korean', 'common'))
        self.assertTrue(rule.get('hand'))
        self.assertIn(rule['id'], msg)
        self.assertEqual(self.scan()['again'], [])  # 본 줄이 됐다
        self.assertEqual(automem.pinned(self.d), [])  # 이미 매번 실리는 글을 또 붙이지 않는다

    def test_같은_묶음을_두_번_올려도_한_번_되돌리면_다시_안_올린다(self):
        self.written('2. 사용자에게 보이는 글은 전부 한글')
        self.session(self.hq_folder(), '참모', [(2, '한국말 좀 써')])
        a = self.scan()['again'][0]
        r1, _ = automem.raise_group(self.d, a['cid'])
        r2, msg = automem.raise_group(self.d, a['cid'])
        self.assertEqual((r1['id'], len(automem.active(automem.load(self.d))), r2['level']), (r2['id'], 1, 3))
        automem.undo(self.d, r1['id'])
        self.session(self.hq_folder(), '참모', [(1, '한글로')])
        r = self.scan()
        self.assertEqual(r['again'], [])  # 되돌린 주제를 저절로 다시 올리지 않는다(새 묶음으로만)

    def test_장부에_있는_규칙은_말이_달라도_주제로_짝짓는다(self):
        self.written('2. 계획은 짧게만')
        rule, _ = automem.add(self.d, 'common', '사용자에게 보이는 답은 전부 한글 — 영어로 쓰지 않는다', hand='손으로', level=2)
        st = automem.load(self.d)
        st['rules'][0]['created'] = ts(5)
        automem.save(self.d, st)
        self.session(self.hq_folder(), '참모', [(8, '한국말로 써 달라고'), (1, '한글로')])
        r = self.scan()
        self.assertEqual([a['rule'] for a in r['again']], [rule['id']])
        self.assertEqual(r['again'][0]['n'], 1)  # 규칙보다 앞선 줄은 '또'가 아니다
        self.assertEqual(r['new'], [])  # 앞선 줄로 같은 규칙을 또 만들지 않게
        got, msg = automem.raise_group(self.d, r['again'][0]['cid'])
        self.assertEqual((got['id'], got['level'], got['check']), (rule['id'], 3, 'english'))

    def test_메모리_파일에만_있으면_한_단계(self):
        p = self.memory_file('ask-less.md', '웬만한 건 네가 정한다 — 그만 물어보고 추천안으로 진행')
        self.session(self.hq_folder(), '참모', [(3, '그만 물어봐 좀'), (1, '그런 건 물어보지마')])
        a = self.scan()['again'][0]
        self.assertEqual((a['topic'], a['file']), ('ask', str(p)))
        rule, _ = automem.raise_group(self.d, a['cid'])
        self.assertEqual((rule['level'], rule['check']), (2, None))
        self.assertEqual(len(automem.pinned(self.d)), 1)

    def test_제목_줄이나_링크_줄은_규칙_문장으로_쓰지_않는다(self):
        self.written('## 참모가 여럿일 때 — 누가 무엇을\n\n사용자는 참모를 여럿 둘 수 있다.')
        self.session(self.hq_folder(), '참모', [(1, '또 비서한테 카드가 뜸')])
        a = self.scan()['again'][0]
        self.assertEqual(a['text'], automem.TOPIC['route']['text_ko'])
        self.memory_file('MEMORY.md', '- [완주 지시면 중간 관문 없이](finish.md) — 완성본까지')
        self.session(self.hq_folder(), '참모', [(1, '또 멈춰있네')])
        b = next(x for x in self.scan()['again'] if x['topic'] == 'stop')
        self.assertEqual(b['text'], automem.TOPIC['stop']['text_ko'])
        for k in automem.TOPIC:
            self.assertFalse(automem.TOPIC[k]['text_ko'].startswith(('#', '[')))

    def test_적힌_규칙이_없으면_새_묶음으로(self):
        self.written('2. 계획은 짧게만')
        self.session(self.hq_folder(), '참모', [(3, '한국말 좀 써'), (2, '한국말로 좀 써 줘'), (1, '또 한국말 안 쓰네')])
        r = self.scan()
        self.assertEqual(r['again'], [])
        self.assertEqual(len(r['new']), 1)

    def test_한글_입력_버그_신고는_한국말_주제가_아니다(self):
        self.assertIsNone(automem.topic_of('목록에서 엔터를 두 번 쳐야 넘어가요 한글일 때만 그렇고 영어는 바로 넘어감'))
        self.assertIsNone(automem.topic_of('가게 영문 이름 없음'))
        self.assertEqual(automem.topic_of('한글로'), 'korean')
        self.assertEqual(automem.topic_of('고친 거 맞아? 화면은 아무것도 안 바뀐 듯'), 'done')
        self.assertEqual(automem.topic_of('안내 문구는 소넷 미디엄으로 쓰자'), 'sonnet')
        self.assertEqual(automem.topic_of('그거 니가 눌러라고 했잖아'), 'user')
        self.assertIsNone(automem.topic_of('응 니가 해 줘 메모는 넣어 두면 좋겠다'))

    def test_지침은_올림을_넘김으로_돌리지_않는다(self):
        g = automem.guide(self.d)
        self.assertIn('scripts/memory raise', g)
        self.assertIn('넘기지 않는다', g)

    def test_월요일이면_scan_이_알린다(self):
        import datetime
        mon = datetime.datetime(2026, 11, 16, 9, 0, tzinfo=datetime.timezone.utc)
        self.assertTrue(automem.scan(self.d, root=str(self.root), now_=mon)['monday'])
        self.assertFalse(automem.scan(self.d, root=str(self.root), now_=mon + datetime.timedelta(days=1))['monday'])


if __name__ == '__main__':
    unittest.main()
