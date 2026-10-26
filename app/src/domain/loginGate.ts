// 로그인 필수(2026-10-24 사용자) — Chammo 계정에 로그인 안 된 기기는 앱을 켜면 먼저 로그인 화면. '나중에' 없음.
// 예외는 중계에 못 닿을 때만(오프라인·서버 장애) — 이번 실행만 '일단 쓰기', 다음에 켜면 다시. 한 번 로그인하면 기기 열쇠(키체인)·team.json 으로 계속(만료 없음)
export type Gate = 'none' | 'login' | 'offline' | 'waiting' | 'code' | 'start' | 'reset' | 'relogin';

/** step = Rust e2e_flow::self_step — need·failed 면 4자리 화면(건너뛰기 없음, chammo-relay ADR 0007 R7), start 면 '첫 기기로 시작'(R8, 나중에는 이번 실행만), reset 이면 '이 기기로 다시 시작'(허용해 줄 사슬 기기가 없음 — 계정 되찾기 갈래 ①), relogin 이면 '다시 로그인'(봉인 없이 대기 — 옛 판 로그인, 10-26 아이맥), outside 면 숫자 대기(허용됐지만 사슬 밖) */
export function gateState(v: { account: unknown; pending?: boolean } | null, o: { offline?: boolean; skipped?: boolean; waitSeen?: boolean; step?: string; startLater?: boolean; resetLater?: boolean; reloginLater?: boolean }): Gate {
  if (!v) return 'none';
  if (!v.account) return o.offline ? (o.skipped ? 'none' : 'offline') : 'login';
  if (o.step === 'need' || o.step === 'failed') return 'code';
  if (o.step === 'start' && !o.startLater) return 'start';
  if (o.step === 'reset' && !o.resetLater) return 'reset';
  // 나중에 = 이번 실행 동안 문 없음 — 숫자가 영영 안 뜨는 대기 화면으로 넘기지 않는다
  if (o.step === 'relogin') return o.reloginLater ? 'none' : 'relogin';
  // 허용됐지만 사슬 밖(outside) — 대기 기기와 같은 숫자 화면, 사슬 기기 어디서든 '내 기기 확인' 카드로(10-26)
  if ((v.pending || o.step === 'outside') && !o.waitSeen) return 'waiting';
  return 'none';
}

/** 상태를 다시 물을 때 — 아직 못 읽음·로그인 전(밖 scripts/team login 으로 로그인하면 닫히게, QA 7)·허용 대기·단계가 있을 때(checking 포함 — ensure 가 끝나 단계가 정해질 때까지) */
/** fresh = 계정이 있는 상태에서 단계를 읽었나 — 로그인 직후엔 로그인 전에 읽은 빈 단계라 한 번 더 읽어야 한다(10-26 아이맥: 다시 시작 화면이 안 떴다) */
export function watchGate(v: { pending?: boolean; account?: unknown } | null, step: string, fresh = true): boolean {
  return !v || !v.account || !!v.pending || step !== '' || !fresh;
}

/** 로그인이 '이미 로그인돼 있어요'로 막혔다 — 밖에서 먼저 로그인한 것. 오류 대신 상태를 다시 읽어 화면을 닫는다(QA 7) */
export const alreadyIn = (e: string) => /이미 이 기기는 로그인돼 있어요/.test(e);

/** 로그인 실패가 망·서버 장애인가(→ 일단 쓰기를 보여 줌). 서버가 답한 거절·사람이 안 마친 것은 아니다 */
export function offlineError(e: string): boolean {
  return /중계 서버에 못 닿았어요|curl: \((6|7|28|35|52|56)\)|resolve host|failed to connect|timed out|network|서버 5\d\d|\b50[234]\b/i.test(e);
}
