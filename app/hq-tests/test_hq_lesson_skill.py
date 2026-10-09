"""교훈 → 프로젝트 스킬 승격(scripts/task lesson-review|lesson-group|lesson-drop|lesson-propose|lesson-promote|lesson-restore) 테스트 (공개판)
python3 -m unittest discover -s app/hq-tests — 공개판 task 와, 원본 저장소면 주인 HQ 판(scripts/task)도 같이 본다"""
import sys
sys.dont_write_bytecode = True  # 템플릿 폴더에 __pycache__ 가 생기지 않게
import contextlib, importlib.machinery, importlib.util, io, json, os, pathlib, subprocess, tempfile, unittest
from unittest import mock

TMPL = pathlib.Path(__file__).resolve().parent.parent / 'hq-template' / 'scripts'
OWNER = TMPL.parent.parent.parent / 'scripts' / 'task'   # 주인 HQ 판 — 공개본엔 없다


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    mod = importlib.util.module_from_spec(importlib.util.spec_from_loader(name, loader))
    loader.exec_module(mod)
    return mod


LS = load('lesson_skill', TMPL / 'lesson_skill.py')
PRIVATE = load('task_private', OWNER) if OWNER.is_file() else None
PUBLIC = load('task_public', TMPL / 'task')

LESSONS = [
    '개발판을 pkill 로 끄면 vite(1420)가 남는다 — 1420 쥔 프로세스 cwd 를 보고 끈다',
    '백그라운드 tauri dev 는 30분에 꺼진다 — timeout 7200000',
    '폰 서버 새 쓰기 길은 head_check 목록에도',
    '앱 테스트엔 jsdom 이 없다 — 순수 함수로 빼서 시험',
    '폰 md 표 칸은 nowrap',
]


class Pure(unittest.TestCase):
    def test_줄_번호_고르기(self):
        self.assertEqual(LS.parse_picks('3,1, 4-5', 5), [1, 3, 4, 5])
        self.assertEqual(LS.parse_picks('2-2,2', 5), [2])
        for bad in ['', '0', '6', '3-1', 'a', '1-', '1,,x']:
            with self.assertRaises(ValueError, msg=bad):
                LS.parse_picks(bad, 5)

    def test_스킬_이름은_접두를_붙이고_영문_소문자만(self):
        self.assertEqual(LS.skill_name('tauri-dev'), 'lesson-tauri-dev')
        self.assertEqual(LS.skill_name('lesson-tauri-dev'), 'lesson-tauri-dev')
        for bad in ['', 'Tauri', '한글', 'a b', '../x', 'a/b', 'x' * 60, '-x']:
            with self.assertRaises(ValueError, msg=bad):
                LS.skill_name(bad)

    def test_교훈_칸_안의_줄만_뺀다(self):
        body = '# 계정\n- 하나\n\n## 교훈 (확인된 것)\n- 하나\n- 둘\n\n## 미룬 할 일\n- 하나\n'
        self.assertEqual(LS.without_lesson(body, '하나'), '# 계정\n- 하나\n\n## 교훈 (확인된 것)\n- 둘\n\n## 미룬 할 일\n- 하나\n')
        self.assertIsNone(LS.without_lesson(body, '셋'))
        self.assertIsNone(LS.without_lesson('# 계정\n- 하나\n', '하나'))
        self.assertEqual(LS.without_lesson('## Lessons\n- one\n', 'one'), '## Lessons\n')

    def test_파일에서_고른_줄만_뺀다(self):
        text = '# 머리\n- a\n- b\n- c\n'
        self.assertEqual(LS.remove_lines(text, ['b', 'x']), ('# 머리\n- a\n- c\n', ['b']))


def read(path):
    return pathlib.Path(path).read_text(encoding='utf-8')


def git(root, *args):
    subprocess.run(['git', '-C', root, *args], check=True, capture_output=True)


