// 시안(iframe)이 '참모에게 보내기'를 하자고 하면 부모 화면이 미리보기로 묻고 사람이 눌러야 보낸다 — 시안 안 글은 웹에서 긁어 온 것일 수
// 있어서, 사람 동작 없이 참모에게 가면 프롬프트 주입 길이 된다(2026-10-03 참모-2 보안 보강). iframe 안 클릭은 부모가 사람 동작인지 못 본다

/** 앞 4줄(빈 줄 빼고, 줄마다 120자) + 더 있나 + 전체 글자 수 */
export function sendPreview(text: string, n = 4): { lines: string[]; more: boolean; chars: number } {
  const all = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
  const cut = (l: string) => ([...l].length > 120 ? `${[...l].slice(0, 120).join('')}…` : l);
  return { lines: all.slice(0, n).map(cut), more: all.length > n || all.some((l) => [...l].length > 120), chars: [...text].length };
}
