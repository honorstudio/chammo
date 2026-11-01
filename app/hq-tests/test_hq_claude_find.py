"""claude 찾기 — 네 스크립트가 앱(setup::find)과 같은 규칙(qa-1101 win-env H2): python3 -m unittest discover -s app/hq-tests"""
import importlib.machinery, importlib.util, pathlib, sys, unittest

sys.dont_write_bytecode = True

SCRIPTS = pathlib.Path(__file__).resolve().parent.parent / 'hq-template' / 'scripts'


def load(name):
    loader = importlib.machinery.SourceFileLoader(f'hq_find_{name.replace("-", "_")}', str(SCRIPTS / name))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


MODS = [load(n) for n in ('task', 'choice', 'routine', 'orch-roster')]

HOME = r'C:\Users\a'
NPM = HOME + r'\AppData\Roaming\npm'
LINKS = HOME + r'\AppData\Local\Microsoft\WinGet\Links'
LOCAL = HOME + r'\.local\bin\claude.exe'
SHIM = NPM + r'\claude.cmd'
EXE = NPM + r'\node_modules\@anthropic-ai\claude-code\bin\claude.exe'
# 윈도우 시험 PC 에서 npm 이 만든 바로가기 그대로(setup.rs NPM_SHIM 과 같은 글)
SHIM_TEXT = ('@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n'
             '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n')
OLD_TEXT = 'endLocal & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n'


def win(mod, files, path=f'{NPM};{LINKS}', text=SHIM_TEXT):
    return mod.find_claude(home=HOME, path=path, win=True, isfile=lambda p: p in files, read=lambda p: text if p == SHIM else None)


class WindowsFind(unittest.TestCase):
    def test_공식_설치본이_PATH_보다_먼저(self):
        # 재현: 0.4.6 '다시 설치' 뒤에도 PATH 앞쪽 npm 바로가기를 잡았다 — 앱은 .local\bin 먼저라 둘이 다른 claude 를 봤다
        for m in MODS:
            self.assertEqual(win(m, {LOCAL, SHIM, EXE}), LOCAL, m.__name__)

    def test_npm_바로가기는_진짜_exe_로(self):
        for m in MODS:
            self.assertEqual(win(m, {SHIM, EXE}), EXE, m.__name__)

    def test_대상이_빠진_바로가기와_확장자_없는_sh_글은_건너뛴다(self):
        # 10-31 사용자 PC: claude.cmd 는 있는데 bin\claude.exe 가 없다. npm 은 옆에 sh 글 claude·claude.ps1 도 만든다
        for m in MODS:
            self.assertEqual(win(m, {SHIM, NPM + r'\claude', NPM + r'\claude.ps1', LINKS + r'\claude.exe'}), LINKS + r'\claude.exe', m.__name__)
            self.assertIsNone(win(m, {SHIM, NPM + r'\claude'}), m.__name__)

    def test_옛_node_판과_못_읽는_바로가기는_그대로(self):
        for m in MODS:
            self.assertEqual(win(m, {SHIM, NPM + r'\node_modules\@anthropic-ai\claude-code\cli.js'}, text=OLD_TEXT), SHIM, m.__name__)
            self.assertEqual(win(m, {SHIM}, text=None), SHIM, m.__name__)

    def test_PATH_가_낡아도_winget_npm_기본_자리(self):
        for m in MODS:
            self.assertEqual(win(m, {LINKS + r'\claude.exe'}, path=r'C:\Windows'), LINKS + r'\claude.exe', m.__name__)
            self.assertEqual(win(m, {SHIM, EXE}, path=''), EXE, m.__name__)


class MacFind(unittest.TestCase):
    def test_공식_설치본_PATH_brew_순(self):
        for m in MODS:
            f = lambda files, path='/opt/homebrew/bin:/usr/bin': m.find_claude(home='/h', path=path, win=False, isfile=lambda p: p in files)
            self.assertEqual(f({'/h/.local/bin/claude', '/opt/homebrew/bin/claude'}), '/h/.local/bin/claude', m.__name__)
            self.assertEqual(f({'/usr/bin/claude'}), '/usr/bin/claude', m.__name__)
            self.assertEqual(f({'/usr/local/bin/claude'}, path=''), '/usr/local/bin/claude', m.__name__)
            self.assertIsNone(f(set()), m.__name__)


class RoutineStoredClaude(unittest.TestCase):
    """예약은 만들 때 찾은 claude 를 routine.json 에 적어 둔다 — 그때 깨진 npm 바로가기를 적었으면 고친 뒤에도 그걸 불렀다"""
    rt = MODS[2]

    def test_윈도우는_적어_둔_바로가기를_다시_찾는다(self):
        found = lambda: EXE
        self.assertEqual(self.rt.claude_of(SHIM, win=True, isfile=lambda p: True, find=found), EXE)
        self.assertEqual(self.rt.claude_of(r'C:\gone\claude.exe', win=True, isfile=lambda p: False, find=found), EXE)
        self.assertEqual(self.rt.claude_of(LOCAL, win=True, isfile=lambda p: True, find=found), LOCAL, '멀쩡한 exe 는 그대로')
        self.assertEqual(self.rt.claude_of(SHIM, win=True, isfile=lambda p: True, find=lambda: None), SHIM, '못 찾으면 적어 둔 것')

    def test_맥은_적어_둔_것_그대로(self):
        self.assertEqual(self.rt.claude_of('/bin/claude', win=False, isfile=lambda p: False, find=lambda: '/x'), '/bin/claude')


if __name__ == '__main__':
    unittest.main()
