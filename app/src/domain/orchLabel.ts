// 참모 별명 — 사용자가 무슨 일을 시킬지 생각해서 붙이는 이름(개발·디자인…). 기본 이름은 설정값(참모·참모-2)을 따른다(2026-09-30 사용자)

/** 별명 다듬기 — 비었으면 null(= 설정 이름으로 되돌림) */
export function cleanLabel(raw: string): string | null {
  const t = [...raw.replace(/\s+/g, ' ').trim()].slice(0, 24).join('');
  return t ? t : null;
}

/** 메뉴 참모 네모 속 한 글자 — 이름 끝 숫자(참모-2 → 2), 없으면 첫 글자. 이름 전체를 넣으면 좁은 네모에서 세로로 쪼개졌다(아이맥 0.2.0) */
export function orchBadge(name: string): string {
  const n = name.trim();
  const num = n.match(/(\d+)$/)?.[1];
  if (num) return num;
  if (!n || n === '참모') return '1';
  return [...n][0]!.toUpperCase();
}
