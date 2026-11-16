"""알아서 기억 — 공통 메모리를 참모 칸·프로젝트로 옮기기·되돌리기 시험: python3 -m unittest discover -s app/hq-tests -p "test_hq_automem_move*" (지어낸 값만)"""
import pathlib, subprocess, sys, unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from test_hq_automem import World, automem

INDEX = """- [한글로 답하기](always-korean.md) — 늘 한글
- [시안 세 방향](design-three.md) — 디자인 참모 몫
- [가게 앱 결제 구조](shop-pay.md) — 가게 앱 한 프로젝트 몫
"""


class Move(World):
    def setUp(self):
        super().setUp()
        self.mem = pathlib.Path(self.tmp.name) / 'claude-mem'
        self.mem.mkdir()
        (self.mem / 'MEMORY.md').write_text(INDEX, encoding='utf-8')
        for name, body in (('always-korean.md', '늘 한글로 답한다'), ('design-three.md', '시안은 서로 다른 세 방향'), ('shop-pay.md', '결제는 카드 하나만')):
            (self.mem / name).write_text(f'---\nname: {name[:-3]}\ndescription: 지어낸 기억\nmetadata:\n  type: project\n---\n\n{body}\n', encoding='utf-8')

    def test_참모_칸으로_옮기고_되돌린다(self):
        rec = automem.move(self.d, str(self.mem / 'design-three.md'), 'orch:참모-2')
        orch = self.data / 'memory' / 'orch' / '참모-2'
        self.assertTrue((orch / 'design-three.md').exists())
        self.assertIn('[시안 세 방향](design-three.md)', (orch / 'MEMORY.md').read_text(encoding='utf-8'))
        idx = (self.mem / 'MEMORY.md').read_text(encoding='utf-8')
        self.assertNotIn('design-three.md', idx)
        self.assertIn('always-korean.md', idx)
        self.assertFalse((self.mem / 'design-three.md').exists())
        self.assertTrue((self.mem / '_archive' / 'design-three.md').exists())
        self.assertEqual(list(self.mem.glob('MEMORY.md.bak-*'))[0].read_text(encoding='utf-8'), INDEX)
        automem.unmove(self.d, rec['id'])
        self.assertTrue((self.mem / 'design-three.md').exists())
        self.assertIn('design-three.md', (self.mem / 'MEMORY.md').read_text(encoding='utf-8'))
        self.assertNotIn('design-three.md', (orch / 'MEMORY.md').read_text(encoding='utf-8'))
        self.assertFalse((orch / 'design-three.md').exists())

    def test_프로젝트_CLAUDE_local_로_옮기고_되돌린다(self):
        local = self.dev / 'shop-app' / 'CLAUDE.local.md'
        local.write_text('## 계정\n- 아이디: 지어낸값\n', encoding='utf-8')
        rec = automem.move(self.d, str(self.mem / 'shop-pay.md'), 'project:shop-app')
        body = local.read_text(encoding='utf-8')
        self.assertIn('결제는 카드 하나만', body)
        self.assertIn('## 계정', body)
        self.assertNotIn('shop-pay.md', (self.mem / 'MEMORY.md').read_text(encoding='utf-8'))
        automem.unmove(self.d, rec['id'])
        self.assertEqual(local.read_text(encoding='utf-8'), '## 계정\n- 아이디: 지어낸값\n')
        self.assertTrue((self.mem / 'shop-pay.md').exists())

    def test_git_이_안_무시하는_CLAUDE_local_엔_안_옮긴다(self):
        repo = self.dev / 'shop-app'
        subprocess.run(['git', 'init', '-q', str(repo)], check=True)
        with self.assertRaises(ValueError):
            automem.move(self.d, str(self.mem / 'shop-pay.md'), 'project:shop-app')
        self.assertTrue((self.mem / 'shop-pay.md').exists())
        self.assertIn('shop-pay.md', (self.mem / 'MEMORY.md').read_text(encoding='utf-8'))

    def test_옮긴_기억은_그_참모_세션_시작에만(self):
        automem.move(self.d, str(self.mem / 'design-three.md'), 'orch:참모-2')
        import contextlib, io, json
        root = pathlib.Path(self.tmp.name) / 'projects' / automem.launch_key(str(self.hq))
        root.mkdir(parents=True)
        for sid, name in (('s2', '참모-2 · 디자인'), ('s3', '참모-3')):
            (root / f'{sid}.jsonl').write_text(json.dumps({'type': 'agent-name', 'agentName': name}, ensure_ascii=False) + '\n', encoding='utf-8')
        outs = {}
        for sid in ('s2', 's3'):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                automem.hook_start(self.d, {'session_id': sid, 'transcript_path': str(root / f'{sid}.jsonl'), 'cwd': str(self.hq)})
            outs[sid] = out.getvalue()
        self.assertIn('시안 세 방향', outs['s2'])
        self.assertNotIn('시안 세 방향', outs['s3'])

    def test_설정의_devRoot_가_물결이어도_찾는다(self):
        import json, os
        home = pathlib.Path(self.tmp.name)
        (self.data / 'config.json').write_text(json.dumps({'devRoot': '~/dev', 'hqDir': str(self.hq)}))
        old = os.environ.get('HOME')
        os.environ['HOME'] = str(home)
        try:
            automem.move(self.d, str(self.mem / 'shop-pay.md'), 'project:shop-app')
        finally:
            os.environ['HOME'] = old
        self.assertIn('결제는 카드 하나만', (self.dev / 'shop-app' / 'CLAUDE.local.md').read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
