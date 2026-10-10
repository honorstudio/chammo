import { describe, expect, it } from 'vitest';
import { safeSvg, svgSrc } from './modeSvg';

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
    const s = svgSrc(OK)!;
    expect(s.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(s.slice('data:image/svg+xml;charset=utf-8,'.length))).toBe(OK);
    expect(s).not.toMatch(/[<>"#\s]/);
    expect(svgSrc('<svg onload="x"/>')).toBeNull();
  });
});
