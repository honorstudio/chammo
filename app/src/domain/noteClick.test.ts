// 알림을 눌러 그 자리로 — 될 때도 있고 안 될 때도 있던 것(2026-11-18 사용자 "알림으로 뜬 거에서 해당 세션으로 바로 가는 게 어떨 땐 뜨고 안 뜨고")
import { describe, expect, it } from 'vitest';
import app from '../App.tsx?raw';
import accounts from '../ui/useAccountAuto.ts?raw';
import revive from '../ui/useOrchRevive.ts?raw';
import phoneTeam from '../ui/mobile/PhoneTeam.tsx?raw';
import { heldNote, NOTE_WAIT_MS, noteClickPlan, parseHeld } from './noteClick';

describe('noteClickPlan — 눌린 알림 갈 곳 → 할 일', () => {
  it('재현: 앱이 막 켜져 세션 목록이 오기 전에 누르면 기다린다 — 예전엔 바로 찾다 "세션이 꺼져 있어"로 끝났다', () => {
    expect(noteClickPlan('session:abc12345', false)).toEqual({ do: 'wait' });
    expect(noteClickPlan('card:abc12345:d:card9', false)).toEqual({ do: 'wait' });
  });
  it('목록이 왔으면 그 세션·그 카드로', () => {
    expect(noteClickPlan('session:abc12345', true)).toEqual({ do: 'session', id: 'abc12345' });
    expect(noteClickPlan('card:abc12345:d:card9', true)).toEqual({ do: 'card', orch: 'abc12345', card: 'd:card9' });
  });
  it('결정 대기함·팀 대화는 세션 목록이 없어도 바로 — 팀은 방 이름에 : 가 있어도 통째로(옛 teamTarget 과 같다)', () => {
    expect(noteClickPlan('inbox', false)).toEqual({ do: 'inbox' });
    expect(noteClickPlan('team:room-1', false)).toEqual({ do: 'team', room: 'room-1' });
    expect(noteClickPlan('team:a:b', true)).toEqual({ do: 'team', room: 'a:b' });
    expect(noteClickPlan('team:', true)).toEqual({ do: 'none' });
  });
  it('설정 탭 — 아는 탭만', () => {
    expect(noteClickPlan('settings:accounts', false)).toEqual({ do: 'settings', tab: 'accounts' });
    expect(noteClickPlan('settings:nope', true)).toEqual({ do: 'none' });
  });
  it('갈 곳 없음(latest·빈 글·모르는 글)은 창만 앞으로 — 오류를 띄우지 않는다', () => {
    for (const raw of ['latest', '', 'whatever', 'session:', 'card:o1']) expect(noteClickPlan(raw, true)).toEqual({ do: 'none' });
  });
});

describe('heldNote — 목록을 기다린 누름은 잠깐만 들고 있는다', () => {
  it('기다리는 동안엔 그대로, 너무 오래되면 버린다(늦게 뜬 화면이 엉뚱한 때 옮기지 않게)', () => {
    expect(heldNote({ raw: 'session:a', at: 1000 }, 1000 + NOTE_WAIT_MS - 1)).toBe('session:a');
    expect(heldNote({ raw: 'session:a', at: 1000 }, 1000 + NOTE_WAIT_MS + 1)).toBeNull();
    expect(heldNote(null, 5)).toBeNull();
  });
  it('화면을 다시 읽어도 남게 sessionStorage 글로 — 깨진 글·다른 모양은 버린다', () => {
    expect(parseHeld(JSON.stringify({ raw: 'session:a', at: 7 }))).toEqual({ raw: 'session:a', at: 7 });
    for (const v of [null, '', '{', '"x"', '{"raw":1,"at":2}', '{"raw":"a"}']) expect(parseHeld(v)).toBeNull();
  });
});

describe('App 배선 — 화면 없이 잴 수 없는 이음매만 소스로', () => {
  it('재현: 웹뷰가 덜 떴을 때 누른 알림 — Rust 가 들고 있는 누름을 화면이 켜질 때 가져간다', () => {
    const eff = app.slice(app.indexOf('w.__notifyClick ='), app.indexOf('delete w.__notifyClick'));
    expect(eff).toMatch(/notifyClickTake\(\)/);
  });
  it('재현(시험 앱): 켜는 중 화면이 다시 읽히면 기다리던 누름이 사라졌다 — 기다리는 누름은 sessionStorage 에', () => {
    const fn = app.slice(app.indexOf('noteClickRef.current = (raw) => {'), app.indexOf('w.__notifyClick ='));
    expect(fn).toMatch(/sessionStorage\.setItem\(NOTE_HELD/);
    expect(fn).toMatch(/sessionStorage\.getItem\(NOTE_HELD/);
  });
  it('재현: 다른 기기 보기·원격 참모 채팅이 채팅 칸을 덮고 있으면 걷고 간다', () => {
    const body = app.slice(app.indexOf('const openTarget = (target: string) => {'), app.indexOf('setFocusReq((r) => ({ key, id: s.id'));
    expect(body).toMatch(/setRemoteChat\(null\)/);
    expect(body).toMatch(/farMode\.back\(\)/);
  });
  it('재현: 세션이 아닌 알림(계정 전환·참모 다시 켬)에 session:<묶음 이름> 갈 곳이 붙어 누르면 "꺼져 있어"', () => {
    for (const m of accounts.matchAll(/notifyOnce\(\{[^}]*kind: 'accounts'[^}]*\}/g)) expect(m[0]).toMatch(/go: 'settings:accounts'/);
    const seeded = revive.slice(revive.indexOf("session: 'orch-seeded'") - 80, revive.indexOf("session: 'orch-seeded'") + 200);
    expect(seeded).toMatch(/go: /);
  });
  it('재현(폰): 알림으로 연 단톡방 — 방 목록(rs)이 대화 목록보다 늦게 오면 효과가 다시 안 돌아 안 열렸다', () => {
    const eff = phoneTeam.slice(phoneTeam.indexOf('if (!open || open.n === opened) return;'));
    expect(eff.slice(0, eff.indexOf('}, [') + 40)).toMatch(/\}, \[open, t\.rs, t\.cs, opened\]\)/);
  });
});
