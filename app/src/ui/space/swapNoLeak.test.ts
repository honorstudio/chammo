import { describe, expect, it } from 'vitest';
import view from './SpaceView.tsx?raw';
import css from './space.css?raw';

// 2026-11-05 사용자(캡처 30·31): 참모 업데이트 탭에서 보관함 문서를 띄워 둔 채 다른 참모 탭으로 바꾸면
// 그 참모 스페이스에 앞 참모 문서(탭 줄·본문)가 잠깐 보였다 — 남의 참모 문서가 비치는 것.
// 원인 — 참모를 바꾸면 움직임이 끝날 때까지(hold, ~180ms) <main> 이 앞 참모 화면(shownMain)을 그대로 그리고,
// 위 덮개(.cv-switch)는 투명도 0 에서 시작하는 55% 반투명 + 흐림이라 그 화면이 그대로 비쳤다.
// 하네스 실측(탭 10번 전환): 고치기 전 107 프레임에 앞 참모 문서가 보였다.

describe('참모를 바꾸는 동안 앞 참모 화면이 안 보인다', () => {
  it('기다리는 동안(held) main 에 가림 클래스를 단다', () => {
    expect(view).toMatch(/<main[^>]*className=\{`cv-main[^`]*\$\{held \? ' cv-held' : ''\}/);
  });
  it('가림 클래스는 덮개(.cv-switch) 말고 main 안 전부를 안 보이게 한다(편집기는 부수지 않고 살려 둔 채)', () => {
    const m = /\.cv-main\.cv-held\s*>\s*:not\(\.cv-switch\)\s*\{([^}]*)\}/.exec(css);
    expect(m?.[1] ?? '').toMatch(/visibility:\s*hidden/);
  });
  it('채팅 탭이 바뀐 걸 따라갈 때도 그리기 전에 바꾼다(useLayoutEffect) — 한 프레임이라도 앞 참모 화면이 그려지지 않게', () => {
    expect(view).toMatch(/useLayoutEffect\(\(\) => \{ if \(chatOrch\?\.id && chatOrch\.id !== nav\.chat\) switchTo\(chatOrch\.id, 'follow'\)/);
  });
});
