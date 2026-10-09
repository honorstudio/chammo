// 채팅 안 파일 카드 — 참모가 scripts/show 로 보여 준 파일을 그 참모 채팅의 그 시각 자리에(2026-10-08 사용자 "ㄱㄱ 해보자").
// 폰·PC 둘 다 show.jsonl 꼬리를 읽는다(폰은 /api/shows — 서버가 폰에 내보낼 수 있는 줄만 남긴 것). 꼬리는 세션별 공평 나누기(reader::fair_tail)라
// 하위 세션이 그림을 잔뜩 띄워도 참모의 옛 카드가 안 밀려난다(2026-10-09)
import { parseAt, type ShowAt } from './showAt';

export type ChatFile = { key: string; ts: string; path: string; at?: ShowAt };

/** 같은 파일·같은 곳을 이 안에 또 보여 주면 한 장으로 — 고치고 다시 띄우는 일(고친 문서는 다시 띄우기)이 잦아 카드가 줄줄이 쌓였다 */
export const MERGE_MS = 10 * 60_000;

/** show.jsonl → 이 참모(orchId = 띄운 세션 id)가 보여 준 파일 카드, 오래된 순. 다른 참모·하위 세션 줄과 못 찾은 파일(gone)은 뺀다.
 *  묶은 카드는 마지막으로 보여 준 자리로 옮기고 key 는 처음 시각 그대로 */
export function chatFiles(log: string, orchId: string): ChatFile[] {
  const out: (ChatFile & { ms: number; same: string })[] = [];
  for (const line of log.split('\n')) {
    let r: { path?: unknown; ts?: unknown; from?: unknown; at?: unknown; gone?: unknown };
    try { r = JSON.parse(line); } catch { continue; }
    if (!r || r.from !== orchId || typeof r.path !== 'string' || !r.path || r.gone || typeof r.ts !== 'string') continue;
    const ms = Date.parse(r.ts);
    if (Number.isNaN(ms)) continue;
    const at = parseAt(r.at);
    const same = `${r.path}\n${JSON.stringify(at ?? null)}`;
    const prev = [...out].reverse().find((c) => c.same === same);
    if (prev && ms - prev.ms <= MERGE_MS) { prev.ms = ms; prev.ts = r.ts; continue; }
    out.push({ key: `show:${r.path}:${r.ts}`, ts: r.ts, path: r.path, ...(at ? { at } : {}), ms, same });
  }
  return out.sort((a, b) => a.ms - b.ms).map(({ ms: _ms, same: _same, ...c }) => c);
}

/** 카드 아래 짚은 곳 한 줄 — 없으면 빈 글 */
export function atLine(at?: ShowAt): string {
  if (!at) return '';
  if (at.line) return `:${at.line}${at.lineEnd ? `-${at.lineEnd}` : ''}`;
  if (at.find) return `"${at.find.length > 40 ? `${at.find.slice(0, 40)}…` : at.find}"`;
  if (at.page) return `${at.page}쪽`;
  return at.box ? '그림 한 곳' : '';
}

/** 채팅 파일 카드를 눌렀을 때 옮길 곳 — 스페이스(view)와 채팅 탭(chat) 각각 그 참모로 옮길 id, 이미 거기면 null.
 *  쌓아 보기에서 다른 참모 카드를 누르면 스페이스만 옮기고 채팅 탭 표시는 그대로였다(2026-10-08 chat-file-card ③) */
export function cardMoves(by: string, now: { view: string; chat: string }): { space: string | null; tab: string | null } {
  if (!by) return { space: null, tab: null };
  return { space: by !== now.view ? by : null, tab: by !== now.chat ? by : null };
}
