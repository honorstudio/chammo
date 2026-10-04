// 받는 중인 요청 나눠 쓰기 — 폰 첫 켜기에 스플래시가 마감으로 먼저 걷히면 화면 훅이 미리 받기와 같은 것(대화 기록 270KB·shows·썸네일)을
// 또 받아 느린 망에서 두 번 내려받았다('다 참' 6.7초 → 9.2초, 2026-10-04 나쁜 LTE 실측). 같은 열쇠가 날고 있으면 그걸 같이 기다린다. 끝나면(성공·실패) 놓는다
const flying = new Map<string, Promise<unknown>>();

export function shared<T>(key: string, load: () => Promise<T>): Promise<T> {
  const f = flying.get(key) as Promise<T> | undefined;
  if (f) return f;
  const p = load().finally(() => { if (flying.get(key) === p) flying.delete(key); });
  flying.set(key, p);
  return p;
}
