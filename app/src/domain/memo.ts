// 세션 옆 메모 — iTerm 에서 쓰던 HOLO MEMO(~/.config/holo/memo/<프로젝트>.md)를 그대로 읽고 쓴다.
// 지금 뭐 하는지·보낼 프롬프트 초안·왜 그렇게 정했는지를 프로젝트별로 쌓는 곳. 형식은 memo.py load/save 와 같다

export type MemoItem = { ts: string; text: string };

export function parseMemo(file: string): MemoItem[] {
  const items: MemoItem[] = [];
  for (const ln of file.split('\n')) {
    const m = ln.startsWith('- [') ? /^- \[([^\]]*)\] (.*)$/.exec(ln) : null;
    const last = items[items.length - 1];
    if (m) items.push({ ts: m[1] ?? '', text: m[2] ?? '' });
    else if (ln.startsWith('  ') && last) last.text += '\n' + ln.slice(2);
    else if (ln.trim() && !ln.startsWith('#')) items.push({ ts: '', text: ln.trim() });
  }
  return items;
}

export function formatEntry(ts: string, text: string): string {
  const [head, ...rest] = text.split('\n');
  return [`- [${ts}] ${head}`, ...rest.map((r) => `  ${r}`)].join('\n') + '\n';
}

export const serializeMemo = (items: MemoItem[]) => '# HOLO MEMO\n\n' + items.map((i) => formatEntry(i.ts, i.text)).join('');

/** 지울 항목을 시각·글로 찾아 뺀다(뒤에서부터 하나). 없으면 null */
export function removeEntry(items: MemoItem[], target: MemoItem): MemoItem[] | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it && it.ts === target.ts && it.text === target.text) return [...items.slice(0, i), ...items.slice(i + 1)];
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const memoTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** 입력칸에 글자만 넣고 Enter 는 사용자가 — 괄호 붙여넣기라 여러 줄이어도 바로 보내지지 않는다 */
export const pasteSequence = (text: string) => `\x1b[200~${text.replace(/\r?\n/g, '\r')}\x1b[201~`;

export const validMemoName = (name: string) => !!name && !name.includes('/') && !name.includes('..');
