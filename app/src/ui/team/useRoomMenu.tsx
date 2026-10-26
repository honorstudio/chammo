// 대화 목록 우클릭 메뉴(10-26 사용자 "팀챗을 지울 수가 없다") — 무엇을 보일지는 domain/teamRoomMenu.
// 이름·사람 = 팀챗 바꾸기 겹창(RoomCreate) 그대로, 나가기·지우기 = 글자 확인 창. 지우기는 만든 사람·팀장만 —
// 팀장은 바로, 팀원은 메뉴를 열 때 명부로 만든 사람인지 본다(team_ui_room_info, 방마다 한 번)
import { useRef, useState } from 'react';
import { teamRoomDelete, teamRoomInfo, teamRoomLeave } from '../../data/teamApi';
import type { Convo } from '../../domain/teamChat';
import { hiddenKey, hideDm, roomActs, type HiddenDms, type RoomAct } from '../../domain/teamRoomMenu';
import { tr } from '../../i18n';
import { Confirm, ContextMenu, type MenuItem } from '../OrchDialogs';

const loadHidden = (team: string): HiddenDms => {
  try { return JSON.parse(localStorage.getItem(hiddenKey(team)) ?? '{}') as HiddenDms; } catch { return {}; }
};

export function useRoomMenu(o: { teamId: string; owner: boolean; onEdit: (room: string) => void; onChanged: () => void; onGone: (c: Convo) => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number; c: Convo; can: boolean } | null>(null);
  const [ask, setAsk] = useState<{ act: 'leave' | 'delete'; c: Convo } | null>(null);
  const [fail, setFail] = useState<{ title: string; body: string } | null>(null);
  const [hidden, setHidden] = useState<{ team: string; h: HiddenDms }>(() => ({ team: o.teamId, h: loadHidden(o.teamId) }));
  if (hidden.team !== o.teamId) setHidden({ team: o.teamId, h: loadHidden(o.teamId) });
  const can = useRef(new Map<string, boolean>());

  const open = (e: React.MouseEvent, c: Convo) => {
    const at = { x: e.clientX, y: e.clientY };
    if (c.kind !== 'group' || o.owner) { setMenu({ ...at, c, can: o.owner }); return; }
    const known = can.current.get(c.room);
    if (known != null) { setMenu({ ...at, c, can: known }); return; }
    void teamRoomInfo(c.room).then((i) => { can.current.set(c.room, i.canDelete); return i.canDelete; }, () => false).then((ok) => setMenu({ ...at, c, can: ok }));
  };
  const hide = (c: Convo) => {
    const h = hideDm(hidden.h, c.peer, Date.now());
    setHidden({ team: o.teamId, h });
    try { localStorage.setItem(hiddenKey(o.teamId), JSON.stringify(h)); } catch { /* 이번 실행만 */ }
    o.onGone(c);
  };
  const run = (act: 'leave' | 'delete', c: Convo) => {
    setAsk(null);
    const p = act === 'delete' ? teamRoomDelete(c.room) : teamRoomLeave(c.room);
    void p.then(() => { can.current.delete(c.room); o.onGone(c); o.onChanged(); }, (e: unknown) =>
      setFail({ title: act === 'delete' ? tr(`${c.name} 팀챗을 못 지웠어요`, `Couldn't delete ${c.name}`) : tr(`${c.name} 팀챗에서 못 나갔어요`, `Couldn't leave ${c.name}`), body: String(e) }));
  };
  const label: Record<RoomAct, string> = {
    edit: tr('이름·사람 바꾸기', 'Edit name and people'),
    leave: tr('나가기', 'Leave'),
    delete: tr('지우기', 'Delete'),
    hide: tr('목록에서 숨기기', 'Hide from list'),
  };
  const items = (c: Convo, ok: boolean): MenuItem[] => roomActs(c.kind ?? 'dm', ok).map((k) => ({
    label: label[k],
    danger: k === 'delete' || undefined,
    sep: k === 'leave' || undefined,
    run: k === 'edit' ? () => o.onEdit(c.room) : k === 'hide' ? () => hide(c) : () => setAsk({ act: k as 'leave' | 'delete', c }),
  }));

  const node = (
    <>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items(menu.c, menu.can)} onClose={() => setMenu(null)} />}
      {ask?.act === 'leave' && (
        <Confirm title={tr(`${ask.c.name} 팀챗에서 나갈까요?`, `Leave ${ask.c.name}?`)} body={tr('이 기기 목록에서 사라지고, 다시 들어오려면 방 사람이 더해 줘야 해요.', 'It leaves your list. Someone in the chat has to add you back.')}
          ok={tr('정말 나가기', 'Leave')} danger onCancel={() => setAsk(null)} onOk={() => run('leave', ask.c)} />
      )}
      {ask?.act === 'delete' && (
        <Confirm title={tr(`${ask.c.name} 팀챗을 지울까요?`, `Delete ${ask.c.name}?`)} body={tr('모든 사람의 목록에서 사라지고 대화도 지워져요. 되돌릴 수 없어요.', 'It disappears for everyone, with all its messages. This cannot be undone.')}
          ok={tr('정말 지우기', 'Delete')} danger onCancel={() => setAsk(null)} onOk={() => run('delete', ask.c)} />
      )}
      {fail && <Confirm title={fail.title} body={fail.body} ok={tr('확인', 'OK')} onCancel={() => setFail(null)} onOk={() => setFail(null)} />}
    </>
  );
  return { open, node, hidden: hidden.h };
}
