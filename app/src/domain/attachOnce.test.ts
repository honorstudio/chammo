import { describe, expect, it } from 'vitest';
import { attachOnce, type Attached } from './attachOnce';
import hooks from '../ui/imageFit.ts?raw';

// 그림 확대 끌기가 아주 짧게 움직이다 끊기던 것(11-05 사용자) — useImagePan 이 렌더마다 이벤트를 떼고 다시 붙여서,
// 끄는 동안 앱이 한 번만 다시 그려도 '끄는 중' 상태가 사라졌다. 같은 칸이면 그대로 두고 칸이 바뀔 때만 다시 붙인다
describe('attachOnce — 칸이 바뀔 때만 다시 붙인다', () => {
  const setup = () => {
    const log: string[] = [];
    const attach = (el: string) => { log.push(`on ${el}`); return () => log.push(`off ${el}`); };
    const h: Attached<string> = { el: null, off: null };
    return { log, attach, h };
  };
  it('같은 칸으로 여러 번 다시 그려도 한 번만 붙고 떼지 않는다', () => {
    const { log, attach, h } = setup();
    for (let i = 0; i < 5; i++) attachOnce(h, 'a', attach);
    expect(log).toEqual(['on a']);
  });
  it('칸이 바뀌면 앞 칸을 떼고 새 칸에 붙인다', () => {
    const { log, attach, h } = setup();
    attachOnce(h, 'a', attach);
    attachOnce(h, 'b', attach);
    expect(log).toEqual(['on a', 'off a', 'on b']);
  });
  it('칸이 사라지면 떼기만 하고, 다시 생기면 붙인다', () => {
    const { log, attach, h } = setup();
    attachOnce(h, null, attach);
    attachOnce(h, 'a', attach);
    attachOnce(h, null, attach);
    attachOnce(h, 'a', attach);
    expect(log).toEqual(['on a', 'off a', 'on a']);
  });
});

describe('useImagePan 이 attachOnce 로 붙는다 — 렌더마다 떼던 옛 모양으로 돌아가지 않게', () => {
  it('끌어서 이동 훅은 attachOnce 를 쓰고, 언마운트 때만 뗀다', () => {
    const pan = hooks.slice(hooks.indexOf('export function useImagePan'));
    expect(pan).toMatch(/attachOnce\(/);
    expect(pan).toMatch(/useEffect\(\(\) => \(\) => \{[^}]*off/);
  });
});
