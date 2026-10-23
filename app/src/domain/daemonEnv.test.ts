import { describe, expect, it } from 'vitest';
import { daemonEnvKey, daemonEnvText } from './daemonEnv';

describe('daemonEnv — 데몬이 시험 폴더로 떠 있으면 참모에게 한 줄(2026-10-23 아이맥 soak)', () => {
  const d = { pid: 4242, home: '/Users/me/.chammo-soak' };
  it('데몬 번호·값마다 한 번', () => {
    expect(daemonEnvKey(d)).toBe('4242:/Users/me/.chammo-soak');
    expect(daemonEnvKey({ ...d, pid: 5000 })).not.toBe(daemonEnvKey(d));
  });
  it('한 줄에 폴더와 내리는 명령, 줄바꿈 없음', () => {
    const t = daemonEnvText(d);
    expect(t.startsWith('[앱]') || t.startsWith('[app]')).toBe(true);
    expect(t).toContain('/Users/me/.chammo-soak');
    expect(t).toContain('claude daemon stop --any --keep-workers');
    expect(t).not.toContain('\n');
  });
});
