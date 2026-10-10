"""HQ 템플릿 scripts/new-project 테스트 (공개판): python3 -m unittest discover -s app/hq-tests"""
import importlib.machinery, importlib.util, json, os, pathlib, sys, tempfile, unittest
import unittest.mock

sys.dont_write_bytecode = True

SCRIPTS = pathlib.Path(__file__).resolve().parent.parent / 'hq-template' / 'scripts'


def load(name):
    loader = importlib.machinery.SourceFileLoader(f'hq_{name.replace("-", "_")}', str(SCRIPTS / name))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


np = load('new-project')


def setUpModule():
    # 시험을 돌리는 셸에 CLAUDE_CONFIG_DIR 가 있으면 믿음 쓰기가 그 진짜 설정으로 간다 — 시험마다 홈(임시 폴더)만 보게
    p = unittest.mock.patch.dict(os.environ)
    p.start()
    os.environ.pop('CLAUDE_CONFIG_DIR', None)
    unittest.addModuleCleanup(p.stop)


def fake_data(root, lang='ko'):
    """데이터 폴더 흉내 — config.json + 앱이 풀어 둔 템플릿"""
    data = pathlib.Path(root) / 'data'
    dev = pathlib.Path(root) / 'dev'
    dev.mkdir(parents=True)
    (data / 'templates/project' / lang / 'docs').mkdir(parents=True)
    (data / 'config.json').write_text(json.dumps({'language': lang, 'devRoot': str(dev)}))
    t = data / 'templates/project' / lang
    (t / 'CLAUDE.md').write_text('# {{name}}\n\n{{summary}}\n')
    (t / 'docs/starter.md').write_text('{{name}} {{date}}\n')
    (t / 'gitignore').write_text('.shots/\n')
    return data, dev


class Names(unittest.TestCase):
    def test_폴더_이름(self):
        self.assertTrue(np.valid_name('acme-shop'))
        for bad in ['Acme', '쇼핑몰', '-x', 'a b', '', '../etc']:
            self.assertFalse(np.valid_name(bad), bad)


class Create(unittest.TestCase):
    def test_새_프로젝트_폴더_git_하네스(self):
        with tempfile.TemporaryDirectory() as root:
            data, dev = fake_data(root)
            out = np.create('shop-landing', '작은 쇼핑몰 랜딩', data=str(data), home=root, today='2026-09-28')
            p = dev / 'shop-landing'
            self.assertEqual(out['path'], str(p))
            self.assertTrue((p / '.git').is_dir())
            self.assertEqual((p / 'CLAUDE.md').read_text(), '# shop-landing\n\n작은 쇼핑몰 랜딩\n')
            self.assertIn('2026-09-28', (p / 'docs/starter.md').read_text())
            self.assertTrue((p / '.gitignore').is_file())
            self.assertFalse(out['projectStarter'])

    def test_있는_폴더면_빈_자리만_채운다(self):
        with tempfile.TemporaryDirectory() as root:
            data, dev = fake_data(root)
            p = dev / 'old'
            p.mkdir()
            (p / 'CLAUDE.md').write_text('# 내 규칙')
            out = np.create('old', '설명', data=str(data), home=root, today='2026-09-28')
            self.assertEqual((p / 'CLAUDE.md').read_text(), '# 내 규칙')
            self.assertTrue(out['existed'])
            self.assertIn('docs/starter.md', out['written'])

    def test_project_starter_스킬이_있으면_그걸_쓰라고_하고_템플릿은_안_깐다(self):
        with tempfile.TemporaryDirectory() as root:
            data, dev = fake_data(root)
            skill = pathlib.Path(root) / '.claude/skills/project-starter'
            skill.mkdir(parents=True)
            (skill / 'SKILL.md').write_text('x')
            out = np.create('app-x', '설명', data=str(data), home=root, today='2026-09-28')
            self.assertTrue(out['projectStarter'])
            self.assertFalse((dev / 'app-x' / 'CLAUDE.md').exists())
            self.assertTrue((dev / 'app-x' / '.git').is_dir())

    def test_이름이_틀리면_아무것도_안_만든다(self):
        with tempfile.TemporaryDirectory() as root:
            data, dev = fake_data(root)
            with self.assertRaises(ValueError):
                np.create('My App', '설명', data=str(data), home=root, today='2026-09-28')
            self.assertEqual(list(dev.iterdir()), [])


