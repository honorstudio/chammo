// 패드 화면 배치(11-18 사용자 '추천대로' — 시안 docs/design-drafts/ipad-layout v1: 가로 A · 세로 B).
// 나누는 기준은 기기 이름이 아니라 지금 창 폭 — 분할 화면·슬라이드 오버에선 폭이 바뀐다.
//   phone = 지금 폰 화면 그대로(폭 700 밑, 또는 높이 600 밑 — 아이폰 가로)
//   two   = 띠 + 채팅, 스페이스는 오른쪽에서 밀어 여는 판(11" 세로 834)
//   wide  = 맥 그대로 — 위 막대 · 띠 · 채팅 · 스페이스(패드 가로, 13" 세로 1032)
export type PadMode = 'phone' | 'two' | 'wide';

export const PAD_MIN_W = 700;
export const PAD_MIN_H = 600;
export const PAD_WIDE_W = 1000;
/** 띠 폭(맥 접힌 띠 56 → 손가락 68) · 채팅 칸 폭(맥 420 → 패드 400) */
export const PAD_RAIL_W = 68;
export const PAD_CHAT_W = 400;
/** 세로 판 폭 = min(520, 칸의 64%) — 시안 B 의 76% 는 채팅을 너무 가렸다(11-18 참모-2 전달 사용자). CSS(.m-tb-two .m-tb-dash)가 쓴다 */
export const PAD_PANEL_MAX = 520;

export function padMode(w: number, h: number): PadMode {
  if (!(w > 0) || !(h > 0)) return 'phone';
  if (w < PAD_MIN_W || h < PAD_MIN_H) return 'phone';
  return w >= PAD_WIDE_W ? 'wide' : 'two';
}
