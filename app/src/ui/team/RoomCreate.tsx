// 단톡방 만들기·바꾸기(시안 msg-rooms R) — 이름 + 팀 사람 고르기. 나는 늘 들어간다. 바꾸기는 지금 방 사람을 체크해 둔 채로 연다
import { useState } from 'react';
import { teamRoomNew, teamRoomSet } from '../../data/teamApi';
import { personColor } from '../../domain/teamChat';
import { tr } from '../../i18n';
import { PersonOf } from './TeamFaces';
import './team.css';

type M = { id: string; name: string; me: boolean };

export function RoomCreate({ team, members, room, onDone, onCancel, make = teamRoomNew, set = teamRoomSet }: {
  /** 팀 id */
  team: string;
  members: M[];
  /** 바꾸기 — 지금 방(id·이름·사람). 없으면 만들기 */
  room?: { id: string; name: string; members: string[] };
  onDone: (room: string) => void;
  onCancel: () => void;
  make?: typeof teamRoomNew;
  set?: typeof teamRoomSet;
}) {
  const others = members.filter((m) => !m.me);
  const [name, setName] = useState(room?.name ?? '');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(room ? room.members : []));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ok = name.trim().length > 0 && [...name.trim()].length <= 40 && (room || picked.size > 0);
  const submit = () => {
    if (!ok || busy) return;
    setBusy(true);
    setErr(null);
    const p = room
      ? set(room.id, name.trim() === room.name ? '' : name.trim(), others.filter((m) => picked.has(m.id) && !room.members.includes(m.id)).map((m) => m.id), others.filter((m) => !picked.has(m.id) && room.members.includes(m.id)).map((m) => m.id)).then(() => room.id)
      : make(team, name.trim(), [...picked]).then((r) => r.room);
    void p.then(onDone, (e: unknown) => setErr(String(e))).finally(() => setBusy(false));
  };
  return (
    <div className="tmx-rc" role="group" aria-label={room ? tr('팀챗 바꾸기', 'Edit team chat') : tr('팀챗 만들기', 'New team chat')}>
      <h3>{room ? tr('팀챗 바꾸기', 'Edit team chat') : tr('팀챗 만들기', 'New team chat')}</h3>
      <input type="text" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} placeholder={tr('팀챗 이름', 'Team chat name')} aria-label={tr('팀챗 이름', 'Team chat name')}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); }} />
      <div className="tmx-rc-ppl">
        {others.length === 0 && <div className="tmx-none tmx-sm">{tr('팀에 다른 사람이 아직 없어요', 'No one else in the team yet')}</div>}
        {others.map((m) => (
          <label key={m.id}>
            <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} />
            <PersonOf member={m.id} name={m.name} color={personColor(m.name)} size={24} />
            <span>{m.name}</span>
          </label>
        ))}
      </div>
      {err && <div className="tmx-err" role="alert">{err}</div>}
      <div className="tmx-rc-a">
        <button className="tmx-btn" onClick={onCancel}>{tr('취소', 'Cancel')}</button>
        <button className="tmx-btn pri" disabled={!ok || busy} aria-busy={busy} onClick={submit}>{busy ? (room ? tr('바꾸는 중', 'Saving') : tr('만드는 중', 'Creating')) : room ? tr('바꾸기', 'Save') : tr('만들기', 'Create')}</button>
      </div>
    </div>
  );
}
