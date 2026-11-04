import { describe, expect, it } from 'vitest';
import { parseSys, type LoadReport } from './load';
import { loadCard } from './loadCard';

// 2026-11-01 21:05 이 맥 실측 — CPU 2.5배·메모리 스왑 5.6GB·저장공간 20GB(4.3%)
const SYS = parseSys('10\n{ 24.94 24.68 17.80 }\ntotal = 7168.00M  used = 5703.75M  free = 1464.25M  (encrypted)\n25769803776\n\n46\n1', '21305425920 494384795648')!;
const s = (name: string, cpu: number, mb: number) => ({ id: name, name, project: 'p', cpu, rssKb: mb * 1024, top: [] });
const REPORT: LoadReport = {
  sessions: [s('shop-ia', 7, 554), s('blog-fix', 26, 1400), s('tiny', 0.2, 40), s('demo-img', 5, 1200), s('site-thumbs', 4, 820)],
  orphans: [], modes: [],
  outside: { cpu: 3, rssKb: 100 * 1024, top: [] },
  rest: { cpu: 107, rssKb: 8800 * 1024, top: [] },
};

describe('loadCard — 부하 칩 호버 카드(C안: 문제 위로, 괜찮은 건 한 줄)', () => {
  it('문제 있는 자원이 위로 — 높음 먼저, 저장공간은 정리 버튼', () => {
    const c = loadCard(SYS, REPORT);
    expect(c.bad.map((x) => [x.key, x.lv])).toEqual([['cpu', 'high'], ['disk', 'high'], ['mem', 'warn']]);
    expect(c.bad.find((x) => x.key === 'disk')?.clean).toBe(true);
    expect(c.bad.find((x) => x.key === 'cpu')?.num).toBe('2.5×');
    expect(c.good).toEqual([]);
  });
  it('다 괜찮으면 bad 없음·good 셋', () => {
    const ok = parseSys('10\n{ 2.0 2.0 2.0 }\ntotal = 0.00M  used = 0.00M  free = 0.00M\n25769803776\n\n60\n1', '200000000000 494384795648')!;
    const c = loadCard(ok, REPORT);
    expect(c.bad).toEqual([]);
    expect(c.good.map((x) => x.key)).toEqual(['cpu', 'mem', 'disk']);
    expect(c.lv).toBe('ok');
  });
  it('많이 쓰는 세션 = CPU 순 3개, 그 밖의 앱 = Chammo 밖 + 나머지 합', () => {
    const c = loadCard(SYS, REPORT);
    expect(c.sessions.map((x) => x.name)).toEqual(['blog-fix', 'shop-ia', 'demo-img']);
    expect(c.rest).toEqual({ cpu: 110, rssKb: 8900 * 1024 });
  });
  it('저장공간을 모르면(윈도우) 그 칸이 없다', () => {
    const c = loadCard({ ...SYS, diskFreeGb: undefined, diskTotalGb: undefined }, REPORT);
    expect([...c.bad, ...c.good].some((x) => x.key === 'disk')).toBe(false);
  });
  it('report 가 아직 없으면 세션 칸은 비움', () => {
    expect(loadCard(SYS, null).sessions).toEqual([]);
  });
});
