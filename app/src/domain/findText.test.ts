import { describe, expect, it } from 'vitest';
import { findAll, locate } from './findText';

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
