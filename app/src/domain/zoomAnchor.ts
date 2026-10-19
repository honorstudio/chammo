// 그림 확대 기준점(2026-10-19 사용자 "마우스 기준으로 가야 하는 거 아니야?") — 핀치·⌘휠은 커서 아래 점, 키보드·단추는 보이는 칸 가운데가 제자리에.
// 칸 모양(여백·가운데 정렬·맞춤)과 상관없이 그려진 그림 자리(getBoundingClientRect)만으로 센다 — 스페이스 탭·크게 보기·리더가 같이 쓴다(ui/zoomAnchor)
export type Rect = { left: number; top: number; width: number; height: number };
/** 화면 좌표 (x, y) 와 그 점이 그림 안 어디쯤인지(0~1, 그림 밖이면 그 너머) */
export type Anchor = { x: number; y: number; u: number; v: number };

export const viewCenter = (box: Rect): { x: number; y: number } => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });

/** 배율을 바꾸기 직전 — 기준점이 그림 어디인지. 아직 크기가 없으면 null */
export function anchorOf(at: { x: number; y: number }, img: Rect): Anchor | null {
  if (!(img.width > 0) || !(img.height > 0)) return null;
  return { x: at.x, y: at.y, u: (at.x - img.left) / img.width, v: (at.y - img.top) / img.height };
}

/** 다시 그린 뒤 — 같은 그림 점이 기준점에 오도록 스크롤에 더할 값(칸 끝은 브라우저가 자른다) */
export function scrollShift(a: Anchor, img: Rect): { dx: number; dy: number } {
  return { dx: img.left + a.u * img.width - a.x, dy: img.top + a.v * img.height - a.y };
}
