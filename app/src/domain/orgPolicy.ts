// 회사 정책(Claude Code 관리 설정) 판정 — ADR 0023. Rust org_policy(정책 파일·doctor 줄)와 세션 첫 권한 모드(세 번째 겹)를 합친다.
// 바이패스가 막힌 기기에선 앱이 권한 창을 대신 누르지 않고 사람 카드로 묻는다(perm_card). 정책이 없으면 지금 그대로
export type OrgPolicy = {
  source: string;
  bypass: 'allowed' | 'blocked' | 'unknown';
  auto: 'allowed' | 'blocked' | 'unknown';
  hooks: 'ours' | 'managedOnly';
  permRules: 'ours' | 'managedOnly';
  agentView: 'on' | 'off';
  remote?: string | null;
};

const BYPASS = 'bypassPermissions';

/** 가장 최근에 뜬 백그라운드 세션 둘이 다 바이패스가 아닌 모드로 시작했나 — Chammo 는 늘 바이패스를 달라고 띄우니 낮아졌다면 정책이다.
 *  둘을 보는 건 사람이 손으로 다른 모드로 띄운 세션 하나에 자동 허용이 꺼지지 않게. 모드를 아직 모르는 세션은 뺀다 */
export function seenDowngrade(rows: { kind: string; startedAt: number; mode?: string }[]): boolean {
  const last = rows.filter((r) => r.kind === 'background' && r.mode).sort((a, b) => b.startedAt - a.startedAt).slice(0, 2);
  return last.length === 2 && last.every((r) => r.mode !== BYPASS);
}

/** 자동 허용을 끄고 사람 카드로 묻나 — 바이패스가 막혔다고 읽혔거나, 세션이 실제로 낮아졌을 때만 */
export const blocksAutoAllow = (p: OrgPolicy | null | undefined, seen: boolean): boolean => p?.bypass === 'blocked' || seen;
