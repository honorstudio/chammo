"""team ask 뒤 2시간 안이어도 --team-work 를 붙인 일만 그 팀 일 — 시각만 보면 다른 거래처 일 결과가 팀에 갔다(0.4.9 2차)"""
import json, os, pathlib, subprocess, sys, tempfile, time, unittest

TASK = pathlib.Path(__file__).resolve().parent.parent / 'hq-template' / 'scripts' / 'task'


class TeamWorkFlag(unittest.TestCase):
    def send(self, d, *extra):
        env = {**os.environ, 'CHAMMO_HOME': d, 'CLAUDE_JOB_DIR': '/tmp/jobs/me', 'PYTHONUTF8': '1'}
        r = subprocess.run([sys.executable, str(TASK), 'send', 'some-session', '거래처 일', *extra], env=env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        rows = [json.loads(x) for x in pathlib.Path(d, 'tasks.jsonl').read_text(encoding='utf-8').splitlines() if x.strip()]
        return [e for e in rows if e.get('type') == 'send'][-1], r.stderr

    def test_표시한_일만_팀_일(self):
        with tempfile.TemporaryDirectory() as d:
            pathlib.Path(d, 'team-work.json').write_text(json.dumps({'me': {'team': 't1', 'at': time.time()}}), encoding='utf-8')
            ev, err = self.send(d)
            self.assertNotIn('team', ev, '표시 없으면 팀에 안 간다')
            self.assertIn('--team-work', err, '참모에게 알린다')
            ev, _ = self.send(d, '--team-work')
            self.assertEqual(ev.get('team'), 't1')
            self.assertNotIn('--team-work', ev.get('title', ''))

    def test_team_ask_안_했으면_표시해도_팀_일_아님(self):
        with tempfile.TemporaryDirectory() as d:
            ev, _ = self.send(d, '--team-work')
            self.assertNotIn('team', ev)


if __name__ == '__main__':
    unittest.main()
