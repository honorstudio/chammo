import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as Icons from './Icons';

// 같은 그림의 아이콘이 두 이름으로 쓰이면 사람이 뜻을 못 가른다 — 10-26 '따로 창'이 '복사'와 같은 겹친 두 네모였다(283.png).
// 뜻이 같아 일부러 같은 그림인 짝만 여기에 적는다
const SAME_ON_PURPOSE = [['IconPlay', 'IconResume']];

const drawn = Object.entries(Icons)
  .filter(([name, f]) => name.startsWith('Icon') && typeof f === 'function')
  .map(([name, f]) => ({ name, svg: renderToStaticMarkup(createElement(f as () => ReactElement)).replace(/\s+/g, ' ') }));

describe('아이콘 모음', () => {
  it('같은 그림을 두 이름이 쓰지 않는다', () => {
    const by = new Map<string, string[]>();
    for (const d of drawn) by.set(d.svg, [...(by.get(d.svg) ?? []), d.name]);
    const dup = [...by.values()].filter((names) => names.length > 1).map((names) => names.sort());
    expect(dup).toEqual(SAME_ON_PURPOSE);
  });
  it('따로 창은 복사(겹친 두 네모)와 다른 모양 — 창 모서리 밖으로 나가는 화살표', () => {
    const out = drawn.find((d) => d.name === 'IconWindowOut')!.svg;
    expect(out).not.toContain('<rect');
    expect(out).toContain('13.5 2.5'); // 오른쪽 위 모서리로 나가는 화살 끝
  });
});