class Flow:
    """두 task 판에 같은 시험을 돌린다 — 공통 흐름"""
    task = None

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = self.tmp.name
        t = self.task
        self.saved = {k: getattr(t, k) for k in ('DATA', 'LESSONS', 'LOG', 'DEV', 'APPLOG')}
        t.DATA = os.path.join(d, 'data')
        t.APPLOG = os.path.join(d, 'app.jsonl')  # 브라우저 카드가 진짜 앱 기록에 새지 않게
        # 진짜 claude agents 를 부르지 않는다
        patcher = mock.patch.object(t, 'load_agents', return_value=[])
        patcher.start()
        self.addCleanup(patcher.stop)
        t.LESSONS = os.path.join(t.DATA, 'lessons')
        t.LOG = os.path.join(t.DATA, 'tasks.jsonl')
        t.DEV = os.path.join(d, 'dev')
        self.root = os.path.join(t.DEV, 'proj')
        os.makedirs(self.root)
        git(self.root, 'init', '-q')
        with open(os.path.join(self.root, '.gitignore'), 'w') as f:
            f.write('CLAUDE.local.md\n')
        os.makedirs(t.LESSONS)
        with open(os.path.join(t.LESSONS, 'proj.md'), 'w', encoding='utf-8') as f:
            f.write(''.join(f'- {l}\n' for l in LESSONS))
        with open(os.path.join(self.root, 'CLAUDE.local.md'), 'w', encoding='utf-8') as f:
            f.write('# 계정\n- 아이디 x\n\n## 교훈 (확인된 것)\n' + ''.join(f'- {l}\n' for l in LESSONS) + '\n## 미룬 할 일\n- 폰 md 표 칸은 nowrap\n')

    def tearDown(self):
        for k, v in self.saved.items():
            setattr(self.task, k, v)
        self.tmp.cleanup()

    def run_task(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = self.task.main(list(args))
        return code, out.getvalue(), err.getvalue()

    def events(self):
        return [json.loads(l) for l in read(self.task.LOG).splitlines()]

    def lessons(self):
        return self.task._lines('proj')

    def propose(self, name='tauri-dev', lines='1-2', desc='tauri dev·vite 1420·개발판 켜고 끌 때'):
        code, out, err = self.run_task('lesson-propose', 'proj', name, '--lines', lines, '--desc', desc)
        self.assertEqual(code, 0, err)
        return out.strip()

    def answer(self, tid, note):
        self.task.append({'ts': self.task.now(), 'type': 'answer', 'task': tid, 'note': note})

    # ── review ──
    def test_review_는_번호와_크기를_보여_주고_아무것도_안_바꾼다(self):
        before = read(os.path.join(self.task.LESSONS, 'proj.md'))
        code, out, err = self.run_task('lesson-review', 'proj')
        self.assertEqual(code, 0, err)
        self.assertIn('1. ' + LESSONS[0], out)
        self.assertIn('5. ' + LESSONS[4], out)
        self.assertIn('lesson-group', out)
        self.assertIn(str(len(LESSONS)), out)
        self.assertEqual(read(os.path.join(self.task.LESSONS, 'proj.md')), before)
        self.assertFalse(os.path.exists(self.task.LOG))

    def test_공통_교훈은_review_못_한다(self):
        code, _, err = self.run_task('lesson-review', '_common')
        self.assertEqual(code, 2)
        self.assertTrue(err)

    # ── propose ──
    def test_propose_는_결정_대기함_카드를_올린다(self):
        tid = self.propose()
        ev = self.events()
        send = next(e for e in ev if e['type'] == 'send')
        ask = next(e for e in ev if e['type'] == 'ask')
        self.assertEqual(send['task'], tid)
        self.assertEqual(ask['task'], tid)
        self.assertEqual(send['lesson']['skill'], 'lesson-tauri-dev')
        self.assertEqual(send['lesson']['lines'], LESSONS[:2])
        self.assertEqual(send['project'], 'proj')
        # 세션 이름과 겹치지 않는 대상 — 앱이 진짜 세션의 주인으로 읽지 않게
        self.assertNotEqual(send['target'], 'proj')
        self.assertIn('lesson-tauri-dev', ask['note'])
        self.assertIn(LESSONS[0][:20], ask['note'])
        # 아직 아무것도 안 옮겼다
        self.assertEqual(self.lessons(), LESSONS)
        self.assertFalse(os.path.exists(os.path.join(self.root, '.claude', 'skills')))

    def test_propose_는_이상한_번호와_이름을_거절한다(self):
        for args in (['x', '--lines', '9'], ['Bad Name', '--lines', '1'], ['ok', '--lines', '1']):
            code, _, err = self.run_task('lesson-propose', 'proj', *args, *(['--desc', 'd'] if args[0] != 'ok' else []))
            self.assertEqual(code, 2, args)
            self.assertTrue(err)
        self.assertFalse(os.path.exists(self.task.LOG))

    def test_남의_스킬_폴더와_이름이_겹치면_거절(self):
        os.makedirs(os.path.join(self.root, '.claude', 'skills', 'lesson-tauri-dev'))
        code, _, err = self.run_task('lesson-propose', 'proj', 'tauri-dev', '--lines', '1', '--desc', 'd')
        self.assertEqual(code, 2)
        self.assertIn('lesson-tauri-dev', err)

    # ── promote ──
    def test_사람_답_없이는_승격하지_않는다(self):
        tid = self.propose()
        code, _, err = self.run_task('lesson-promote', tid)
        self.assertEqual(code, 2)
        self.assertEqual(self.lessons(), LESSONS)
        self.assertFalse(os.path.exists(os.path.join(self.root, '.claude', 'skills', 'lesson-tauri-dev')))

    def test_그대로_둠_처리함_답이면_승격하지_않는다(self):
        for note in ['그대로 둬', '처리함', 'Handled', '다시 묶어', '버려']:
            tid = self.propose()
            self.answer(tid, note)
            code, _, err = self.run_task('lesson-promote', tid)
            self.assertEqual(code, 2, note)
        self.assertEqual(self.lessons(), LESSONS)

    def test_묶어_답이면_스킬을_만들고_원본은_archive_로(self):
        tid = self.propose()
        self.answer(tid, '묶어')
        code, out, err = self.run_task('lesson-promote', tid)
        self.assertEqual(code, 0, err)
        skill = os.path.join(self.root, '.claude', 'skills', 'lesson-tauri-dev', 'SKILL.md')
        body = read(skill)
        self.assertTrue(body.startswith('---\nname: lesson-tauri-dev\ndescription: "tauri dev·vite 1420·개발판 켜고 끌 때"\n---\n'), body[:120])
        for l in LESSONS[:2]:
            self.assertIn(f'- {l}\n', body)
        self.assertNotIn(LESSONS[2], body)
        # 지시에 붙는 줄이 줄었다
        self.assertEqual(self.lessons(), LESSONS[2:])
        # 지우지 않고 archive
        arch = read(os.path.join(self.task.LESSONS, '_archive', 'proj.md'))
        self.assertIn('lesson-tauri-dev', arch)
        self.assertIn(f'- {LESSONS[0]}\n', arch)
        # CLAUDE.local.md 교훈 칸에서만 빠짐, 계정 칸·다른 칸은 그대로
        local = read(os.path.join(self.root, 'CLAUDE.local.md'))
        self.assertNotIn(LESSONS[0], local)
        self.assertIn('- 아이디 x', local)
        self.assertIn(f'- {LESSONS[2]}', local)
        # 커밋되지 않는 자리
        self.assertEqual(subprocess.run(['git', '-C', self.root, 'check-ignore', '-q', skill]).returncode, 0)
        self.assertFalse(os.path.exists(os.path.join(self.root, '.gitignore.orig')))
        self.assertEqual(read(os.path.join(self.root, '.gitignore')), 'CLAUDE.local.md\n')
        # 기록·일 닫기
        self.assertTrue(any(e['type'] == 'done' and e['task'] == tid for e in self.events()))
        rec = [json.loads(l) for l in read(os.path.join(self.task.LESSONS, 'skills.jsonl')).splitlines()]
        self.assertEqual((rec[-1]['action'], rec[-1]['skill'], rec[-1]['project']), ('promote', 'lesson-tauri-dev', 'proj'))
        # 두 번은 안 된다
        self.assertEqual(self.run_task('lesson-promote', tid)[0], 2)

    def test_스킬이_여럿이어도_send_엔_한_줄_경로는_한_번(self):
        for name, lines in (('tauri-dev', '1'), ('phone', '2')):
            tid = self.propose(name=name, lines=lines)  # 앞 승격으로 번호가 당겨져도 원래 1·2번 줄
            self.answer(tid, '묶어')
            self.assertEqual(self.run_task('lesson-promote', tid)[0], 0)
        _, _, err = self.run_task('send', 'proj', '버튼 색 바꾸기')
        skill = [l for l in err.splitlines() if 'lesson-tauri-dev' in l]
        self.assertEqual(len(skill), 1)
        self.assertIn('lesson-phone', skill[0])
        self.assertEqual(skill[0].count(os.path.join(self.root, '.claude', 'skills')), 1)

    def test_승격한_스킬은_send_에_한_줄로_붙고_교훈_줄은_안_붙는다(self):
        tid = self.propose()
        self.answer(tid, 'ㄱㄱ')
        self.run_task('lesson-promote', tid)
        _, _, err = self.run_task('send', 'proj', '버튼 색 바꾸기')
        self.assertNotIn(LESSONS[0], err)
        self.assertIn(LESSONS[2], err)
        self.assertIn('lesson-tauri-dev', err)
        self.assertIn('SKILL.md', err)

    def test_CLAUDE_local_교훈_칸에_스킬_목록_한_줄(self):
        # 워크트리 세션은 gitignore 된 스킬을 목록에 못 본다(2026-10-08 실측) — 부모 폴더 CLAUDE.local.md 는 읽으니 거기 길을 남긴다
        local = lambda: read(os.path.join(self.root, 'CLAUDE.local.md'))
        for name, lines in (('tauri-dev', '1'), ('phone', '1')):
            tid = self.propose(name=name, lines=lines)
            self.answer(tid, '묶어')
            self.assertEqual(self.run_task('lesson-promote', tid)[0], 0)
        ptr = [l for l in local().splitlines() if 'lesson-tauri-dev' in l]
        self.assertEqual(len(ptr), 1)
        self.assertIn('lesson-phone', ptr[0])
        self.assertIn(os.path.join(self.root, '.claude', 'skills'), ptr[0])
        # 교훈 칸 안, 머리 바로 아래 — 칸 밖은 그대로
        body = local()
        self.assertLess(body.index('## 교훈'), body.index(ptr[0]))
        self.assertLess(body.index(ptr[0]), body.index('## 미룬 할 일'))
        self.assertIn('- 아이디 x', body)
        # 교훈 파일 쪽엔 안 생긴다(지시엔 send 가 따로 붙인다)
        self.assertFalse(any('lesson-' in l for l in self.lessons()))
        # 다 되돌리면 그 줄도 빠진다
        self.run_task('lesson-restore', 'proj', 'tauri-dev')
        self.assertNotIn('lesson-tauri-dev', local())
        self.assertIn('lesson-phone', local())
        self.run_task('lesson-restore', 'proj', 'phone')
        self.assertNotIn('lesson-', local())

    def test_승격_사이에_교훈이_바뀌어도_글로_찾는다(self):
        tid = self.propose(lines='2')
        # 사람이 메모 창에서 첫 줄을 지웠다 — 번호가 밀렸다
        with open(os.path.join(self.task.LESSONS, 'proj.md'), 'w', encoding='utf-8') as f:
            f.write(''.join(f'- {l}\n' for l in LESSONS[1:]))
        self.answer(tid, '응')
        code, _, err = self.run_task('lesson-promote', tid)
        self.assertEqual(code, 0, err)
        self.assertEqual(self.lessons(), LESSONS[2:])

    def test_커밋되는_자리면_git_info_exclude_로_막는다(self):
        os.remove(os.path.join(self.root, '.gitignore'))
        tid = self.propose()
        self.answer(tid, '묶어')
        code, _, err = self.run_task('lesson-promote', tid)
        self.assertEqual(code, 0, err)
        skill = os.path.join(self.root, '.claude', 'skills', 'lesson-tauri-dev', 'SKILL.md')
        self.assertEqual(subprocess.run(['git', '-C', self.root, 'check-ignore', '-q', skill]).returncode, 0)
        self.assertFalse(os.path.exists(os.path.join(self.root, '.gitignore')))

    def test_gitignore_가_스킬을_다시_추적하게_하면_그_줄과_넣을_줄을_알려_준다(self):
        # 2026-10-09 project-a: .gitignore 가 '!.claude/skills/' 로 직원 공유 스킬을 추적 — info/exclude 보다 이겨서 막지 못했다
        with open(os.path.join(self.root, '.gitignore'), 'w') as f:
            f.write('.claude/*\n!.claude/skills/\n.claude/skills/*\n!.claude/skills/*/\n')
        tid = self.propose()
        self.answer(tid, '묶어')
        code, _, err = self.run_task('lesson-promote', tid)
        self.assertEqual(code, 2)
        self.assertIn('.gitignore:4', err)
        self.assertIn('/.claude/skills/lesson-*/', err)
        self.assertEqual(self.lessons(), LESSONS)

    def test_git_이_추적하는_스킬_폴더면_거절(self):
        d = os.path.join(self.root, '.claude', 'skills', 'lesson-tauri-dev')
        tid = self.propose()
        os.makedirs(d)
        with open(os.path.join(d, 'SKILL.md'), 'w') as f:
            f.write('x')
        git(self.root, 'add', '-f', '.claude/skills/lesson-tauri-dev/SKILL.md')
        self.answer(tid, '묶어')
        code, _, err = self.run_task('lesson-promote', tid)
        self.assertEqual(code, 2)
        self.assertEqual(self.lessons(), LESSONS)

    def test_같은_스킬에_더_묶으면_합친다(self):
        a = self.propose(lines='1')
        self.answer(a, '묶어')
        self.run_task('lesson-promote', a)
        b = self.propose(lines='1')  # 남은 줄의 1번 = 원래 2번
        self.answer(b, '묶어')
        code, _, err = self.run_task('lesson-promote', b)
        self.assertEqual(code, 0, err)
        body = read(os.path.join(self.root, '.claude', 'skills', 'lesson-tauri-dev', 'SKILL.md'))
        self.assertIn(LESSONS[0], body)
        self.assertIn(LESSONS[1], body)
        self.assertEqual(self.lessons(), LESSONS[2:])

    def test_버리기는_스킬_없이_archive_만(self):
        tid = self.propose(name='done-todo', lines='5')
        self.answer(tid, '버려')
        code, _, err = self.run_task('lesson-promote', tid, '--drop')
        self.assertEqual(code, 0, err)
        self.assertEqual(self.lessons(), LESSONS[:4])
        self.assertFalse(os.path.exists(os.path.join(self.root, '.claude', 'skills', 'lesson-done-todo')))
        self.assertIn(LESSONS[4], read(os.path.join(self.task.LESSONS, '_archive', 'proj.md')))
        # 미룬 할 일 칸의 같은 줄은 남는다
        self.assertIn('## 미룬 할 일\n- 폰 md 표 칸은 nowrap', read(os.path.join(self.root, 'CLAUDE.local.md')))

    def test_버리라는_답_없이는_drop_하지_않는다(self):
        tid = self.propose(name='done-todo', lines='5')
        self.answer(tid, '묶어')
        code, _, err = self.run_task('lesson-promote', tid, '--drop')
        self.assertEqual(code, 2)
        self.assertEqual(self.lessons(), LESSONS)

    # ── group — 카드 없이 참모가 알아서 묶는다(2026-10-08 사용자 "추천대로 진행") ──
    def group(self, name='tauri-dev', lines='1-3', desc='tauri dev·vite 1420·개발판 켜고 끌 때'):
        args = ['lesson-group', 'proj', name, '--lines', lines] + (['--desc', desc] if desc else [])
        return self.run_task(*args)

    def test_group_은_카드_없이_바로_스킬로_묶고_한_줄로_보고한다(self):
        code, out, err = self.group()
        self.assertEqual(code, 0, err)
        skill = os.path.join(self.root, '.claude', 'skills', 'lesson-tauri-dev', 'SKILL.md')
        body = read(skill)
        self.assertTrue(body.startswith('---\nname: lesson-tauri-dev\ndescription: "tauri dev·vite 1420·개발판 켜고 끌 때"\n---\n'), body[:120])
        for l in LESSONS[:3]:
            self.assertIn(f'- {l}\n', body)
        self.assertEqual(self.lessons(), LESSONS[3:])
        # 사람에게 묻지 않는다 — 결정 대기함 기록이 없다
        self.assertFalse(os.path.exists(self.task.LOG))
        # 되돌릴 길은 그대로: archive 와 기록
        self.assertIn(f'- {LESSONS[0]}\n', read(os.path.join(self.task.LESSONS, '_archive', 'proj.md')))
        rec = [json.loads(l) for l in read(os.path.join(self.task.LESSONS, 'skills.jsonl')).splitlines()]
        self.assertEqual((rec[-1]['action'], rec[-1]['skill'], rec[-1]['project']), ('promote', 'lesson-tauri-dev', 'proj'))
        # 커밋되지 않는 자리 + CLAUDE.local.md 교훈 칸에서만 빠짐
        self.assertEqual(subprocess.run(['git', '-C', self.root, 'check-ignore', '-q', skill]).returncode, 0)
        local = read(os.path.join(self.root, 'CLAUDE.local.md'))
        self.assertNotIn(f'- {LESSONS[0]}\n', local)
        self.assertIn('- 아이디 x', local)
        # 사람에게 전할 한 줄
        report = out.strip().splitlines()[-1]
        self.assertIn('proj', report)
        self.assertIn('3줄', report)
        self.assertIn('lesson-tauri-dev', report)
        self.assertIn('되돌리려면', report)
        _, _, serr = self.run_task('send', 'proj', '버튼 색 바꾸기')
        self.assertNotIn(LESSONS[0], serr)
        self.assertIn('lesson-tauri-dev', serr)

    def test_group__되돌리기는_restore_그대로(self):
        self.group()
        code, _, err = self.run_task('lesson-restore', 'proj', 'tauri-dev')
        self.assertEqual(code, 0, err)
        self.assertEqual(sorted(self.lessons()), sorted(LESSONS))

    def test_group__새_스킬은_3줄_미만이면_거절(self):
        code, _, err = self.group(lines='1-2')
        self.assertEqual(code, 2)
        self.assertTrue(err)
        self.assertEqual(self.lessons(), LESSONS)
        self.assertFalse(os.path.exists(os.path.join(self.root, '.claude', 'skills')))

    def test_group__이상한_입력은_거절하고_아무것도_안_바꾼다(self):
        for args in (['lesson-group', 'proj', 'x', '--lines', '1-3'],                       # --desc 없음
                     ['lesson-group', 'proj', 'x', '--lines', '1-9', '--desc', 'd'],         # 번호 밖
                     ['lesson-group', 'proj', 'Bad Name', '--lines', '1-3', '--desc', 'd'],  # 이름
                     ['lesson-group', '_common', 'x', '--lines', '1-3', '--desc', 'd'],      # 공통 칸
                     ['lesson-group', 'proj', 'x', '--desc', 'd']):                          # --lines 없음
            self.assertEqual(self.run_task(*args)[0], 2, args)
        self.assertEqual(self.lessons(), LESSONS)
        self.assertFalse(os.path.exists(os.path.join(self.root, '.claude', 'skills')))

    def test_group__이미_있는_스킬엔_1줄도_desc_없이_덧붙는다(self):
        self.group(lines='1-3')
        # 남은 줄 2개(원래 4·5번) 중 첫 줄 하나만, --desc 없이
        code, out, err = self.group(lines='1', desc=None)
        self.assertEqual(code, 0, err)
        body = read(os.path.join(self.root, '.claude', 'skills', 'lesson-tauri-dev', 'SKILL.md'))
        for l in LESSONS[:4]:
            self.assertIn(f'- {l}\n', body)
        self.assertNotIn(LESSONS[4], body)
        self.assertIn('description: "tauri dev·vite 1420·개발판 켜고 끌 때"', body)  # 설명은 그대로
        self.assertEqual(self.lessons(), LESSONS[4:])
        self.assertIn('덧붙', out.strip().splitlines()[-1])
        # 되돌리면 합친 줄 전부가 돌아온다
        self.run_task('lesson-restore', 'proj', 'tauri-dev')
        self.assertEqual(sorted(self.lessons()), sorted(LESSONS))

    def test_group__desc_를_주면_덧붙일_때_설명을_바꾼다(self):
        self.group(lines='1-3')
        self.group(lines='1', desc='새 설명')
        body = read(os.path.join(self.root, '.claude', 'skills', 'lesson-tauri-dev', 'SKILL.md'))
        self.assertIn('description: "새 설명"', body)

    def test_group__git_이_추적하는_스킬_폴더면_거절(self):
        d = os.path.join(self.root, '.claude', 'skills', 'lesson-tauri-dev')
        os.makedirs(d)
        with open(os.path.join(d, 'SKILL.md'), 'w') as f:
            f.write('x')
        git(self.root, 'add', '-f', '.claude/skills/lesson-tauri-dev/SKILL.md')
        code, _, err = self.group()
        self.assertEqual(code, 2)
        self.assertEqual(self.lessons(), LESSONS)

    def test_group__없는_글만_고르면_거절하고_옮긴_뒤_같은_번호는_글로_찾는다(self):
        self.group(lines='1-3')
        self.assertEqual(self.group(name='phone', lines='1-3')[0], 2)  # 남은 줄은 2개뿐
        self.assertEqual(self.lessons(), LESSONS[3:])

    def test_review_는_group_길과_이미_있는_스킬_설명을_알려_준다(self):
        self.group()
        _, out, _ = self.run_task('lesson-review', 'proj')
        self.assertIn('lesson-group', out)
        self.assertIn('lesson-tauri-dev', out)
        self.assertIn('tauri dev·vite 1420', out)   # 설명을 보고 같은 주제를 가려 덧붙이게
        self.assertIn('lesson-drop', out)
        self.assertNotIn('lesson-propose', out)

    # ── drop — 버리기만 사람에게 카드로 묻는다 ──
    def test_drop_은_버릴까_카드를_올리고_답_전엔_안_버린다(self):
        code, out, err = self.run_task('lesson-drop', 'proj', '--lines', '5', '--why', '끝난 할 일')
        self.assertEqual(code, 0, err)
        tid = out.strip()
        ev = self.events()
        ask = next(e for e in ev if e['type'] == 'ask')
        self.assertEqual(ask['task'], tid)
        self.assertIn('버릴까', ask['note'])
        self.assertIn('끝난 할 일', ask['note'])
        self.assertIn(LESSONS[4][:20], ask['note'])
        self.assertNotEqual(next(e for e in ev if e['type'] == 'send')['target'], 'proj')
        self.assertEqual(self.lessons(), LESSONS)
        code, _, err = self.run_task('lesson-promote', tid)
        self.assertEqual(code, 2)          # 사람 답이 아직 없다
        self.assertEqual(self.lessons(), LESSONS)

    def test_drop_카드에_버려_답이_오면_promote_가_버린다(self):
        tid = self.run_task('lesson-drop', 'proj', '--lines', '5')[1].strip()
        self.answer(tid, '응 버려')
        code, _, err = self.run_task('lesson-promote', tid)   # --drop 플래그 없이도 drop 카드라서 버린다
        self.assertEqual(code, 0, err)
        self.assertEqual(self.lessons(), LESSONS[:4])
        self.assertIn(LESSONS[4], read(os.path.join(self.task.LESSONS, '_archive', 'proj.md')))
        self.assertFalse(os.path.exists(os.path.join(self.root, '.claude', 'skills')))

    def test_drop_카드에_그대로_답이면_안_버린다(self):
        for note in ['그대로 둬', '처리함', '아니']:
            tid = self.run_task('lesson-drop', 'proj', '--lines', '5')[1].strip()
            self.answer(tid, note)
            self.assertEqual(self.run_task('lesson-promote', tid)[0], 2, note)
        self.assertEqual(self.lessons(), LESSONS)

    def test_drop_은_이상한_번호를_거절한다(self):
        self.assertEqual(self.run_task('lesson-drop', 'proj', '--lines', '9')[0], 2)
        self.assertEqual(self.run_task('lesson-drop', 'proj')[0], 2)
        self.assertFalse(os.path.exists(self.task.LOG))

    # ── restore ──
    def test_되돌리면_줄이_다시_붙고_스킬은_archive_로(self):
        tid = self.propose()
        self.answer(tid, '묶어')
        self.run_task('lesson-promote', tid)
        code, out, err = self.run_task('lesson-restore', 'proj', 'tauri-dev')
        self.assertEqual(code, 0, err)
        self.assertEqual(sorted(self.lessons()), sorted(LESSONS))
        self.assertFalse(os.path.exists(os.path.join(self.root, '.claude', 'skills', 'lesson-tauri-dev')))
        kept = os.path.join(self.task.LESSONS, '_archive', 'skills', 'proj')
        self.assertTrue(any(n.startswith('lesson-tauri-dev') for n in os.listdir(kept)))
        self.assertIn(LESSONS[0], read(os.path.join(self.root, 'CLAUDE.local.md')))
        _, _, err = self.run_task('send', 'proj', '버튼 색 바꾸기')
        self.assertIn(LESSONS[0], err)
        self.assertNotIn('lesson-tauri-dev', err)

    def test_우리가_안_만든_스킬은_되돌리지_않는다(self):
        os.makedirs(os.path.join(self.root, '.claude', 'skills', 'lesson-x'))
        code, _, err = self.run_task('lesson-restore', 'proj', 'x')
        self.assertEqual(code, 2)
        self.assertTrue(os.path.isdir(os.path.join(self.root, '.claude', 'skills', 'lesson-x')))

    # ── 경고 ──
    def test_교훈이_많으면_알아서_묶으라고_알려_준다(self):
        for i in range(15):
            self.run_task('lesson', 'proj', f'교훈 {i}')
        _, _, err = self.run_task('lesson', 'proj', '교훈 하나 더')
        self.assertIn('lesson-review', err)
        self.assertIn('lesson-group', err)
        self.assertIn('한 줄', err)             # 사람에겐 결과 한 줄만
        self.assertNotIn('lesson-propose', err)  # 묻는 길은 이제 안내하지 않는다


@unittest.skipIf(PRIVATE is None, '주인 HQ 판 scripts/task 없음(공개본)')
class PrivateFlow(Flow, unittest.TestCase):
    task = PRIVATE


class PublicFlow(Flow, unittest.TestCase):
    task = PUBLIC


if __name__ == '__main__':
    unittest.main()
