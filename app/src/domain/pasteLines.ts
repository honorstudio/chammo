// 다른 앱에서 맨 글(text/plain)만 붙일 때 노션처럼 줄마다 블록(2026-11-09 사용자) — 편집기(BlockNote)는 맨 글을 md 로 읽어
// 줄바꿈 하나를 한 문단 안 줄바꿈으로 넣었다. 줄마다 빈 줄로 띄운 md 로 바꿔 넘긴다. 빈 줄은 문단 구분(빈 블록은 안 만든다).
// 그대로 두는 것: 코드 펜스 안(빈 줄도), 이어진 표 줄(한 표), 목록 항목 아래 들여 쓴 줄(그 항목 안쪽)
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST = /^ {0,3}([-*+]|\d{1,9}[.)])\s/;
const ROW = /^\s*\|/;

/** 맨 글 여러 줄 → 줄마다 블록이 되는 md */
export function linesAsBlocks(text: string): string {
  const units: string[] = [];
  let fence: string | null = null; // 열린 펜스 기호
  let kind: 'list' | 'row' | null = null; // 지금 조각이 이어 받을 줄
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (fence) {
      units[units.length - 1] += `\n${line}`;
      if (new RegExp(`^ {0,3}\\${fence[0]}{${fence.length},}\\s*$`).test(line)) fence = null;
      continue;
    }
    if (!line.trim()) { kind = null; continue; }
    const f = FENCE.exec(line);
    if (f) { units.push(line); fence = f[1]!; kind = null; continue; }
    if (kind === 'row' && ROW.test(line)) { units[units.length - 1] += `\n${line}`; continue; }
    if (kind === 'list' && /^\s/.test(line)) { units[units.length - 1] += `\n${line}`; continue; } // 항목 안쪽
    units.push(LIST.test(line) || ROW.test(line) ? line : line.trimStart());
    kind = LIST.test(line) ? 'list' : ROW.test(line) ? 'row' : null;
  }
  return units.join('\n\n');
}
