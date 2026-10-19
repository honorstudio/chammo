// 파일 끌어다 놓기 — Rust(main.rs)가 창의 드래그드롭 이벤트를 window.__drop(...) 으로 넘긴다(메뉴처럼 권한 파일 없이).
// 좌표는 웹뷰 안 좌표(macOS 는 포인트 단위라 clientX/Y 와 같다). 받을 수 있는 칸 = .pane[data-drop]
import { invoke } from '@tauri-apps/api/core';
import { dropText, paneAt } from '../domain/drop';
import { LOCKER_CHAT_ATTACH, LOCKER_DROP } from './space/useLocker';
import { chatDropAt, lightChat } from './space/chatDrop';

export type DropEvent = { type: 'over' | 'drop' | 'leave'; x?: number; y?: number; paths?: string[] };

/** 칸이 이 이벤트를 받으면 자기 xterm 에 붙여넣는다 (TerminalPane) */
export const DROP_EVENT = 'honor-drop';
/** 같은 칸에 놓은 파일 경로들(배열) — 채팅 판이 보내기 전 썸네일로 쓰고, 받으면 preventDefault 하고 터미널 붙여넣기도 맡는다 */
export const DROP_PATHS_EVENT = 'honor-drop-paths';
/** 스페이스 문서 편집기에 놓은 파일 — SpaceEditor 가 그림 블록으로 넣는다 */
export const DOC_DROP_EVENT = 'honor-doc-drop';
/** 세션 브라우저 크게 보기 화면에 놓은 파일(detail = {paths, x, y}) — 모달이 그 자리 파일 칸에 넣는다 */
export const AGENT_DROP_EVENT = 'honor-agent-drop';
/** 문서 편집기 위를 지나는 중(detail = {x,y}, 벗어나면 null) — 놓일 자리 줄을 그린다 */
export const DOC_OVER_EVENT = 'honor-doc-over';

