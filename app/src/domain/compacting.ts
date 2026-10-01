// 대화 압축(/compact·자동 압축) 중인지 — 채팅에는 "작업 중"으로만 보여 사용자가 터미널을 봐야 알았다(2026-09-30).
// 터미널 화면 아래쪽에 "Compacting conversation…" 이 돌고 있으면 압축 중
export function isCompacting(lines: string[] | undefined): boolean {
  if (!lines) return false;
  return lines.slice(-12).some((l) => /Compacting conversation/i.test(l));
}
