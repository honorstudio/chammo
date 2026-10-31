"""HQ 템플릿 scripts/recall(지난 대화 검색) 테스트: python3 -m unittest discover -s app/hq-tests"""
import datetime, importlib.machinery, importlib.util, json, os, pathlib, re, subprocess, sys, tempfile, unittest

sys.dont_write_bytecode = True

SCRIPTS = pathlib.Path(__file__).resolve().parent.parent / 'hq-template' / 'scripts'
loader = importlib.machinery.SourceFileLoader('hq_recall', str(SCRIPTS / 'recall'))
recall = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(recall)

H = recall.HIDDEN
# 가짜 비밀값은 조각으로 이어 붙인다 — 한 덩어리면 공개 저장소 비밀 검사가 가짜도 막는다
TG = '123456789:' + 'AAH4kq9_sZx-' + 'Qw3eRtYuIoP1aSdFgHjKlZx'
JWT = 'eyJhbGciOiJIUzI1NiJ9' + '.eyJyb2xlIjoic2VydmljZV9yb2xlIn0' + '.abcDEF123_xyz'
SLACK = 'https://hooks.slack.' + 'com/services/T0000AAAA/B0000BBBB/' + 'abcdefghijklmnopqrstuvwx'
GHP = 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789'


class Redact(unittest.TestCase):
    """앱 메신저 회신 가림(messenger_text.rs redact)과 같은 비밀 거름 — 경로 가림만 뺐다(색인은 이 기기 안에만 있고 경로가 찾을 거리다)"""

    def test_키_토큰처럼_생긴_것은_가린다(self):
        r = recall.redact
        self.assertEqual(r(f'봇 토큰 {TG} 넣었어'), f'봇 토큰 {H} 넣었어')
        self.assertNotIn('AAH4kq9', r(f'https://api.telegram.org/bot{TG}/getMe'))
        self.assertNotIn('abcdefghijklmnop', r('키는 sk-ant-' + 'api03-abcdefghijklmnop1234 이야'))
        self.assertNotIn('1234567890', r('ghp_' + '1234567890abcdefghijABCDEFGHIJ'))
        self.assertNotIn('eyJyb2xl', r(f'jwt {JWT}'))
        self.assertNotIn('abc123', r('https://x.com/cb?code=abc123&state=ok&token=zzz'))
        self.assertIn('state=ok', r('https://x.com/cb?code=abc123&state=ok&token=zzz'))
        self.assertNotIn('zzz', r('token=zzz'))
        self.assertEqual(r('password: hunter2'), f'password: {H}')
        self.assertEqual(r('비밀번호: 1234abcd'), f'비밀번호: {H}')
        self.assertEqual(r('AWS AKIA' + 'IOSFODNN7EXAMPLE'), f'AWS {H}')
        pem = '앞\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n뒤'
        self.assertEqual(r(pem), f'앞\n{H}\n뒤')

    def test_새는_모양(self):
        for text, leak in [
            (f'SUPABASE_SERVICE_ROLE_KEY={JWT}', 'eyJyb2xl'),
            ('DATABASE_URL=postgresql://postgres:MyS3cretPw@db.x.example.co:5432/postgres', 'MyS3cretPw'),
            (f'git clone https://{GHP}@github.com/x/y', 'ghp_abc'),
            ('DB_PASSWORD="Winter2026!"', 'Winter2026'),
            ('{"password": "Winter2026"}', 'Winter2026'),
            ('password: P@ss!w0rd#xyz 다음', 'w0rd'),
            (SLACK, 'abcdefghijklmnopqrstuvwx'),
            ('api_key:abc123def456', 'abc123def456'),
        ]:
            self.assertNotIn(leak, recall.redact(text), text)
        self.assertTrue(recall.redact('password: P@ss!w0rd#xyz 다음').endswith(' 다음'))
        # 마크다운 답 모양 — 실제 대화 색인에서 백틱 값이 샜다(앱 메신저 거름도 따옴표만 본다)
        for text in ['- 비밀번호: `qpmz' + 'k5170`', '**비밀번호:** qpmz' + 'k5170', '**password**: `qpmz' + 'k5170` 다음',
                     'ID : shop / PW : `qpmz' + 'k5170!`', 'PW : qpmz' + 'k5170~~', 'pw:qpmz' + 'k5170']:
            out = recall.redact(text)
            self.assertNotIn('k5170', out, text)
            self.assertIn(H, out)
        self.assertTrue(recall.redact('**password**: `qpmz' + 'k5170` 다음').endswith(' 다음'))
        self.assertIn('@github.com/x/y', recall.redact(f'git clone https://{GHP}@github.com/x/y'))

    def test_앱_메신저_거름과_같은_사례_묶음(self):
        # redact.fixture.json — 앱 메신저 회신 가림(messenger_text_tests.rs)도 같은 파일로 같은 답을 시험한다
        cases = json.loads((pathlib.Path(__file__).parent / 'redact.fixture.json').read_text(encoding='utf-8'))['cases']
        self.assertGreater(len(cases), 20)
        for c in cases:
            self.assertEqual(recall.redact(c['in']), c['out'], c['in'])

    def test_보통_글과_경로와_세션_id_는_그대로(self):
        for s in [
            'PR #412 머지했어 — CI 초록, 테스트 1,203개',
            '커밋 3e9a07c1 위에 쌓았어',
            '토큰은 키체인에 넣었어',
            'MessengerSection.tsx:264 를 봐',
            'https://github.com/example/shop/pull/12',
            '가격은 US$25, 내일 09:00 배포',
            '캡처는 /Users/me/dev/alpha-shop/.shots/a.png 에',
            '세션 7c0e1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b 이 끝났어',
        ]:
            self.assertEqual(recall.redact(s), s)


