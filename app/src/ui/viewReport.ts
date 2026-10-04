// 지금 보는 화면 조각을 모아 한 줄로 적는다(domain/viewNow) — 앱·스페이스·하니터가 각자 자기 조각만 알린다.
// 같은 줄이면 안 쓰고, 연달아 바뀌면 0.3초 모아서 한 번 쓴다
import { invoke } from '@tauri-apps/api/core';
import { viewLine, type ViewParts } from '../domain/viewNow';

const parts: ViewParts = {};
let last = '';
let timer: number | undefined;

export function reportView(p: Partial<ViewParts>): void {
  let changed = false;
  for (const [k, v] of Object.entries(p) as [keyof ViewParts, string | undefined][]) {
    if (parts[k] !== v) { parts[k] = v; changed = true; }
  }
  if (!changed) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    const line = viewLine(parts);
    if (line === last) return;
    last = line;
    void invoke('write_view', { text: line }).catch(() => {});
  }, 300);
}
