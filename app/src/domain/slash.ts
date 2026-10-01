// 채팅 입력칸 / 명령 자동완성 — 맨 앞 / 뒤 첫 단어를 치는 동안 목록을 띄우고, Tab 으로 채운다(2026-10-01 사용자: 터미널처럼 바로 떠야).
// 목록 = Claude Code 기본 명령 + 사용자·프로젝트 스킬·명령(Rust slash_commands 가 디스크에서 읽는다). 판단만 여기

import { tr } from '../i18n';

export type SlashItem = { name: string; desc: string; kind: 'builtin' | 'skill' | 'command' };

/** 지금 / 명령 이름을 치는 중이면 / 뒤 글자(빈 글자 가능), 아니면 null. 첫 줄의 첫 단어 안에 커서가 있을 때만 */
export function slashQuery(draft: string, caret: number): string | null {
  if (!draft.startsWith('/') || caret < 1) return null;
  const end = draft.search(/[\s]/);
  const nameEnd = end < 0 ? draft.length : end;
  if (caret > nameEnd) return null;
  return draft.slice(1, caret);
}

/** 앞글자 맞는 것 먼저, 그다음 가운데 맞는 것. 같은 이름은 먼저 온 하나만 */
export function matchSlash(items: SlashItem[], q: string, max = 8): SlashItem[] {
  const k = q.toLowerCase();
  const seen = new Set<string>();
  const uniq = items.filter((i) => (seen.has(i.name) ? false : (seen.add(i.name), true)));
  const head = uniq.filter((i) => i.name.toLowerCase().startsWith(k));
  const mid = uniq.filter((i) => !i.name.toLowerCase().startsWith(k) && i.name.toLowerCase().includes(k));
  return [...head, ...mid].slice(0, max);
}

/** 첫 줄 명령 이름을 그 이름으로 바꾸고 뒤에 한 칸 */
export function completeSlash(draft: string, name: string): string {
  const nl = draft.indexOf('\n');
  const rest = nl < 0 ? '' : draft.slice(nl);
  return `/${name} ${rest}`;
}

/** Claude Code 기본 명령 — 자주 쓰는 것만(2.1.28x). 설명은 짧게, 앱 언어로 */
const BUILTIN: [string, string, string][] = [
  ['clear', '대화 비우고 새로 시작', 'Clear the conversation and start fresh'],
  ['compact', '앞 대화를 요약해 컨텍스트 비우기', 'Summarize earlier conversation to free context'],
  ['model', '모델 고르기', 'Choose the model'],
  ['effort', '생각하는 정도(low~max)', 'Thinking effort (low–max)'],
  ['context', '컨텍스트 쓴 양 보기', 'Show context usage'],
  ['resume', '지난 대화 이어 가기', 'Resume a past conversation'],
  ['rewind', '앞 지점으로 되돌리기', 'Rewind to an earlier point'],
  ['memory', 'CLAUDE.md 메모리 고치기', 'Edit CLAUDE.md memory'],
  ['init', '이 폴더 CLAUDE.md 만들기', 'Create CLAUDE.md for this folder'],
  ['review', 'PR 리뷰', 'Review a pull request'],
  ['agents', '서브에이전트 관리', 'Manage subagents'],
  ['mcp', 'MCP 서버 상태', 'MCP server status'],
  ['permissions', '도구 권한', 'Tool permissions'],
  ['hooks', '훅 설정', 'Hook settings'],
  ['config', '설정', 'Settings'],
  ['status', '버전·계정·모델 상태', 'Version, account and model status'],
  ['usage', '사용량', 'Usage'],
  ['cost', '이번 대화 비용', 'Cost of this conversation'],
  ['doctor', '설치 점검', 'Check the installation'],
  ['rc', '원격 연결(Remote Control) 켜기', 'Turn on Remote Control'],
  ['fast', '빠른 모드 켜고 끄기', 'Toggle fast mode'],
  ['voice', '음성 입력', 'Voice input'],
  ['export', '대화 내보내기', 'Export the conversation'],
  ['add-dir', '작업 폴더 더하기', 'Add a working folder'],
  ['plugin', '플러그인', 'Plugins'],
  ['help', '도움말', 'Help'],
];
export const builtinSlash = (): SlashItem[] => BUILTIN.map(([name, ko, en]) => ({ name, desc: tr(ko, en), kind: 'builtin' as const }));
