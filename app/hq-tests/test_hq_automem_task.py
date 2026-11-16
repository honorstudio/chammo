"""알아서 기억 — task send·done 연결(사람이 보낸 화면 전후 캡처 관문·늘 지킬 줄) 시험: python3 -m unittest discover -s app/hq-tests -p "test_hq_automem_task*" (지어낸 값만)"""
import contextlib, datetime, importlib.machinery, importlib.util, io, json, os, pathlib, sys, unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from test_hq_automem import World, automem, TPL


def ago(minutes):
    t = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=minutes)
    return t.isoformat().replace('+00:00', 'Z')


class Shots(World):
    def setUp(self):
        super().setUp()
        self.root = pathlib.Path(self.tmp.name) / 'projects'
        self.events = []

    def chat(self, sid, rows):
        d = self.root / automem.launch_key(str(self.hq))
        d.mkdir(parents=True, exist_ok=True)
        with open(d / f'{sid}.jsonl', 'a', encoding='utf-8') as f:
            for minutes, content in rows:
                f.write(json.dumps({'type': 'user', 'timestamp': ago(minutes), 'origin': {'kind': 'human'}, 'turnPosition': {'promptIndex': 3},
                                    'message': {'role': 'user', 'content': content}}, ensure_ascii=False) + '\n')

    def shots_on(self):
        r, _ = automem.add(self.d, 'common', '고쳤다고 할 땐 사람이 보낸 화면 전후 캡처', lines=[])
        automem.set_level(self.d, r['id'], 3, check='shots')

    def test_참모가_최근에_받은_그림을_찾는다(self):
        self.chat('o1', [(200, '#img1 "/x/old.png" 옛날 거'), (10, '#img1 "/x/now.png" 이거 왜 이래'), (5, '[Image #12] 또 이래'),
                         (3, '[앱] 정리할 세션: x(1) — #img1 "/x/app.png"')])
        got = automem.recent_shots(self.d, 'o1', root=str(self.root))
        self.assertEqual(got, ['/x/now.png', '[Image #12]'])

    def test_send_는_그림을_적고_검사가_켜졌으면_한_줄(self):
        self.shots_on()
        self.chat('o1', [(5, '#img1 "/x/now.png" 버튼이 안 눌려')])
        ev = {'type': 'send', 'task': 't1', 'fromName': '참모'}
        lines = automem.on_send(self.d, ev, 'shop-app', sid='o1', root=str(self.root))
        self.assertEqual(ev['shots'], ['/x/now.png'])
        self.assertTrue(any('/x/now.png' in l and '캡처' in l for l in lines))

    def done(self, note, shots=('/x/now.png',), no_shot=None):
        events = [{'type': 'send', 'task': 't1', 'fromName': '참모', 'shots': list(shots)}] + self.events
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code, extra = automem.on_done(self.d, 't1', note, events, self.events.append, no_shot=no_shot)
        return code, extra, err.getvalue()

    def test_고쳤다는데_새_캡처가_없으면_한_번_되묻는다(self):
        self.shots_on()
        code, _, err = self.done('버튼 고쳤어 — 커밋 abc1234')
        self.assertEqual(code, 5)
        self.assertIn('/x/now.png', err)
        code, extra, _ = self.done('버튼 고쳤어 — 커밋 abc1234')
        self.assertIsNone(code)
        self.assertTrue(extra.get('noShot'))

    def test_새_캡처가_있으면_통과(self):
        self.shots_on()
        self.assertEqual(self.done('고쳤어 — 전 /x/now.png 후 .shots/after.png')[0], None)

    def test_사람이_보낸_그림만_붙이면_안_된다(self):
        self.shots_on()
        self.assertEqual(self.done('고쳤어 — /x/now.png')[0], 5)

    def test_검사가_꺼졌거나_고친_일이_아니면_통과(self):
        self.assertIsNone(self.done('고쳤어 — 커밋 abc1234')[0])
        self.shots_on()
        self.assertIsNone(self.done('조사 끝 — docs/report.md')[0])
        self.assertIsNone(self.done('고쳤어 abc1234', shots=())[0])
        self.assertIsNone(self.done('고쳤어 abc1234', no_shot='서버 로그만 바뀌는 일')[0])

    def test_늘_지킬_줄은_공통과_그_프로젝트(self):
        a, _ = automem.add(self.d, 'common', '답은 늘 한글로', lines=[])
        automem.up(self.d, a['id'])
        automem.up(self.d, a['id'], check='english')
        b, _ = automem.add(self.d, 'project:other-app', '다른 프로젝트 규칙', lines=[])
        automem.up(self.d, b['id'])
        lines = automem.on_send(self.d, {'type': 'send'}, 'shop-app', sid='', root=str(self.root))
        self.assertTrue(any('답은 늘 한글로' in l for l in lines))
        self.assertTrue(any('영어' in l for l in lines))
        self.assertFalse(any('다른 프로젝트' in l for l in lines))

    def test_설정의_HQ_가_물결이어도_참모_기록을_찾는다(self):
        import os
        home = pathlib.Path(self.tmp.name)
        (self.data / 'config.json').write_text(json.dumps({'devRoot': str(self.dev), 'hqDir': '~/hq'}))
        old = os.environ.get('HOME')
        os.environ['HOME'] = str(home)
        try:
            self.chat('o1', [(5, '#img1 "/x/now.png" 버튼이 안 눌려')])
            self.assertEqual(automem.recent_shots(self.d, 'o1', root=str(self.root)), ['/x/now.png'])
        finally:
            os.environ['HOME'] = old


class PublicTask(World):
    def test_공개판_task_done_이_관문을_건다(self):
        r, _ = automem.add(self.d, 'common', '전후 캡처', lines=[])
        automem.set_level(self.d, r['id'], 3, check='shots')
        (self.data / 'tasks.jsonl').write_text(json.dumps({'ts': '2026-11-16T00:00:00+00:00', 'type': 'send', 'task': 't9', 'target': 'x',
                                                           'title': '버튼 고치기', 'fromName': '참모', 'shots': ['/x/now.png']}) + '\n')
        ld = importlib.machinery.SourceFileLoader('pub_task', str(TPL / 'task'))
        task = importlib.util.module_from_spec(importlib.util.spec_from_loader(ld.name, ld))
        ld.exec_module(task)
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(task.main(['done', 't9', '버튼 고쳤어 — 커밋 abc1234']), 5)
            self.assertEqual(task.main(['done', 't9', '버튼 고쳤어 — 전후 .shots/after.png']), 0)


if __name__ == '__main__':
    unittest.main()
