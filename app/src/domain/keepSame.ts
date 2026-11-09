// 같은 내용이면 옛 값을 그대로 — 폴링 결과를 setState 에 넣기 전에 거친다. React 는 참조가 같으면 다시 안 그리고, 자식 memo·훅 의존성도 안 깨진다.
// 3초마다 새 배열·새 객체를 넣어 값이 그대로여도 앱 전체가 다시 그려졌다(11-07 가만히 WebContent 21%).
// 비교는 키 순서를 안 본다(11-07 accounts.json 무한 저장이 키 순서만 다른 비교였다). 일부만 바뀌면 안 바뀐 칸은 옛 참조를 재사용해 줄별 memo 가 산다.
type Plain = Record<string, unknown>;

const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

export function keepSame<T>(old: T, next: T): T {
  if (Object.is(old, next)) return old;
  if (Array.isArray(old) && Array.isArray(next)) {
    let same = old.length === next.length;
    const out = next.map((v, i) => {
      const r = i < old.length ? keepSame(old[i], v) : v;
      if (!Object.is(r, old[i])) same = false;
      return r;
    });
    return same ? old : (out as unknown as T);
  }
  if (isPlain(old) && isPlain(next)) {
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(old).length;
    const out: Plain = {};
    for (const k of keys) {
      const had = Object.prototype.hasOwnProperty.call(old, k);
      const r = had ? keepSame(old[k], next[k]) : next[k];
      if (!had || !Object.is(r, old[k])) same = false;
      out[k] = r;
    }
    return same ? old : (out as T);
  }
  return next;
}
