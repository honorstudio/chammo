"""알아서 기억 — 맡은 참모·한 번 묻기·예약 시험: python3 -m unittest discover -s app/hq-tests -p "test_hq_automem_owner*" (지어낸 값만)"""
import json, pathlib, subprocess, sys, unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from test_hq_automem import World, automem, TPL


class Owner(World):
    def agents(self):
        hq = str(self.hq)
        return [{'id': 'a1', 'sessionId': 's1', 'name': '참모 · 회사 일', 'cwd': hq},
                {'id': 'a2', 'sessionId': 's2', 'name': '참모-2 · 디자인', 'cwd': hq},
                {'id': 'a3', 'sessionId': 's3', 'name': '참모-3 · 정리 담당', 'cwd': hq},
                {'id': 'a4', 'sessionId': 's4', 'name': 'shop-app', 'cwd': str(self.dev / 'shop-app')}]

    def test_참모_칸은_그_참모_전체_이름(self):
        self.assertEqual(automem.owner(self.d, 'orch:참모-2', agents=self.agents()), '참모-2 · 디자인')

    def test_공통은_맡은_일에_기억_교훈_규칙_참모_앱이_든_참모(self):
        (self.data / 'orch-roles.json').write_text(json.dumps({'참모': {'role': '회사 결정·서류 정리·예약 관리'},
                                                               '참모-2': {'role': '참모 앱 고치기·머지'}}, ensure_ascii=False))
        self.assertEqual(automem.owner(self.d, 'common', agents=self.agents()), '참모-2 · 디자인')  # '정리·예약' 같은 흔한 낱말로 고르지 않는다

    def test_공통은_정한_참모가_먼저(self):
        (self.data / 'orch-roles.json').write_text(json.dumps({'참모-2': {'role': '기억 담당'}}, ensure_ascii=False))
        automem.set_owner(self.d, '참모-3')
        self.assertEqual(automem.owner(self.d, 'common', agents=self.agents()), '참모-3 · 정리 담당')
        self.assertEqual(automem.owner(self.d, 'project:없는-것', agents=self.agents()), '참모-3 · 정리 담당')
        automem.set_owner(self.d, '없는-참모')  # 지금 안 떠 있으면 다음 순서로
        self.assertEqual(automem.owner(self.d, 'common', agents=self.agents()), '참모-2 · 디자인')

    def test_맡은_일이_없으면_기본_이름_참모(self):
        self.assertEqual(automem.owner(self.d, 'common', agents=self.agents()), '참모 · 회사 일')

    def test_프로젝트는_최근에_그_일을_맡긴_참모(self):
        ev = [{'ts': '2026-11-15T01:00:00+00:00', 'type': 'send', 'task': 't1', 'target': 'a4', 'from': 's2', 'fromName': '참모-2 · 디자인', 'project': 'shop-app'}]
        (self.data / 'tasks.jsonl').write_text('\n'.join(json.dumps(e, ensure_ascii=False) for e in ev) + '\n')
        import datetime
        now = datetime.datetime(2026, 11, 16, tzinfo=datetime.timezone.utc)
        self.assertEqual(automem.owner(self.d, 'project:shop-app', agents=self.agents(), now_=now), '참모-2 · 디자인')


class Ask(World):
    def test_같은_열쇠는_한_번만(self):
        self.assertTrue(automem.ask(self.d, 'load-limit', '부하 기준이 둘'))
        self.assertFalse(automem.ask(self.d, 'load-limit', '부하 기준이 둘'))


class Schedule(World):
    def test_없으면_소넷_medium_매일_예약을_한_번(self):
        calls = []

        def run(argv, **kw):
            calls.append(argv)
            out = '[]' if 'list' in argv else '{}'
            return subprocess.CompletedProcess(argv, 0, out, '')
        automem.schedule(self.d, runner=run)
        new = next(c for c in calls if 'new' in c)
        self.assertIn('memory', new)
        self.assertEqual(new[new.index('--model') + 1], 'sonnet')
        self.assertEqual(new[new.index('--in') + 1], str(self.hq))

        def run2(argv, **kw):
            calls.append(argv)
            return subprocess.CompletedProcess(argv, 0, json.dumps([{'name': 'memory'}]), '')
        n = len(calls)
        automem.schedule(self.d, runner=run2)
        self.assertFalse(any('new' in c for c in calls[n:]))

    def test_지침은_검사_이름과_되돌리기를_알려준다(self):
        g = automem.guide(self.d)
        for w in ('scripts/memory scan', 'english', 'shots', 'skip --fresh', 'owner', 'routine report memory'):
            self.assertIn(w, g)


class Stats(World):
    def test_한_주_숫자_한_줄(self):
        r, _ = automem.add(self.d, 'common', '답은 늘 한글로', lines=[])
        automem.up(self.d, r['id'])
        automem.log(self.d, {'action': 'check', 'check': 'english'})
        (self.data / 'tasks.jsonl').write_text(json.dumps({'ts': automem.now(), 'type': 'done', 'task': 't1', 'note': '고침', 'noShot': True}) + '\n')
        line = automem.stats(self.d)
        for w in ('새 규칙 1', '올림 1', '영어 다시 쓰기 1번', '캡처 없이 닫은 일 1건', '2단계 1'):
            self.assertIn(w, line)


if __name__ == '__main__':
    unittest.main()
