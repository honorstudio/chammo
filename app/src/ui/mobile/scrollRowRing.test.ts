// "반복적으로 나타나는 버그인데 하이라이트된 버튼의 일부 — 선택된 참모 하이라이트의 윗부분이 가려짐"(2026-10-23 사용자 폰, 사무실 참모 줄)
// 가로로 미는 줄(overflow-x:auto)은 세로도 자른다(overflow-y 가 auto 로 계산됨) — 고른 칩의 고리(box-shadow 0 0 0 2px)·outline 은 칸 크기에 안 잡혀서
// 줄 안쪽 여백이 고리보다 얇으면 위아래·양끝이 잘린다. 예전엔 줄마다 따로 막았다(edgeClip.test) — 이제 가로로 미는 줄은 네 쪽 다 3px 이상 숨 쉴 틈.
// 진짜 화면에서 재는 일반 검사는 폰 하네스(app/.harness/qa.cjs inkClip — 모든 화면에서 자르는 상자 밖으로 나간 고리 0개)
import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';

const RING = 3; // 폰에서 쓰는 가장 두꺼운 고리 2px + 1
const rules = [...css.matchAll(/(?:^|\n|\})\s*([^{}@\n]+?)\s*\{([^}]*)\}/g)].map((m) => ({ sels: m[1]!.split(',').map((s) => s.trim()), body: m[2]! }));
const px = (v: string) => (v.trim() === '0' ? 0 : v.trim().endsWith('px') ? parseFloat(v) : NaN);
/** padding 선언들(순서대로) → [위, 오른쪽, 아래, 왼쪽] — 없으면 0 */
function pads(bodies: string[]): number[] {
  const p = [0, 0, 0, 0];
  for (const b of bodies) {
    for (const m of b.matchAll(/(?:^|;)\s*padding(-top|-right|-bottom|-left)?\s*:\s*([^;]+)/g)) {
      const v = m[2]!.replace(/!important/, '').trim().split(/\s+/).map(px);
      if (m[1]) { p[['-top', '-right', '-bottom', '-left'].indexOf(m[1])] = v[0]!; continue; }
      const [a, b2 = a, c = a, d = b2] = v;
      p.splice(0, 4, a!, b2!, c!, d!);
    }
  }
  return p;
}
// 가로로 미는 줄 = 가로 넘침을 굴리는 flex 줄(글·표처럼 덩어리로 미는 칸은 고를 칸이 없어서 뺀다)
const rows = rules.filter((r) => /overflow-x:\s*(auto|scroll)/.test(r.body) && /display:\s*(inline-)?flex|flex-wrap:\s*nowrap/.test(r.body)).flatMap((r) => r.sels);

describe('가로로 미는 줄 — 고른 칸 고리가 안 잘린다', () => {
  it('CSS 를 읽었다', () => expect(css.length).toBeGreaterThan(1000));
  it('가로로 미는 줄을 찾았다(사무실 참모 줄·기기 줄·스킨 자리 슬롯 포함)', () => {
    expect(rows).toEqual(expect.arrayContaining(['.m-talk', '.m-far-pills', '.m-g1-slots']));
  });
  for (const sel of rows) {
    it(`${sel} 는 네 쪽 다 안쪽 여백 ${RING}px 이상`, () => {
      // 같은 줄을 뒤에서 덮어쓰는 규칙(.m-input .m-attached 처럼 그 줄로 끝나는 선택자)까지 순서대로
      const last = sel.split(/\s+/).pop()!;
      const bodies = rules.filter((r) => r.sels.some((s) => s === sel || s.endsWith(` ${last}`))).map((r) => r.body);
      const [t, r, b, l] = pads(bodies);
      expect({ sel, t, r, b, l }).toEqual({ sel, t: expect.toSatisfy((n: number) => n >= RING), r: expect.toSatisfy((n: number) => n >= RING), b: expect.toSatisfy((n: number) => n >= RING), l: expect.toSatisfy((n: number) => n >= RING) });
    });
  }
});
