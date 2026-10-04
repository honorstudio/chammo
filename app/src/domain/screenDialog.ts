// 세션 터미널에 뜬 선택 창(선택지 질문·확인 창·플랜 승인·/model 목록 등)을 글자 화면에서 읽는다 — 채팅에 버튼으로 보여 주려고.
// 사용자은 채팅 뷰에서만 일한다: 창이 뜰 때마다 "터미널에서 선택을 기다리고 있어요"로 터미널에 가야 했다(2026-10-01 사용자 "cli 안 거치게").
// 창 모양은 Claude 판마다 조금씩 달라서 이름이 아니라 모양으로 읽는다: 커서(❯)가 붙은 번호 줄과, 같은 칸에서 시작하는 번호 줄들

export type DialogOption = { n: number; label: string; detail?: string };
export type ScreenDialog = {
  /** 선택지 위의 묻는 말(여러 줄일 수 있다) */
  question: string[];
  options: DialogOption[];
  /** 지금 커서가 있는 선택지(options 안 번호) */
  cursor: number;
  /** 질문이 여럿일 때 위쪽 탭 줄(☐ 색  ☐ 크기  ✔ Submit) */
  tabs?: string;
  /** 목록이 화면에 다 안 보인다(↓·… +N) — 버튼은 보이는 것만 */
  partial?: boolean;
  /** 고르는 키 — 보통 Enter. /model 목록은 Enter 가 "새 세션 기본값"까지 저장해서 s(이 세션만) */
  confirm?: string;
};

const OPT = /^(\s*)(?:([❯↓↑])\s*)?(\d+)\.\s+(.*)$/;
const RULE = /^\s*[─▔━]{4,}/;
const MORE = /^\s*…\s*\+\d+/;

const indentOf = (l: string) => l.search(/\S/);
/** 번호가 시작하는 칸 */
const numCol = (l: string) => { const m = l.match(OPT); return m ? l.indexOf(m[3]!, m[1]!.length) : -1; };
const unbalanced = (s: string) => (s.match(/\(/g)?.length ?? 0) > (s.match(/\)/g)?.length ?? 0);

export function screenDialog(raw: string[]): ScreenDialog | null {
  const lines = raw.map((l) => l.replace(/\s+$/, ''));
  let c = -1;
  lines.forEach((l, i) => { const m = l.match(OPT); if (m?.[2] === '❯') c = i; });
  if (c < 0) return null;
  // 아래에 입력칸(❯ 만 있는 줄)이 있으면 대화 속에 내가 친 말 — 창이 아니다
  if (lines.slice(c + 1).some((l) => /^\s*❯(\s*$|\s+\D)/.test(l))) return null;
  const col = numCol(lines[c]!);
  const isOpt = (l: string) => numCol(l) === col;
  const isMore = (l: string) => !!l.trim() && !RULE.test(l) && !MORE.test(l) && indentOf(l) > col && !isOpt(l);

  let top = c;
  while (top > 0 && (isOpt(lines[top - 1]!) || isMore(lines[top - 1]!))) top--;
  while (top < c && !isOpt(lines[top]!)) top++;
  let bottom = c;
  let partial = false;
  for (let i = c + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (isOpt(l) || isMore(l)) { bottom = i; continue; }
    if (MORE.test(l)) { partial = true; continue; }
    if (RULE.test(l) && i + 1 < lines.length && isOpt(lines[i + 1]!)) continue; // 구분선 너머 선택지(Chat about this)
    break;
  }

  const options: DialogOption[] = [];
  let cursor = 0;
  for (let i = top; i <= bottom; i++) {
    const l = lines[i]!;
    if (RULE.test(l)) continue;
    const m = l.match(OPT);
    if (m && isOpt(l)) {
      if (m[2] === '↓' || m[2] === '↑') partial = true;
      if (i === c) cursor = options.length;
      options.push({ n: Number(m[3]), label: m[4]!.trim() });
    } else if (options.length) {
      const o = options[options.length - 1]!;
      const t = l.trim();
      if (!o.detail && unbalanced(o.label)) o.label = `${o.label} ${t}`; // 접힌 줄
      else o.detail = o.detail ? `${o.detail} ${t}` : t;
    }
  }
  if (options.length < 2) return null;

  const question: string[] = [];
  let tabs: string | undefined;
  for (let i = top - 1; i >= 0 && question.length < 4; i--) {
    const l = lines[i]!;
    if (!l.trim()) { if (question.length) break; continue; }
    if (RULE.test(l)) break;
    if (/☐|☒|✔\s*Submit/.test(l)) { tabs = l.replace(/^[\s←]+|[\s→]+$/g, ''); break; }
    question.unshift(l.trim());
  }
  const below = lines.slice(bottom + 1).join(' ');
  const confirm = /\bs to use this session\b/.test(below) ? 's' : undefined;
  return { question, options, cursor, tabs, partial: partial || undefined, confirm };
}

const DOWN = '\x1b[B';
const UP = '\x1b[A';

/** 커서에서 i 번째 선택지까지 화살표 + Enter */
export function dialogKeys(d: ScreenDialog, i: number): string {
  const n = i - d.cursor;
  return (n > 0 ? DOWN.repeat(n) : UP.repeat(-n)) + (d.confirm ?? '\r');
}

/** 지금 화면에서 그 번호 선택지까지 한 걸음 — 번호로 가린다(목록이 길어 화면 밖이어도). 화살표를 한꺼번에 보내면 몇 개 씹혔다 */
export function stepToward(d: ScreenDialog, n: number): 'here' | 'up' | 'down' {
  const cur = d.options[d.cursor]!.n;
  return cur === n ? 'here' : n > cur ? 'down' : 'up';
}
