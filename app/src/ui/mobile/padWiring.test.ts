// 패드 화면 배선(11-18 시안 v1 가로 A · 세로 B) — 폰은 그대로(회귀 0), 패드 규칙은 패드에만, 늘어나던 것(전수조사)은 패드에서 막는다
import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';
import app from './MobileApp.tsx?raw';
import dash from './OrchDash.tsx?raw';
import composer from './Composer.tsx?raw';
import picker from './OrchPicker.tsx?raw';
import rail from './PadRail.tsx?raw';

const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...flat.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
const body = (sel: string) => rules.filter((r) => r.sel === sel).map((r) => r.body).join(';');

describe('패드 CSS 는 패드에만', () => {
  it('m-tb 가 들어간 규칙은 전부 .m-tb… 로 시작한다 — 폰 화면에 새 규칙이 안 샌다', () => {
    const leaks = rules.filter((r) => r.sel.includes('m-tb')).flatMap((r) => r.sel.replace(/^@media[^{]*/, '').split(',').map((s) => s.trim()))
      .filter((s) => s && !/^(:where\()?\.m-tb/.test(s) && !/^\.m-tb/.test(s));
    expect(leaks).toEqual([]);
  });
  it('세로 판은 min(520px, 64%) — 시안 76% 는 채팅을 너무 가렸다', () => {
    expect(body('.m-tb-two .m-tb-dash')).toMatch(/width:\s*min\(520px,\s*64%\)/);
  });
  it('늘어나던 것: 시트 가운데 600 · 길게 누르기 메뉴 440 · 크게 보기 글 800 · 팀·메모 760', () => {
    expect(body('.m-tb .m-pick')).toMatch(/left:\s*max\(0px,\s*calc\(50% - 300px\)\)/);
    expect(body('.m-tb .m-menu')).toMatch(/width:\s*min\(440px/);
    expect(body('.m-tb .m-view-body')).toMatch(/calc\(50% - 400px\)/);
    expect(body('.m-tb-narrow')).toMatch(/max-width:\s*760px/);
  });
  it('띠 얼굴 줄은 스크롤해도 칸이 안 눌린다', () => {
    expect(body('.m-tb-faces > *')).toMatch(/flex:\s*none/);
  });
});

describe('폰 길은 그대로', () => {
  it('폰이면 아래 탭바·채팅 시트, 패드면 띠·채팅 칸 — 갈림은 usePadMode 하나', () => {
    expect(app).toMatch(/const pad = usePadMode\(\)/);
    const padBranch = app.slice(app.indexOf("if (pad !== 'phone') return cover("), app.indexOf("  return cover(\n    // 키보드가 올라오면"));
    expect(padBranch).toMatch(/<PadRail/);
    expect(padBranch).not.toMatch(/m-tabbar/);
    const phoneTail = app.slice(app.indexOf("  return cover(\n    // 키보드가 올라오면"));
    expect(phoneTail).toMatch(/className="m-tabbar"/);
    expect(app).toMatch(/<ChatSheet[\s\S]*composer=\{composer\}/);
    expect(app).toMatch(/<ChatColumn composer=\{composer\}>/);
  });
  it('폰에선 대시보드 머리줄이 제자리 — 패드만 위 막대로 포털', () => {
    expect(dash).toMatch(/\{padHeadOut\(headRow, padHead\)\}/);
  });
  it('Enter 보내기는 패드 + 하드웨어 키보드일 때만(화면 키보드가 뜨면 줄바꿈)', () => {
    expect(app).toMatch(/enterSends=\{pad !== 'phone' && !vp\.kb\}/);
    expect(composer).toMatch(/onKeyDown=\{enterSends \?/);
    expect(composer).toMatch(/enterSendsNow\(e\)/);
  });
  it('⌘ 키는 패드에서만', () => {
    expect(app).toMatch(/if \(p === 'phone'\) return;\s*const a = padKey\(e\)/);
  });
});

describe('띠 — 시트와 같은 순서·같은 메뉴', () => {
  it('순서는 orchSort(고정 → 맥 순서), 길게 누르면 시트 메뉴(menuFor)', () => {
    expect(rail).toMatch(/orchSort\(/);
    expect(rail).toMatch(/usePress\(onPick, onMenu\)/);
    expect(picker).toMatch(/menuFor \? orchs\.find/);
  });
});
