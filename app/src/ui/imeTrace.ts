import { imeDebugMode, imeLog } from '../data/tauri';

// 한글 입력 진단 — <데이터 폴더>/ime-debug.on 이 있으면 켤 때 한 번 켜진다. 0.5초마다 ime-debug.jsonl 에 몰아 쓴다.
// 터미널 한글 다리(TerminalPane)와 글칸 조합 막이(imeGuard)가 같이 쓴다. 내용에 "noswallow" 가 있으면 터미널 조합 이벤트를 막지 않고 본다
export let imeTrace: ((type: string, v: object) => void) | null = null;
export let imeNoSwallow = false;
/** ime-debug.on 내용(없으면 null) — 'bridge' 가 있으면 윈도우도 한글 다리를 건다(domain/imeBridge imeBridgeOn) */
export let imeMode: string | null = null;
void imeDebugMode().then((mode) => {
  if (mode == null) return;
  imeMode = mode;
  imeNoSwallow = mode.includes('noswallow');
  let buf: string[] = [];
  imeTrace = (type, v) => buf.push(JSON.stringify({ t: Math.round(performance.now()), type, ...v }));
  setInterval(() => { if (buf.length) { const out = buf.join('\n') + '\n'; buf = []; void imeLog(out).catch(() => {}); } }, 500);
}).catch(() => {});
