// 길게 누르기 배선 — 폰의 길게 누르기 길(밀기 줄 SwipeRow · 보관함·말풍선·팀 파일 usePress)이 같은 때·같은 눌린 느낌·같은 막기를 쓰나
// (11-18 사용자 아이패드: 길게 누르면 메뉴 대신 글 고르기(파란 블록)가 먼저 떴다)
import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';
import swipe from './SwipeRow.tsx?raw';
import parts from './PhoneLockerParts.tsx?raw';
import app from './MobileApp.tsx?raw';
import hold from './hold.ts?raw';

const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
/** 선택자 글이 들어간 규칙 몸통들 */
const bodies = (needle: string) => [...flat.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1]!.includes(needle)).map((m) => m[2]!).join(';');

describe('때는 한 곳(domain/hold)', () => {
  it('밀기 줄·usePress 가 같은 HOLD_MS — 숫자를 따로 박지 않는다', () => {
    for (const [name, src] of [['SwipeRow', swipe], ['usePress', parts]] as const) {
      expect(src, name).toMatch(/HOLD_MS/);
      expect(src, name).not.toMatch(/setTimeout\([^;]*,\s*(450|500)\)/);
    }
  });
  it('둘 다 대상에 data-hold 를 단다 — 사파리 막기와 CSS 가 이걸로 고른다', () => {
    expect(swipe).toMatch(/data-hold/);
    expect(parts).toMatch(/'data-hold'/);
  });
  it('눌린 느낌을 켜고 끄는 건 hold.ts 하나', () => {
    expect(swipe).toMatch(/pressFeel/);
    expect(parts).toMatch(/pressFeel/);
    expect(hold).toMatch(/m-holding/);
  });
  it('뜨는 순간 사파리가 잡은 글 고르기를 지운다', () => {
    expect(hold).toMatch(/removeAllRanges/);
  });
  it('폰 화면이 사파리 막기를 건다(selectstart·contextmenu) — 아이 화면은 MobileApp 이 아니라 안 걸린다', () => {
    expect(app).toMatch(/installHoldGuard\(\)/);
    expect(hold).toMatch(/selectstart/);
    expect(hold).toMatch(/contextmenu/);
  });
});

describe('CSS — 누르는 자리는 글 고르기 없음', () => {
  it('길게 누르기 대상: 글 고르기·사파리 말풍선·끌어 올리기(패드) 없음', () => {
    const b = bodies('[data-hold]');
    expect(b).toMatch(/-webkit-user-select:\s*none/);
    expect(b).toMatch(/-webkit-touch-callout:\s*none/);
    expect(b).toMatch(/-webkit-user-drag:\s*none/);
  });
  it('폰 화면 단추·탭·머리·탭바도 글 고르기 없음(.m-chrome 아래) — 길게 눌러도 파란 블록이 안 생긴다', () => {
    const b = bodies('.m-chrome');
    expect(flat).toMatch(/\.m-chrome[^{]*button/);
    expect(flat).toMatch(/\.m-chrome[^{]*\[role="tab"\]/);
    expect(flat).toMatch(/\.m-chrome[^{]*\.m-dash-head/);
    expect(b).toMatch(/-webkit-user-select:\s*none/);
    expect(b).toMatch(/-webkit-touch-callout:\s*none/);
  });
  it('글 칸은 다시 고를 수 있게 — 사파리는 조상이 none 이면 입력칸 글자가 안 쳐질 때가 있다', () => {
    expect(flat).toMatch(/\.m-chrome[^{]*:is\(input,\s*textarea,\s*\[contenteditable[^\]]*\]\)[^{]*\{[^}]*-webkit-user-select:\s*text/);
  });
  it('눌린 느낌 = 살짝 작아지고 어두워짐, 움직임 줄이기면 크기는 그대로', () => {
    const b = bodies('.m-holding');
    expect(b).toMatch(/transform:\s*scale\(0?\.9\d\)/);
    expect(b).toMatch(/filter:\s*brightness/);
    expect(flat).toMatch(/prefers-reduced-motion[^{]*\{[^{]*\.m-holding[^{]*\{[^}]*transform:\s*none/);
  });
});
