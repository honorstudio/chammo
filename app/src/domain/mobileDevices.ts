// 설정 > 모바일 연결된 폰 목록 — 맥이 준 기기 줄(열쇠 하나 = 한 줄)을 폰 단위로 묶는다.
// 한 폰에 사파리 탭과 홈 화면 앱은 저장 공간이 따로라 열쇠가 둘이다 — 묶음(group)은 맥이 증명으로만 붙인다(mobile_pair.rs)
export type DeviceRow = { id: string; name: string; created: number; lastSeen: number | null; home: boolean; group: string; paired: number; peer?: boolean };
/** peer = 다른 기기의 참모 앱이 붙은 열쇠(폰 아님) */
export type Kind = 'browser' | 'home' | 'peer';
export type PhoneGroup = { group: string; name: string; kinds: Kind[]; lastUsed: number };

const used = (r: DeviceRow) => r.lastSeen ?? r.created;

/** 묶음별 한 줄 — 이름은 브라우저 줄 것(없으면 첫 줄), 마지막 사용은 묶음에서 가장 최근. 최근에 쓴 폰이 위 */
export function phoneGroups(rows: DeviceRow[]): PhoneGroup[] {
  const by = new Map<string, DeviceRow[]>();
  for (const r of rows) by.set(r.group, [...(by.get(r.group) ?? []), r]);
  return [...by.entries()]
    .map(([group, rs]) => ({
      group,
      name: (rs.find((r) => !r.home) ?? rs[0]!).name,
      kinds: rs.some((r) => r.peer) ? ['peer' as const] : (['browser', 'home'] as const).filter((k) => rs.some((r) => r.home === (k === 'home'))),
      lastUsed: Math.max(...rs.map(used)),
    }))
    .sort((a, b) => b.lastUsed - a.lastUsed);
}

export type KindWords = { safari: string; browser: string; home: string; peer: string };
const KO: KindWords = { safari: '사파리', browser: '브라우저', home: '홈 화면 앱', peer: '다른 기기 참모' };

/** 칸 이름 — 아이폰·아이패드 브라우저는 사파리 */
export const kindLabels = (name: string, kinds: Kind[], w: KindWords = KO) =>
  kinds.map((k) => (k === 'peer' ? w.peer : k === 'home' ? w.home : /^iP(hone|ad)$/.test(name) ? w.safari : w.browser));

/** 열쇠를 가장 최근에 내준 때 — 같은 폰이 다시 짝지으면 줄은 안 늘고 이것만 바뀐다(QR 거두기) */
export const lastPaired = (rows: DeviceRow[]) => rows.reduce((m, r) => Math.max(m, r.paired), 0);
