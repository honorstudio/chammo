import { describe, expect, it } from 'vitest';
import { FIT, IMAGE_STEPS, parseZoom, selectAllTarget, stepZoom, withZoom, zoomable, zoomLabel, zoomOf } from './readerZoom';

describe('stepZoom — 브라우저처럼 정해진 단계로', () => {
  it('100 에서 한 단계씩', () => {
    expect(stepZoom(100, 1)).toBe(110);
    expect(stepZoom(100, -1)).toBe(90);
  });
  it('끝에서 멈춘다', () => {
    expect(stepZoom(300, 1)).toBe(300);
    expect(stepZoom(50, -1)).toBe(50);
  });
  it('단계 사이 값이면 가까운 다음 단계로', () => {
    expect(stepZoom(105, 1)).toBe(110);
    expect(stepZoom(105, -1)).toBe(100);
  });
});

describe('종류별 기억 (사용자 2026-09-29)', () => {
  it('처음은 100', () => expect(zoomOf({}, 'md')).toBe(100));
  it('한 종류를 바꿔도 다른 종류는 그대로', () => {
    const m = withZoom({}, 'md', 125);
    expect(zoomOf(m, 'md')).toBe(125);
    expect(zoomOf(m, 'html')).toBe(100);
  });
  it('영상은 확대하지 않는다', () => {
    expect(zoomable('video')).toBe(false);
    expect(zoomable('pdf')).toBe(true);
  });
  it('저장값이 깨졌거나 범위 밖이면 버린다', () => {
    expect(parseZoom(null)).toEqual({});
    expect(parseZoom('{')).toEqual({});
    expect(parseZoom('[1,2]')).toEqual({});
    expect(parseZoom('{"md":125,"html":"x","pdf":9999,"video":150,"zzz":110}')).toEqual({ md: 125 });
  });
});

// 2026-09-29 사용자: 그림은 50% 로도 한 화면에 안 찬다 → 기본은 '맞춤'(가로·세로 다 창 안), 비율은 실제 픽셀 기준, 10% 까지
describe('그림은 맞춤부터', () => {
  it('그림 처음 값은 맞춤, 다른 종류는 100', () => {
    expect(zoomOf({}, 'image')).toBe(FIT);
    expect(zoomOf({}, 'md')).toBe(100);
  });
  it('맞춤에서 누르면 지금 보이는 실제 비율의 다음 단계로 — 그림 단계는 10% 까지', () => {
    expect(stepZoom(37, -1, IMAGE_STEPS)).toBe(33);
    expect(stepZoom(37, 1, IMAGE_STEPS)).toBe(50);
    expect(stepZoom(10, -1, IMAGE_STEPS)).toBe(10);
    expect(IMAGE_STEPS[0]).toBe(10);
  });
  it('표시: 맞춤은 글자로, 나머지는 %', () => {
    expect(zoomLabel(FIT)).toBe('맞춤');
    expect(zoomLabel(125)).toBe('125%');
  });
  it('저장값: 그림은 맞춤(0)·10~400 을 받는다, 다른 종류는 50~300 그대로', () => {
    expect(parseZoom('{"image":0}')).toEqual({ image: 0 });
    expect(parseZoom('{"image":25,"md":25}')).toEqual({ image: 25 });
    expect(parseZoom('{"image":400}')).toEqual({ image: 400 });
    expect(parseZoom('{"md":0}')).toEqual({});
  });
});

describe('selectAllTarget — ⌘A 는 보고 있는 곳 안에서만', () => {
  const base = { editable: false, terminal: false, reader: false, kind: null } as const;
  it('입력칸이면 입력칸', () => expect(selectAllTarget({ ...base, editable: true, reader: true, kind: 'md' })).toBe('input'));
  it('터미널이면 그 터미널', () => expect(selectAllTarget({ ...base, terminal: true })).toBe('terminal'));
  it('리더 마크다운·글은 문서 글만', () => {
    expect(selectAllTarget({ ...base, reader: true, kind: 'md' })).toBe('readerText');
    expect(selectAllTarget({ ...base, reader: true, kind: 'text' })).toBe('readerText');
  });
  it('리더 HTML·PDF 는 문서 프레임 안(웹뷰 기본 동작)', () => {
    expect(selectAllTarget({ ...base, reader: true, kind: 'html' })).toBe('readerFrame');
    expect(selectAllTarget({ ...base, reader: true, kind: 'pdf' })).toBe('readerFrame');
  });
  it('그림·영상·빈 리더·아무 데도 아니면 아무것도 안 한다 — 앱 화면 전체가 잡히지 않게', () => {
    expect(selectAllTarget({ ...base, reader: true, kind: 'image' })).toBe('none');
    expect(selectAllTarget({ ...base, reader: true, kind: null })).toBe('none');
    expect(selectAllTarget(base)).toBe('none');
  });
});
