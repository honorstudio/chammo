// 있던 프로젝트(clone 한 저장소)에 이 프로젝트 브라우저(chammo-browser) 붙이기 — GitHub #2.
// 앱(Rust browser_attach)이 저장소 .mcp.json 은 안 건드리고 ~/.claude.json 의 그 프로젝트 local 칸에 적는다.
// 버튼(프로젝트 화면 머리줄·스페이스 프로젝트 대시보드)과 결정 대기함 카드(task send·scripts/app browser need 가 올림)가 여기 판단을 쓴다
import { tr } from '../i18n';

/** Rust BrowserLink 와 같은 모양 */
export type BrowserLink = {
  available: boolean;
  connected: boolean;
  /** 도구 이름 mcp__<name>__… */
  name: string;
  /** local(앱이 붙임) | project(저장소 .mcp.json — 새 프로젝트) */
  scope: string;
  /** 저장소 등에 다른 'playwright' 가 있다 — 같이 뜬다 */
  other: boolean;
  added: boolean;
};

export type BrowserNeed = { dir: string; session: string; why: string; at: number };

const MAX = 5;
const norm = (d: string) => d.replace(/\/+$/, '');

/** 같은 폴더는 한 장 — 새 것으로 바꿔 맨 위로 */
export function addNeed(list: BrowserNeed[], n: BrowserNeed): BrowserNeed[] {
  const x = { ...n, dir: norm(n.dir) };
  return [x, ...list.filter((l) => l.dir !== x.dir)].slice(0, MAX);
}

/** '브라우저 연결' 버튼 — 브라우저 자동화가 깔려 있고 아직 안 붙었을 때만(안 깔렸으면 설정의 '설치'가 먼저) */
export const showButton = (l: BrowserLink | null): boolean => !!l && l.available && !l.connected;

/** 붙인 뒤 한 줄 — running = 그 폴더에 떠 있는 세션 수(다시 켜야 붙는다) */
export function attachNote(l: BrowserLink, running: number): string {
  if (!l.added) return tr(`이미 붙어 있어요 — mcp__${l.name}`, `Already connected — mcp__${l.name}`);
  const parts = [tr(`브라우저를 붙였어요 — mcp__${l.name}`, `Browser connected — mcp__${l.name}`)];
  if (l.other) parts.push(tr('저장소의 playwright 도 그대로 같이 떠요', "The repo's own playwright still starts too"));
  if (running > 0) parts.push(tr(`떠 있는 세션 ${running}개는 다시 켜야 붙어요`, `Restart the ${running} running session(s) to pick it up`));
  return parts.join(' · ');
}

export const projectName = (dir: string) => norm(dir).split('/').pop() || dir;
