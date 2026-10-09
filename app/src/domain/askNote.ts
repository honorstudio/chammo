// 결정 물음 글(scripts/task ask) 나누기 — 폰 '답을 기다림' 카드·데스크톱 결정 대기함이 같이 쓴다.
// 긴 물음(교훈 묶기: 물음 · 언제 열리나 · '- ' 목록 · '… 외 N줄' · '답: A / B')이 줄바꿈 없이 한 덩어리로 화면을 덮었다(2026-10-08 사용자 폰)

/** head = 첫 줄(물음), body = 나머지 줄, answerLine = 마지막 '답: A / B' 줄(알약으로 쓸 수 있을 때만 body 에서 뺀다) */
export type AskNote = { head: string; body: string[]; answers: string[]; answerLine: string };

const ANSWER = /^(?:답|Answer)\s*[:：]\s*(.+)$/i;
/** 알약 하나 최대 글자·보기 수 — 넘으면 보기가 아니라 글로 본다 */
const PILL_MAX = 16;
const PILLS = [2, 6] as const;

/** '버려(끝난 일·중복)' → '버려' — 괄호는 설명이라 단추 글·보내는 답에서 뺀다 */
const pill = (s: string) => s.replace(/\s*[(（][^)）]*[)）]\s*$/, '').trim();

export function askNote(text: string): AskNote {
  const lines = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
  const head = (lines[0] ?? '').trim();
  const body = lines.slice(1);
  const m = body.length ? ANSWER.exec(body[body.length - 1]!.trim()) : null;
  const words = m ? m[1]!.split('/').map(pill) : [];
  const ok = words.length >= PILLS[0] && words.length <= PILLS[1] && words.every((w) => w && w.length <= PILL_MAX);
  if (!ok) return { head, body, answers: [], answerLine: '' };
  return { head, body: body.slice(0, -1), answers: words, answerLine: body[body.length - 1]!.trim() };
}

/** 접었을 때 보이는 본문 줄 수 — 줄마다 한 줄로 자른다(…) */
export const FOLD_LINES = 3;
/** 이보다 긴 줄은 폰 카드 폭(약 330px, 14px)에 한 줄로 안 들어가 잘린다고 본다 — 넘치면 펼칠 게 있다 */
const ONE_LINE = 22;
/** 접힌 물음은 4줄까지 — 그보다 길면 펼칠 게 있다 */
const HEAD_MAX = 4 * ONE_LINE;

/** 접힘/펼침에 보일 본문 줄과 펼침 단추가 필요한지(줄이 숨었거나, 접힌 줄·물음이 잘릴 만큼 길 때) */
export function foldNote(n: AskNote, open: boolean, max = FOLD_LINES): { body: string[]; more: boolean } {
  const shown = n.body.slice(0, max);
  const more = n.body.length > max || shown.some((l) => l.trim().length > ONE_LINE) || n.head.length > HEAD_MAX;
  return { body: open ? n.body : shown, more };
}