class Trust(unittest.TestCase):
    # claude --bg 는 부모 폴더를 믿어도 새 하위 폴더는 "Workspace not trusted" 로 거부했다(2026-09-28 데모 실측)
    def test_새로_만든_폴더는_믿음으로_기록(self):
        with tempfile.TemporaryDirectory() as root:
            data, dev = fake_data(root)
            cj = pathlib.Path(root) / '.claude.json'
            cj.write_text(json.dumps({'numStartups': 3, 'projects': {'/other': {'hasTrustDialogAccepted': True, 'x': 1}}}))
            out = np.create('fresh-app', '설명', data=str(data), home=root, today='2026-09-28')
            d = json.loads(cj.read_text())
            self.assertTrue(d['projects'][out['path']]['hasTrustDialogAccepted'])
            self.assertEqual(d['projects']['/other'], {'hasTrustDialogAccepted': True, 'x': 1})  # 다른 건 그대로
            self.assertEqual(d['numStartups'], 3)
            self.assertTrue(out['trusted'])

    def test_있던_폴더는_믿음을_대신_주지_않는다(self):
        with tempfile.TemporaryDirectory() as root:
            data, dev = fake_data(root)
            (dev / 'old').mkdir()
            cj = pathlib.Path(root) / '.claude.json'
            cj.write_text(json.dumps({'projects': {}}))
            out = np.create('old', '설명', data=str(data), home=root, today='2026-09-28')
            self.assertNotIn(out['path'], json.loads(cj.read_text())['projects'])
            self.assertFalse(out['trusted'])

    def test_CLAUDE_CONFIG_DIR_면_그_폴더의_claude_json_에_적는다(self):
        # Claude Code 는 CLAUDE_CONFIG_DIR 가 있으면 그 안 .claude.json 을 읽는다 — 홈 것에 적으면 시험 설정으로 돌려도 진짜 설정에 칸이 생겼다
        with tempfile.TemporaryDirectory() as root:
            data, dev = fake_data(root)
            home_cj = pathlib.Path(root) / '.claude.json'
            home_cj.write_text(json.dumps({'projects': {}}))
            cfg = pathlib.Path(root) / 'cfg'
            cfg.mkdir()
            (cfg / '.claude.json').write_text(json.dumps({'projects': {}}))
            with unittest.mock.patch.dict(os.environ, {'CLAUDE_CONFIG_DIR': str(cfg)}):
                out = np.create('cfg-app', '설명', data=str(data), home=root, today='2026-09-28')
            self.assertTrue(json.loads((cfg / '.claude.json').read_text())['projects'][out['path']]['hasTrustDialogAccepted'])
            self.assertEqual(json.loads(home_cj.read_text()), {'projects': {}})
            self.assertTrue(out['trusted'])

    def test_claude_json_이_없거나_깨졌으면_건드리지_않는다(self):
        with tempfile.TemporaryDirectory() as root:
            data, dev = fake_data(root)
            cj = pathlib.Path(root) / '.claude.json'
            cj.write_text('{not json')
            out = np.create('x-app', '설명', data=str(data), home=root, today='2026-09-28')
            self.assertEqual(cj.read_text(), '{not json')
            self.assertFalse(out['trusted'])


