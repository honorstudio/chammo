"""교훈 스킬 승격이 git 에 새지 않는지(lesson_skill.ensure_ignored)·gitignore 안내 시험 (공개판)
흐름 시험(review·propose·group·drop·restore)은 test_hq_lesson_skill.py — 같은 Harness 틀을 빌려 두 task 판에 돌린다"""
import sys
sys.dont_write_bytecode = True  # 템플릿 폴더에 __pycache__ 가 생기지 않게
import os, subprocess, unittest

from test_hq_lesson_skill import LESSONS, PRIVATE, PUBLIC, Harness, git, read


class GitFlow(Harness):
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

    def test_group__git_이_추적하는_스킬_폴더면_거절(self):
        d = os.path.join(self.root, '.claude', 'skills', 'lesson-tauri-dev')
        os.makedirs(d)
        with open(os.path.join(d, 'SKILL.md'), 'w') as f:
            f.write('x')
        git(self.root, 'add', '-f', '.claude/skills/lesson-tauri-dev/SKILL.md')
        code, _, err = self.group()
        self.assertEqual(code, 2)
        self.assertEqual(self.lessons(), LESSONS)


@unittest.skipIf(PRIVATE is None, '주인 HQ 판 scripts/task 없음(공개본)')
class PrivateGitFlow(GitFlow, unittest.TestCase):
    task = PRIVATE


class PublicGitFlow(GitFlow, unittest.TestCase):
    task = PUBLIC


if __name__ == '__main__':
    unittest.main()
