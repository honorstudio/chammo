"""알아서 기억 — 사람 말 뽑기·묶기 시험: python3 -m unittest discover -s app/hq-tests -p "test_hq_automem_lines*" (지어낸 기록으로만)"""
import datetime, json, pathlib, sys, unittest, uuid
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from test_hq_automem import World, automem


def ts(days_ago, hour=10):
    t = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days_ago)
    return t.replace(hour=hour, minute=0, second=0, microsecond=0).isoformat().replace('+00:00', 'Z')


class Logs(World):
    def setUp(self):
        super().setUp()
        self.root = pathlib.Path(self.tmp.name) / 'projects'

    def session(self, folder, name, rows, sid=None):
        sid = sid or str(uuid.uuid4())
        d = self.root / folder
        d.mkdir(parents=True, exist_ok=True)
        out = [json.dumps({'type': 'agent-name', 'agentName': name, 'sessionId': sid})] if name else []
        for i, (days, text, *extra) in enumerate(rows):
            kw = extra[0] if extra else {}
            row = {'type': 'user', 'uuid': kw.get('uuid') or str(uuid.uuid4()), 'timestamp': ts(days), 'origin': {'kind': kw.get('kind', 'human')},
                   'turnPosition': {'promptIndex': kw.get('index', i + 2)}, 'cwd': kw.get('cwd', ''), 'sessionId': sid,
                   'message': {'role': 'user', 'content': text}}
            out.append(json.dumps(row, ensure_ascii=False))
        (d / f'{sid}.jsonl').write_text('\n'.join(out) + '\n', encoding='utf-8')
        return sid

    def hq_folder(self):
        return automem.launch_key(str(self.hq))


    def lines(self):
        return automem.human_lines(self.d, root=str(self.root))

    def test_사람이_친_줄만_남는다(self):
        self.session(self.hq_folder(), '참모-2 · 디자인', [
            (3, '텍스트는 항상 소넷 미디엄으로 써줘'),
            (2, '[앱] 정리할 세션: shop-app(1234) — 갱신 없이 바로 끄기'),
            (2, '<cross-session-message from-name="참모">텍스트 좀</cross-session-message>'),
            (2, '텍스트는 소넷 좀 첫 지시', {'index': 1}),
            (2, '텍스트는 소넷 좀 아님', {'kind': 'model'}),
            (1, '오늘 일정 정리해줘'),
        ])
        got = self.lines()
        self.assertEqual([(l['who'], l['text']) for l in got], [('orch:참모-2', '텍스트는 항상 소넷 미디엄으로 써줘')])

    def test_도우미_세션은_빼고_프로젝트는_이름으로(self):
        self.session(self.hq_folder(), 'probe', [(2, '숫자 좀 써 줘')])
        cwd = str(self.dev / 'shop-app')
        self.session(automem.launch_key(cwd), 'shop-app', [(1, '버튼 설명 줄 붙이지 마', {'cwd': cwd})])
        self.assertEqual([l['who'] for l in self.lines()], ['project:shop-app'])

    def test_같은_글을_10분_안에_또_보내면_한_번(self):
        self.session(self.hq_folder(), '참모', [(1, '왜 또 멈췄어'), (1, '왜 또 멈췄어')])
        self.assertEqual(len(self.lines()), 1)

    def test_조사가_달라도_같이_묶인다(self):
        ls = [{'uuid': str(i), 'ts': f'2026-11-0{i}T00:00:00+00:00', 'text': t} for i, t in
              enumerate(['텍스트는 소넷 미디엄으로 좀', '왜 또 텍스트를 소넷 미디엄 말고', '오늘 회의록 정리해줘'], 1)]
        gs = sorted(len(g) for g in automem.group(ls))
        self.assertEqual(gs, [1, 2])


if __name__ == '__main__':
    unittest.main()