class Browser(unittest.TestCase):
    def fake_tool(self, data, root):
        tool = data / 'tools/chammo-browser'
        (tool / 'node_modules/@playwright/mcp').mkdir(parents=True)
        (tool / 'node_modules/@playwright/mcp/package.json').write_text('{}')
        (tool / 'bin').mkdir()
        (tool / 'bin/chammo-browser.js').write_text('')
        node = pathlib.Path(root) / 'fake-node'  # node <js> setup <이름> <폴더> 흉내 — .mcp.json 을 쓴다
        node.write_text('#!/bin/sh\nprintf \'{"mcpServers":{"playwright":{"args":["%s"]}}}\' "$3" > "$4/.mcp.json"\n')
        node.chmod(0o755)
        return str(node)

    def test_node_는_앱이_고른_것부터_링크_받은_것_시스템_순(self):
        # 앱이 고른 node(<데이터>/tools/bin/node 링크) → 앱이 받은 node → PATH — .mcp.json 에 버전 폴더가 박히지 않게(⑧)
        with tempfile.TemporaryDirectory() as root:
            data = pathlib.Path(root) / 'd'
            ours = data / 'tools/node/bin/node'
            ours.parent.mkdir(parents=True)
            ours.write_text('')
            self.assertEqual(np.pick_node(str(data), which=lambda _: '/opt/homebrew/bin/node', win=False), str(ours))
            link = data / 'tools/bin/node'
            link.parent.mkdir(parents=True)
            link.symlink_to('../node/bin/node')
            self.assertEqual(np.pick_node(str(data), which=lambda _: '/opt/homebrew/bin/node', win=False), str(link))
            empty = pathlib.Path(root) / 'empty'
            self.assertEqual(np.pick_node(str(empty), which=lambda _: '/usr/bin/node', win=False), '/usr/bin/node')
            win = pathlib.Path(root) / 'w'
            (win / 'tools/node').mkdir(parents=True)
            (win / 'tools/node/node.exe').write_text('')
            self.assertEqual(np.pick_node(str(win), which=lambda _: None, win=True), str(win / 'tools/node/node.exe'))

    def test_깔려_있으면_새_프로젝트에_브라우저_프로필과_미리_승인(self):
        with tempfile.TemporaryDirectory() as root:
            data, dev = fake_data(root)
            node = self.fake_tool(data, root)
            out = np.create('web-app', '설명', data=str(data), home=root, today='2026-09-28', node=node)
            p = dev / 'web-app'
            self.assertTrue(out['browser'])
            self.assertEqual(json.loads((p / '.mcp.json').read_text())['mcpServers']['playwright']['args'], ['web-app'])
            self.assertEqual(json.loads((p / '.claude/settings.local.json').read_text())['enabledMcpjsonServers'], ['playwright'])
            # playwright MCP 가 프로젝트 폴더에 남기는 스냅샷이 git 에 섞이지 않게
            self.assertIn('.playwright-mcp/', (p / '.gitignore').read_text().splitlines())

    def test_gitignore_는_있던_줄을_살리고_한_번만_더한다(self):
        with tempfile.TemporaryDirectory() as root:
            p = pathlib.Path(root)
            (p / '.gitignore').write_text('node_modules/')  # 끝 줄바꿈 없음
            np.gitignore(str(p), '.playwright-mcp/')
            np.gitignore(str(p), '.playwright-mcp/')
            self.assertEqual((p / '.gitignore').read_text(), 'node_modules/\n.playwright-mcp/\n')

    def test_안_깔려_있으면_건너뛴다(self):
        with tempfile.TemporaryDirectory() as root:
            data, dev = fake_data(root)
            out = np.create('web-app', '설명', data=str(data), home=root, today='2026-09-28', node='/nope')
            self.assertFalse(out['browser'])
            self.assertFalse((dev / 'web-app' / '.mcp.json').exists())

    def test_있던_폴더엔_브라우저를_대신_붙이지_않는다(self):
        with tempfile.TemporaryDirectory() as root:
            data, dev = fake_data(root)
            node = self.fake_tool(data, root)
            (dev / 'old').mkdir()
            out = np.create('old', '설명', data=str(data), home=root, today='2026-09-28', node=node)
            self.assertFalse(out['browser'])
            self.assertFalse((dev / 'old' / '.mcp.json').exists())


class StatusLine(unittest.TestCase):
    def test_새_프로젝트_세션도_앱_상태줄로(self):
        with tempfile.TemporaryDirectory() as root:
            data, dev = fake_data(root)
            (data / 'tools').mkdir()
            (data / 'tools/statusline').write_text('#!/bin/sh\n')
            np.create('web-app', '설명', data=str(data), home=root, today='2026-09-28', node='/nope')
            s = json.loads((dev / 'web-app/.claude/settings.local.json').read_text())
            self.assertEqual(s['statusLine'], {'type': 'command', 'command': str(data / 'tools/statusline')})

    def test_스크립트가_없으면_안_건드린다(self):
        with tempfile.TemporaryDirectory() as root:
            data, dev = fake_data(root)
            np.create('web-app', '설명', data=str(data), home=root, today='2026-09-28', node='/nope')
            self.assertFalse((dev / 'web-app/.claude/settings.local.json').exists())


if __name__ == '__main__':
    unittest.main()


class TrustOnWindows(unittest.TestCase):
    """윈도우 Claude Code 는 .claude.json 키를 C:/… 로 찾는다 — C:\\… 로 적으니 'Workspace not trusted'. 
    또 claude 가 파일을 쥐고 있으면 바꿔치기(os.replace)가 PermissionError — 제자리에 쓴다"""
    def test_키는_슬래시로_바꿔치기가_막히면_제자리에(self):
        with tempfile.TemporaryDirectory() as h:
            cj = os.path.join(h, '.claude.json')
            open(cj, 'w', encoding='utf-8').write('{"projects": {}}')
            real = os.replace
            def locked(a, b):
                raise PermissionError('in use')
            os.replace = locked
            try:
                self.assertTrue(np.trust('C:\\Users\\a\\dev\\x', h, win=True))
            finally:
                os.replace = real
            d = json.load(open(cj, encoding='utf-8'))
            self.assertTrue(d['projects']['C:/Users/a/dev/x']['hasTrustDialogAccepted'])
            self.assertFalse(os.path.exists(cj + '.chammo-tmp'))
