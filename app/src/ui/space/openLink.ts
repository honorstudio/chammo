import { invoke } from '@tauri-apps/api/core';
import { linkBrowser } from '../../domain/frameLink';

export type LinkDeps = {
  /** 지금 보는 참모가 맡긴 세션 — 폴더와 떠 있는 브라우저(사람이 끈 건 뺀 것) */
  held: { cwd: string; live?: { profile: string } }[];
  devRoot: () => Promise<string>;
  /** 새 탭을 연 브라우저 — 스페이스 칸을 그 브라우저로 */
  shown: (profile: string) => void;
  /** 참모 브라우저를 띄웠거나 이미 떠 있던 것(프로필) */
  hqOpened: (profile: string) => void;
  fail: (e: unknown) => void;
};

/** 시안 칸 안 링크(2026-11-05 사용자) — 그 문서 프로젝트 세션 브라우저, 없으면 참모 브라우저(안 떠 있으면 띄운다)에 새 탭으로(domain/frameLink linkBrowser). url 은 거른 것 */
export function openLinkIn(url: string, doc: string, d: LinkDeps): Promise<void> {
  const show = (p: string) => invoke('agent_open_tab', { profile: p, url }).then(() => d.shown(p));
  return d.devRoot().catch(() => '').then((root) => {
    const to = linkBrowser(doc, d.held, root);
    if (to !== 'hq') return show(to.profile);
    return invoke<string>('hq_browser_open').then((p) => { d.hqOpened(p); return show(p); });
  }).catch(d.fail);
}
