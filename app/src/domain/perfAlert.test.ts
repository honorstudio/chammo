// 팀 성능 예산 넘침 알림(10-31) — 받을 참모 고르기·한 줄·하루 한 번
import { describe, expect, it } from 'vitest';
import { alertKey, alertLine, alertTarget, deliverAlerts } from './perfAlert';

const o = (id: string, name: string) => ({ id, name });

describe('예산 넘침 알림', () => {
  it('맡은 일에 앱 업데이트·참모 앱이 있는 참모, 없으면 첫 참모', () => {
    const orchs = [o('a', '참모'), o('b', '참모-2')];
    expect(alertTarget(orchs, { '참모-2': { role: '참모 앱(이 저장소 app/) 고치기·머지', at: 1 } })?.id).toBe('b');
    expect(alertTarget(orchs, { '참모-2': { role: '앱 업데이트', at: 1 } })?.id).toBe('b');
    expect(alertTarget(orchs, { 참모: { role: '디자인', at: 1 } })?.id).toBe('a');
    expect(alertTarget([], {})).toBeUndefined();
  });
  it('같은 원인은 하루 한 번 — 원인 = 종류 + 가장 많은 경로', () => {
    const a = { kind: 'bg-cap', detail: 'GET /v0/teams/*/heads 187 · GET /v0/me 3', at: Date.UTC(2026, 9, 31, 1) };
    const b = { ...a, detail: 'GET /v0/teams/*/heads 190 · 막힘 GET /v0/me 1', at: Date.UTC(2026, 9, 31, 9) };
    expect(alertKey(a)).toBe(alertKey(b));
    expect(alertKey({ ...a, at: Date.UTC(2026, 10, 1, 9) })).not.toBe(alertKey(a));
    expect(alertKey({ kind: 'human-429', detail: 'POST /v0/teams/*/rooms', at: a.at })).not.toBe(alertKey(a));
  });
  it('한 줄 — [앱]·종류·경로·할 일(perf-budget 스킬), 줄바꿈 없음', () => {
    const l = alertLine({ kind: 'human-429', detail: 'POST /v0/teams/*/rooms', at: 0 });
    expect(l.startsWith('[앱] ')).toBe(true);
    expect(l).toContain('POST /v0/teams/*/rooms');
    expect(l).toContain('perf-budget');
    expect(l).not.toContain('\n');
  });
  // 10-31 리뷰: Rust 줄은 가져가면 비어서 — 받을 참모가 없거나 못 보낸 알림은 사라지고, 못 보낸 것도 '오늘 보냄'으로 막혔다
  it('보내기에 성공한 원인만 오늘 보낸 것으로, 받을 참모가 없거나 못 보내면 다음 바퀴에 다시', async () => {
    const a = { kind: 'bg-cap', detail: 'GET /v0/me 201', at: Date.UTC(2026, 9, 31, 1) };
    const sent: string[] = [];
    const ok = async (id: string) => { sent.push(id); };
    const none = await deliverAlerts([a], [], undefined, ok);
    expect(none).toEqual({ seen: [], left: [a] });
    const fail = await deliverAlerts([a], [], { id: 'b' }, async () => { throw new Error('입력칸 없음'); });
    expect(fail).toEqual({ seen: [], left: [a] });
    const done = await deliverAlerts([a, { ...a, detail: 'GET /v0/me 230' }], [], { id: 'b' }, ok);
    expect(done).toEqual({ seen: [alertKey(a)], left: [] });
    expect(sent).toEqual(['b']);
    expect(await deliverAlerts([a], done.seen, { id: 'b' }, ok)).toEqual({ seen: done.seen, left: [] });
    expect(sent).toEqual(['b']);
  });
});