def user(uuid, ts, text, cwd='/d/dev/alpha-shop', sid='s-1', **more):
    return {'type': 'user', 'uuid': uuid, 'timestamp': ts, 'cwd': cwd, 'sessionId': sid, 'message': {'role': 'user', 'content': text}, **more}


def bot(uuid, ts, blocks, cwd='/d/dev/alpha-shop', sid='s-1'):
    return {'type': 'assistant', 'uuid': uuid, 'timestamp': ts, 'cwd': cwd, 'sessionId': sid, 'message': {'role': 'assistant', 'content': blocks}}


def text(t):
    return {'type': 'text', 'text': t}


class Extract(unittest.TestCase):
    """대화 기록 한 줄 → 색인할 글. 사람·클로드가 쓴 글만 — 도구 호출·도구 결과·생각·메타·시스템 알림은 뺀다"""

    def ex(self, d):
        return recall.extract(json.dumps(d, ensure_ascii=False).encode())

    def test_사람_글과_클로드_글(self):
        self.assertEqual(self.ex(user('u1', '2026-10-01T01:00:00.000Z', '워크트리 지워 줘'))['text'], '워크트리 지워 줘')
        r = self.ex(bot('a1', '2026-10-01T01:00:01Z', [{'type': 'thinking', 'thinking': '속생각'}, text('지울게'), {'type': 'tool_use', 'name': 'Bash', 'input': {'command': 'rm'}}, text('지웠어')]))
        self.assertEqual((r['role'], r['text']), ('assistant', '지울게\n지웠어'))
        self.assertEqual(r['ts'], '2026-10-01T01:00:01Z')

    def test_빼는_것(self):
        self.assertIsNone(self.ex(user('u2', 't', [{'type': 'tool_result', 'tool_use_id': 'x', 'content': '도구 출력'}])))
        self.assertIsNone(self.ex(user('u3', 't', '메타 글', isMeta=True)))
        self.assertIsNone(self.ex(bot('a2', 't', [{'type': 'tool_use', 'name': 'Bash', 'input': {}}])))
        self.assertIsNone(self.ex({'type': 'api-request-blob', 'message': {'role': 'user', 'content': '"type":"user"'}}))
        self.assertIsNone(self.ex(user('u4', 't', '<system-reminder>\n규칙\n</system-reminder>')))
        self.assertIsNone(recall.extract(b'{"type":"user", broken'))

    def test_시스템_알림은_떼고_본문만(self):
        r = self.ex(user('u5', 't', [text('<system-reminder>\n긴 규칙\n</system-reminder>'), text('배포 봐 줘'), {'type': 'image', 'source': {}}]))
        self.assertEqual(r['text'], '배포 봐 줘')

    def test_일하는_중_끼어든_사람_말(self):
        d = {'type': 'attachment', 'uuid': 'q1', 'timestamp': 't', 'cwd': '/d', 'sessionId': 's',
             'attachment': {'type': 'queued_command', 'prompt': '그거 말고 이거', 'origin': {'kind': 'human'}}}
        self.assertEqual((self.ex(d)['role'], self.ex(d)['text']), ('user', '그거 말고 이거'))

    def test_이름과_프로젝트(self):
        self.assertEqual(self.ex({'type': 'custom-title', 'customTitle': '참모 · 뽀삐', 'sessionId': 's'}), {'name': '참모 · 뽀삐'})
        self.assertEqual(recall.project_of('/d/dev/alpha-shop'), 'alpha-shop')
        self.assertEqual(recall.project_of('/d/dev/gamma-app/.claude/worktrees/fix-cart'), 'gamma-app')
        self.assertEqual(recall.project_of('C:\\dev\\beta'), 'beta')
        self.assertEqual(recall.project_of(''), '')


