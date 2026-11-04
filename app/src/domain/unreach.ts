// 못 닿음 표시는 오래 끊길 때만(2026-11-02 사용자 폰 '맥에 못 닿았어요: Load failed') — 계산만.
// 맥↔중계 허브가 몇 초 끊겼다 붙는 동안(notify.log: 끊긴 뒤 4~16초에 다시) 받기가 한두 번 실패해도 보던 화면을 그대로 두고,
// 실패가 이만큼 이어질 때만 첫 켜기의 '못 닿음' 화면·켜진 뒤의 윗줄을 띄운다
import { machine, tr } from '../i18n';

/** 실패가 이만큼 이어지면 보인다(ms) — 받기 하나도 netRetry 로 7초 남짓 다시 해 본 뒤라 실제로는 그보다 조금 늦다 */
export const UNREACH_GRACE_MS = 15_000;
/** 받기 고리 간격 — 잘 받을 때 / 실패 중(붙자마자 화면이 따라오게) */
export const OK_EVERY_MS = 3000;
export const FAIL_EVERY_MS = 1500;

/** since = 실패 줄이 시작된 때(그 받기를 시작한 시각, 0 = 실패 중 아님) */
export type Unreach = { since: number };

/** 받기 하나가 끝났다 — ok 면 줄이 끊기고, 실패면 줄의 시작에서 유예를 넘었을 때만 show */
export function unreachStep(s: Unreach, r: { ok: boolean; startedAt: number; now: number }): Unreach & { show: boolean } {
  if (r.ok) return { since: 0, show: false };
  const since = s.since || r.startedAt;
  return { since, show: r.now - since >= UNREACH_GRACE_MS };
}

/** 연결 오류 → 윗줄·첫 화면 글. 'Load failed'·허브 글 같은 속 오류가 그대로 나갔다(11-04 사용자 '문구 정상화', 글은 소넷이 씀).
 *  이름으로 가른다 — 폰 터널(phone-web/hub)의 OfflineError·TrustError. 이미 사람 말로 만든 오류(느림·답 없음)는 그대로 */
export function netText(e: unknown): string {
  const name = e instanceof Error || e instanceof DOMException ? e.name : '';
  if (name === 'OfflineError') return tr(`${machine()}에서 Chammo 를 켜 주세요`, `Open Chammo on your ${machine()}`);
  if (name === 'TrustError') return tr(`폰 연결을 다시 해 주세요. ${machine()}의 QR 을 새로 찍어요`, `Reconnect your phone. Scan a new QR code from your ${machine()}`);
  if (e instanceof TypeError) return tr('연결이 잠깐 끊겼어요. 저절로 다시 붙어요', 'Connection dropped for a moment. Reconnecting automatically');
  return e instanceof Error || e instanceof DOMException ? e.message : String(e);
}
