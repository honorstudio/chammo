// 겹창 포커스 가두기(ui/team/TeamDialog) — Tab 이 겹창 밖(뒤 화면)으로 새지 않게. 화면과 따로 시험한다

/** n = 겹창 안 누를 수 있는 것 수, i = 지금 포커스 차례(-1 = 겹창 밖), back = ⇧Tab.
 *  돌려주는 값: 옮길 차례 · -1 = 손대지 않음(브라우저 차례 그대로) · -2 = 막기만(누를 게 없다) */
export function trapNext(n: number, i: number, back: boolean): number {
  if (n === 0) return -2;
  if (i < 0) return back ? n - 1 : 0;
  if (back && i === 0) return n - 1;
  if (!back && i === n - 1) return 0;
  return -1;
}
