// 보안 번호 단순화 — ?view=settings 진짜 TeamSettings(팀원 목록) · ?view=convo 팀원 DM(회색 줄) · &phone=1 폰 틀 안 대화. 앱 명령은 /__invoke 로 가짜 맥에
import { createRoot } from 'react-dom/client';
import type { Convo, TeamItem } from '../../src/domain/teamChat';
import type { TeamView } from '../../src/data/teamApi';

const w = window as unknown as { __TAURI_INTERNALS__: unknown };
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

const DAY = 24 * 3600_000;
const now = Date.now();
const dev = (n: string) => [{ id: `d-${n}`, name: n }];
const VIEW: TeamView = {
  joined: true, team: '모모팀', teamId: 't-momo', me: '사용자', device: 'd-me', role: 'owner', server: '', deliverTo: '',
  members: [
    { id: 'm-me', name: '사용자', role: 'owner', me: true, devices: dev('맥북') },
    { id: 'm-js', name: '지수', role: 'member', me: false, devices: dev('지수 맥') },
    { id: 'm-mj', name: '민지', role: 'member', me: false, devices: dev('민지 윈도우') },
    { id: 'm-sh', name: '팀원', role: 'member', me: false, devices: dev('팀원 맥') },
    { id: 'm-dy', name: '도윤', role: 'member', me: false, devices: dev('도윤 맥') },
  ],
  rooms: [{ id: 'r-sh', kind: 'dm', peer: 'm-sh', with: '팀원', team: 't-momo' }],
  teams: [{ id: 't-momo', name: '모모팀', role: 'owner', current: true }], plan: null, account: null, devices: [], pending: false, pendingAutoAt: 0,
};
const DM: Convo = { key: 'dm:m-sh', room: 'r-sh', peer: 'm-sh', name: '팀원', last: null, unread: 0, color: '#c0692a', kind: 'dm' };
const item = (seq: number, member: string, person: string, body: string, at: number): TeamItem => ({ room: 'r-sh', seq, member, device: 'd', person, origin: 'human', body, at, deviceName: '', kind: 'msg', note: member === 'm-me' ? 'mine' : 'human' });
const ITEMS = [item(1, 'm-sh', '팀원', '견적서 올려 뒀어요', now - 3 * DAY), item(2, 'm-me', '사용자', '고마워요', now - 3 * DAY + 60_000), item(3, 'm-sh', '팀원', '새 맥으로 바꿨어요', now - DAY)];
const noop = () => {};
const q = new URLSearchParams(location.search);

async function page() {
  await import('../../src/ui/layers.css');
  await import('../../src/ui/styles.css');
  const { teamFeed } = await import('../../src/data/teamApi');
  const feed = await teamFeed(1);
  if (q.get('view') === 'convo') {
    const { TeamConvo } = await import('../../src/ui/team/TeamConvo');
    const phone = q.has('phone');
    if (phone) await import('../../src/ui/mobile/mobile.css');
    const convo = <TeamConvo convo={DM} items={ITEMS} team="모모팀" myName="사용자" handed={{}} onRead={noop} onHanded={noop} onSent={noop} teamId="t-momo" members={VIEW.members} safety={feed.safety} phone={phone} agentsApi={null} thumb={async () => null} />;
    return phone
      ? <div className="m-app" style={{ position: 'fixed', inset: 0 }}><div className="tmc" style={{ height: '100%', display: 'flex' }}><div className="tmc-main" style={{ flex: 1, display: 'flex', minHeight: 0 }}>{convo}</div></div></div>
      : <div style={{ position: 'fixed', inset: 0, display: 'flex', background: 'var(--surface)' }}><div className="tmc" style={{ width: 620, display: 'flex' }}><div className="tmc-main" style={{ flex: 1, display: 'flex', minHeight: 0 }}>{convo}</div></div></div>;
  }
  const { TeamSettings } = await import('../../src/ui/team/TeamSettings');
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', justifyContent: 'center', background: 'var(--surface-2)', paddingTop: 24 }}>
      <div style={{ width: 420, height: 'calc(100vh - 48px)', overflow: 'auto', background: 'var(--surface)', borderRadius: 14, boxShadow: '0 10px 28px rgba(0,0,0,.14)' }}>
        <TeamSettings view={VIEW} onClose={noop} onChanged={noop} />
      </div>
    </div>
  );
}

void page().then((el) => createRoot(document.getElementById('root')!).render(el));
