// 팀 보관함 → 팀챗에 보내기 단추(11-09 사용자 "팀 보관함에서 팀챗으로 파일이 안 옮겨져. 회의하는데 난감했어") — 끌기가 어려울 때.
// 누른 자리 아래에 이 팀 팀챗·DM 목록, 고르면 그 대화에 파일 첨부로 바로 보낸다(팀 R2 파일을 가리키는 참조 — 다시 받거나 올리지 않는다).
// 보내기는 사람 손 문(누른 지 1.5초 안, teamHumanSay)을 그대로 지난다 — 메뉴 항목을 누른 그 손이 증거
import { useEffect, useRef, type MouseEvent } from 'react';
import { teamHumanSay } from '../../data/teamApi';
import { sayTarget, type Convo } from '../../domain/teamChat';
import { sendBatches } from '../../domain/teamAttach';
import { chatSendPlan, chatTargets, sendNote, type SendItem } from '../../domain/teamSendChat';
import { tr } from '../../i18n';
import type { MenuItem } from '../OrchDialogs';

/** 단추 이름(aria-label·title) */
export const CHAT_SEND_LABEL = () => tr('팀챗에 보내기', 'Send to a team chat');

export function useChatSend({ teamId, chats, byId, onSent, note, menu, say = teamHumanSay }: {
  teamId: string;
  /** 이 팀 팀챗·DM — 없으면 단추를 안 보인다(대화 파일 보기) */
  chats?: Convo[];
  byId: (id: string) => SendItem | undefined;
  /** 보낸 뒤 — 그 대화를 연다 */
  onSent?: (c: Convo) => void;
  note: (s: string) => void;
  menu: (m: { x: number; y: number; items: MenuItem[] }) => void;
  say?: typeof teamHumanSay;
}) {
  // 마지막 진짜 누름·키 — 메뉴 항목을 누르는 손이 사람 손 문을 연다
  const trustedAt = useRef(0);
  useEffect(() => {
    const f = (e: Event) => { if (e.isTrusted) trustedAt.current = Date.now(); };
    window.addEventListener('pointerdown', f, true);
    window.addEventListener('keydown', f, true);
    return () => { window.removeEventListener('pointerdown', f, true); window.removeEventListener('keydown', f, true); };
  }, []);

  const send = (ids: string[], c: Convo, done?: () => void) => {
    const { refs, skip } = chatSendPlan(ids.map(byId).filter((x): x is SendItem => !!x), c.room, teamId);
    const left = sendNote(skip);
    if (!refs.length) { note(left || tr('보낼 파일이 없어요', 'Nothing to send')); return; }
    // 10장씩(받는 쪽이 10장 넘는 말의 파일을 버린다) — 한꺼번에 불러 사람 손 문을 안 넘긴다
    const ps = sendBatches('', refs).map((b) => say(sayTarget(c), '', trustedAt.current, { files: b.files }));
    if (ps.some((p) => !p)) { note(tr('직접 누른 것만 보내요 — 다시 눌러 줘', 'Only sends what you click — try again')); return; }
    note(tr(`${c.name}에 ${refs.length}개 보내는 중…`, `Sending ${refs.length} to ${c.name}…`));
    done?.();
    void Promise.all(ps).then(() => { note(left); onSent?.(c); }, (e: unknown) => note(tr(`${c.name}에 못 보냈어요 — ${String(e)}`, `Couldn't send to ${c.name} — ${String(e)}`)));
  };

  const targets = chatTargets(chats ?? []);
  /** 누른 단추 아래에 대화 고르기 — 팀챗 먼저, DM 은 줄을 띄워 */
  const open = (e: MouseEvent<HTMLElement>, ids: string[], done?: () => void) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const items: MenuItem[] = targets.map((c, k) => ({ label: c.name, sep: k > 0 && c.kind !== 'group' && targets[k - 1]!.kind === 'group', run: () => send(ids, c, done) }));
    menu({ x: Math.round(r.left), y: Math.round(r.bottom + 4), items: items.length ? items : [{ label: tr('보낼 대화가 없어요', 'No chats yet') }] });
  };
  return { on: !!chats, open, send };
}
