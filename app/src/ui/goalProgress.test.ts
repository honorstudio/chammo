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


// 사용자 10-28: 진행 칸 접기 — 머리줄 끝 아이콘 단추, 접히면 머리줄 한 줄에 목표 블록(전체 숫자는 그대로), 올리면 말풍선, 누르면 펼치며 그 목표로
describe('진행 칸 — 접기', () => {
  it('머리줄 끝 접기 단추는 직접 그린 아이콘만(글자 없음), 이름은 aria-label·title', () => {
    expect(comp).toMatch(/className="gp-foldbtn" aria-label=\{foldLabel\} title=\{foldLabel\} aria-expanded=\{!folded\}/);
    expect(comp).toMatch(/\{folded \? <IconChevronDown \/> : <IconChevronUp \/>\}/);
  });
  it('접혀도 전체 숫자는 머리줄에 남고, 목표 줄 대신 블록 막대', () => {
    const head = comp.slice(comp.indexOf('<div className="gp-head">'), comp.indexOf('</div>', comp.indexOf('<div className="gp-head">')));
    expect(head).toMatch(/<span className="gp-num"><b>\{bar\.done\}<\/b> \/ \{bar\.total\}<\/span>\s*\{folded \? <span ref=\{foldRef\} className="gp-fold">/);
    expect(comp).toMatch(/\{!folded && goalRows\(bar\)\.map/);
  });
  it('블록 폭 = 전체 몫(share), 블록 안 조각 = 칸 수, 색은 줄 막대 상태 클래스 그대로', () => {
    expect(comp).toMatch(/className=\{`gp-blk\$\{going \? ' gp-cleave' : ''\}`\} style=\{\{ flexGrow: b\.share \}\}/);
    expect(comp).toMatch(/className=\{`gp-fp gp-\$\{p\.state\}`\} style=\{\{ flexGrow: p\.n \}\}/);
    expect(css).toMatch(/\.gp-fold \{[^}]*gap: 2px/);
  });
  it('누르면 펼치고 그 목표 줄을 연 채 그 자리로 — 그 밖 블록은 펼치기만', () => {
    const pick = comp.slice(comp.indexOf('const pick = '), comp.indexOf('};', comp.indexOf('const pick = ')));
    expect(pick).toMatch(/if \(b\.keys\.length === 1\) setOpen/);
    expect(pick).toMatch(/setGo\(b\.keys\[0\]/);
    expect(pick).toMatch(/setFolded\?\.\(false\)/);
    expect(comp).toMatch(/data-gk=\{g\.key\}/);
    expect(comp).toMatch(/scrollIntoView\(\{ block: 'nearest' \}\)/);
  });
  it('말풍선은 스크롤 칸 밖으로(fixed·층 이름), 접힘 기억은 참모·자리마다', () => {
    expect(css).toMatch(/\.gp-tip \{ position: fixed; z-index: var\(--z-popover\)/);
    expect(comp).toMatch(/useGoalFold\(`\$\{place\}:\$\{p\.orch\.id\}`\)/);
  });
  // 사용자 10-28 "압축 버전이어도 알아서 제거되어야 하는데 열어서 확인해야 완료된 거 사라지네" — 봤음 감시가 펼친 줄(GoalRow)에만 있어서 접힌 동안 끝난 목표가 남았다
  it('접힌 막대도 같은 감시(useSeenWatch)로 끝난 목표를 4초 보면 빠진다 — 접힌 때만 대상, 같은 leave·gone', () => {
    expect(comp).toMatch(/function useSeenWatch<T extends HTMLElement>/);
    expect(comp).toMatch(/const foldRef = useSeenWatch<HTMLSpanElement>\(folded \? foldUnits : \[\], leave\)/);
    expect(comp).toMatch(/<span ref=\{foldRef\} className="gp-fold">/);
    // 떠나는 효과가 안 와도(창이 숨음) 빠지게 — 펼친 줄과 같은 1600ms
    const eff = comp.slice(comp.indexOf('if (!folded) return;'));
    expect(eff).toMatch(/window\.setTimeout\(\(\) => gone\(out\), 1600\)/);
  });
  it('끝난 블록만 줄어들며 사라진다 — 안 끝난 칸이 섞인 블록은 효과 없이 갱신만', () => {
    expect(comp).toMatch(/b\.done === b\.total && b\.units\.length > 0 && b\.units\.every\(\(u\) => leaving\.has\(u\)\)/);
    expect(css).toMatch(/\.gp button\.gp-blk\.gp-cleave \{ animation: gp-shrink/);
    expect(css).toMatch(/\.gp-cleave \.gp-blk-in \{ animation: gp-flash/);
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.gp button\.gp-blk\.gp-cleave \{ animation: gp-cfade/);
  });
  it('폰(마우스 없음)은 누르는 칸 44px', () => {
    const touch = css.slice(css.indexOf('@media (hover: none) {\n  .gp button.gp-foldbtn'));
    expect(touch).toMatch(/\.gp button\.gp-foldbtn \{ width: 44px; height: 44px/);
    expect(touch).toMatch(/\.gp button\.gp-blk \{ height: 44px; \}/);
  });
});
