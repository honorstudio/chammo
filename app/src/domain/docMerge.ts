// 열어 둔 문서를 밖(참모·세션)이 고쳤을 때 — 블록 단위 3자 합치기(노션처럼 바깥 변경이 편집기에 들어온다).
// 편집기가 연 판(base) · 지금 편집기(mine) · 지금 파일(theirs)을 블록 md 줄로 비교해, 내가 안 건드린 곳의 바깥 변경만
// 편집기에 넣는다. 같은 블록을 둘 다 고쳤으면 고르지 않고 충돌 — 부르는 쪽이 저장을 멈추고 알린다.
// 예전엔 처음 읽은 판을 통째로 저장해 밖에서 고친 줄이 말없이 사라졌다(2026-10-04 QA D1)

/** base[s..e) 가 other[ts..te) 로 바뀐 덩어리 */
export type Hunk = { s: number; e: number; ts: number; te: number };

/** 가운데(앞뒤 같은 부분을 뺀 것)가 이보다 크면 LCS 를 안 하고 한 덩어리로 본다 — 넓게 잡을수록 충돌로 기울어 잃지는 않는다 */
const LCS_CELLS = 4_000_000;

/** 두 블록 줄의 차이 덩어리들(base 순서) */
export function diffBlocks(a: string[], b: string[]): Hunk[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const ae = a.length - suf, be = b.length - suf;
  const n = ae - pre, m = be - pre;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0 || n * m > LCS_CELLS) return [{ s: pre, e: ae, ts: pre, te: be }];
  // LCS 표(뒤에서부터) → 같은 줄을 따라가며 다른 구간을 덩어리로
  const w = m + 1;
  const t = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i * w + j] = a[pre + i] === b[pre + j] ? t[(i + 1) * w + j + 1]! + 1 : Math.max(t[(i + 1) * w + j]!, t[i * w + j + 1]!);
    }
  }
  const out: Hunk[] = [];
  let i = 0, j = 0, open: Hunk | null = null;
  const close = () => { if (open) { out.push(open); open = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && a[pre + i] === b[pre + j]) { close(); i++; j++; continue; }
    if (!open) open = { s: pre + i, e: pre + i, ts: pre + j, te: pre + j };
    if (j < m && (i >= n || t[i * w + j + 1]! >= t[(i + 1) * w + j]!)) { j++; open.te = pre + j; } else { i++; open.e = pre + i; }
  }
  close();
  return out;
}

const same = (x: Hunk, y: Hunk, xs: string[], ys: string[]) =>
  x.s === y.s && x.e === y.e && x.te - x.ts === y.te - y.ts && xs.slice(x.ts, x.te).every((v, k) => v === ys[y.ts + k]);

/** 두 덩어리가 부딪히나 — base 구간이 겹치거나, 같은 자리에서 시작하며 하나라도 삽입(순서를 모름) */
const clash = (x: Hunk, y: Hunk) => (x.s < y.e && y.s < x.e) || (x.s === y.s && (x.s === x.e || y.s === y.e));

/** 편집기(mine)에 할 일 — mine[at..at+del) 을 theirs[ts..te) 로. 뒤에서부터 하도록 at 이 큰 것부터 */
export type Op = { at: number; del: number; ts: number; te: number };

export function merge3(base: string[], mine: string[], theirs: string[]): { ops: Op[] } | { conflict: true } {
  const hm = diffBlocks(base, mine);
  const ht = diffBlocks(base, theirs).filter((t) => !hm.some((m) => same(t, m, theirs, mine)));
  // 밖이 통째로 비웠는데 내가 고친 게 있으면 받지 않는다(빈 파일 저장·실수일 수 있다)
  if (theirs.length === 0 && hm.length) return { conflict: true };
  for (const t of ht) if (hm.some((m) => clash(t, m))) return { conflict: true };
  const ops = ht.map((t) => {
    // base 자리 → mine 자리: 앞에서 끝난 내 덩어리만큼 민다
    const shift = hm.filter((m) => m.e <= t.s && !(m.s === m.e && m.s === t.s)).reduce((n, m) => n + (m.te - m.ts) - (m.e - m.s), 0);
    return { at: t.s + shift, del: t.e - t.s, ts: t.ts, te: t.te };
  });
  return { ops: ops.sort((x, y) => y.at - x.at) };
}

/** 줄 배열에 할 일 적용(시험·확인용 — 편집기는 같은 일을 블록으로 한다) */
export function applyOps(mine: string[], ops: Op[], theirs: string[]): string[] {
  const out = [...mine];
  for (const o of ops) out.splice(o.at, o.del, ...theirs.slice(o.ts, o.te));
  return out;
}

/** before → after 로 바뀐 것(바깥 변경)을 older 에도 옮긴다 — older 는 before 보다 앞 판(그새 내가 고친 것 = before 와의 차이).
 *  줄 단위. 내가 고친 줄과 겹치면 null(못 옮김) */
export function rebase(older: string, before: string, after: string): string | null {
  if (older === before) return after;
  const [o, b, a] = [older, before, after].map((t) => t.split('\n'));
  const r = merge3(b!, o!, a!);
  return 'conflict' in r ? null : applyOps(o!, r.ops, a!).join('\n');
}
