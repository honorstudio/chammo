// 키즈 모드(Rust kids.rs) — 아이 세션은 <데이터>/kids/<참모>/ 에서 막힌 규칙으로 돈다.
// 앱의 자동 손길(권한 창 자동 허용 등)은 아이 세션에 닿지 않는다 — 자동 허용이 '다른 세션 메시지 전달'까지 눌러 막힘이 풀렸다(11-17 리뷰)
import { fwd } from './paths';
import { withinRoots } from './session';

/** 아이 세션(과 그 만들기 세션)을 뺀 목록 */
export function withoutKids<T extends { cwd: string }>(all: T[], dataDir: string): T[] {
  if (!dataDir) return all;
  const kids = withinRoots(all, [`${fwd(dataDir).replace(/\/+$/, '')}/kids`]);
  return kids.length ? all.filter((s) => !kids.includes(s)) : all;
}

/** 아이 대화 기록 한 줄(Rust kids_wire::Row) */
export type KidsRow = { ts: number; who: string; text: string; cid?: string };
/** 보호자 채팅에 끼울 줄 — kid 아이 말 · reply 아이 화면 답 · app 앱 줄(작은 회색) */
export type KidsLine = { ts: string; key: string; kind: 'kid' | 'reply' | 'app'; text: string };

/** 아이 대화 기록 → 보호자 채팅 줄(두 세션을 한 줄기로, 시각 자리에 끼운다 — domain/chatExtras interleave).
 *  보호자 쪽 줄(guardian)은 보호자 채팅에 이미 있어 뺀다. 같은 시각 줄이 겹쳐도 열쇠가 겹치지 않게 순번을 붙인다 */
export function kidsLines(rows: KidsRow[]): KidsLine[] {
  return rows
    .filter((r) => r.who === 'kid' || r.who === 'assistant' || r.who === 'app')
    .map((r, i) => ({ ts: new Date(r.ts).toISOString(), key: `kids:${r.ts}:${i}`, kind: r.who === 'kid' ? 'kid' : r.who === 'assistant' ? 'reply' : 'app', text: r.text }));
}
