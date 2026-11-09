// 데스크톱 ?v=pc — 진짜 VideoReview + 가짜 invoke. 폰 ?v=phone — 진짜 VideoReviewSheet + 진짜 data/web(가짜 서버로)
import { createRoot } from 'react-dom/client';

const q = new URLSearchParams(location.search);
const path = '/m/film/v8.mp4';
const root = createRoot(document.getElementById('root')!);

async function pc() {
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: async (cmd: string, a: { text?: string; json?: string }) => {
      if (cmd === 'video_review_prep') return { state: 'ready', fps: 30, record: '/d/curation/film-v8-ab12.state.json' };
      if (cmd === 'read_curation_state') return (await fetch('/__desktop-load')).text();
      if (cmd === 'save_curation') { await fetch('/__desktop-save', { method: 'POST', body: JSON.stringify({ md: a.text }) }); return '/d/x.md'; }
      if (cmd === 'save_curation_state') { await fetch('/__desktop-save', { method: 'POST', body: JSON.stringify({ json: a.json }) }); return null; }
      throw new Error(`no ${cmd}`);
    },
  };
  await import('../../src/ui/styles.css');
  await import('../../src/ui/space/space.css');
  const { VideoReview } = await import('../../src/ui/space/VideoReview');
  w.__sent = [];
  root.render(
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', width: q.get('w') ? Number(q.get('w')) : '100%' }}>
      <VideoReview path={path} sendTo="영상 담당" color="#f2a65a" onClose={() => { w.__closed = true; }} onBig={() => {}} onSend={async (t) => { (w.__sent as string[]).push(t); }} />
    </div>,
  );
}

async function phone() {
  localStorage.setItem('chammo.token', 'tok');
  localStorage.removeItem('m.cursent'); // 지난 판의 '보냈어요'
  await import('../../src/ui/styles.css');
  await import('../../src/ui/mobile/mobile.css');
  const { SheetHostProvider } = await import('../../src/ui/mobile/kit');
  const { default: Sheet } = await import('../../src/ui/mobile/VideoReviewSheet');
  root.render(
    <div className="m-app" style={{ position: 'fixed', inset: 0, ['--orch-solid' as string]: '#f2a65a' }}>
      <SheetHostProvider kb={false}>
        <Sheet path={path} title="v8.mp4" orch="aaaa0001" onClose={() => { (window as unknown as Record<string, unknown>).__closed = true; }} />
      </SheetHostProvider>
    </div>,
  );
}

void (q.get('v') === 'phone' ? phone() : pc());
