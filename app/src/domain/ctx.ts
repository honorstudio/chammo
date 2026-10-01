// 세션별 컨텍스트(대화 메모리) 사용량. 상태줄 스크립트가 세션마다 ~/.honor-orchestrator/ctx/<session_id>.json 을 남긴다
// (Claude Code 가 상태줄에 주는 context_window.used_percentage 그대로라 모델별 창 크기를 따로 셀 필요가 없다)

export type Ctx = { used: number; ts: number; model?: string; modelId?: string; effort?: string };
export const CTX_ALERT = 80;

export function parseCtx(files: string[]): Record<string, Ctx> {
  const out: Record<string, Ctx> = {};
  for (const text of files) {
    try {
      const j = JSON.parse(text) as { sessionId?: string; used?: unknown; ts?: unknown; model?: unknown; modelId?: unknown; effort?: unknown };
      if (j.sessionId && typeof j.used === 'number') {
        const c: Ctx = { used: j.used, ts: typeof j.ts === 'number' ? j.ts : 0 };
        // 채팅 머리줄 칩용 — 상태줄이 같이 남긴 모델·에포트(옛 파일엔 없다)
        if (typeof j.model === 'string' && j.model) c.model = j.model;
        if (typeof j.modelId === 'string' && j.modelId) c.modelId = j.modelId;
        if (typeof j.effort === 'string' && j.effort) c.effort = j.effort;
        out[j.sessionId] = c;
      }
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
