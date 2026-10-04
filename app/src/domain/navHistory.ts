// 스페이스 화면 기록 — 뒤로 = '왔던 곳'(브라우저처럼), 앞으로 = 뒤로 갔던 곳. 참모 탭(채팅 탭)마다 따로 쓴다.
// 예전 문서 '뒤로'는 '위 칸'(주인·폴더)으로 가서 링크 타고 간 뒤 누르면 오케스트레이터 홈으로 튕겼다(2026-10-04 QA D2)

export type Nav = { back: string[]; fwd: string[] };
export const EMPTY_NAV: Nav = { back: [], fwd: [] };
const KEEP = 50;

/** cur 에서 next 로 갔다 — 같은 곳·빈 곳은 안 쌓고, 새로 가면 앞으로 기록은 버린다 */
export function visit(n: Nav, cur: string, next: string): Nav {
  if (!cur || cur === next) return n;
  return { back: [...n.back, cur].slice(-KEEP), fwd: [] };
}

/** 뒤로 — 갈 곳이 없으면 null(부르는 쪽이 위 칸으로). 지금과 같은 곳은 건너뛴다 */
export function goBack(n: Nav, cur: string): { nav: Nav; to: string } | null {
  const back = [...n.back];
  let to = back.pop();
  while (to !== undefined && to === cur) to = back.pop();
  if (to === undefined) return null;
  return { nav: { back, fwd: [cur, ...n.fwd].slice(0, KEEP) }, to };
}

/** 앞으로 */
export function goForward(n: Nav, cur: string): { nav: Nav; to: string } | null {
  const [to, ...fwd] = n.fwd;
  if (to === undefined) return null;
  return { nav: { back: [...n.back, cur].slice(-KEEP), fwd }, to };
}
