// 대기 말풍선 — 사용자 캡처(11-17 41.png)와 같은 장면: 일하는 참모 채팅에 말을 연달아 보낸다. ?phone=1 이면 폰 MessageList.
// 기록은 window.__log(jsonl 줄)에서 읽고, 보내면 가짜 세션이 대기열(enqueue)에 올린다 — 그림 붙인 말은 경로를 앞에 붙여(진짜와 같이).
// 시계는 window.__skew 만큼 당긴다(30초 '전달 안 됨' 판정을 기다리지 않고 본다).
// 11-17 '못 갔다' 장면: __link(세션 칸 붙음 — 'gone' = 세션이 꺼짐) · __outcome(앱 치기 결과 — 'stuck' = 다시 쳐 봐도 입력칸에 그대로) · __rerender
// · ?phone=fail 이면 폰에 못 보낸 말 + Claude 오류로 답을 못 받은 말
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

type W = { __TAURI_INTERNALS__: unknown; __log: string[]; __skew: number; __sent: string[]; __cut: number; __keys: string[][]; __dead: boolean; __state: string; __link: string; __outcome: string; __rerender?: () => void };
const w = window as unknown as W;
w.__log = []; w.__skew = 0; w.__sent = []; w.__cut = 0; w.__keys = []; w.__dead = false; w.__state = 'working'; w.__link = 'live'; w.__outcome = '';
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + w.__skew;
w.__TAURI_INTERNALS__ = {
  invoke: async () => [], // 할 일·명령 목록 같은 목록 답 — null 이면 ChatView 가 .length 에서 죽는다
  transformCallback: () => 0,
  convertFileSrc: (p: string) => p,
};
const iso = (ms: number) => new Date(ms).toISOString();
const L = (o: object) => JSON.stringify(o);
let n = 0;
const T0 = realNow() - 120_000;
const user = (text: string, at: number) => L({ type: 'user', uuid: `u${n++}`, timestamp: iso(at), origin: { kind: 'human' }, message: { role: 'user', content: text } });
const said = (text: string, at: number, end = true) => L({ type: 'assistant', uuid: `a${n++}`, timestamp: iso(at), message: { role: 'assistant', stop_reason: end ? 'end_turn' : null, content: [{ type: 'text', text }] } });
const tool = (at: number) => L({ type: 'assistant', uuid: `a${n++}`, timestamp: iso(at), message: { role: 'assistant', content: [{ type: 'tool_use', id: `t${n}`, name: 'Bash', input: { command: 'grep -rn calendar app/', description: '캘린더 연동 코드 찾기' } }] } });
w.__log.push(
  user('다음 업데이트에 캘린더 넣자', T0),
  said('좋아. 다음 스토어 업데이트(1.1.0) 때 같이 올라가게 해 볼게.\n\n- 일정 탭에 달력 보기\n- 다음 스토어 업데이트(1.1.0) 때 같이 올라가서 내보낼 거야.', T0 + 5000),
  user('그 캘린더라는게 우리 앱 전용 말하는건데?', T0 + 60_000),
  tool(T0 + 62_000),
);
const PATHS = '/Users/me/Documents/보관함/스크린샷\\ 2026-11-17\\ 오후\\ 2.46.46.png /Users/me/Documents/보관함/스크린샷\\ 2026-11-17\\ 오후\\ 2.46.26.png';
/** 가짜 세션 — 받은 말을 0.3초 뒤 대기열에. 죽은 세션(__dead)이면 아무것도 안 붙는다. 꺼진 칸(__link gone)이면 못 친다(false — SessionGrid sendOnLink) */
const send = async (text: string): Promise<boolean | 'stuck'> => {
  if (w.__link === 'gone') return false;
  w.__sent.push(text);
  if (w.__outcome === 'stuck') return 'stuck';
  if (w.__dead) return true;
  const at = Date.now();
  setTimeout(() => w.__log.push(L({ type: 'queue-operation', operation: 'enqueue', timestamp: iso(at + 300), sessionId: 's', content: text.includes('#img1') ? `${PATHS} ${text}` : text })), 300);
  return true;
};
const readFn = async (_sid: string, from?: number) => {
  const i = from ? from - 1 : 0;
  return { text: w.__log.slice(i).join('\n'), next: w.__log.length + 1, reset: !from };
};
const noop = () => {};

async function desk() {
  await import('@src/ui/layers.css');
  await import('@src/ui/styles.css');
  const { ChatView } = await import('@src/ui/chat/ChatView');
  const App = () => {
    const [, bump] = useState(0);
    useEffect(() => { w.__rerender = () => bump((n) => n + 1); }, []);
    return (
    <div className="cell" style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
      <ChatView sessionId="s1" paneId="p1" state={w.__state} send={send} interrupt={noop} onTerminal={noop} submitTerminal={noop} pasteImage={noop} clearTerminal={noop}
        sendQueuedNow={noop} cutTurn={async () => { w.__cut++; return { cut: true, via: 'interrupt', lost: [] }; }} rawKeys={async (k) => { w.__keys.push(k); }}
        readFn={readFn} screen={() => ({ lines: ['', '> ', ''], cursor: [1, 2] })} ctx={44} link={w.__link as 'live' | 'gone'} />
    </div>
    );
  };
  return <App />;
}

async function phone() {
  await import('@src/ui/mobile/mobile.css');
  const { MessageList } = await import('@src/ui/mobile/MessageList');
  const { parseChat } = await import('@src/domain/chat');
  const fail = new URLSearchParams(location.search).get('phone') === 'fail';
  // 못 보낸 말 장면 — 앞 턴은 Claude 과부하 오류로 끝났고(답 없음), 그 뒤 보낸 말 하나는 맥에 못 닿았다
  if (fail) w.__log.push(user('이 사진 배경 좀 밝게', realNow() - 30_000), L({ type: 'assistant', uuid: 'err1', timestamp: iso(realNow() - 20_000), isApiErrorMessage: true, message: { role: 'assistant', model: '<synthetic>', stop_reason: 'stop_sequence', content: [{ type: 'text', text: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' }] } }));
  const items = parseChat(w.__log.join('\n'));
  const first = fail
    ? [{ id: 'o9', session: 's1', text: '끝내 안 간 말', at: realNow() - 700_000, status: 'failed' as const, error: '전해지지 않았어요' }]
    : [
      { id: 'o1', session: 's1', text: '구글 캘린더 연동말하는거아님', at: realNow() - 4000, status: 'sent' as const },
      { id: 'o2', session: 's1', text: '자 보낼게 어떻게 가는지 봐봐', at: realNow() - 2000, status: 'sent' as const },
      { id: 'o3', session: 's1', text: '그러니까 제대로 간다고 액션이', at: realNow() - 500, status: 'sending' as const },
    ];
  const Phone = () => {
    const [out, setOut] = useState(first);
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
        <div className="m-log" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
          <MessageList items={items} out={out} onRetry={(id) => { w.__sent.push(`retry:${id}`); }} onDrop={(id) => setOut((o) => o.filter((m) => m.id !== id))}
            onResend={(t) => { w.__sent.push(t); setOut((o) => [...o, { id: `r${o.length}`, session: 's1', text: t, at: realNow(), status: 'sending' as const }]); }}
            live={fail ? undefined : { busy: true, line: '캘린더 연동 코드 찾기', tools: 3, secs: 16 }} />
        </div>
      </div>
    );
  };
  return <Phone />;
}

const isPhone = new URLSearchParams(location.search).has('phone');
void (isPhone ? phone() : desk()).then((el) => createRoot(document.getElementById('root')!).render(el));
