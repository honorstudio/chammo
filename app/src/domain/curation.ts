/** 검토용 시안(design-curation·flow-curation 껍데기)인가 — 껍데기는 앱에 `hodoc: 'cur-state'` 로 진행을 알린다.
 *  미리보기 창을 띄웠다가 시안이 알려 오면 검토 모드로 바꾸면 창이 번쩍 떴다 사라졌다(2026-09-30 사용자 "깜빡거린다") — 열기 전에 글로 본다 */
export const isCurationHtml = (html: string) => /hodoc\s*:\s*['"]cur-state['"]/.test(html);

/** 껍데기가 알려 온 저장분이 비었나 — 칸(marks·notes·decks·picks·flows…) 어느 하나라도 들어 있으면 빈 게 아니다.
 *  흐름 시안은 결정(picks)만 고를 수도 있어서, 칸 이름을 박아 두면 그것만 고른 기록을 못 되살렸다(2026-10-01) */
export const emptyStore = (d?: Record<string, unknown> | null) =>
  !d || Object.values(d).every((v) => !v || typeof v !== 'object' || !Object.keys(v as object).length);

/** 시안 칸이 보낸 message 인가 — 그 칸 창(contentWindow)일 때만. 다른 칸이 cur-state·curation·esc 를 흉내 내지 못하게(리더 Reader·폰 HtmlSheet 와 같은 규칙) */
export const fromFrame = (e: MessageEvent, win: Window | null | undefined) => !!win && e.source === win;

/** 껍데기가 알린 확대(cur-state zoom)를 보고 칸에 보낼 확대 — 없으면 null. 칸을 읽은 뒤 첫 알림(synced=false)이 지금 확대와 다를 때만 보내고,
 *  그 뒤엔 사람이 확대를 바꿀 때만(zoomBy) 보낸다. 알림마다 다르면 또 보냈더니 받은 확대를 곱하거나 맞춤까지 곱해 알리는 손본 껍데기와
 *  되먹임이 돼 카드를 누를 때마다(알림마다) 보드가 한 단계씩 작아졌다(공개 이슈 #1, 2026-10-27). 옛 껍데기(zoom 칸 없음)는 앱이 문서째 확대한다 */
export function curZoomCmd(shell: number | undefined, want: number, synced: boolean): number | null {
  if (shell === undefined || synced || Math.abs(shell - want) <= 0.001) return null;
  return want;
}

/** 시안(HTML) 칸 샌드박스 — 폰처럼 앱과 다른 불투명 출처로 돈다. allow-same-origin 을 주면 시안 스크립트가 hodoc 으로 홈 폴더 아무 파일이나
 *  읽었다(2026-10-06 실측). 스크립트·확인 창(검토 틀 초기화·빈 결과 보내기 confirm)만. hodoc 응답 머리글(reader.rs DOC_CSP)도 같은 sandbox 를 건다 */
export const DOC_SANDBOX = 'allow-scripts allow-modals';

/** Esc 가 시안 검토 탭을 닫나 — 검토가 스페이스 탭이라 채팅 칸이 같이 보인다(fix/curation-space). 채팅 입력칸처럼 검토 밖 글 칸에서 누른 Esc·
 *  한글 조합 중·위에 뜬 창(미리보기·문서 뒤로 창)이 있을 땐 안 닫는다. 검토 안 보낼 말 칸에서는 닫는다(예전 그대로) */
export function reviewEscCloses(o: { key: string; composing?: boolean; inReview: boolean; editable: boolean; overlay: boolean }): boolean {
  if (o.key !== 'Escape' || o.composing || o.overlay) return false;
  return o.inReview || !o.editable;
}

export type CurStep = { do: 'restore' } | { do: 'save'; text: string; json: string } | null;

/** 시안이 알려 온 것(cur-state) → 앱이 할 일. 불투명 출처라 칸을 새로 열면 시안 저장소가 비어 있다 — 그 칸의 첫 알림이 비었으면
 *  파일(curation/)에서 되돌리고, 그 밖엔 결과 글·저장분을 파일에 적는다. 첫 알림 뒤의 빈 알림은 시안 안 초기화라 그대로 적는다 */
export function curStep(first: boolean, d: unknown): CurStep {
  const m = d as { hodoc?: unknown; text?: unknown; store?: unknown } | null;
  if (!m || typeof m !== 'object' || m.hodoc !== 'cur-state' || typeof m.text !== 'string') return null;
  const store = m.store && typeof m.store === 'object' && !Array.isArray(m.store) ? (m.store as Record<string, unknown>) : undefined;
  if (first && emptyStore(store)) return { do: 'restore' };
  return { do: 'save', text: m.text, json: JSON.stringify(store ?? {}) };
}

/** 폰 시안 보내기 상태 — idle 보낼 수 있음 · sending 보내는 중 · sent 지금 결과 글을 이미 보냄 · fail 못 보냄(그 자리에서 다시).
 *  같은 결과가 두 번 들어갔다(2026-10-11 사용자 — 창이 안 닫혀 보내졌는지 몰라 또 누름): 마지막으로 보낸 글과 같으면 보냄으로 둔다 */
export type CurSend = 'idle' | 'sending' | 'sent' | 'fail';
export function curSendState(phase: CurSend, sentText: string | null, text: string): CurSend {
  if (phase === 'sending' || phase === 'fail') return phase;
  return sentText !== null && sentText === text ? 'sent' : 'idle';
}
export const canCurSend = (s: CurSend) => s === 'idle' || s === 'fail';

type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void };
const CUR_SENT_KEY = 'm.cursent';
const readSentMap = (s: KV | null): Record<string, string> => {
  try { const m = JSON.parse(s?.getItem(CUR_SENT_KEY) ?? '{}') as unknown; return m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, string>) : {}; } catch { return {}; }
};
/** 그 시안에서 마지막으로 보낸 결과 글 — 창을 닫았다 다시 열어도 같은 걸 또 안 보내게 */
export const readCurSent = (s: KV | null, path: string): string | null => { const v = readSentMap(s)[path]; return typeof v === 'string' ? v : null; };
/** 시안 30개까지만 기억 — 오래된 것부터 버린다 */
export function writeCurSent(s: KV | null, path: string, text: string) {
  const m = readSentMap(s);
  delete m[path];
  m[path] = text;
  const keys = Object.keys(m);
  keys.slice(0, Math.max(0, keys.length - 30)).forEach((k) => delete m[k]);
  try { s?.setItem(CUR_SENT_KEY, JSON.stringify(m)); } catch { /* 저장 막힘 — 이 화면 동안만 */ }
}
