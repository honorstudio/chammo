// 참모 모드 Client 칸 — 모드의 화면 모듈(surface module)은 별도 주소의 빈 방(Rust modes.rs FRAME_HTML·FRAME_CSP)에서만 돈다.
// 방이 하는 말은 믿지 않는다: 아는 모양만 받고(frameMsg), 트리는 글로 받아 앱 렌더러 마디로 다시 짓는다(clientTree → normalize inClient)
import { IS_WIN } from './reader';
import { normalize, type TNode } from './modeTree';

/** 방 주소 — 맥 modeframe://, 윈도우 WebView2 는 http://<scheme>.localhost */
export const frameUrl = (win = IS_WIN) => (win ? 'http://modeframe.localhost/' : 'modeframe://localhost/');

/** 방 트리 글 한도 — 런타임 한도(limits.chars 기본 10만)의 두 배까지만 읽는다 */
const TREE_MAX = 200_000;
/** surface.post 한도 — 규약과 같다(10만 자) */
const POST_MAX = 100_000;

export function clientTree(text: unknown): TNode {
  if (typeof text !== 'string' || text.length > TREE_MAX) return { type: 'Cant', what: 'Client', alt: '' };
  try {
    return normalize(JSON.parse(text), 0, true);
  } catch {
    return { type: 'Cant', what: 'Client', alt: '' };
  }
}

export type FrameMsg =
  | { mf: 'ready' }
  | { mf: 'tree'; text: string }
  | { mf: 'post'; data: unknown }
  | { mf: 'fault'; phase: 'load' | 'render' | 'run'; reason: string };

/** 방에서 온 말 → 아는 모양만(나머지 null) */
export function frameMsg(d: unknown): FrameMsg | null {
  if (!d || typeof d !== 'object') return null;
  const m = d as { mf?: unknown; text?: unknown; phase?: unknown; reason?: unknown };
  switch (m.mf) {
    case 'ready':
      return { mf: 'ready' };
    case 'tree':
      return typeof m.text === 'string' ? { mf: 'tree', text: m.text } : null;
    case 'post': {
      if (typeof m.text !== 'string' || m.text.length > POST_MAX) return null;
      try {
        const data: unknown = JSON.parse(m.text);
        return data === null || data === undefined ? null : { mf: 'post', data };
      } catch {
        return null;
      }
    }
    case 'fault':
      if (m.phase !== 'load' && m.phase !== 'render' && m.phase !== 'run') return null;
      return { mf: 'fault', phase: m.phase, reason: String(m.reason ?? '').replace(/[\u0000-\u001f\u2028\u2029]/g, ' ').slice(0, 200) };
    default:
      return null;
  }
}

/** 글 보내기 홍수 막이 — 1초 창에 n 개까지(모드 호스트에 요청이 쏟아지지 않게) */
export class PostGate {
  private start = 0;
  private used = 0;
  constructor(private readonly perSecond = 20) {}
  take(now = Date.now()): boolean {
    if (now - this.start >= 1000) {
      this.start = now;
      this.used = 0;
    }
    if (this.used >= this.perSecond) return false;
    this.used++;
    return true;
  }
}
