// 팀 여러 개(11-02 사용자) — 데스크톱 레일 팀 줄·목록 머리 칩 ▾ 메뉴·폰 머리 팀 줄이 같이 쓰는 순수 함수(시안 docs/design-drafts/team-add v1: PC A+C, 폰 B2)

type Teams = { id: string; name: string }[] | undefined;

/** 레일·칩 메뉴·폰 머리에 쌓을 내 팀 — 서버 순서 그대로(바꿔도 칸 자리가 안 움직인다), 지금 팀만 current. 같은 이름은 id 끝 네 자리로 가른다 */
export function teamStack(v: { joined: boolean; teamId: string; team: string; teams?: Teams } | null): { id: string; name: string; current: boolean }[] {
  if (!v?.joined) return [];
  const all = v.teams?.length ? v.teams : [{ id: v.teamId, name: v.team }];
  return all.map((t) => ({
    id: t.id,
    name: all.some((o) => o.id !== t.id && o.name === t.name) ? `${t.name}(…${t.id.slice(-4)})` : t.name,
    current: t.id === v.teamId,
  }));
}

/** 새 팀 이름이 내 팀과 같은가 — 앞뒤 빈칸·대소문자만 달라도 같다(막지 않고 경고 한 줄) */
export function sameTeamName(name: string, teams: Teams): boolean {
  const n = name.trim().toLowerCase();
  return !!n && (teams ?? []).some((t) => t.name.trim().toLowerCase() === n);
}

/** '이 팀에서 보일 내 이름' 칸 기본값 — 지금 팀 이름 → 계정 이름 → 빈 칸(Rust team_arg 도 빈 칸이면 계정 이름) */
export const defaultMe = (v: { me: string; account: { name?: string } | null } | null): string => (v?.me || v?.account?.name || '').trim();
