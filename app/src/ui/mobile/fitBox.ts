// 글 칸 높이를 글만큼 — 재려면 글 칸을 잠깐 접어야(height:auto) 하는데, 그 순간 카드가 줄면 위 대화 목록이 커졌다 줄며
// 사파리가 목록 스크롤을 '커진 목록'의 끝으로 깎아 버린다(크롬은 스크롤 고정이 덮어 줘서 안 보임). 크기는 결국 그대로라
// ResizeObserver 도 안 불려 마지막 말이 입력칸에 가린 채 남았다(11-08 사용자 폰 — 6줄 91px·칩 141px). 재는 동안 카드를 지금 높이로 붙든다
type Box = { style: { height: string; overflowY: string }; readonly scrollHeight: number };
type Hold = { style: { minHeight: string }; readonly offsetHeight: number };

export function fitBox(box: Box, hold: Hold, cap: number) {
  hold.style.minHeight = `${hold.offsetHeight}px`;
  box.style.height = 'auto';
  const h = box.scrollHeight;
  box.style.height = `${Math.min(h, cap)}px`;
  box.style.overflowY = h > cap ? 'auto' : 'hidden';
  hold.style.minHeight = '';
}
