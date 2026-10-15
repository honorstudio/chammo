// 참모를 바꿀 때 스페이스(문서 편집기 등) 바꿔 끼우기를 언제 할까 — 2026-10-12 사용자 "참모 바꿀 때 애니메이션 렉".
// 바꾸는 순간 옛 BlockNote 를 부수고(~110ms) 새로 만들면(~100+85ms) 이음 탭이 옮겨 가는 움직임 위에 그대로 깔려 끊겼다.
// 움직임이 끝날 때까지 옛 화면을 덮개(불러오는 중) 아래 그대로 두고, 그 뒤에 한 번에 바꿔 끼운다. 긴 일은 남지만 움직이는 동안엔 없다
import { LINK_MOVE_MS } from './chatLink';

/** 움직임이 끝나고 한 프레임쯤 여유 */
const SLACK_MS = 40;

/** 바꿔 끼우기까지 기다릴 ms — 움직임을 줄였으면(동작 줄이기·애니메이션 끄기) 기다릴 게 없어 0 */
export function spaceSwapDelay(moving: boolean): number {
  return moving ? LINK_MOVE_MS + SLACK_MS : 0;
}

/** 움직임 끝 풀기 — hold 는 바꿀 때마다 늘 커지는 번호(0 = 안 기다림). 자기 번호일 때만 푼다(그사이 또 바꿨으면 새 번호는 그대로).
 *  참·거짓이었을 땐 풀기(false)와 새 바꾸기(true)가 한 렌더에 합쳐지면 커밋 값이 true → true 라 푸는 타이머가 다시 안 걸려 영원히 멈췄다(2026-10-13) */
export function holdRelease(cur: number, mine: number): number {
  return cur === mine ? 0 : cur;
}
