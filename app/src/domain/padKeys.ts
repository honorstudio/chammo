// 패드 + 하드웨어 키보드 — 맥 앱 단축키(domain/shortcuts) 가운데 패드 화면에 있는 것만 같은 키로(11-18 시안 v1 D, 추천안).
// 한글 자판이면 ⌘⇧M 이 'ㅡ' 로 오니 글자(key) 대신 키 자리(code)로 읽는다. ⌘ 하나(+⇧)만 — ⌥·⌃ 가 섞이면 시스템·입력칸 몫
export type PadKey = { type: 'orch'; n: number } | { type: 'notes' } | { type: 'dash'; tab: 'home' | 'locker' };
type Ev = { code: string; metaKey: boolean; shiftKey: boolean; altKey: boolean; ctrlKey: boolean };

export function padKey(e: Ev): PadKey | null {
  if (!e.metaKey || e.altKey || e.ctrlKey) return null;
  const d = /^Digit([1-9])$/.exec(e.code);
  if (d && !e.shiftKey) return { type: 'orch', n: Number(d[1]) };
  if (!e.shiftKey) return null;
  if (e.code === 'KeyM') return { type: 'notes' };
  if (e.code === 'KeyH') return { type: 'dash', tab: 'home' };
  if (e.code === 'KeyL') return { type: 'dash', tab: 'locker' };
  return null;
}

/** 입력칸 Enter 로 보낼 때인가 — ⇧·⌥·⌃·⌘ 없이, 한글 조합 확정 중(isComposing·229)이 아닐 때 */
export const enterSendsNow = (e: { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; keyCode?: number; nativeEvent?: { isComposing?: boolean } }) =>
  e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.nativeEvent?.isComposing && e.keyCode !== 229;
