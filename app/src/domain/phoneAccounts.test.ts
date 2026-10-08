import { describe, expect, it } from 'vitest';
import macRs from '../../src-tauri/src/mobile.rs?raw';
import css from '../ui/mobile/mobile.css?raw';
import { ACCOUNTS_CHANGED } from './accounts';
import { headUsage, accountHead, confirmText, phoneAccountError, phoneAccountRows, readPhoneAccounts } from './phoneAccounts';

const NOW = new Date(2026, 9, 5, 14, 0).getTime();
const H = 3_600_000;
const raw = (over: Record<string, unknown> = {}) => JSON.stringify({
  accounts: [{ id: 'a1', name: '큰 것', plan: 'Max 20x' }, { id: 'a2', name: '보조', plan: 'Pro' }],
  active: 'a1',
  livePlan: 'Max 20x',
  liveName: null,
  switching: false,
  auto: {
    on: true,
    pinned: null,
    slots: {
      a1: { five: { used: 40, resetsAt: NOW + 2 * H }, week: { used: 10, resetsAt: NOW + 50 * H }, seenAt: NOW - 60_000 },
      a2: { five: { used: 97, resetsAt: NOW + 3 * H }, seenAt: NOW - 60_000 },
    },
  },
  ...over,
});

describe('폰 계정 시트', () => {
  it('줄마다 이름·남은 %·지금·쉬는 중', () => {
    const v = readPhoneAccounts(raw())!;
    const rows = phoneAccountRows(v, NOW);
    expect(rows.map((r) => [r.id, r.name, r.on, r.five, r.week])).toEqual([['a1', '큰 것', true, 60, 90], ['a2', '보조', false, 3, null]]);
    expect(rows[0]!.rest).toBeNull();
    expect(rows[1]!.rest).toBe('17:00까지 쉬는 중');
  });

  it('자동 전환이 막아 둔 칸(한도 오류)도 쉬는 중, 지난 막힘은 아니다', () => {
    const v = readPhoneAccounts(raw({ auto: { on: true, slots: { a2: { blockedUntil: NOW + 26 * H, why: 'limit' } } } }))!;
    expect(phoneAccountRows(v, NOW)[1]!.rest).toBe('10/06 16:00까지 쉬는 중');
    const old = readPhoneAccounts(raw({ auto: { on: true, slots: { a2: { blockedUntil: NOW - 1, why: 'limit' } } } }))!;
    expect(phoneAccountRows(old, NOW)[1]!.rest).toBeNull();
  });

  it('로그인이 풀린 칸은 시각 없이 로그인 필요', () => {
    const v = readPhoneAccounts(raw({ auto: { on: true, slots: { a2: { blockedUntil: NOW + 30 * 24 * H, why: 'auth', authAt: NOW - 60_000 } } } }))!;
    expect(phoneAccountRows(v, NOW)[1]!.rest).toBe('로그인 필요');
  });

  it('사용량을 못 읽었으면 막대 없음(—)', () => {
    const v = readPhoneAccounts(raw({ auto: {} }))!;
    expect(phoneAccountRows(v, NOW).map((r) => [r.five, r.week])).toEqual([[null, null], [null, null]]);
    // 지난 창 값은 버린다(옛 퍼센트)
    const stale = readPhoneAccounts(raw({ auto: { slots: { a1: { five: { used: 99, resetsAt: NOW - 1 } } } } }))!;
    expect(phoneAccountRows(stale, NOW)[0]!.five).toBeNull();
  });

  it('깨진 응답·모양 다른 값은 null 또는 거른다', () => {
    expect(readPhoneAccounts('<html>')).toBeNull();
    expect(readPhoneAccounts('{}')).toEqual({ accounts: [], active: null, livePlan: null, liveName: null, switching: false, auto: {} });
    const v = readPhoneAccounts(JSON.stringify({ accounts: [{ id: 'a1', name: 5 }, 'x', { name: '이름만' }], active: 7 }))!;
    expect(v.accounts).toEqual([{ id: 'a1', name: '', plan: '' }]);
    expect(v.active).toBeNull();
  });

  it('확인 문구 — 데스크톱 바꾸기가 하는 일 그대로, 자동 전환·쉬는 중이면 덧붙임', () => {
    const v = readPhoneAccounts(raw())!;
    const [, a2] = phoneAccountRows(v, NOW);
    const t = confirmText(a2!, true);
    expect(t.title).toBe('보조 계정으로 바꿀까요?');
    expect(t.lines).toContain('돌고 있는 세션도 다음 요청부터 이 계정을 써요. 하던 일은 안 끊겨요.');
    expect(t.lines).toContain('MCP 로그인은 그대로예요.');
    expect(t.lines.some((l) => l.includes('고정'))).toBe(true);
    expect(t.lines.some((l) => l.includes('17:00까지 쉬는 중'))).toBe(true);
    // 자동 꺼짐이면 고정 줄 없음
    expect(confirmText(a2!, false).lines.some((l) => l.includes('고정'))).toBe(false);
  });

  it('머리줄 — 지금 계정 이름, 칸이 없으면 null', () => {
    expect(accountHead(readPhoneAccounts(raw()))).toBe('큰 것');
    expect(accountHead(readPhoneAccounts(raw({ active: null, liveName: 'who' })))).toBe('who');
    expect(accountHead(readPhoneAccounts(raw({ active: null, liveName: null })))).toBe('로그인 없음');
    expect(accountHead(readPhoneAccounts(raw({ accounts: [] })))).toBeNull();
    expect(accountHead(null)).toBeNull();
  });

  it('오류 이름 → 폰 글(키체인은 맥 앞에서)', () => {
    expect(phoneAccountError('too soon')).toContain('잠깐');
    expect(phoneAccountError('locked')).toContain('맥 앞에서');
    expect(phoneAccountError('denied')).toContain('맥 앞에서');
    expect(phoneAccountError('unknown')).toContain('없어요');
    expect(phoneAccountError('unsupported')).toContain('맥 앱');
    expect(phoneAccountError('Load failed')).toContain('Load failed');
  });

  it('맥이 폰에서 바꾼 뒤 데스크톱에 보내는 신호 이름이 같다', () => {
    expect(macRs).toContain(`new Event('${ACCOUNTS_CHANGED}')`);
  });

  it('누르는 자리는 44px 이상', () => {
    for (const sel of ['.m-acct-head', '.m-acct-auto']) {
      const rule = css.split('\n').find((l) => l.startsWith(`${sel} {`)) ?? '';
      expect(Number(/min-height: (\d+)px/.exec(rule)?.[1] ?? 0), sel).toBeGreaterThanOrEqual(44);
    }
    expect(css).toMatch(/\.m-acct \{[^}]*min-height: 56px/);
  });

  it('머리줄 사용량 — 지금 칸의 계정 사용량이 있으면 그것(바꾼 직후 상태줄은 옛 계정 값), 없으면 상태줄', () => {
    const status = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 42, resets_at: (NOW + H) / 1000 }, seven_day: { used_percentage: 18, resets_at: (NOW + 50 * H) / 1000 } } });
    expect(headUsage(readPhoneAccounts(raw({ active: 'a2' })), status, NOW)).toBe('5시간 3%');
    expect(headUsage(readPhoneAccounts(raw()), status, NOW)).toBe('5시간 60% · 주 90%');
    expect(headUsage(readPhoneAccounts(raw({ auto: {} })), status, NOW)).toBe('5시간 58% · 주 82%');
    expect(headUsage(null, status, NOW)).toBe('5시간 58% · 주 82%');
    expect(headUsage(null, '{}', NOW)).toBe('');
  });
});
