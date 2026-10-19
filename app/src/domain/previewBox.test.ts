import { describe, expect, it } from 'vitest';
import { parseBox, resizeBox } from './previewBox';

const room = { w: 1200, h: 800 };
describe('resizeBox — 미리보기 모달 크기 끌기(가운데 기준이라 양쪽으로 같이 커진다, 2026-09-30 사용자)', () => {
  it('오른쪽 모서리를 dx 만큼 끌면 폭이 2dx 늘어난다(가운데 고정)', () => {
    expect(resizeBox({ w: 600, h: 400 }, 50, 0, 'e', room)).toEqual({ w: 700, h: 400 });
    expect(resizeBox({ w: 600, h: 400 }, -50, 0, 'w', room)).toEqual({ w: 700, h: 400 });
  });
  it('모서리(se)는 폭·높이 같이, 아래(s)는 높이만', () => {
    expect(resizeBox({ w: 600, h: 400 }, 10, 20, 'se', room)).toEqual({ w: 620, h: 440 });
    expect(resizeBox({ w: 600, h: 400 }, 10, 20, 's', room)).toEqual({ w: 600, h: 440 });
  });
  it('최소 360×240, 최대는 스페이스 크기', () => {
    expect(resizeBox({ w: 400, h: 300 }, -100, -100, 'se', room)).toEqual({ w: 360, h: 240 });
    expect(resizeBox({ w: 1100, h: 700 }, 200, 200, 'se', room)).toEqual({ w: 1200, h: 800 });
  });
});

describe('parseBox — 기억해 둔 크기', () => {
  it('숫자 둘이면 그 크기, 아니면 없음(꽉 채움)', () => {
    expect(parseBox('{"w":700,"h":500}')).toEqual({ w: 700, h: 500 });
    expect(parseBox('{깨짐')).toBeNull();
    expect(parseBox(null)).toBeNull();
    expect(parseBox('{"w":"a","h":1}')).toBeNull();
  });
});
