import { describe, expect, it } from 'vitest';
import { chiefLine, memcapSession, routeMemcap, sessionLine, type MemcapEvent } from './browserMemcap';
import type { Session } from './session';

const ev = (o: Partial<MemcapEvent> = {}): MemcapEvent => ({
  at: '2026-11-16T13:00:00.000Z', profile: 'store-shop', action: 'trim', why: 'profile', bytes: 7.4 * 1024 ** 3, capGb: 6,
  tabs: ['https://shop.example/p/1'], sessionPid: 4242, via: 'script', ...o,
});
const s = (id: string, o: Partial<Session> = {}) => ({ id, name: id, cwd: `/dev/${id}`, state: 'idle', ...o }) as Session;

describe('참모 브라우저 메모리 상한 알림(2026-11-16 맥 멈춤 사고)', () => {
  it('세션은 기록의 세션 pid(procPid)로 찾는다', () => {
    const shop = s('shop-store', { procPid: 4242 });
    expect(memcapSession(ev(), [s('x', { procPid: 1 }), shop])).toBe(shop);
    expect(memcapSession(ev({ sessionPid: 0 }), [shop])).toBeUndefined();
  });

  it('참모 줄 — [앱] 으로 시작, 한 줄, 프로필·크기·상한·세션·탭', () => {
    const t = chiefLine(ev(), s('shop-store'));
    expect(t.startsWith('[앱] ')).toBe(true);
    expect(t).not.toMatch(/\n/);
    for (const w of ['store-shop', '7.4GB', '6GB', 'shop-store', 'https://shop.example/p/1', '탭을 닫았']) expect(t).toContain(w);
    expect(chiefLine(ev({ action: 'kill', why: 'total', capGb: 12 }))).toMatch(/크롬을 껐/);
  });

  it('보낼 곳 — 참모에게 늘, 세션에는 스크립트 길일 때만(MCP 길은 도구 결과 꼬리로 이미 안다)', () => {
    const shop = s('shop-store', { procPid: 4242 });
    const chief = s('chief');
    const r = routeMemcap(ev(), { sessions: [shop, chief], chiefOf: () => chief });
    expect(r.map((x) => x.to)).toEqual(['chief', 'shop-store']);
    expect(r[1]?.text).toBe(sessionLine(ev()));
    expect(routeMemcap(ev({ via: 'mcp' }), { sessions: [shop], chiefOf: () => chief }).map((x) => x.to)).toEqual(['chief']);
    // 세션을 못 찾으면 참모만 · 참모가 없으면 아무 데도(다음 바퀴에 다시)
    expect(routeMemcap(ev({ sessionPid: 9 }), { sessions: [shop], chiefOf: () => chief }).map((x) => x.to)).toEqual(['chief']);
    expect(routeMemcap(ev(), { sessions: [shop], chiefOf: () => undefined })).toEqual([]);
  });
});
