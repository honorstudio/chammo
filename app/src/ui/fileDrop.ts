// 파일 끌어다 놓기 — Rust(main.rs)가 창의 드래그드롭 이벤트를 window.__drop(...) 으로 넘긴다(메뉴처럼 권한 파일 없이).
// 좌표는 웹뷰 안 좌표(macOS 는 포인트 단위라 clientX/Y 와 같다). 받을 수 있는 칸 = .pane[data-drop]
import { invoke } from '@tauri-apps/api/core';
import { dropText, paneAt } from '../domain/drop';

export type DropEvent = { type: 'over' | 'drop' | 'leave'; x?: number; y?: number; paths?: string[] };

/** 칸이 이 이벤트를 받으면 자기 xterm 에 붙여넣는다 (TerminalPane) */
export const DROP_EVENT = 'honor-drop';

function targetAt(x: number, y: number): HTMLElement | null {
  const els = [...document.querySelectorAll<HTMLElement>('.pane[data-drop]')];
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
  w.__drop = (e) => {
    if (e.type === 'leave' || e.x === undefined || e.y === undefined) return light(null);
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
    const text = dropText(e.paths ?? []);
    if (el && text) el.dispatchEvent(new CustomEvent(DROP_EVENT, { detail: text }));
  };
  return () => {
    light(null);
    delete w.__drop;
  };
}