class Since(unittest.TestCase):
    NOW = datetime.datetime(2026, 10, 31, 12, 0, tzinfo=datetime.timezone.utc)

    def test_모양(self):
        self.assertEqual(recall.parse_since('7d', self.NOW), '2026-10-24T12:00:00Z')
        self.assertEqual(recall.parse_since('12h', self.NOW), '2026-10-31T00:00:00Z')
        self.assertTrue(recall.parse_since('10/01', self.NOW).startswith('2026-09-30T') or recall.parse_since('10/01', self.NOW).startswith('2026-10-01T'))
        self.assertTrue(recall.parse_since('2025-12-01', self.NOW)[:7] in ('2025-11', '2025-12'))
        with self.assertRaises(ValueError):
            recall.parse_since('어제', self.NOW)


class Index(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name) / 'projects'
        self.db = pathlib.Path(self.tmp.name) / 'data' / 'recall.db'
        self.a = self.root / '-d-dev-alpha-shop' / 's-1.jsonl'
        self.a.parent.mkdir(parents=True)
        self.write(self.a, [
            {'type': 'custom-title', 'customTitle': '쇼핑몰 세션', 'sessionId': 's-1'},
            user('u1', '2026-10-01T01:00:00Z', '결제 화면 워크트리를 정리해 줘'),
            bot('a1', '2026-10-01T01:00:05Z', [text('앞 줄\n워크트리를 지웠어\n뒷 줄')]),
            user('u2', '2026-10-02T01:00:00Z', '키는 sk-ant-' + 'api03-abcdefghijklmnop1234 이야, password: hunter2'),
        ])
        sub = self.root / '-d-dev-alpha-shop' / 's-1' / 'subagents' / 'agent-x.jsonl'
        sub.parent.mkdir(parents=True)
        self.write(sub, [user('s1', '2026-10-03T01:00:00Z', '분신이 찾은 캐시 문제', sid='s-1')])
        b = self.root / '-d-dev-beta' / 's-2.jsonl'
        b.parent.mkdir(parents=True)
        self.write(b, [user('b1', '2026-10-20T01:00:00Z', '베타 워크트리 얘기', cwd='/d/dev/beta', sid='s-2')])

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, p, rows, mode='w'):
        with open(p, mode, encoding='utf-8') as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + '\n')

    def index(self):
        return recall.update(str(self.db), str(self.root))

    def find(self, q, **kw):
        return recall.search(str(self.db), q, **kw)

    def test_색인에_비밀이_안_남고_주인만_읽는다(self):
        st = self.index()
        self.assertEqual((st['files'], st['added']), (3, 5))
        raw = b''.join(p.read_bytes() for p in self.db.parent.iterdir())  # 저널·wal 까지
        self.assertNotIn(b'abcdefghijklmnop1234', raw)
        self.assertNotIn(b'hunter2', raw)
        self.assertIn(recall.HIDDEN.encode(), raw)
        self.assertEqual(self.db.stat().st_mode & 0o777, 0o600)

    def test_한글_부분_검색_최신순_필터(self):
        self.index()
        hits = self.find('트리를')
        self.assertEqual([h['uuid'] for h in hits], ['a1', 'u1'])  # 최신 먼저
        self.assertEqual(hits[0]['name'], '쇼핑몰 세션')
        self.assertEqual(hits[0]['project'], 'alpha-shop')
        self.assertEqual(hits[0]['lines'], ['앞 줄', '워크트리를 지웠어', '뒷 줄'])
        self.assertEqual([h['uuid'] for h in self.find('워크트리')], ['b1', 'a1', 'u1'])
        self.assertEqual([h['uuid'] for h in self.find('워크트리', project='beta')], ['b1'])
        self.assertEqual([h['uuid'] for h in self.find('워크트리', since='2026-10-01T03:00:00Z')], ['b1'])
        self.assertEqual(len(self.find('워크트리', limit=1)), 1)
        self.assertEqual([h['uuid'] for h in self.find('결제 정리')], ['u1'])  # 낱말 모두(AND), 두 글자도
        self.assertEqual([h['uuid'] for h in self.find('캐시')], ['s1'])  # 분신 대화도
        self.assertEqual(self.find('없는말이다'), [])
        self.assertEqual(self.find('hunter2'), [])

    def test_바뀐_파일만_다시_이어서(self):
        self.index()
        self.assertEqual(self.index()['read'], 0)
        self.write(self.a, [user('u9', '2026-10-05T01:00:00Z', '새로 붙은 워크트리 말')], 'a')
        st = self.index()
        self.assertEqual((st['read'], st['added']), (1, 1))
        self.assertEqual(self.find('붙은')[0]['uuid'], 'u9')

    def test_거름_판이_바뀌면_통째로_다시(self):
        # 옛 거름으로 넣은 글엔 새 거름이 못 닿는다 — 규칙을 고치면 VERSION 을 올려 색인을 다시 만든다
        self.index()
        import sqlite3
        con = sqlite3.connect(self.db)
        con.execute('pragma user_version = 0')
        con.execute("update body set text = 'old secret' where rowid = 1")
        con.commit()
        con.close()
        st = self.index()
        self.assertEqual((st['read'], st['added']), (3, 5))
        self.assertEqual(self.find('secret'), [])

    def test_읽는_동안_자란_파일은_처음부터_다시_안_읽는다(self):
        # 큰 파일을 읽는 사이 세션이 덧붙이면 읽은 자리가 재 둔 크기보다 커진다 — 그걸 '줄었다'로 보면 617MB 를 통째로 다시 읽었다
        self.index()
        import sqlite3
        con = sqlite3.connect(self.db)
        ids = con.execute('select id from msgs order by id').fetchall()
        con.execute('update files set size = off - 10, mtime = 0 where path = ?', (str(self.a),))
        con.commit()
        con.close()
        st = self.index()
        self.assertEqual((st['read'], st['added']), (1, 0))
        con = sqlite3.connect(self.db)
        self.assertEqual(con.execute('select id from msgs order by id').fetchall(), ids)
        con.close()

    def test_같은_메시지는_한_번_지운_파일은_빠진다(self):
        self.index()
        c = self.root / '-d-dev-alpha-shop' / 's-1-copy.jsonl'  # 이어 하기로 앞 대화가 새 파일에 다시 적힌 꼴
        self.write(c, [user('u1', '2026-10-01T01:00:00Z', '결제 화면 워크트리를 정리해 줘')])
        self.assertEqual(self.index()['added'], 0)
        self.assertEqual(len(self.find('결제')), 1)
        (self.root / '-d-dev-beta' / 's-2.jsonl').unlink()
        self.index()
        self.assertEqual(self.find('베타'), [])

    def test_줄어든_파일은_처음부터(self):
        self.index()
        self.write(self.a, [user('n1', '2026-10-06T01:00:00Z', '새 대화 하나')])
        self.index()
        self.assertEqual(self.find('워크트리를'), [])
        self.assertEqual(self.find('대화 하나')[0]['uuid'], 'n1')

    def test_앞뒤_보기(self):
        self.index()
        hit = self.find('트리를')[0]
        around = recall.around(str(self.db), hit['id'], 1)
        self.assertEqual([m['uuid'] for m in around], ['u1', 'a1', 'u2'])
        self.assertTrue(next(m for m in around if m['uuid'] == 'a1')['hit'])
        self.assertEqual(recall.around(str(self.db), 99999, 1), [])

    def test_명령줄(self):
        env = {**os.environ, 'CHAMMO_HOME': str(self.db.parent), 'CLAUDE_CONFIG_DIR': str(self.root.parent)}
        r = subprocess.run([sys.executable, str(SCRIPTS / 'recall'), '트리를', '--limit', '5'], capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('alpha-shop', r.stdout)
        self.assertIn('쇼핑몰 세션', r.stdout)
        self.assertIn('워크트리를 지웠어', r.stdout)
        hid = re.search(r'#(\d+)', r.stdout).group(1)
        r = subprocess.run([sys.executable, str(SCRIPTS / 'recall'), '--open', hid], capture_output=True, text=True, env=env)
        self.assertIn('결제 화면', r.stdout)
        r = subprocess.run([sys.executable, str(SCRIPTS / 'recall'), '없는말이다'], capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 1)


if __name__ == '__main__':
    unittest.main()
