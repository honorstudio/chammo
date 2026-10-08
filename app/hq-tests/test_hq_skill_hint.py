"""HQ 스킬 환기 훅(scripts/skill-hint) 테스트: python3 -m unittest discover -s app/hq-tests
상황별 안내를 늘 실리는 CHAMMO.md 에서 HQ 스킬로 뺐다 — 그 일의 낱말이 보이면 voice-hint 가 '○○ 스킬 열어' 한 줄을 붙인다(2026-10-06)"""
import json, pathlib, subprocess, sys, tempfile, unittest

sys.dont_write_bytecode = True
SCRIPTS = pathlib.Path(__file__).resolve().parent.parent / 'hq-template' / 'scripts'


def hint(prompt, lang=None, script='skill-hint'):
    with tempfile.TemporaryDirectory() as d:
        if lang:
            pathlib.Path(d, 'config.json').write_text(json.dumps({'language': lang}))
        r = subprocess.run(['sh', str(SCRIPTS / script)], input=json.dumps({'prompt': prompt, 'session_id': 'x'}),
                           env={'CHAMMO_HOME': d, 'HOME': d, 'PATH': '/usr/bin:/bin:/opt/homebrew/bin'}, capture_output=True, text=True, timeout=20)
        return r.stdout


class SkillHint(unittest.TestCase):
    def test_낱말이_보이면_그_스킬을_열라고_한_줄(self):
        cases = {
            'hq-browser': 'project-b-platform 세션한테 관리자 페이지 브라우저로 열어서 확인시켜 줘',
            'hq-login': "[앱] project-x 세션이 'Login expired · Please run /login' 으로 멈췄어",
            'hq-routine': '매주 월요일 9시에 리뷰 확인하는 거 걸어 줘',
            'hq-folders': 'claude --bg 가 Operation not permitted 로 실패했어',
            'hq-app': '음성 모드 켜 줘',
        }
        for skill, prompt in cases.items():
            out = hint(prompt)
            self.assertIn(f'`{skill}`', out, prompt)
            self.assertIn('스킬', out)

    def test_상관없는_말엔_아무것도_안_붙인다(self):
        for p in ['PR 512 머지해 줘', 'project-x 세션 회신: 테스트 다 통과했어', '']:
            self.assertEqual(hint(p).strip(), '', p)

    def test_영어_설정이면_영어로(self):
        out = hint('open the admin page in the browser', lang='en')
        self.assertIn('`hq-browser`', out)
        self.assertIn('skill', out)

    def test_한_번에_셋까지만(self):
        out = hint('브라우저 Login expired 매일 음성 모드 Operation not permitted')
        self.assertLessEqual(len([l for l in out.splitlines() if l.strip()]), 3)

    def test_voice_hint_가_불러서_붙인다(self):
        self.assertIn('`hq-routine`', hint('매일 아침 9시에 블로그 글 올려 줘', script='voice-hint'))


if __name__ == '__main__':
    unittest.main()
