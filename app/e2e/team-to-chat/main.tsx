// 팀 보관함 → 팀챗 — 앱과 같은 겹침(참모 채팅 칸 .office-chats 안 .och-card 위를 팀챗 덮개 .och-remote 가 덮는다) 안에 진짜 TeamConvo,
// 오른쪽 스페이스에 진짜 TeamLocker. ?phone=1 이면 진짜 PhoneTeamLocker. 앱 명령은 /__invoke 로 가짜 맥에
import { createRoot } from 'react-dom/client';
import type { Convo, TeamFile } from '../../src/domain/teamChat';

const w = window as unknown as { __TAURI_INTERNALS__: unknown; __sent: string[]; __say: { to: string; at: number; files: TeamFile[] }[] };
w.__sent = [];
w.__say = [];
w.__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: unknown) => {
    const r = await fetch('/__invoke', { method: 'POST', body: JSON.stringify({ cmd, args }) });
    const j = await r.json() as { v?: unknown; e?: string };
    if (!r.ok) throw j.e;
    return j.v;
  },
  transformCallback: () => 0,
  convertFileSrc: (p: string) => p,
};
// 켜져 있는 내 참모 하나(밑에 숨은 참모 채팅 칸과 같은 id) — 고치기 전엔 팀챗에 놓은 파일이 이 참모에게 갔다
localStorage.setItem('chammo.orchRoster.v1', JSON.stringify([{ id: 'orch-1', owner: '참모', label: '참모', color: '#3a7', busy: false }]));

const TEAM = 't-3k';
const ROOM: Convo = { key: 'room:r1', room: 'r1', peer: '', name: '회의방', last: null, unread: 0, color: '#2a8f84', kind: 'group', people: 3, members: ['m-me', 'm-b', 'm-c'] };
const CHATS: Convo[] = [ROOM, { key: 'room:r2', room: 'r2', peer: '', name: '디자인팀', last: null, unread: 0, color: '#7456cf', kind: 'group', people: 2 }, { key: 'dm:m-b', room: '', peer: 'm-b', name: '비비', last: null, unread: 0, color: '#c0692a', kind: 'dm' }];
const MEMBERS = [{ id: 'm-me', name: '사용자', role: 'owner', me: true }, { id: 'm-b', name: '비비', role: 'member', me: false }, { id: 'm-c', name: '씨씨', role: 'member', me: false }];
const noop = () => {};

async function desk() {
  await import('../../src/ui/layers.css');
  await import('../../src/ui/styles.css');
  await import('../../src/ui/space/space.css');
  const { TeamLocker } = await import('../../src/ui/team/TeamLocker');
  const { TeamConvo } = await import('../../src/ui/team/TeamConvo');
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', background: 'var(--surface)' }}>
      <div className="office-chats left" style={{ flex: '0 0 560px', width: 560, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <div className="och-card" style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div className="cell" data-session="orch-1" style={{ flex: 1 }}>숨은 참모 채팅</div>
          <div className="och-remote">
            <div className="tmc"><div className="tmc-main" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              <TeamConvo convo={ROOM} items={[]} team="우리팀" myName="사용자" handed={{}} onRead={noop} onHanded={noop} onSent={noop} teamId={TEAM} members={MEMBERS} agentsApi={null} thumb={async () => null} />
            </div></div>
          </div>
        </div>
      </div>
      <div className="space cv" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TeamLocker teamId={TEAM} team="우리팀" people={3} follow onFollow={noop} tail={<></>} chats={CHATS} onChatSent={(c) => w.__sent.push(c.key)} />
      </div>
    </div>
  );
}

async function phone() {
  await import('../../src/ui/mobile/mobile.css');
  const { PhoneTeamLocker } = await import('../../src/ui/mobile/PhoneTeamLocker');
  const { sendAllowed } = await import('../../src/domain/remoteChat');
  const v = await (await fetch('/__invoke', { method: 'POST', body: JSON.stringify({ cmd: 'team_locker_list', args: {} }) })).json() as { v: never };
  const api = { locker: async () => v.v, lockerOp: async () => ({}), lockerPut: async () => ({}) } as never;
  // 폰 사람 손 문 — PhoneTeam 의 say 와 같다(누른 지 1.5초 안)
  const say = (to: string, _t: string, at: number, extra?: { files?: TeamFile[] }) => (sendAllowed(at, Date.now()) ? (w.__say.push({ to, at, files: extra?.files ?? [] }), Promise.resolve({ room: 'r1', seq: 7 })) : null);
  return (
    <div className="m-app"><div className="m-dash">
      <PhoneTeamLocker api={api} teamId={TEAM} chats={CHATS} say={say} onChatSent={(c) => w.__sent.push(c.key)} />
    </div></div>
  );
}

const isPhone = new URLSearchParams(location.search).has('phone');
void (isPhone ? phone() : desk()).then((el) => createRoot(document.getElementById('root')!).render(el));
