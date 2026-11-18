"""scripts/default-model-hook 테스트(참모가 Bash 로 치는 claude --bg 에 새 세션 기본 모델·노력값 붙이기): python3 -m unittest app/hq-tests/test_hq_default_model_hook.py"""
import json, os, pathlib, subprocess, tempfile, unittest

HERE = pathlib.Path(__file__).parent
SCRIPT = HERE.parent / 'hq-template' / 'scripts' / 'default-model-hook'


def run(cmd, cfg=None, tool='Bash'):
    with tempfile.TemporaryDirectory() as d:
        if cfg is not None:
            with open(os.path.join(d, 'config.json'), 'w') as f:
                f.write(json.dumps(cfg))
        env = dict(os.environ, CHAMMO_HOME=d, HOME=d)
        p = subprocess.run(['sh', str(SCRIPT)], input=json.dumps({'tool_name': tool, 'tool_input': {'command': cmd, 'description': 'x'}}),
                           capture_output=True, text=True, env=env, timeout=20)
        assert p.returncode == 0, p.stderr
        if not p.stdout.strip():
            return None
        out = json.loads(p.stdout)['hookSpecificOutput']
        assert out['hookEventName'] == 'PreToolUse'
        assert out['updatedInput']['description'] == 'x', '다른 칸은 그대로'
        return out['updatedInput']['command']


ON = {'defaultModel': 'sonnet', 'defaultEffort': 'high'}


class Hook(unittest.TestCase):
    def test_값이_없으면_안_바꾼다(self):
        self.assertIsNone(run('claude --bg -n x "일"', {}))
        self.assertIsNone(run('claude --bg -n x "일"', None))

    def test_bg_뒤에_붙인다(self):
        self.assertEqual(run('cd ~/dev/shop && claude --bg --dangerously-skip-permissions -n shop "일"', ON),
                         'cd ~/dev/shop && claude --bg --model sonnet --effort high --dangerously-skip-permissions -n shop "일"')

    def test_경로로_부른_claude_와_줄바꿈_뒤도(self):
        self.assertEqual(run('X=1 /opt/bin/claude --bg -n a "b"', ON), 'X=1 /opt/bin/claude --bg --model sonnet --effort high -n a "b"')
        self.assertEqual(run('echo hi\nclaude --bg -n a', {'defaultModel': 'opus'}), 'echo hi\nclaude --bg --model opus -n a')

    def test_이미_고른_칸은_그대로(self):
        self.assertEqual(run('claude --bg --model haiku -n a', ON), 'claude --bg --effort high --model haiku -n a')
        self.assertIsNone(run('claude --bg --model haiku --effort low -n a', ON))

    def test_명령_자리가_아니면_안_건드린다(self):
        self.assertIsNone(run('scripts/task send shop "claude --bg 로 띄워"', ON))
        self.assertIsNone(run('claude agents --json', ON))
        self.assertIsNone(run('claude respawn abcd1234', ON))
        self.assertIsNone(run('claude --bg -n a', ON, tool='Read'))

    def test_모르는_값은_버린다(self):
        self.assertIsNone(run('claude --bg -n a', {'defaultModel': 'gpt; rm -rf ~', 'defaultEffort': 'ultra'}))


if __name__ == '__main__':
    unittest.main()
