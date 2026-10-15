// 스페이스 것(파일 카드·파일/폴더·문서·세션·참모)을 채팅 입력창으로 끌어다 놓기(2026-09-30 사용자).
// 웹 끌기(HTML5 drag)는 앱 창의 파일 끌어다 놓기(Tauri)가 가로채서 안 됐다 — 마우스를 직접 따라간다.
// 조금(5px) 움직이기 전엔 그냥 클릭이다
import { tr } from '../../i18n';
import { attachToChat } from '../fileDrop';
import { LOCKER_MOVE } from './useLocker';
import { chatDropAt, lightChat } from './chatDrop';
import { lostRelease } from './dragEnd';

export const PATH_MIME = 'text/x-chammo-path'; // 옛 웹 끌기(남은 곳 호환)

/** paths = 보관함에서 여럿 고른 채 그중 하나를 끈 묶음(2026-10-12) */
export type DragPayload = { kind: 'path'; path: string } | { kind: 'paths'; paths: string[] } | { kind: 'text'; text: string };

/** 채팅 입력칸에 글을 넣는 신호 — ChatView 가 받는다 */
export const CHAT_INSERT = 'chat-insert';

/** 놓을 채팅 세션 — 채팅 칸(머리·대화 기록·입력칸·카드 여백) 어디든(chatDrop, 2026-10-12 사용자) */
const chatAt = (x: number, y: number): string | null => chatDropAt(x, y)?.id ?? null;

/** 보관함 폴더 나무의 한 줄(카드를 끌어 놓으면 그 폴더로) */
function folderAt(x: number, y: number): HTMLElement | null {
  return (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-locker-folder]') ?? null;
}

/** 끌기 유령 표 + 놓을 채팅 칸 빛(칸 전체) — 스페이스 것 끌기와 띠 프사 끌기(@멘션 넣기)가 같이 쓴다. 놓으면 그 채팅 칸 세션(없으면 null) */
export function dragGhost(label: string, folders: boolean) {
  let ghost: HTMLDivElement | null = null;
  let hot: HTMLElement | null = null;
  const light = (el: HTMLElement | null) => { if (hot === el) return; hot?.classList.remove('drop-hot'); el?.classList.add('drop-hot'); hot = el; };
  return {
    get on() { return !!ghost; },
    move(x: number, y: number) {
      if (!ghost) {
        ghost = document.createElement('div');
        ghost.className = 'cv-drag-ghost';
        ghost.textContent = label;
        document.body.appendChild(ghost);
        document.documentElement.classList.add('cv-dragging');
      }
      ghost.style.transform = `translate(${x + 12}px, ${y + 10}px)`;
      // 채팅 칸 위면 칸 전체(카드) 강조, 아니면 보관함 폴더 줄
      const chat = chatDropAt(x, y);
      lightChat(chat);
      light(!chat && folders ? folderAt(x, y) : null);
    },
    hide() {
      if (!ghost) return;
      ghost.remove();
      ghost = null;
      document.documentElement.classList.remove('cv-dragging');
      light(null);
      lightChat(null);
    },
    chatAt,
  };
}

/** 채팅 입력칸에 글 넣기(멘션·명령) — ChatView 가 받아 글 끝에 붙인다 */
export const insertToChat = (id: string, text: string) => window.dispatchEvent(new CustomEvent(CHAT_INSERT, { detail: { id, text } }));

function drop(id: string, p: DragPayload) {
  if (p.kind === 'path') attachToChat(id, [p.path]);
  else if (p.kind === 'paths') attachToChat(id, p.paths);
  else insertToChat(id, p.text);
}

/** 지금 끌고 있는 것을 끝내는 함수 — 한 번에 하나만(새로 누르면 먼저 것을 끝낸다) */
let endActive: (() => void) | null = null;

function start(e: React.PointerEvent, payload: DragPayload, label: string) {
  if (e.button !== 0 || e.ctrlKey) return; // 우클릭·맥 ctrl+클릭은 끌기가 아니다(메뉴)
  endActive?.();
  const x0 = e.clientX, y0 = e.clientY;
  const files = payload.kind === 'path' ? [payload.path] : payload.kind === 'paths' ? payload.paths : null;
  const g = dragGhost(label, !!files);
  // 끝내는 길은 여기 하나 — 놓기·웹뷰가 끌기를 가져감(pointercancel)·창 밖에서 놓기·Esc·창 포커스 잃음 모두 이리 온다.
  // pointerup 하나에만 기대면 놓음 신호가 안 올 때 표가 마우스를 영영 따라다닌다(2026-10-11 사용자)
  const finish = (at: PointerEvent | null) => {
    lost.stop();
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key);
    window.removeEventListener('blur', cancel);
    if (endActive === cancel) endActive = null;
    if (!g.on) return; // 그냥 클릭
    g.hide();
    // 끌기 끝의 클릭은 삼킨다(카드가 열리지 않게)
    const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0); // 클릭이 안 오면 다음 진짜 클릭을 먹지 않게
    if (!at) return; // 취소 — 아무 데도 안 놓는다
    const id = chatAt(at.clientX, at.clientY);
    if (id) drop(id, payload);
    // 빈 글 = 보관함 맨 위(경로 줄 '보관함'·보관함 탭) — 거짓으로 거르면 맨 위로 못 옮겼다
    const folder = !id && files ? folderAt(at.clientX, at.clientY)?.dataset.lockerFolder : undefined;
    if (folder !== undefined) for (const path of files ?? []) window.dispatchEvent(new CustomEvent(LOCKER_MOVE, { detail: { path, folder } }));
  };
  const cancel = () => finish(null);
  const lost = lostRelease(cancel);
  const up = (ev: PointerEvent) => finish(ev);
  const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') finish(null); };
  const move = (ev: PointerEvent) => {
    lost.move(ev.buttons); // 버튼 0 = 뗀 뒤에 처리된 끌기 사건이거나 놓음 신호를 놓친 것 — 끌기는 이어 가며 pointerup 을 잠깐 기다린다(dragEnd)
    if (!g.on && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
    g.move(ev.clientX, ev.clientY);
  };
  endActive = cancel;
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key);
  window.addEventListener('blur', cancel);
}

/** 끌 수 있게 — 요소에 펼쳐 넣는다 */
export function dragProps(payload: DragPayload, label: string) {
  if (payload.kind === 'path' && payload.path.startsWith('data:')) return {};
  return { onPointerDown: (e: React.PointerEvent) => start(e, payload, label) };
}

/** 파일·폴더 경로 끌기 */
export const dragPath = (path: string) => dragProps({ kind: 'path', path }, path.split('/').pop() || path);

/** 여럿 고른 묶음 끌기 — 폴더에 놓으면 하나씩 옮기기 신호, 채팅에 놓으면 한꺼번에 붙인다. 하나면 dragPath 와 같다 */
export const dragPaths = (paths: string[]) => (paths.length === 1 ? dragPath(paths[0]!) : dragProps({ kind: 'paths', paths }, tr(`${paths.length}개`, `${paths.length} items`)));
