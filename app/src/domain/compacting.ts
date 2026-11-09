// 대화 압축(/compact·자동 압축) 중인지 — 채팅에는 "작업 중"으로만 보여 사용자가 터미널을 봐야 알았다(2026-09-30).
// 터미널 화면 아래쪽에 "Compacting conversation…" 이 돌고 있으면 압축 중
export function isCompacting(lines: string[] | undefined): boolean {
  if (!lines) return false;
  return lines.slice(-12).some((l) => /Compacting conversation/i.test(l));
}

/** Claude 가 붙여넣은 그림을 읽는 중인지 — 입력칸 아래 줄이 'Pasting…'(2.1.318). 그동안 Enter 는 버려지고, 앱(pty::type_keys_seen)이
 *  끝나길 기다렸다 다시 넣는다 — 채팅은 그 사이 '입력칸에 걸려 있어요'로 보이지 않게 하고 Enter 를 따로 안 넣는다(2026-11-05 send-stuck) */
export function isPasting(lines: string[] | undefined): boolean {
  if (!lines) return false;
  let b = -1;
  lines.forEach((l, i) => { if (/^\s*─{4,}/.test(l)) b = i; });
  return b >= 0 && lines.slice(b + 1).some((l) => /^\s*Pasting/.test(l));
}
