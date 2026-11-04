import { describe, expect, it } from 'vitest';
import { downOf, downProgress, downRatio, downStatus, type TeamDown } from './teamDown';

const d = (x: Partial<TeamDown>): TeamDown => ({ team: 't', id: 'f', mode: 'save', done: 0, total: 0, state: 'going', why: '', error: '', path: '', ...x });

// 11-01 사용자 시안 승인 — 막대 옆 글은 '받은 / 전체' 숫자만(전체와 같은 단위), 남은 시간 없음
describe('downProgress', () => {
  it('전체 단위로 받은 만큼', () => {
    expect(downProgress(d({ done: 128_000_000, total: 312_400_000 }))).toBe('128 / 312MB');
    expect(downProgress(d({ done: 1_500_000_000, total: 3_200_000_000 }))).toBe('1.5 / 3.2GB');
    expect(downProgress(d({ done: 300_000, total: 800_000 }))).toBe('300 / 800KB');
    expect(downProgress(d({ done: 0, total: 0 }))).toBe('');
  });
  it('보관함 칸은 1024 단위(fmtBytes) — 원래 크기 글과 같은 숫자', () => {
    expect(downProgress(d({ done: 128 * 2 ** 20, total: 312_400_000 }), true)).toBe('128 / 298MB');
    expect(downStatus(d({ state: 'done', total: 312_400_000 }), true).text).toBe('298MB · 받았어요');
  });
});

describe('downRatio', () => {
  it('0~1 로 자른다', () => {
    expect(downRatio(d({ done: 50, total: 200 }))).toBe(0.25);
    expect(downRatio(d({ done: 9, total: 0 }))).toBe(0);
    expect(downRatio(d({ done: 300, total: 200 }))).toBe(1);
  });
});

describe('downOf — 한 파일에 보일 받기 줄', () => {
  it('받는 중이 먼저, 그다음 저장 줄, 여는 줄은 실패만', () => {
    const list = [d({ id: 'a', mode: 'open', state: 'failed', why: 'net' }), d({ id: 'a', mode: 'save', state: 'done' }), d({ id: 'b', mode: 'open', state: 'going' })];
    expect(downOf(list, 'a')?.mode).toBe('save');
    expect(downOf(list, 'b')?.state).toBe('going');
    expect(downOf([d({ id: 'a', mode: 'open', state: 'failed', why: 'net' })], 'a')?.why).toBe('net');
    expect(downOf(list, 'z')).toBeUndefined();
  });
});

describe('downStatus — 줄 아래 글', () => {
  it('다 받음은 크기 + 받았어요, 실패는 이유 한 줄', () => {
    expect(downStatus(d({ state: 'done', total: 312_400_000 }))).toEqual({ text: '312.4 MB · 받았어요', err: false });
    expect(downStatus(d({ state: 'failed', why: 'net' }))).toEqual({ text: '인터넷이 끊겼어요', err: true });
    expect(downStatus(d({ state: 'failed', why: 'disk' })).text).toBe('저장 공간이 모자라요');
    expect(downStatus(d({ state: 'failed', why: 'gone' })).text).toBe('올린 사람이 지웠어요');
    expect(downStatus(d({ state: 'failed', why: 'stopped' })).text).toBe('받기를 멈췄어요');
    expect(downStatus(d({ state: 'failed', why: 'other', error: '조각이 안 열려' })).text).toBe('받지 못했어요 — 조각이 안 열려');
    expect(downStatus(d({ state: 'going', done: 1_000_000, total: 2_000_000 }))).toEqual({ text: '1 / 2MB', err: false });
  });
});
