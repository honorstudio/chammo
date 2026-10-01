// 스페이스 것(파일 카드·파일/폴더·문서·세션·참모)을 채팅 입력창으로 끌어다 놓기(2026-09-30 사용자).
// 웹 끌기(HTML5 drag)는 앱 창의 파일 끌어다 놓기(Tauri)가 가로채서 안 됐다 — 마우스를 직접 따라간다.
// 조금(5px) 움직이기 전엔 그냥 클릭이다
import { attachToChat } from '../fileDrop';

export const PATH_MIME = 'text/x-chammo-path'; // 옛 웹 끌기(남은 곳 호환)

export type DragPayload = { kind: 'path'; path: string } | { kind: 'text'; text: string };

/** 채팅 입력칸에 글을 넣는 신호 — ChatView 가 받는다 */
export const CHAT_INSERT = 'chat-insert';

function chatAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const cell = el?.closest<HTMLElement>('.office-chats .cell[data-session]');
  return cell && !cell.classList.contains('behind') ? cell.dataset.session ?? null : null;
}

function drop(id: string, p: DragPayload) {
  if (p.kind === 'path') attachToChat(id, [p.path]);
  else window.dispatchEvent(new CustomEvent(CHAT_INSERT, { detail: { id, text: p.text } }));
}

function start(e: React.PointerEvent, payload: DragPayload, label: string) {
  if (e.button !== 0) return;
  const x0 = e.clientX, y0 = e.clientY;
  let ghost: HTMLDivElement | null = null;
  let hot: HTMLElement | null = null;
  const light = (el: HTMLElement | null) => { if (hot === el) return; hot?.classList.remove('drop-hot'); el?.classList.add('drop-hot'); hot = el; };
  const move = (ev: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      ghost = document.createElement('div');
      ghost.className = 'cv-drag-ghost';
      ghost.textContent = label;
      document.body.appendChild(ghost);
      document.documentElement.classList.add('cv-dragging');
    }
    ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 10}px)`;
    const id = chatAt(ev.clientX, ev.clientY);
    light(id ? document.querySelector<HTMLElement>(`.office-chats .cell[data-session="${CSS.escape(id)}"] .chat`) : null);
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (!ghost) return; // 그냥 클릭
    ghost.remove();
    document.documentElement.classList.remove('cv-dragging');
    light(null);
    // 끌기 끝의 클릭은 삼킨다(카드가 열리지 않게)
    const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0); // 클릭이 안 오면 다음 진짜 클릭을 먹지 않게
    const id = chatAt(ev.clientX, ev.clientY);
    if (id) drop(id, payload);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/** 끌 수 있게 — 요소에 펼쳐 넣는다 */
export function dragProps(payload: DragPayload, label: string) {
  if (payload.kind === 'path' && payload.path.startsWith('data:')) return {};
  return { onPointerDown: (e: React.PointerEvent) => start(e, payload, label) };
}

/** 파일·폴더 경로 끌기 */
export const dragPath = (path: string) => dragProps({ kind: 'path', path }, path.split('/').pop() || path);