function targetAt(x: number, y: number): HTMLElement | null {
  // 탭 보기에서 뒤에 숨겨 둔 창(.cell.behind)은 보이는 창과 같은 자리라 빼야 한다 — 참모1 에 놓은 파일이 참모-2 로 갔다(2026-09-30 사용자)
  const els = [...document.querySelectorAll<HTMLElement>('.pane[data-drop]')].filter((el) => !el.closest('.cell.behind'));
  const rects = els.map((el, i) => {
    const r = el.getBoundingClientRect();
    return { id: String(i), left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });
  const hit = paneAt(rects, x, y);
  return hit === null ? null : (els[Number(hit)] ?? null);
}

export function installFileDrop(): () => void {
  let lit: HTMLElement | null = null;
  const light = (el: HTMLElement | null) => {
    if (lit === el) return;
    lit?.classList.remove('drop-over');
    el?.classList.add('drop-over');
    lit = el;
  };
  const w = window as unknown as { __drop?: (e: DropEvent) => void };
  let overDoc: HTMLElement | null = null;
  w.__drop = (e) => {
    if (e.type === 'leave' || e.x === undefined || e.y === undefined) {
      overDoc?.dispatchEvent(new CustomEvent(DOC_OVER_EVENT, { detail: null }));
      overDoc = null;
      lightChat(null);
      return light(null);
    }
    // 채팅 칸 위면 어디든(머리·대화 기록·입력칸·여백) 칸 전체 강조, 놓으면 그 칸 세션 입력칸에(2026-10-12 사용자 — 입력창까지 옮겨야만 들어갔다)
    const chat = chatDropAt(e.x, e.y);
    lightChat(e.type === 'over' ? chat : null);
    if (chat) {
      light(null);
      if (e.type === 'drop' && e.paths?.length) attachToChat(chat.id, e.paths);
      return;
    }
    // 스페이스 문서 편집기 위면 그림 블록으로(BlockNote 는 창이 가로챈 파일 끌기를 못 받는다 — 2026-10-01 사용자)
    const doc = (document.elementFromPoint(e.x, e.y) as HTMLElement | null)?.closest<HTMLElement>('.space-editor') ?? null;
    if (overDoc && overDoc !== doc) { overDoc.dispatchEvent(new CustomEvent(DOC_OVER_EVENT, { detail: null })); overDoc = null; }
    if (doc) {
      if (e.type === 'over') { overDoc = doc; doc.dispatchEvent(new CustomEvent(DOC_OVER_EVENT, { detail: { x: e.x, y: e.y } })); return; }
      overDoc = null;
      doc.dispatchEvent(new CustomEvent(DOC_OVER_EVENT, { detail: null }));
      if (e.paths?.length) doc.dispatchEvent(new CustomEvent(DOC_DROP_EVENT, { detail: { paths: e.paths, x: e.x, y: e.y } }));
      return;
    }
    // 세션 브라우저 크게 보기 화면 위면 그 페이지에 놓는다(모달이 앱 창 전체를 덮으니 다른 칸보다 먼저)
    const abm = (document.elementFromPoint(e.x, e.y) as HTMLElement | null)?.closest<HTMLElement>('.abm-screen') ?? null;
    if (abm) {
      if (e.type === 'over') return light(abm);
      light(null);
      if (e.paths?.length) abm.dispatchEvent(new CustomEvent(AGENT_DROP_EVENT, { detail: { paths: e.paths, x: e.x, y: e.y } }));
      return;
    }
    // 파일 보관함 칸·폴더 위면 보관함에 넣는다(그 폴더 열쇠는 data-locker-drop)
    const lk = (document.elementFromPoint(e.x, e.y) as HTMLElement | null)?.closest<HTMLElement>('[data-locker-drop]') ?? null;
    if (lk) {
      if (e.type === 'over') return light(lk);
      light(null);
      if (e.paths?.length) window.dispatchEvent(new CustomEvent(LOCKER_DROP, { detail: { paths: e.paths, folder: lk.dataset.lockerDrop ?? '' } }));
      return;
    }
    // 리더 패널 위면 파일을 탭으로 연다(터미널 붙여넣기 대신)
    const reader = (document.elementFromPoint(e.x, e.y) as HTMLElement | null)?.closest<HTMLElement>('.reader-panel') ?? null;
    if (reader) {
      if (e.type === 'over') return light(reader);
      light(null);
      if (e.paths?.length) void invoke('reader_open', { paths: e.paths });
      return;
    }
    const el = targetAt(e.x, e.y);
    if (e.type === 'over') return light(el);
    light(null);
    if (el && e.paths?.length) pastePaths(el, e.paths);
  };
  return () => {
    light(null);
    delete w.__drop;
  };
}

/** 파일을 그 세션 채팅에 붙인다 — 끌어다 놓기와 똑같이(터미널 입력칸에 경로, 채팅엔 #img·#file 이름표). 스페이스 미리보기·문서의 "채팅에 붙이기" */
export function attachToChat(sessionId: string, paths: string[]): boolean {
  const el = document.querySelector<HTMLElement>(`.cell[data-session="${CSS.escape(sessionId)}"] .pane[data-drop]`);
  if (!el || !paths.length) return false;
  pastePaths(el, paths);
  return true;
}

/** 칸에 경로들을 넣는다 — 채팅 판이 받으면(preventDefault) 그쪽이 이름표를 매겨 칩 글(#file1 "…")로 붙여넣고, 없으면 iTerm 처럼 셸 이스케이프로 */
function pastePaths(el: HTMLElement, paths: string[]) {
  const took = !el.dispatchEvent(new CustomEvent(DROP_PATHS_EVENT, { detail: paths, cancelable: true }));
  if (!took) el.dispatchEvent(new CustomEvent(DROP_EVENT, { detail: dropText(paths) }));
  chatAttached(el, paths);
}

/** 채팅에 붙인 파일 — 그 칸이 참모면 보관함에도(SpaceView 가 참모인지 보고 넣는다) */
function chatAttached(pane: HTMLElement, paths: string[]) {
  const session = pane.closest<HTMLElement>('.cell[data-session]')?.dataset.session;
  if (session && paths.length) window.dispatchEvent(new CustomEvent(LOCKER_CHAT_ATTACH, { detail: { session, paths } }));
}
