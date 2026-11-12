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


class Paused(unittest.TestCase):
    def test_멈춘_짝은_account_대신_왜_멈췄는지_한_줄(self):
        out = shown({'me': 'laptop', 'devices': [{'id': 'nOLD', 'name': 'office-pc', 'status': 'account', 'paused': 'unbound',
                                                   'pausedWord': '예전 방식으로 연결한 컴퓨터예요. 지금 방식으로 재연결해 주세요', 'assistants': []}]})
        self.assertNotIn('— account', out)
        self.assertIn('예전 방식', out)
        self.assertIn('scripts/peer connect office-pc', out)


class ConnectNote(unittest.TestCase):
    def test_연결_중_앱이_남긴_알림을_바로_보여_준다(self):
        import os, tempfile
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, 'answers'))
        seen = []
        real_uuid = peer.uuid.uuid4
        class U:
            hex = 'abc123def4567890'
        peer.uuid.uuid4 = lambda: U()
        try:
            rid = 'abc123def456'
            with open(os.path.join(d, 'answers', f'peer-{rid}.note'), 'w', encoding='utf-8') as f:
                f.write('승인 메일을 못 보냈어요(os error 49)')
            with open(os.path.join(d, 'answers', f'peer-{rid}.txt'), 'w', encoding='utf-8') as f:
                f.write(f'#id {rid}\n{{"ok": true, "device": "box"}}')
            code, ans = peer.ask(d, {'verb': 'connect', 'device': 'box'}, 5, on_note=seen.append)
        finally:
            peer.uuid.uuid4 = real_uuid
        self.assertEqual(code, 0)
        self.assertEqual(seen, ['승인 메일을 못 보냈어요(os error 49)'])

