// 팀 보관함 파일을 팀챗(방·DM)에 보내기(11-09 사용자 "팀 보관함에서 팀챗으로 파일이 안 옮겨져. 회의하는데 난감했어") — 끌기가 어려운 폰·좁은 창용 단추.
// 이미 팀 R2 에 있는 파일이라 다시 받거나 올리지 않고 그 파일을 가리키는 첨부(TeamFile)로 보낸다 — 팀 전체 파일은 팀 사람 기기마다 봉해져 있어 방 사람 누구나 연다.
// 다른 방 대화 파일은 그 방 사람만 열 수 있어 빼고(끌어 놓으면 TeamConvo 가 풀어 다시 올린다), 잠긴(이 기기 열쇠 기다림)·휴지통 파일도 뺀다
import { tr } from '../i18n';
import type { Convo, TeamFile } from './teamChat';

export type SendItem = { id: string; name: string; size: number; room: string; why?: string; state?: string; deletedAt?: number | null };
export type SendSkip = { id: string; why: 'locked' | 'room' | 'gone' | 'folder' };

/** room = 보낼 대화의 방(아직 안 연 DM 은 빈 글), team = 이 팀 id */
export function chatSendPlan(items: SendItem[], room: string, team: string): { refs: TeamFile[]; skip: SendSkip[] } {
  const refs: TeamFile[] = [];
  const skip: SendSkip[] = [];
  const seen = new Set<string>();
  for (const i of items) {
    if (seen.has(i.id)) continue;
    seen.add(i.id);
    if (i.id.startsWith('dir:')) skip.push({ id: i.id, why: 'folder' });
    else if ((i.state && i.state !== 'live') || i.deletedAt != null) skip.push({ id: i.id, why: 'gone' });
    else if (i.why) skip.push({ id: i.id, why: 'locked' });
    else if (i.room && i.room !== room) skip.push({ id: i.id, why: 'room' });
    else refs.push({ id: i.id, name: i.name, size: i.size, team, room: i.room });
  }
  return { refs, skip };
}

/** 뺀 것 한 줄(보낸 뒤 보관함 알림 줄) — 없으면 빈 글 */
export function sendNote(skip: SendSkip[]): string {
  if (!skip.length) return '';
  const room = skip.filter((s) => s.why === 'room').length;
  return room === skip.length
    ? tr(`다른 대화 파일 ${room}개는 그 대화 사람만 열 수 있어 뺐어요 — 대화 칸에 끌어 놓으면 다시 올려 붙여요`, `Left out ${room} file(s) from another chat — only its members can open them. Drag them onto the chat to re-upload`)
    : tr(`${skip.length}개는 못 보내서 뺐어요(잠긴 파일·폴더·다른 대화 파일)`, `Left out ${skip.length} item(s) that can't be sent (locked, folders, other chats' files)`);
}

/** 보낼 곳 — 이 팀 팀챗(단톡방) 먼저, 그다음 DM. 같은 대화는 한 번, 받을 곳(방·상대)이 없는 줄은 뺀다 */
export function chatTargets(cs: Convo[]): Convo[] {
  const seen = new Set<string>();
  const ok = cs.filter((c) => (c.room || c.peer) && !seen.has(c.key) && seen.add(c.key));
  return [...ok.filter((c) => c.kind === 'group'), ...ok.filter((c) => c.kind !== 'group')];
}
