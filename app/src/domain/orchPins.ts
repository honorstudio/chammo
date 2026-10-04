// 참모 고정 — 고정한 참모를 목록 맨 위에(고정한 순서대로). 폰 참모 바꾸기 시트·데스크톱 사이드바·채팅 탭·오케스트레이터 홈이 같이 쓴다.
// 저장은 맥 <데이터>/orch-pins.json(대화 id) — 폰은 /api/pins, 데스크톱은 read_orch_pins(2026-10-03 사용자). 화면·통신 없음

/** 고정한 것(pins 순서) 먼저, 나머지는 원래 순서. 고정이 하나도 안 걸리면 같은 배열 */
export function pinFirst<T>(items: T[], pins: string[], key: (t: T) => string | undefined): T[] {
  if (!pins.length) return items;
  const rank = new Map(pins.map((p, i) => [p, i]));
  const pinned = items.filter((t) => { const k = key(t); return k !== undefined && rank.has(k); });
  if (!pinned.length) return items;
  pinned.sort((a, b) => rank.get(key(a)!)! - rank.get(key(b)!)!);
  return [...pinned, ...items.filter((t) => !pinned.includes(t))];
}

/** /api/pins·read_orch_pins 글 → 대화 id 목록(문자열만) */
export function parsePins(text: string): string[] {
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
