import { describe, expect, it } from 'vitest';
import rail from './OrchRail.tsx?raw';
import fb from '../FeatureButtons.tsx?raw';
import css from './locker.css?raw';

// 2026-10-12 사용자(참모-2 전달): 띠 프사에 올리면 어느 참모인지가 너무 늦게 뜬다(기본 title 1초+) — 직접 그린 호버 카드.
// 참모 색 작은 점(상태는 점 모양 규칙) + 이름 굵게 + 맡은 일 한 줄. 바로 뜨고, 옮기면 미끄러지듯, 띠를 벗어나면 짧게 사라짐
describe('띠 호버 카드', () => {
  const strip = rail.slice(rail.indexOf('<nav ref={navRef} className={`lk-strip'), rail.lastIndexOf('</nav>'));
  it('띠 항목엔 기본 title 이 없다(같은 글 두 번 금지) — aria-label 은 그대로', () => {
    expect(strip).not.toMatch(/\stitle=\{/);
    expect(strip).toMatch(/aria-label=\{a\.phaseText \? `\$\{a\.label\} · \$\{a\.phaseText\}` : a\.label\}/); // 켜는 중·끄는 중이면 단계까지 읽어 준다
  });
  it('프사·도우미·쉬는 참모·예약은 data-tip 으로 카드 내용', () => {
    expect(strip).toMatch(/data-tip=\{a\.label\} data-tip-sub=\{a\.phaseText \?\? a\.role\}/);
    expect(strip).toMatch(/data-tip-dot=/);
    expect((strip.match(/data-tip=/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
  it('띠 하나가 위임으로 카드 하나를 움직인다(바로 — 기다림 없음)', () => {
    expect(rail).toMatch(/onPointerOver=\{over\}/);
    expect(rail).toMatch(/onPointerLeave=\{leave\}/);
    expect(rail).not.toMatch(/setTimeout\(\(\) => setTip\(\{/);
  });
  it('기능 줄(띠 안)은 이름만 카드로 — title 없이', () => {
    expect(fb).toMatch(/tip \? \{ 'data-tip': /);
  });
  it('카드 모양·움직임 — 앱 토큰, 미끄러지듯·페이드 120~160ms, 줄인 움직임이면 바로', () => {
    expect(css).toMatch(/\.rail-tip \{[^}]*background: var\(--surface\)/);
    expect(css).toMatch(/\.rail-tip \{[^}]*transition: top \.14s[^}]*opacity \.14s/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.rail-tip, \.rail-tip-in \{ transition: none; animation: none; \} \}/);
    expect(css).not.toMatch(/\.rail-tip[^{]*\{[^}]*border-left/);
  });
});

// 2026-10-12 사용자 "호버 카드가 흐려 보인다"(195.png) — 배율 2 실측: 카드 높이 49 → translateY(-50%) = -24.5 → 반 픽셀 자리(top 94.5)라 글자가 뭉개졌다
describe('호버 카드 — 정수 픽셀 자리', () => {
  it('세로 가운데는 퍼센트 transform 이 아니라 JS 로 잰 정수 top', () => {
    expect(css).not.toMatch(/\.rail-tip \{[^}]*transform: translateY\(-50%\)/);
    expect(rail).toMatch(/Math\.round\(tip\.y - el\.offsetHeight \/ 2\)/);
  });
  it('합성층을 남기는 것(will-change·backdrop-filter) 없음, 들어오는 움직임은 끝나면 transform 없음', () => {
    expect(css).not.toMatch(/\.rail-tip[^{]*\{[^}]*(will-change|backdrop-filter)/);
    expect(css).toMatch(/@keyframes rail-tip-in \{ from \{ opacity: 0; transform: translateX\(-6px\); \} to \{ opacity: 1; transform: none; \} \}/);
  });
});

describe('호버 카드 — 들어오는 움직임이 끝나면 떼기', () => {
  it('animationend 에 done — 그 뒤엔 animation 없음(합성층이 남아 글자가 흐려지지 않게)', () => {
    expect(rail).toMatch(/onAnimationEnd=\{\(\) => setTipDone\(true\)\}/);
    expect(css).toMatch(/\.rail-tip-in\.done \{ animation: none; \}/);
  });
});

// 2026-10-12 사용자(198.png): '패널 접기 ⌘B' 카드가 접은 뒤에도 안 사라졌다 — 접히면서 항목이 다시 그려지거나 띠 밖으로 밀려나면
// pointerleave 가 안 온다(없어진 요소엔 안 감, 가만히 있는 마우스엔 안 감). 이벤트 하나에 기대지 않고 '지금 마우스가 띠 위 항목에 있나'를 매번 본다
describe('호버 카드 — 안 사라지고 남는 버그', () => {
  it('띄운 항목과 마우스 자리를 기억한다(anchor·pt)', () => {
    expect(rail).toMatch(/const anchor = useRef<HTMLElement \| null>\(null\)/);
    expect(rail).toMatch(/const pt = useRef<\{ x: number; y: number \} \| null>\(null\)/);
    expect(rail).toMatch(/pt\.current = \{ x: e\.clientX, y: e\.clientY \}/);
  });
  it('그릴 때마다 마우스 밑을 다시 본다(elementFromPoint) — 띠 밖이거나 항목이 사라졌으면 바로 닫고, 남았으면 글·자리를 새로', () => {
    expect(rail).toMatch(/document\.elementFromPoint\(/);
    expect(rail).toMatch(/anchor\.current\?\.isConnected/);
    expect(rail).toMatch(/readTip\(el, false\)/); // 갱신은 미끄러짐 없이 제자리에서 글만 바꾼다
  });
  it('열려 있는 동안 창 전체에서 무조건 닫기 신호를 받는다 — 포인터 이동(띠 밖)·누름·키·창 포커스 잃음·화면 숨김', () => {
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'blur', 'visibilitychange'])
      expect(rail).toMatch(new RegExp(`addEventListener\\('${ev}'`));
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'blur', 'visibilitychange'])
      expect(rail).toMatch(new RegExp(`removeEventListener\\('${ev}'`));
  });
  it('닫기는 anchor 도 비운다(hideTip) — 옛 글이 다음 카드에 안 남게', () => {
    expect(rail).toMatch(/const hideTip = \(\) => \{[^}]*anchor\.current = null;[^}]*setTip\(null\)/);
  });
});
