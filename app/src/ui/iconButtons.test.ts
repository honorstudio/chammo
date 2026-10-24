import { describe, expect, it } from 'vitest';

// 2026-10-11 UI 재조사(사용자 "추천대로"): 익숙한 동작(닫기·빼기·열기·보내기·접기·다시 읽기…)은 글자 버튼이 아니라 직접 그린 SVG 아이콘.
// <button> 자식 글자에 이 이름이 다시 들어오면 걸린다. 이름은 aria-label·title 로(kit/IconButton).
// 그대로 두는 것: 취소·저장·확인 쌍, 되돌리기 어려운 확인(정말 끄기·한 번 더), 이름 글, 메뉴 항목(role=menuitem). 폰(ui/mobile)은 폰 세션 몫.
const files = import.meta.glob(['/src/**/*.tsx', '!/src/ui/mobile/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const FAMILIAR = [
  '닫기', '빼기', '열기', '보기', '이전', '뒤로', '다음', '접기', '건너뛰기', '추가', '폴더 추가', '계정 추가', '마켓플레이스 추가', '새 페이지',
  '위로', '아래로', '펼치기', '보내기', '지금 보내기', '다시 보내기', '다시 시도', '다시 읽기', '다시 켜기', '이어서 켜기', '켜는 중', '받는 중…', '읽는 중…', '들어보기',
  '참조', '채팅에 붙이기', '고정', '고정됨', '맨 아래로', '터미널로 보기', '크게 보기로 하기', '설정 열기', '키보드 설정 열기', '기본 앱으로 열기',
  'GitHub에서 열기', '크롬에서 보기', '로그', '다 고침', '고치기', '이 줄에 코멘트', '진화 · 보관함 열기',
];

// 아이콘이 동작이 아니라 상태 표시인 이름 버튼(펼침 화살표·뒤로 가는 이름 칩) — 파일:첫 글
const NAME_WITH_ICON = new Set<string>([
  '/src/ui/AgentBrowser.tsx 사람 필요', // 브라우저 띠 — 썸네일·페이지 제목·상태 꼬리표를 읽는 줄, 화살표는 펼침 표시
  '/src/ui/AgentBrowserModal.tsx 다 했어', // 보낼 말이 있으면 종이비행기, 없으면 '다 했어' 글자 — 둘 중 하나만 나온다
  '/src/ui/space/OrchHome.tsx 켜는 중…', // 참모 줄 — 프사·이름·상태를 읽는 줄
  '/src/ui/space/UnclosedTasks.tsx 정리', // 닫히지 않은 일 N · 정리 + 펼침 화살표
  '/src/ui/GoalProgress.tsx 기다림', // 진행 칸 목표 줄 — 이름·막대·숫자를 읽는 줄, 펼침 화살표 + 오른쪽 '기다림' 한 단어(상태 글)
  '/src/ui/space/OrchRail.tsx 도우미', // 넓은 띠 도우미 줄 — 아이콘은 동작이 아니라 묶음의 프사 자리(옆 참모 줄과 같은 줄), 글은 읽을 이름
]);

/** <button …>자식</button> 을 찾는다 — 여는 태그 안 {…}·'…' 의 > 는 건너뛴다 */
function buttons(src: string): { line: number; open: string; kids: string }[] {
  const out: { line: number; open: string; kids: string }[] = [];
  let i = 0;
  while ((i = src.indexOf('<button', i)) !== -1) {
    let j = i + 7, depth = 0, q: string | null = null;
    for (; j < src.length; j++) {
      const c = src[j]!;
      if (q) { if (c === q && src[j - 1] !== '\\') q = null; continue; }
      if (c === '"' || c === "'" || c === '`') q = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    const open = src.slice(i, j + 1);
    const end = open.endsWith('/>') ? j + 1 : src.indexOf('</button>', j);
    const kids = open.endsWith('/>') ? '' : src.slice(j + 1, end === -1 ? j + 1 : end);
    out.push({ line: src.slice(0, i).split('\n').length, open, kids });
    i = j + 1;
  }
  return out;
}

const said = (kids: string) => [...kids.matchAll(/\btr\(\s*'([^']+)'/g)].map((m) => m[1]!).concat([...kids.matchAll(/>\s*([^<>{}\s][^<>{}]*?)\s*</g)].map((m) => m[1]!.trim()));

describe('익숙한 동작은 아이콘 버튼', () => {
  it('파일을 읽었다', () => {
    expect(Object.keys(files).length).toBeGreaterThan(50);
  });

  it('<button> 자식 글자에 익숙한 동작 이름이 없다', () => {
    const bad: string[] = [];
    for (const [f, src] of Object.entries(files)) for (const b of buttons(src)) {
      if (/role="menuitem"/.test(b.open)) continue;
      for (const w of said(b.kids)) if (FAMILIAR.includes(w)) bad.push(`${f}:${b.line} ${w}`);
    }
    expect(bad).toEqual([]);
  });

  it('글리프 ✕ ✓ 를 아이콘 대신 쓰지 않는다', () => {
    const bad: string[] = [];
    for (const [f, src] of Object.entries(files)) for (const b of buttons(src)) if (/[✕✓✔✖×]/.test(b.kids.replace(/\{\/\*[\s\S]*?\*\/\}/g, ''))) bad.push(`${f}:${b.line}`);
    expect(bad).toEqual([]);
  });

  it('한 버튼에 아이콘과 글자를 같이 붙이지 않는다 — 읽을 이름이면 글, 익숙한 동작이면 아이콘', () => {
    const bad: string[] = [];
    for (const [f, src] of Object.entries(files)) for (const b of buttons(src)) {
      if (!/<Icon[A-Z]\w*\s*\/>/.test(b.kids)) continue;
      // 안쪽 요소의 이름 속성(aria-label·title)은 화면 글자가 아니다. 코드 조각(: ? &&)도 뺀다
      const shown = b.kids.replace(/\s(?:aria-label|title|alt|placeholder)=\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
      const words = said(shown).filter((w) => /[가-힣A-Za-z]/.test(w) && !/[?&=:]/.test(w));
      if (words.length && !NAME_WITH_ICON.has(`${f} ${words[0]}`)) bad.push(`${f}:${b.line} ${words.join(' / ')}`);
    }
    expect(bad).toEqual([]);
  });

  it('아이콘만 있는 버튼은 이름(aria-label 이나 title)이 있다', () => {
    const bad: string[] = [];
    for (const [f, src] of Object.entries(files)) for (const b of buttons(src)) {
      const iconOnly = /<Icon[A-Z]\w*\s*\/>/.test(b.kids) && said(b.kids).length === 0 && !/\{[^}]*\}/.test(b.kids.replace(/<Icon[A-Z]\w*\s*\/>/g, '').replace(/\{\s*\w+\s*\?\s*<Icon\w+\s*\/>\s*:\s*<Icon\w+\s*\/>\s*\}/g, ''));
      if (iconOnly && !/aria-label=|title=/.test(b.open)) bad.push(`${f}:${b.line}`);
    }
    expect(bad).toEqual([]);
  });
});
