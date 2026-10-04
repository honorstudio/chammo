import { describe, expect, it } from 'vitest';
import { findAll, locate, startAt } from './findText';

describe('findAll — 문서 찾기(⌘F): 글 조각들에서 찾은 자리(대소문자 무시)', () => {
  it('조각마다 [조각 번호, 시작, 끝]', () => {
    expect(findAll(['안녕 참모', 'Hello 참모 참모'], '참모')).toEqual([[0, 3, 5], [1, 6, 8], [1, 9, 11]]);
  });
  it('대소문자 무시, 빈 말이면 없음', () => {
    expect(findAll(['Hello hello'], 'HELLO')).toEqual([[0, 0, 5], [0, 6, 11]]);
    expect(findAll(['abc'], '')).toEqual([]);
  });
});

describe('locate — 짚어 보여 주기: 조각을 넘어서 n 번째 자리(굵게·코드가 섞인 줄)', () => {
  it('조각을 넘는 글', () => {
    expect(locate(['아이디', ': ', 'demo-user', ' 끝'], '아이디: demo-user', 0)).toEqual({ start: [0, 0], end: [2, 9] });
  });
  it('n 번째, 없으면 처음 것', () => {
    expect(locate(['가 나 가', ' 가'], '가', 2)).toEqual({ start: [1, 1], end: [1, 2] });
    expect(locate(['가 나'], '가', 5)).toEqual({ start: [0, 0], end: [0, 1] });
  });
  it('대소문자 무시, 못 찾으면 앞 20글자로 다시', () => {
    expect(locate(['Naver ANALYTICS'], 'naver analytics', 0)).toEqual({ start: [0, 0], end: [0, 15] });
    expect(locate(['예시 서비스 — 지점 A 사용 안내 계정 안내'], '예시 서비스 — 지점 A 사용 안내 계정(원본과 다름)', 0)).toEqual({ start: [0, 0], end: [0, 20] });
    expect(locate(['없음'], '딴 글', 0)).toBeNull();
  });
});

// ⌘F 를 시작하면 보던 자리를 버리고 문서 맨 위 첫 결과로 튀었다(2026-10-04 QA N2) — 브라우저 찾기처럼 보던 자리 다음 것부터
describe('startAt — 찾기 시작 결과: 보던 자리(화면 위 끝) 이후 첫 결과, 없으면 처음으로 돌아감', () => {
  it('재현: 24장 근처를 보다가 찾으면 1장이 아니라 그 근처', () => {
    expect(startAt([10, 500, 2400, 2600, 5000], 2300)).toBe(2);
  });
  it('보던 자리 위 끝에 딱 걸친 결과는 그 결과', () => {
    expect(startAt([10, 2300, 2600], 2300)).toBe(1);
  });
  it('보던 자리 아래에 결과가 없으면 처음 것(돌아감)', () => {
    expect(startAt([10, 500], 9000)).toBe(0);
  });
  it('맨 위에서 시작하면 처음 것, 결과 없으면 0', () => {
    expect(startAt([10, 500], 0)).toBe(0);
    expect(startAt([], 300)).toBe(0);
  });
  it('위치가 순서대로가 아니어도(표 칸·나란한 블록) 보던 자리에서 가장 가까운 아래 것', () => {
    expect(startAt([3000, 100, 2500, 2800], 2400)).toBe(2);
  });
});
