import { describe, expect, it } from 'vitest';
import css from './goalProgress.css?raw';
import space from './space/SpaceView.tsx?raw';
import home from './space/HomeView.tsx?raw';
import dash from './mobile/OrchDash.tsx?raw';
import comp from './GoalProgress.tsx?raw';
import { waitWord } from './GoalProgress';

// 사용자 10-23: 진행 막대는 홈 진행 칸에만(데스크톱 스페이스 홈 + 폰 홈), 사라질 땐 반짝 → 접힘, 동작 줄이기면 페이드만
describe('진행 칸 — 홈에만, 사라짐 효과', () => {
  it('데스크톱 홈 맨 위와 폰 홈 맨 위에 같은 진행 칸', () => {
    expect(space).toMatch(/progress=\{<HomeProgress orch=\{lo\} events=\{events\} sessions=\{sessions\} readFill=\{sessionFill\} \/>\}/);
    expect(home).toMatch(/<div className="hm">\s*\{progress\}/);
    expect(dash).toMatch(/<div className="m-top">\s*<HomeProgress orch=\{orch\} events=\{events\} sessions=\{sessions\} \/>/);
  });
  it('끝난 줄은 반짝인 뒤 접히고, 기타의 끝난 칸은 폭이 줄어 옆 칸이 당겨진다', () => {
    expect(css).toMatch(/\.gp-leave \{[^}]*animation: gp-fold/);
    expect(css).toMatch(/\.gp-leave \.gp-c \{ animation: gp-flash/);
    expect(css).toMatch(/\.gp-cleave \{ animation: gp-flash[^;]*gp-shrink/);
  });
  it('동작 줄이기면 페이드만 — 끝 사건 이름도 받는다', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.gp-leave \{ animation: gp-fade/);
    expect(reduced).toMatch(/\.gp-cleave \{ animation: gp-cfade/);
    expect(comp).toMatch(/'gp-fold' \|\| e\.animationName === 'gp-fade'/);
    expect(comp).toMatch(/'gp-shrink' \|\| e\.animationName === 'gp-cfade'/);
  });
  it('왼쪽 색 띠 없음', () => {
    expect(css).not.toMatch(/border-left\s*:/);
  });
});

// 사용자 10-23 저녁: 심사·예약·사람 답을 기다리는 칸이 빨간 '17시간 조용'이었다 — 기다림은 회색 점선, 사유 한 줄, 경고 빨강 아님
describe('진행 칸 — 기다림', () => {
  const d = (y: number, mo: number, da: number, h: number, mi: number) => new Date(y, mo - 1, da, h, mi).getTime();
  it('사유 한 줄 — 밖이면 \'~ 기다림\', 사용자 몫이면 \'사용자 몫 · ~\', 날짜만 준 건 시각 없이', () => {
    expect(waitWord({ why: '애플 심사', on: 'outside' })).toBe('애플 심사 기다림');
    expect(waitWord({ why: '애플 심사 기다림', on: 'outside' })).toBe('애플 심사 기다림');
    expect(waitWord({ why: '예약 날짜', on: 'outside', until: d(2026, 10, 24, 18, 0) })).toBe('예약 날짜 기다림 · 10/24 18:00까지');
    expect(waitWord({ why: '예약 날짜', on: 'outside', until: d(2026, 10, 25, 23, 59) })).toBe('예약 날짜 기다림 · 10/25까지');
    expect(waitWord({ why: '앱 비밀번호 4개', on: 'user' })).toBe('사용자 몫 · 앱 비밀번호 4개');
  });
  it('기다림 칸은 회색 점선 — 경고 빨강이 아니다', () => {
    expect(css).toMatch(/\.gp-c\.gp-wait \{[^}]*dashed var\(--text-3\)/);
    expect(css).not.toMatch(/\.gp-wait[^{]*\{[^}]*danger-ink/);
    expect(comp).toMatch(/gp-waiting">\{tr\('기다림'/);
  });
});

