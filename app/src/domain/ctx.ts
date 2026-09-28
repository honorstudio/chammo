// 세션별 컨텍스트(대화 메모리) 사용량. 상태줄 스크립트가 세션마다 ~/.honor-orchestrator/ctx/<session_id>.json 을 남긴다
// (Claude Code 가 상태줄에 주는 context_window.used_percentage 그대로라 모델별 창 크기를 따로 셀 필요가 없다)

export type Ctx = { used: number; ts: number };
export const CTX_ALERT = 80;

export function parseCtx(files: string[]): Record<string, Ctx> {
  const out: Record<string, Ctx> = {};
  for (const text of files) {
    try {
      const j = JSON.parse(text) as { sessionId?: string; used?: unknown; ts?: unknown };
      if (j.sessionId && typeof j.used === 'number') out[j.sessionId] = { used: j.used, ts: typeof j.ts === 'number' ? j.ts : 0 };
    } catch {
      // 쓰는 중이던 파일 — 다음에 다시 읽힌다
    }
  }
  return out;
}

export const ctxLevel = (used: number) => (used >= CTX_ALERT ? 'high' : used >= 60 ? 'mid' : 'ok');

/** 80% 를 넘어선 세션. 이전 값을 모르는 세션(앱을 막 켰을 때)은 알리지 않는다 */
export function ctxAlerts(prev: Record<string, number>, next: Record<string, number>): string[] {
  return Object.keys(next).filter((id) => prev[id] !== undefined && prev[id]! < CTX_ALERT && next[id]! >= CTX_ALERT);
}
