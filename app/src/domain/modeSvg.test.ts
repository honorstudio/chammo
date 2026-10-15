import { describe, expect, it } from 'vitest';
import { BigNum, svgDoc } from '../../hq-template/.claude/skills/hq-mode-kit/kit-svg';
import { safeSvg, svgSrc, svgStillSrc } from './modeSvg';

const OK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#2f74e0"/></svg>';

describe('safeSvg — 모드 Svg 거르기(그 뒤 <img> 로만 그린다)', () => {
  it('보통 그림은 그대로', () => {
    expect(safeSvg(OK)).toBe(OK);
    expect(safeSvg(`  <?xml version="1.0"?>\n<!-- made by a mode -->\n${OK}  `)).toBe(`<?xml version="1.0"?>\n<!-- made by a mode -->\n${OK}`);
    expect(safeSvg('<svg><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use href="#g"/><use xlink:href="#g"/></svg>')).not.toBeNull();
    expect(safeSvg('<svg><style>.a{fill:red}</style><text class="a">hi</text></svg>')).not.toBeNull();
    expect(safeSvg('<svg><image href="data:image/png;base64,iVBORw0KGgo="/></svg>')).not.toBeNull();
  });

  it('svg 가 아니면 버린다', () => {
    expect(safeSvg('')).toBeNull();
    expect(safeSvg('<div>hi</div>')).toBeNull();
    expect(safeSvg('<svgx></svgx>')).toBeNull();
    expect(safeSvg('hello <svg></svg>')).toBeNull();
    expect(safeSvg(42 as unknown as string)).toBeNull();
  });

  it('스크립트·이벤트·끼운 HTML 은 버린다', () => {
    for (const bad of [
      '<svg><script>alert(1)</script></svg>',
      '<svg><SCRIPT href="x"/></svg>',
      '<svg onload="alert(1)"></svg>',
      '<svg><rect ONCLICK = "x"/></svg>',
      '<svg><rect\nonmouseover="x"/></svg>',
      '<svg><rect/onload="x"/></svg>',
      '<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><iframe/></body></foreignObject></svg>',
      '<svg><iframe src="x"/></svg>',
      '<svg><embed src="x"/></svg>',
      '<svg><object data="x"/></svg>',
      '<svg><set attributeName="href" to="javascript:alert(1)"/></svg>',
      '<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>',
      '<svg><handler>x</handler></svg>',
      '<svg><listener event="click"/></svg>',
    ]) expect(safeSvg(bad), bad).toBeNull();
  });

  it('DOCTYPE·ENTITY(엔티티 폭탄·바깥 엔티티)는 버린다', () => {
    expect(safeSvg('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]><svg>&a;</svg>')).toBeNull();
    expect(safeSvg('<svg><!ENTITY x SYSTEM "file:///etc/passwd"></svg>')).toBeNull();
  });

  it('바깥을 부르는 주소는 버린다 — 안쪽(#)·data 그림만', () => {
    for (const bad of [
      '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
      '<svg><a xlink:href="JavaScript:x"/></svg>',
      '<svg><use href="https://evil.example/s.svg#a"/></svg>',
      '<svg><use xlink:href="hodoc://localhost/Users/a/.ssh/id_rsa"/></svg>',
      '<svg><image href="file:///etc/hosts"/></svg>',
      "<svg><image href='http://evil.example/x.png'/></svg>",
      '<svg><image href=http://evil.example/x.png /></svg>',
      '<svg><a href="&#106;avascript:x"/></svg>',
      '<svg><image href="data:image/svg+xml,<svg onload=x>"/></svg>',
      '<svg><image href="data:text/html,<script>x</script>"/></svg>',
      '<svg><rect fill="url(https://evil.example/p.svg#g)"/></svg>',
      "<svg><rect style=\"fill:url('http://evil.example/a')\"/></svg>",
      '<svg><style>@import url(https://evil.example/a.css);</style></svg>',
      '<svg><style>rect{background:url(//evil.example/a)}</style></svg>',
      '<svg><rect src="x"/></svg>',
    ]) expect(safeSvg(bad), bad).toBeNull();
  });

  it('128KB 를 넘으면 버린다(엔진과 같은 한도)', () => {
    const big = `<svg>${'<rect/>'.repeat(30000)}</svg>`;
    expect(big.length).toBeGreaterThan(128 * 1024);
    expect(safeSvg(big)).toBeNull();
  });
});

