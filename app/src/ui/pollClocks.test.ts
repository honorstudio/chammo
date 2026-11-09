import { describe, expect, it } from 'vitest';
import app from '../App.tsx?raw';
import autoAllow from './useAutoAllow.ts?raw';
import forward from './useForwardQuestions.ts?raw';
import askWake from './useAskWake.ts?raw';
import accountAuto from './useAccountAuto.ts?raw';
import locker from './space/useLocker.ts?raw';

// 11-07: 폴링 값이 그대로면 새 참조를 안 넣는다 — 3초마다 앱 전체가 다시 그려져 가만히 웹뷰 CPU 의 큰 몫이었다.
// 그런데 그 새 참조를 시계로 쓰던 훅이 있었다(값이 그대로면 효과가 다시 안 돈다). 둘 다 지켜야 한다
describe('값이 같으면 다시 안 그린다 — 시계로 쓰던 훅은 자체 타이머로', () => {
  it('세션 목록·꺼진 세션·컨텍스트는 값이 그대로면 옛 참조', () => {
    expect(app).toContain('setSessions((o) => keepSame(o, live))');
    expect(app).toContain('setAllSessions((o) => keepSame(o, everyone))');
    expect(app).toContain('setStopped((o) => keepSame(o, next))');
    expect(app).toContain('setCtx((o) => keepSame(o, nextCtx))');
    expect(locker).toContain('setV((o) => keepSame(o, x))');
  });
  it('시간 글자·시각 판단은 15초 심장 박동이 받친다', () => {
    expect(app).toContain('useEffect(() => every(beat, 15_000), [])');
  });
  it('자동 허용·선택지 전달·계정 전환은 값이 그대로여도 스스로 다시 본다', () => {
    expect(autoAllow).toMatch(/setInterval\(\(\) => step\.current\(\), RECHECK_MS\)/);
    expect(forward).toMatch(/setInterval\(\(\) => step\.current\(\), RECHECK_MS\)/);
    expect(accountAuto).toMatch(/setInterval\(\(\) => round\.current\(\), AUTO_EVERY_MS\)/);
  });
  it('깨우기 재시도는 시간이 되면 스스로 다시 본다', () => {
    expect(askWake).toContain('step.current(); }, RETRY_MS * n)');
  });
});
