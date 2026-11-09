// 진짜 내 메모 패널을 스페이스와 같은 틀(.space.cv > .cv-main + 패널)에 띄운다. ?phone=1 이면 폰 탭. 앱 명령은 /__invoke 로 가짜 저장소에
import { createRoot } from 'react-dom/client';
import { lazy, Suspense, useState } from 'react';
// 폰 앱처럼 메모 탭은 바로 들고 있다(lazy 면 첫 열기에 모듈 받기가 섞여 재기가 틀린다)
import { MemoTab } from '../../src/ui/mobile/MemoTab';
import { listSessionsRaw } from '../../src/data/web';
import '../../src/ui/layers.css';
import '../../src/ui/styles.css';
import '../../src/ui/space/space.css';

const w = window as unknown as { __TAURI_INTERNALS__: unknown; __shared: string[]; __pasted: string[] };
w.__shared = [];
w.__pasted = [];
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

const NotesSlot = lazy(() => import('../../src/ui/notes/NotesPanel').then((m) => ({ default: m.NotesSlot })));

function Desk() {
  const [open, setOpen] = useState(true);
  return (
    <div className="space cv" style={{ position: 'fixed', inset: 0 }}>
      <main className="cv-main" data-testid="main">{!open && <button onClick={() => setOpen(true)}>열기</button>}</main>
      {open && <Suspense fallback={null}><NotesSlot onClose={() => setOpen(false)} onToWindow={() => {}} onShare={(p) => { w.__shared.push(p); return true; }} onPaste={(t) => { w.__pasted.push(t); return true; }} /></Suspense>}
    </div>
  );
}

function Phone() {
  // ?tabs=1 — 폰 앱(MobileApp)처럼 탭을 바꾸면 메모 탭이 내려갔다 다시 올라온다
  const tabs = new URLSearchParams(location.search).has('tabs');
  const [tab, setTab] = useState(tabs ? 'orch' : 'notes');
  const memo = <MemoTab onShare={(p) => { w.__shared.push(p); }} onPaste={(t) => { w.__pasted.push(t); }} />;
  if (!tabs) return <div className="m-app">{memo}</div>;
  return (
    <div className="m-app">
      <nav><button data-tab="orch" onClick={() => setTab('orch')}>대화</button><button data-tab="notes" onClick={() => setTab('notes')}>메모</button></nav>
      {tab === 'notes' ? memo : <p>대화</p>}
    </div>
  );
}

const phone = new URLSearchParams(location.search).has('phone');
// 폰 요청은 기기 열쇠가 있어야 나간다(data/web call) — 가짜 서버는 열쇠를 안 본다. 받기 고리보다 먼저
if (phone) localStorage.setItem('chammo.token', 'e2e');
// ?poll=1 — 폰 앱 받기 고리처럼 3초마다 세션 목록(메모 도장이 실린다). __pause·__resume = 앱이 뒤로 갔다(타이머 멈춤) 돌아옴(kick)
if (new URLSearchParams(location.search).has('poll')) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => { clearTimeout(t); try { await listSessionsRaw(); } catch { /* 다음에 */ } t = setTimeout(() => void tick(), 3000); };
  void tick();
  Object.assign(window, { __pause: () => clearTimeout(t), __resume: () => void tick() });
}
if (phone) void import('../../src/ui/mobile/mobile.css');
createRoot(document.getElementById('root')!).render(phone ? <Phone /> : <Desk />);
