import type { MouseEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openTarget } from '../data/tauri';
import { routeOf, webHref, type Opened } from '../domain/links';
import { frameLink } from '../domain/frameLink';
import { pathOfDocUrl } from '../domain/reader';

/** 링크 열기 — 웹은 기본 브라우저, 문서는 리더(패널이 열린다), 나머지는 기본 앱. 터미널·리더가 같이 쓴다 */
export function followLink(o: Opened | null) {
  if (!o) return;
  const r = routeOf(o);
  if (r === 'browser') void openTarget('url', o.target).catch(() => {});
  else if (r === 'reader') void invoke('reader_open', { paths: [o.target] }).catch(() => {});
  else void openTarget('file', o.target).catch(() => {});
}

/** 말풍선 안 링크 누르기 — 웹뷰가 따라가지 않게 막고 웹 주소(http·https)만 기본 브라우저로. 참모 채팅·팀챗이 같이 쓴다(말 목록 onClick) */
export function openWebLink(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest('a');
  if (!a) return;
  e.preventDefault();
  const href = webHref(a.getAttribute('href'));
  if (href) void openTarget('url', href).catch(() => {});
}

/** 시안 칸(html 미리보기) 안 웹 링크 — 스페이스 칸·미리보기면 그 참모·프로젝트 참모 브라우저 새 탭(SpaceView __openLink), 그 밖(리더)은 기본 브라우저.
 *  url 은 이미 거른 것(domain/frameLink) */
export function openFrameLink(url: string, doc: string, frame: Element) {
  const w = window as unknown as { __openLink?: (url: string, doc: string, frame: Element) => boolean };
  if (w.__openLink?.(url, doc, frame)) return;
  void openTarget('url', url).catch(() => {});
}

/** 앱 창 칸이 바깥 사이트로 가려다 웹뷰에서 막혔다(Rust frame_nav — 스크립트 location·되돌아가기·PDF 링크) — 사람이 누른 칸(포커스된 iframe)이면 그 주소를 연다,
 *  아니면(저절로 넘어감) 막기만. 창마다 한 번 — 이 파일을 부르는 창(메인·리더·팀 창)이면 저절로 */
export function watchFrameNav() {
  const w = window as unknown as { __frameNav?: (url: unknown) => void };
  if (w.__frameNav) return;
  w.__frameNav = (u) => {
    const url = frameLink({ hodoc: 'link', url: u });
    const f = document.activeElement;
    if (url && f instanceof HTMLIFrameElement) openFrameLink(url, pathOfDocUrl(f.src) ?? '', f);
  };
}
if (typeof window !== 'undefined') watchFrameNav();
