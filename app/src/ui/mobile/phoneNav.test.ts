import { describe, expect, it } from 'vitest';
import dash from './OrchDash.tsx?raw';
import more from './MoreSheet.tsx?raw';
import alerts from './AlertsSheet.tsx?raw';
import icons from '../Icons.tsx?raw';

// 폰 머리 줄 정리(시안 docs/design-drafts/phone-nav v1 B, 2026-10-24 사용자 "더보기가 좋은데 오피스가 좀 애매… 나름 재미 포인트라서")
// 머리 = 얼굴·이름(두 줄까지)·고리·종(알림 보기)·사무실·더보기. 세션·예약·계정·폰 알림 켜기/끄기는 더보기 시트
const head = dash.slice(dash.indexOf('<header className="m-dash-head">'), dash.indexOf('</header>'));

describe('폰 머리 줄 — B 더보기', () => {
  it('오른쪽 단추 순서: 고리 → 종 → 사무실 → 더보기', () => {
    const order = ['m-acct-ring', 'aria-label={bellLabel}', '<IconOffice />', '<IconMore />'].map((k) => head.indexOf(k));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it('세션·예약 단추는 머리에서 빠졌다(더보기 안으로)', () => {
    expect(head).not.toMatch(/IconSessions|IconCalendarClock/);
  });
  it('종은 알림 보기 — 켜고 끄기(IconBellOff·push.enable) 아님', () => {
    expect(head).not.toMatch(/IconBellOff|onClick=\{bell\}/);
    expect(head).toMatch(/onClick=\{\(\) => setAlertsOpen\(true\)\}/);
  });
  it('사무실은 머리에 늘 — 기다리는 세션 점', () => {
    expect(head).toMatch(/<IconOffice \/>\{officeDot && <span className="m-rt-dot"/);
  });
  it('더보기 단추 점 = 일하는 세션이나 도는 예약', () => {
    expect(head).toMatch(/<IconMore \/>\{\(busySubs > 0 \|\| routinesRunning > 0\) && <span className="m-rt-dot"/);
  });
  it('이름은 두 줄까지(잘리지 않게)', () => {
    expect(head).toMatch(/className="m-dash-title m-dash-title2"/);
  });
});

describe('더보기 시트', () => {
  it('세션 수·예약·계정·폰 알림 토글', () => {
    for (const k of ['세션', '예약', '계정']) expect(more).toContain(`row(tr('${k}'`);
    expect(more).toContain("<b>{tr('폰 알림', ");
    expect(more).toMatch(/role="switch" aria-checked=\{push\.on\}/);
  });
  it('공용 시트(kit BottomSheet)로', () => expect(more).toMatch(/from '\.\/kit'/));
  it('글자 줄만 — 줄마다 아이콘을 붙이지 않는다(오른쪽 꺾쇠만)', () => {
    const icons = [...more.matchAll(/<Icon(\w+) \/>/g)].map((m) => m[1]);
    expect(new Set(icons)).toEqual(new Set(['Chevron']));
  });
});

describe('알림 시트(종)', () => {
  it('답 기다림 + 최근', () => {
    expect(alerts).toContain('답 기다림');
    expect(alerts).toContain('최근');
  });
  it('공용 시트(kit BottomSheet)로', () => expect(alerts).toMatch(/from '\.\/kit'/));
});

describe('사무실 아이콘 = 책상 앞 모찌(시안 I-4)', () => {
  it('IconOffice 가 모찌 얼굴·책상 길', () => {
    const o = icons.slice(icons.indexOf('export const IconOffice'), icons.indexOf('export const IconSpace'));
    expect(o).toContain('M3.4 10.6C3.6 6.6 5.6 4 8 4s4.4 2.6 4.6 6.6M1.5 10.6h13M3 10.6v3M13 10.6v3M6.4 7.6v1M9.6 7.6v1');
    expect(o).not.toContain('M8 3.5 14 6.5 8 9.5 2 6.5Z');
  });
});
