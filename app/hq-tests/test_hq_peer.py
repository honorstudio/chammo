"""scripts/peer 목록의 계정 줄 (공개판): python3 -m unittest discover -s app/hq-tests"""
import contextlib, importlib.machinery, importlib.util, io, pathlib, sys, unittest

sys.dont_write_bytecode = True

SCRIPTS = pathlib.Path(__file__).resolve().parent.parent / 'hq-template' / 'scripts'
loader = importlib.machinery.SourceFileLoader('hq_peer', str(SCRIPTS / 'peer'))
spec = importlib.util.spec_from_loader(loader.name, loader)
peer = importlib.util.module_from_spec(spec)
loader.exec_module(peer)


def shown(ans):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        peer.show_list(ans)
    return out.getvalue()


class Accounts(unittest.TestCase):
    def test_그_기기_chammo_가_어느_계정인지_시험_데이터_폴더도_따로(self):
        out = shown({'me': 'laptop', 'devices': [{'id': 'nA', 'name': 'office-imac', 'status': 'connected', 'assistants': [], 'accounts': [
            {'folder': '.chammo', 'current': True, 'email': '', 'name': ''},
            {'folder': '.chammo-qa', 'current': False, 'email': 'other@example.com', 'name': 'Kim'},
        ]}]})
        self.assertIn('account / 계정: not signed in / 로그인 안 됨', out)
        self.assertIn('.chammo-qa', out)
        self.assertIn('other@example.com (Kim)', out)

    def test_옛_판은_계정_줄이_없다(self):
        out = shown({'me': 'laptop', 'devices': [{'id': 'nA', 'name': 'office-imac', 'status': 'connected', 'assistants': []}]})
        self.assertNotIn('계정', out)


if __name__ == '__main__':
    unittest.main()
