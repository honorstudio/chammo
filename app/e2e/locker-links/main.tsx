// 진짜 보관함 링크 칸 — 데스크톱은 LockerPage(링크 칸 자리) + 진짜 useLockerLinks·linksApi, 폰은 PhoneLocker. ?phone=1 이면 폰. 앱 명령은 /__invoke 로 가짜 저장소에
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import '../../src/ui/layers.css';
import type { LkPlace } from '../../src/domain/lockerTree';

const w = window as unknown as { __TAURI_INTERNALS__: unknown; __opened: string[][]; __out: string[] };
w.__opened = [];
w.__out = [];
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

const DIR = '/H/Documents/Chammo/참모-2';
const SHOWN = [{ path: 'http://localhost:1420/', ts: '2026-11-06T03:38:00.000Z', by: 's-onb' }, { path: '/H/dev/x/out.html', ts: '2026-11-06T03:41:00.000Z', by: 's-onb' }];
const HELD = [{ id: 's-onb', cwd: '/H/dev/onboarding' }];
const whoOf = (by: string) => (by === 'me' ? '나' : by === 'o2' ? '참모-2' : `${by} 세션`);
const noop = () => {};

async function desk() {
  await import('../../src/ui/styles.css');
  await import('../../src/ui/space/space.css');
  const { LockerPage } = await import('../../src/ui/space/LockerPage');
  const { useLockerLinks, linksApi } = await import('../../src/ui/space/useLocker');
  const { mergeLinks, linkDoc } = await import('../../src/domain/lockerLinks');
  function Desk() {
    const [place, setPlace] = useState<LkPlace>({ kind: 'root' });
    const store = useLockerLinks({ id: 'o2', session: 'abc-1' }, true, 800);
    const links = mergeLinks(store, SHOWN);
    return (
      <div className="space cv" style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
        <div className="lk-main"><div className="lk-center">
          <LockerPage dir={DIR} place={place as Exclude<LkPlace, { kind: 'home' }>} entries={[]} log={[]} chips={{ active: [], all: [] }} projects={[]} whoOf={whoOf}
            onPlace={setPlace} onChoose={noop} onNewFolder={noop} acts={{ onOpen: noop, onSend: noop }} kit={{} as never} links={links}
            linkActs={{
              onOpen: (l, at) => { w.__opened.push([l.url, linkDoc(l, HELD), at.closest('.space') ? 'space' : 'out']); },
              onOpenOut: (l) => { w.__out.push(l.url); },
              onAdd: (url) => linksApi.linkAdd('o2', url),
              onHide: (ids, hide) => Promise.all(ids.map((id) => linksApi.linkHide('o2', id, hide))),
            }} />
        </div></div>
      </div>
    );
  }
  return <Desk />;
}

async function phone() {
  localStorage.setItem('chammo.token', 'e2e'); // 폰 요청은 기기 열쇠가 있어야 나간다 — 가짜 서버는 열쇠를 안 본다
  await import('../../src/ui/mobile/mobile.css');
  const { PhoneLocker } = await import('../../src/ui/mobile/PhoneLocker');
  const view = { items: [], hidden: [], folders: [], dirs: { '참모-2': DIR } };
  return (
    <div className="m-app"><div className="m-dash">
      <PhoneLocker owner="참모-2" view={view} shown={SHOWN} projects={[]} chips={{ active: [], all: [] }} whoOf={whoOf} onOpen={noop} onReload={noop} onUpload={async () => []} />
    </div></div>
  );
}

const isPhone = new URLSearchParams(location.search).has('phone');
void (isPhone ? phone() : desk()).then((el) => createRoot(document.getElementById('root')!).render(el));
