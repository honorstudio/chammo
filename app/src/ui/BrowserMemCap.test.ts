import { describe, expect, it } from 'vitest';
import { memCapShown } from './BrowserMemCap';

// 메모리 상한 감시(tools/chammo-browser/src/memcap.js)는 윈도우에서 안 돈다(ps 로 잰다) — 윈도우 설정엔 아무 일도 안 하는 칸이 뜨면 안 된다
describe('memCapShown', () => {
  it('맥에서 참모 브라우저가 설치됐으면 보인다', () => expect(memCapShown('ok', false)).toBe(true));
  it('윈도우에선 설치됐어도 안 보인다', () => expect(memCapShown('ok', true)).toBe(false));
  it('설치 전이면 안 보인다', () => expect(memCapShown('todo', false)).toBe(false));
});
