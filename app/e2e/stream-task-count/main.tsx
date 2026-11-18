// 폰 일하는 중 줄(11-17 사용자 "59개라고 나오다가 스트리밍 끝날 때 사라짐") — 진짜 폰 MessageList 에 긴 턴(도구 59번) 뒤 답이 흘러나오는 장면
import { createRoot } from 'react-dom/client';

(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = { invoke: async () => [], transformCallback: () => 0, convertFileSrc: (p: string) => p };
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const L = (o: object) => JSON.stringify(o);
const log = [
  L({ type: 'user', uuid: 'u1', timestamp: iso(now - 75_000), origin: { kind: 'human' }, message: { role: 'user', content: '오늘 들어온 메일 정리해 줘' } }),
  L({ type: 'assistant', uuid: 'a1', timestamp: iso(now - 2_000), message: { role: 'assistant', stop_reason: null, content: [{ type: 'text', text: '메일 12통 봤어. 답이 필요한 건 세 통이야.' }] } }),
];

async function phone() {
  await import('@src/ui/mobile/mobile.css');
  const { MessageList } = await import('@src/ui/mobile/MessageList');
  const { parseChat } = await import('@src/domain/chat');
  const busy = new URLSearchParams(location.search).get('busy') !== '0';
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <div className="m-log" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
        <MessageList items={parseChat(log.join('\n'))} out={[]} onRetry={() => {}} onDrop={() => {}} onResend={() => {}}
          live={busy ? { busy: true, line: '', tools: 59, secs: 75 } : undefined} />
      </div>
    </div>
  );
}
void phone().then((el) => createRoot(document.getElementById('root')!).render(el));
