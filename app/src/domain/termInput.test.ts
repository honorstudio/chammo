import { describe, expect, test } from 'vitest';
import { promptInput } from './chat';
import { clearCount, nextEmpties } from './termInput';

// 실측(2026-11-01, Claude Code 2.1.316 · tmux 42칸): 같은 경로를 세 번 붙이면 입력칸은 끝 8줄만 보인다 — 앞 두 덩어리가 화면 밖
const P = '#file1 "/Users/me/Documents/도우미함/비서 · 일정 정리/팀 보관함/우리팀/대화 파일/세로 사진 모음 파일.zip" ';
const TAIL = [
  '────────────────────────────── demo ─',
  '❯ 사진 모음 파일.zip" #file1 "/Users/me/',
  '  Documents/도우미함/비서 · 일정',
  '  정리/팀 보관함/우리팀/대화',
  '  파일/세로 사진 모음 파일.zip" #file1',
  '  "/Users/me/Documents/도우미함/비서',
  '  · 일정 정리/팀 보관함/우리팀/대화',
  '  파일/세로 사진 모음',
  '  파일.zip"',
  '──────────────────────────────────────────',
  '  main* · Opus 5.5 · medium',
];
// 10줄 창: 입력칸 아래 선이 화면 밖 — 읽기 실패(null)
const SHORT = [
  '──────────────────────────────── demo ─',
  '❯ uments/도우미함/비서 · 일정 정리/팀',
  '  보관함/우리팀/대화 파일/세로 사진 모음',
  '  파일.zip"',
];
const EMPTY = ['──────────', '❯ ', '──────────', '  main*'];

describe('터미널 입력칸 지우기 수(clearCount)', () => {
  test('입력칸이 잘려 보이면 읽은 글보다 붙인 글이 길다 — 붙인 만큼 지운다(20칸만 지워 경로가 잘려 남던 것, 11-01 사용자)', () => {
    const read = promptInput(TAIL, [0, 0]) ?? '';
    const pasted = [...P].length * 3;
    expect([...read].length).toBeLessThan(pasted);
    expect(clearCount(read, pasted)).toBe(pasted + 20);
  });
  test('못 읽으면(null → 빈 글) 붙인 글 길이로', () => {
    expect(promptInput(SHORT, [0, 0])).toBeNull();
    expect(clearCount('', [...P].length)).toBe([...P].length + 20);
  });
  test('앱이 안 붙인 글(손으로 친 것)은 읽은 길이로 — 한글은 글자 수로 센다', () => {
    expect(clearCount('안녕 하세요', 0)).toBe(6 + 20);
  });
});

describe('입력칸이 빈 횟수(nextEmpties) — 붙인 것 기억을 비울지', () => {
  test('입력칸이 다 보이고 비었을 때만 센다', () => {
    expect(nextEmpties(2, promptInput(EMPTY, [1, 1]))).toBe(3);
  });
  test('못 읽으면(null·잠깐 조용히) 처음부터 다시 센다 — 붙이기 전 빈 칸 횟수가 남아 글이 있는데도 #file 기억을 지워 같은 파일이 #file1 로 또 붙었다(하네스 재현)', () => {
    expect(nextEmpties(10, promptInput(SHORT, [0, 0]))).toBe(0);
    expect(nextEmpties(10, undefined)).toBe(0);
  });
  test('글이 보이면 0', () => {
    expect(nextEmpties(5, promptInput(TAIL, [0, 0]))).toBe(0);
  });
});
