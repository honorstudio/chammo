// 키즈 보호자 채팅 E2E(11-17) — 진짜 ChatView(보호자 세션 기록) + useKidsChat(아이 세션 기록, 가짜 kids_log)로 두 세션이 한 줄기에 시각 순으로 끼는지.
// ?off=1 이면 키즈 모드 꺼짐(지금과 똑같아야 한다)
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

const w = window as unknown as { __TAURI_INTERNALS__: unknown };
const off = new URLSearchParams(location.search).get('off');
const T = Math.max(Date.now() - 600_000, new Date().setHours(0, 0, 0, 1)); // 오늘 안 — '오늘 만든 것' 카드가 뜨게
const iso = (ms: number) => new Date(ms).toISOString();
const L = (o: object) => JSON.stringify(o);
const log = [
  L({ type: 'user', uuid: 'u1', timestamp: iso(T), origin: { kind: 'human' }, message: { role: 'user', content: '서아 오늘 뭐 했어?' } }),
  L({ type: 'assistant', uuid: 'a1', timestamp: iso(T + 300_000), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: '오늘은 공룡 점프 게임을 만들고 두 마리로 고쳤어요. 기록은 아래에 이어서 보여요.' }] } }),
];
const rows = [
  { ts: T + 60_000, who: 'app', text: '아이 세션 켬' },
  { ts: T + 120_000, who: 'kid', text: '공룡이 점프하는 게임 만들어 줘', cid: 'c1' },
  { ts: T + 125_000, who: 'assistant', text: '좋아! 공룡 점프 게임을 만들었어. 톡 누르면 공룡이 껑충 뛰어.' },
  { ts: T + 200_000, who: 'kid', text: '공룡 두 마리로 해 줘', cid: 'c2' },
  { ts: T + 126_000, who: 'app', text: '만들기 dino: 공룡이 점프하는 게임' },
  { ts: T + 204_000, who: 'assistant', text: '두 마리가 됐어! 빨간색도 해 볼까?' },
  { ts: T + 205_000, who: 'app', text: '고치기 dino: 공룡 두 마리로' },
  { ts: T + 250_000, who: 'guardian', text: '튜닝: 공룡 좋아해' },
];
w.__TAURI_INTERNALS__ = {
  invoke: async (cmd: string) => {
    if (cmd === 'kids_read') return { on: !off, orchs: { '참모-5': { child: '서아', age: 5, since: 1 } }, time: { '참모-5': { usedMs: 12 * 60_000, limitMs: 20 * 60_000, leftMs: 8 * 60_000 } } };
    if (cmd === 'kids_works') return [{ name: 'dino', title: '공룡 점프', mtime: T + 205_000 }];
    if (cmd === 'kids_work') return '<!doctype html><body style="margin:0;display:grid;place-items:center;height:100vh;background:#e8f4ea;font:48px sans-serif"><div id="w">공룡 점프</div></body>';
    if (cmd === 'kids_log') return (window as unknown as { __rows?: unknown[] }).__rows ?? rows; // 끝에서 끝 — 진짜 아이 세션 기록(run.mjs KIDS_ROWS)
    return [];
  },
  transformCallback: () => 0,
  convertFileSrc: (p: string) => p,
};
const noop = () => {};
const readFn = async (_sid: string, from?: number) => ({ text: from ? '' : log.join('\n'), next: log.length + 1, reset: !from, start: 0 });

(async () => {
  await import('@src/ui/layers.css');
  await import('@src/ui/styles.css');
  const { ChatView } = await import('@src/ui/chat/ChatView');
  const { useKidsChat } = await import('@src/ui/kids/useKidsChat');
  const orch = { id: 'o5', sessionId: 's5', name: '참모-5 · 선생님', cwd: '/u/hq', state: 'done', status: 'idle', kind: 'background' } as never;
  function App() {
    const [ ] = useState(0);
    const kids = useKidsChat([orch], !off);
    return (
      <div className="cell" style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
        <ChatView sessionId="s5" paneId="p5" state="done" send={async () => true} interrupt={noop} onTerminal={noop} submitTerminal={noop} pasteImage={noop} clearTerminal={noop}
          sendQueuedNow={noop} cutTurn={async () => ({ cut: true, via: 'interrupt', lost: [] })} rawKeys={async () => {}}
          readFn={readFn} screen={() => ({ lines: ['', '> ', ''], cursor: [1, 2] })} ctx={20} link="live" extra={kids.extraOf(orch)} notice={kids.todayOf(orch)} />
      </div>
    );
  }
  createRoot(document.getElementById('root')!).render(<App />);
})();