describe('svgSrc — <img> 주소', () => {
  it('data: 주소로만, 걸러지면 null', () => {
    const s = svgSrc(OK, 'light')!;
    expect(s.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(s.slice('data:image/svg+xml;charset=utf-8,'.length))).toBe(OK);
    expect(s).not.toMatch(/[<>"#\s]/);
    expect(svgSrc('<svg onload="x"/>', 'light')).toBeNull();
  });
});

// 2026-10-12 mode-showcase 실측: <img> SVG 는 점 하나만 숨쉬어도 그림 전체를 매 프레임 다시 그려 렌더러 CPU 10~12%·GPU 12~14%.
// 움직임을 끈 정지판으로 바꾸면 2.5~2.9%·1.3~2.3%. 바깥 CSS(oa-paused·oa-calm)는 <img> 안에 안 닿아서 src 를 바꾼다
describe('svgStillSrc — 움직임 끈 정지판', () => {
  const MOVING = '<svg class="mode-anim" viewBox="0 0 10 10"><style>@keyframes b{50%{opacity:.3}}.d{animation:b 2s infinite}</style><circle class="d" cx="5" cy="5" r="2"/></svg>';
  const dec = (u: string | null) => decodeURIComponent((u ?? '').replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
  it('여는 <svg …> 바로 뒤에 움직임·전환을 끄는 <style> 을 끼운다(그림은 그대로)', () => {
    const still = dec(svgStillSrc(MOVING, 'light'));
    expect(still).toMatch(/^<svg class="mode-anim" viewBox="0 0 10 10"><style>\*\{animation:none!important;transition:none!important\}<\/style><style>@keyframes b/);
    expect(still).toContain('<circle class="d" cx="5" cy="5" r="2"/>');
  });
  it('<?xml·주석 머리가 있어도 <svg 여는 꼬리 뒤에', () => {
    expect(dec(svgStillSrc(`<?xml version="1.0"?><!-- x --><svg\nviewBox="0 0 1 1"><rect/></svg>`, 'light'))).toMatch(/<svg\nviewBox="0 0 1 1"><style>\*\{animation:none!important/);
  });
  it('걸러지는 SVG 는 정지판도 없다', () => {
    expect(svgStillSrc('<svg onload="alert(1)"/>', 'light')).toBeNull();
  });
});

// 2026-10-16 폰(다크) 실측: <img> 안 SVG 의 @media (prefers-color-scheme: dark) 는 앱이 고른 테마를 못 본다(WebKit 은 그림 안을 늘 라이트로 본다)
// → kit-svg 계기판 큰 숫자(var(--ink))가 어두운 바탕에 거의 안 보였다. 앱이 그릴 때 지금 테마로 그 조건을 못 박는다 — OS 설정이 끼어들 자리가 없게
describe('svgSrc·svgStillSrc — 앱 테마로 못 박기', () => {
  const dec = (u: string | null) => decodeURIComponent((u ?? '').replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
  const KIT = svgDoc({ layers: [{ skin: 'gauge', w: 300, h: 120, body: BigNum(20, 90, '$12.34', { size: 64 }) }] }).svg;
  const DARK_INK = '--ink:#e7e7ea';
  // 그 스킨 변수 블록이 늘 참인 조건(또는 조건 없음) 안에 있으면 켜진 것
  const on = (svg: string, vars: string) => {
    const at = svg.indexOf(vars);
    const media = svg.lastIndexOf('@media', at);
    if (media < 0 || svg.lastIndexOf('}}', at) > media) return true; // @media 밖
    return /^@media \(grid:0\)\{/.test(svg.slice(media));
  };
  it('앱 다크면 다크 변수가 켜지고 OS 조건(prefers-color-scheme)이 남지 않는다', () => {
    for (const s of [dec(svgSrc(KIT, 'dark')), dec(svgStillSrc(KIT, 'dark'))]) {
      expect(s).not.toMatch(/prefers-color-scheme/);
      expect(on(s, DARK_INK)).toBe(true);
    }
  });
  it('앱 라이트면 다크 변수는 꺼진다(OS 가 다크여도)', () => {
    for (const s of [dec(svgSrc(KIT, 'light')), dec(svgStillSrc(KIT, 'light'))]) {
      expect(s).not.toMatch(/prefers-color-scheme/);
      expect(on(s, DARK_INK)).toBe(false);
      expect(on(s, '--ink:#1d1d20')).toBe(true);
    }
  });
  it('모드가 직접 쓴 조건도 — 띄어쓰기·대소문자·light 쪽·style media 속성·not', () => {
    const own = '<svg viewBox="0 0 1 1" xmlns="http://www.w3.org/2000/svg"><style media="( Prefers-Color-Scheme:LIGHT )">.a{fill:#000}</style><style>@media screen and (prefers-color-scheme:dark){.a{fill:#fff}}@media not all and (prefers-color-scheme: dark){.b{fill:red}}</style><rect class="a"/></svg>';
    expect(dec(svgSrc(own, 'dark'))).toBe('<svg viewBox="0 0 1 1" xmlns="http://www.w3.org/2000/svg"><style media="(grid:1)">.a{fill:#000}</style><style>@media screen and (grid:0){.a{fill:#fff}}@media not all and (grid:0){.b{fill:red}}</style><rect class="a"/></svg>');
    expect(dec(svgSrc(own, 'light'))).toContain('<style media="(grid:0)">');
  });
  it('조건이 없는 그림은 그대로', () => {
    expect(dec(svgSrc(OK, 'dark'))).toBe(OK);
  });
});
