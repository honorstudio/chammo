// 화면이 멈추면 notify.log 에 'ui-crash <창> <오류>' 한 줄 — 설치 스크립트가 새 판 메인 창 멈춤을 보고 백업으로 되돌린다(2026-11-05 TDZ 멈춤)
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const cfg: { bubble: boolean | null } = { bubble: null };
vi.mock('../data/tauri', () => ({
  bumpUsage: () => {},
  uiCrash: (m: string) => { calls.push(m); return Promise.reject(new Error('폰엔 앱 명령이 없다')); },
  readConfig: () => (cfg.bubble === null ? Promise.reject(new Error('폰엔 앱 명령이 없다')) : Promise.resolve({ features: { bubble: cfg.bubble } })),
  bubbleRescue: () => Promise.resolve(),
}));

const { ErrorBoundary } = await import('./ErrorBoundary');

describe('ErrorBoundary — 멈춘 걸 앱 기록에 남긴다', () => {
  beforeEach(() => { calls.length = 0; cfg.bubble = null; });
  it('잡은 오류 글을 uiCrash 로 넘긴다', () => {
    new ErrorBoundary({ children: null }).componentDidCatch(new ReferenceError("Cannot access 'ko' before initialization."));
    expect(calls).toEqual(["Cannot access 'ko' before initialization."]);
  });
  it('Error 가 아닌 것도 글로', () => {
    new ErrorBoundary({ children: null }).componentDidCatch('문자열 던짐');
    expect(calls).toEqual(['문자열 던짐']);
  });
  it('기록 명령이 실패해도(폰·브라우저) 던지지 않는다', async () => {
    expect(() => new ErrorBoundary({ children: null }).componentDidCatch(new Error('x'))).not.toThrow();
    await new Promise((r) => setTimeout(r, 0)); // 거부된 약속이 처리 안 된 채 남지 않는다(vitest 가 잡는다)
  });
});

// 11-13 배지 끄기 검토 — 배지는 메인 창 화면이 멈췄을 때 참모와 말할 비상구(11-05 TDZ). 꺼 둔 사람에겐 켜는 단추
describe('ErrorBoundary — 배지를 꺼 뒀으면 켜는 단추', () => {
  const caught = async (bubble: boolean) => {
    cfg.bubble = bubble;
    const b = new ErrorBoundary({ children: null });
    const seen: unknown[] = [];
    b.setState = ((s: unknown) => { seen.push(s); }) as typeof b.setState;
    b.componentDidCatch(new Error('x'));
    await new Promise((r) => setTimeout(r, 0));
    return seen;
  };
  it('꺼져 있으면 badgeOff', async () => {
    expect(await caught(false)).toEqual([{ badgeOff: true }]);
  });
  it('켜져 있으면 단추 없음', async () => {
    expect(await caught(true)).toEqual([{ badgeOff: false }]);
  });
});
