// 확인 창 버튼 색 — 지우기·끄기만 빨강(위험), 추가·설치는 보통 버튼.
// 예전엔 orchActions confirm 이 danger 고정이라 도구 화면 '설치'·'추가'도 빨갛게 떴다(2026-10-04 tools-panel ⑤)
import { describe, expect, it } from 'vitest';
import tools from './space/ToolsPage.tsx?raw';
import actions from './orchActions.tsx?raw';

/** ask( … ) 부름마다 ok 글자(tr 의 한글)와 끝 인자가 false 인지 */
export function askCalls(src: string): { ok: string; safe: boolean }[] {
  const out: { ok: string; safe: boolean }[] = [];
  for (const m of src.matchAll(/\bask\(tr\(/g)) {
    let depth = 0;
    let i = m.index! + 3;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) break;
    }
    const call = src.slice(m.index!, i + 1);
    const oks = [...call.matchAll(/tr\('([^']+)', '[^']+'\)/g)].map((x) => x[1]!);
    out.push({ ok: oks[oks.length - 1] ?? '', safe: /,\s*false\)$/.test(call) });
  }
  return out;
}

describe('확인 창 버튼 색', () => {
  it('부름 읽기 — 마지막 tr 이 ok 글자, 끝 인자 false 면 보통 버튼', () => {
    expect(askCalls("ask(tr('a 지울까?', 'x'), 'b', tr('지우기', 'Remove'), () => go())")).toEqual([{ ok: '지우기', safe: false }]);
    expect(askCalls("ask(tr('a 설치할까?', 'x'), b, tr('설치', 'Install'), () => run(f(1)), false)")).toEqual([{ ok: '설치', safe: true }]);
  });

  it('도구 화면: 설치·추가는 보통 버튼, 지우기는 빨강', () => {
    const calls = askCalls(tools);
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const c of calls) expect({ ok: c.ok, safe: c.safe }).toEqual({ ok: c.ok, safe: c.ok !== '지우기' });
  });

  it('confirm 은 danger 를 받아 Confirm 에 넘긴다(안 주면 빨강 그대로)', () => {
    expect(actions).toMatch(/danger=\{ask\.danger !== false\}/);
  });
});
