// 진짜 BrowserMemCap + 가짜 앱 명령(값 검사는 Rust browser_memcap_set 과 같은 규칙) — run.mjs 가 window.__calls 로 저장을 본다
import { createRoot } from 'react-dom/client';
import '../../src/ui/layers.css';
import '../../src/ui/styles.css';
import '../../src/ui/setup.css';

let caps = { profileGb: 6, totalGb: 12 };
const calls: unknown[] = [];
(window as unknown as { __calls: unknown[] }).__calls = calls;
const invoke = async (cmd: string, args: Record<string, unknown> = {}) => {
  calls.push({ cmd, args });
  if (cmd === 'browser_memcap_get') return caps;
  if (cmd === 'browser_memcap_set') {
    const c = args.caps as typeof caps;
    const ok = (v: number) => Number.isFinite(v) && v >= 0.5 && v <= 256;
    if (!ok(c.profileGb) || !ok(c.totalGb)) throw new Error('상한은 0.5~256GB');
    caps = { profileGb: c.profileGb, totalGb: Math.max(c.totalGb, c.profileGb) };
    return caps;
  }
  throw new Error(`모르는 명령 ${cmd}`);
};
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = { invoke, transformCallback: () => 0, unregisterCallback: () => {}, convertFileSrc: (p: string) => p };

const { BrowserMemCap } = await import('../../src/ui/BrowserMemCap');
createRoot(document.getElementById('root')!).render(<div className="su-rows"><div className="su-row"><div className="su-row-text"><b>참모 브라우저</b><span>설치됐어요</span></div></div><BrowserMemCap /></div>);
