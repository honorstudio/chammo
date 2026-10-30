import { tr } from '../i18n';
// 팀 설정(메신저 머리 톱니·팀 아이콘 메뉴) — 화면 판단. 서버 길: chammo-relay teams.ts(이름·초대)·membership.ts(나가기·빼기)

type Member = { id: string; name: string; role: string; perms?: string[]; me: boolean; devices?: { id: string; name: string }[] };

/** 팀 아이콘(왼쪽·오른쪽 누르기) 메뉴 */
export function menuFor(v: { joined: boolean } | null): ('invite' | 'settings' | 'make')[] {
  return v?.joined ? ['invite', 'settings'] : ['make'];
}

export type MemberRow = {
  id: string; name: string; me: boolean; owner: boolean; devices: string[]; canRemove: boolean;
  /** 표시 — owner 팀장 · all 전체 권한 · manager 매니저 · '' 팀원 */
  badge: 'owner' | 'all' | 'manager' | '';
  perms: string[];
  /** 그 사람 권한 칩을 바꿀 수 있나 · 전체 칩까지(팀장만) · 팀장 넘기기(팀장만) */
  canPerms: boolean; canAll: boolean; canTransfer: boolean;
};

/** 매니저 권한 칩(relay ADR 0014 항목) — 전체 먼저 */
export const PERM_CHIPS: { key: string; ko: string; en: string }[] = [
  { key: 'all', ko: '전체', en: 'All' },
  { key: 'invite', ko: '초대', en: 'Invite' },
  { key: 'kick', ko: '내보내기', en: 'Remove' },
  { key: 'posts', ko: '글 고정', en: 'Posts' },
  { key: 'look', ko: '꾸미기', en: 'Look' },
  { key: 'files', ko: '파일 정리', en: 'Files' },
  { key: 'agents', ko: '팀 참모', en: 'Agents' },
];

/** 순위 — 팀장 3 · 전체 권한 2 · 매니저 1 · 팀원 0 (relay src/perms.ts rank). 화면 판단만 — 실제로 막는 건 서버·명부 */
const rankOf = (x: { role: string; perms?: string[] }) => (x.role === 'owner' ? 3 : x.perms?.includes('all') ? 2 : x.perms?.length ? 1 : 0);

/** 팀원 줄 — 나를 맨 위로. 빼기 = 팀장이거나 kick 권한 + 나보다 낮은 사람(마지막 팀장은 서버가 409), 권한 바꾸기 = 전체 권한 이상 + 나보다 낮은 사람 */
export function memberRows(v: { role: string; members: Member[] }): MemberRow[] {
  const me = v.members.find((x) => x.me);
  const mine = { role: v.role, perms: me?.perms ?? [] };
  const myRank = rankOf(mine);
  const owner = v.role === 'owner';
  return [...v.members]
    .sort((a, b) => Number(b.me) - Number(a.me))
    .map((x) => {
      const r = rankOf(x);
      const lower = !x.me && (owner || myRank > r);
      return {
        id: x.id, name: x.name, me: x.me, owner: x.role === 'owner', devices: (x.devices ?? []).map((d) => d.name),
        badge: r === 3 ? 'owner' : r === 2 ? 'all' : r === 1 ? 'manager' : '',
        perms: x.perms ?? [],
        canRemove: lower && (owner || mine.perms.includes('kick') || myRank >= 2),
        canPerms: lower && myRank >= 2 && x.role !== 'owner',
        canAll: owner && !x.me && x.role !== 'owner',
        canTransfer: owner && !x.me && x.role !== 'owner',
      };
    });
}

/** 팀 지우기 확인 창 — 팀 이름·팀원 수. 같은 이름 팀이 있으면 id 끝자리까지(같은 이름 팀이 둘이면 이름만으론 어느 팀인지 모른다) */
export function deleteAsk(v: { teamId: string; team: string; members: Member[]; teams?: { id: string; name: string }[] }): { title: string; body: string } {
  const dup = (v.teams ?? []).some((t) => t.id !== v.teamId && t.name === v.team);
  const name = dup ? `${v.team}(…${v.teamId.slice(-4)})` : v.team;
  const n = v.members.length;
  return {
    title: tr(`${name} 팀을 지울까요?`, `Delete ${name}?`),
    body: tr(`팀원 ${n}명이 모두 빠지고 이 팀 대화가 지워져요. 되돌릴 수 없어요.`, `All ${n} members leave and this team's chats are deleted. This cannot be undone.`)
      + (dup ? tr(' 같은 이름 팀이 하나 더 있어요 — 이 팀만 지워요.', ' Another team has the same name — only this one is deleted.') : ''),
  };
}

/** 팀 바꾸기 — 지금 팀 말고 내 팀들. 이름이 같은 팀이 있으면 id 끝 4자리(QA 6: 팀이 둘이면 첫 팀이 화면에서 사라졌다) */
export function switchTargets(v: { teamId: string; teams?: { id: string; name: string }[] }): { id: string; label: string }[] {
  const all = v.teams ?? [];
  return all
    .filter((t) => t.id !== v.teamId)
    .map((t) => ({ id: t.id, label: all.some((o) => o.id !== t.id && o.name === t.name) ? `${t.name}(…${t.id.slice(-4)})` : t.name }));
}

/** 팀 지우기 — 팀장만(서버 deleteTeam 과 같은 기준). 되돌릴 수 없어 확인 창 뒤에만 */
export const canDeleteTeam = (v: { role: string }) => v.role === 'owner';

/** 나가기 앞 안내 — 내가 유일한 팀장이면 못 나간다(서버 removeStmt 와 같은 기준) */
export function leaveNote(v: { role: string; members: Member[] }): '' | 'last-owner' {
  if (v.role !== 'owner') return '';
  return v.members.filter((x) => x.role === 'owner').length > 1 ? '' : 'last-owner';
}

/** 메신저 창 오른쪽 클릭 — 글 칸·고른 글 위에서만 기본 메뉴(붙여넣기·복사)를 둔다. 나머지는 웹뷰 메뉴(다시 로드·요소 검사)를 막는다 */
export function quietContextMenu(at: { editable: boolean; selection: string }): boolean {
  return !at.editable && !at.selection.trim();
}
