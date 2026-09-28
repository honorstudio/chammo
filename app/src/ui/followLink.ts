import { invoke } from '@tauri-apps/api/core';
import { openTarget } from '../data/tauri';
import { routeOf, type Opened } from '../domain/links';

/** 링크 열기 — 웹은 기본 브라우저, 문서는 리더(패널이 열린다), 나머지는 기본 앱. 터미널·리더가 같이 쓴다 */
export function followLink(o: Opened | null) {
  if (!o) return;
  const r = routeOf(o);
  if (r === 'browser') void openTarget('url', o.target).catch(() => {});
  else if (r === 'reader') void invoke('reader_open', { paths: [o.target] }).catch(() => {});
  else void openTarget('file', o.target).catch(() => {});
}
