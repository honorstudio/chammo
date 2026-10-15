import { describe, expect, it } from 'vitest';
import { LINK_MOVE_MS } from './chatLink';
import { holdRelease, spaceSwapDelay } from './switchHold';
import spaceView from '../ui/space/SpaceView.tsx?raw';
import chatLink from '../ui/space/ChatLink.tsx?raw';

// 2026-10-12 사용자 "참모 바꿀 때 애니메이션 렉" — 바꾸는 순간 스페이스를 비워(옛 BlockNote 부수기 ~110ms) 이음 탭이 옮겨 가는 140ms 와 겹쳤다.
// WKWebView 하네스 실측: 스페이스에 md 문서가 있으면 바꾸기 한 번에 긴 프레임 3개(110·100·85ms), 1초에 21~27프레임 빠짐
describe('참모 바꾸기 — 스페이스 바꿔 끼우기는 움직임이 끝난 뒤', () => {
  it('움직일 땐 이음 탭 움직임(LINK_MOVE_MS)이 끝난 뒤에 바꿔 끼운다', () => {
    expect(spaceSwapDelay(true)).toBeGreaterThan(LINK_MOVE_MS);
    expect(spaceSwapDelay(true)).toBeLessThanOrEqual(LINK_MOVE_MS + 80); // 너무 늦으면 내용이 늦게 뜬다
  });
  it('움직임을 줄였으면 기다릴 움직임이 없다 — 바로(0)', () => {
    expect(spaceSwapDelay(false)).toBe(0);
  });
  it('기다리는 동안 스페이스를 비우지 않고 옛 화면을 그대로 둔다 — 비우면 옛 편집기를 부수는 일이 움직임 첫 프레임에 깔린다', () => {
    expect(spaceView).not.toMatch(/\{hold \? null : main\}/);
    expect(spaceView).toMatch(/spaceSwapDelay\(/);
    // 바뀜을 알아챈 렌더(렌더 중 setHold)는 버려진다 — 그 렌더에서 옛 화면 자리를 새 화면으로 덮으면 클릭 순간 새 편집기까지 만들었다(실측 270~440ms 막힘)
    expect(spaceView).toMatch(/\{held \? shownMain\.current : \(shownMain\.current = main\)\}/);
  });
  it('이음 탭은 같은 시간 상수로 움직인다', () => {
    expect(chatLink).toMatch(/LINK_MOVE_MS/);
    expect(chatLink).not.toMatch(/const DUR = \d+/);
  });
});

// 2026-10-13 02:40 사용자 "참모 이동이 안 되고 모든 참모가 같은 모드·같은 세션 줄" — hold 가 true 로 박혀 가운데가 옛 참모 화면(shownMain)에 멈췄다.
// 움직임 끝 타이머가 hold=false 를 세운 직후, React 가 그리기 전에 다음 참모 누름이 끼면 두 갱신이 한 렌더로 합쳐진다(false → 렌더 중 true).
// 커밋된 값이 true → true 라 useEffect([hold]) 가 다시 안 돌아 푸는 타이머가 영영 안 걸렸다(하네스 holdRace 로 결정적 재현, .shots/fix-mode-stuck)
describe('참모 바꾸기 hold — 움직임 끝 타이머 직후 다음 누름이 끼어도 풀린다', () => {
  // React 가 같은 렌더에서 차례로 적용하는 갱신 줄 — 값이면 그 값, 함수면 앞 값에 적용
  const settle = <T,>(base: T, queue: (T | ((x: T) => T))[]) => queue.reduce<T>((s, u) => (typeof u === 'function' ? (u as (x: T) => T)(s) : u), base);
  it('옛 모양(참·거짓)은 풀기와 새 바꾸기가 합쳐지면 커밋 값이 그대로라 타이머가 다시 안 걸렸다', () => {
    expect(settle<boolean>(true, [false, true])).toBe(true); // 커밋된 값 true → true: 효과가 안 돈다 = 영원히 hold
  });
  it('새 모양: 바꿀 때마다 늘 커지는 번호 — 합쳐져도 커밋 값이 바뀌어 타이머가 다시 걸린다', () => {
    const committed = 5;
    const next = settle<number>(committed, [(s) => holdRelease(s, committed), 6]);
    expect(next).toBe(6);
    expect(next).not.toBe(committed);
  });
  it('풀기는 자기 번호일 때만 — 그사이 또 바꿨으면 새 번호를 지우지 않는다', () => {
    expect(holdRelease(3, 3)).toBe(0);
    expect(holdRelease(4, 3)).toBe(4);
    expect(holdRelease(0, 3)).toBe(0);
  });
  it('SpaceView 연결 — 렌더 중엔 새 번호를 값으로, 푸는 타이머는 holdRelease, 기다리는 동안 옛 화면은 못 누른다(inert)', () => {
    expect(spaceView).toMatch(/const \[hold, setHold\] = useState\(0\)/);
    expect(spaceView).toMatch(/holdSeq\.current \+= 1;\s*setHold\(holdSeq\.current\);/);
    expect(spaceView).toMatch(/setHold\(\(s\) => holdRelease\(s, mine\)\)/);
    expect(spaceView).not.toMatch(/setHold\(true\)|setHold\(false\)/);
    // 옛 화면이 눌리면 옛 참모 보관함 자리가 박혀 다른 참모 기억으로 옮아 갔다(하네스 holdClick)
    expect(spaceView).toMatch(/<main inert=\{held\}/);
  });
});

