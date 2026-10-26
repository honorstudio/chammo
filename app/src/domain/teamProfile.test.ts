// 팀 프로필(이름·사진·상태) — 화면 판단(순수 함수). 저장 길은 Rust team_profile(팀 보관함 암호 길)
import { describe, expect, it } from 'vitest';
import { clampOffset, cropRect, dndNotice, lookOf, namedConvos, statusLine, type ProfileBoard } from './teamProfile';

const board: ProfileBoard = {
  team: 't1', rev: 3, teamIcon: '',
  people: {
    m2: { name: '준호', status: 'away', note: '점심 다녀올게요', photo: 'data:image/webp;base64,AA', at: 1 },
    m3: { name: '', status: 'dnd', note: '', photo: '', at: 1 },
  },
};

describe('팀 프로필 화면 판단', () => {
  // 팀 설정엔 바꾼 이름이 나오는데 대화 목록·DM 머리엔 명부의 옛 이름이 그대로였던 것
  it('사람 대화(DM) 이름은 프로필 이름으로, 단톡방 이름·프로필 없는 사람은 그대로', () => {
    const cs = [
      { key: 'd1', room: 'r1', peer: 'm2', name: '박준호', last: null, unread: 0, color: '#000', kind: 'dm' as const },
      { key: 'd2', room: 'r2', peer: 'm3', name: '서연', last: null, unread: 0, color: '#000', kind: 'dm' as const },
      { key: 'd3', room: '', peer: 'm9', name: '새사람', last: null, unread: 0, color: '#000' },
      { key: 'g1', room: 'r3', peer: '', name: 'QA방', last: null, unread: 0, color: '#000', kind: 'group' as const },
    ];
    expect(namedConvos(cs, board).map((c) => c.name)).toEqual(['준호', '서연', '새사람', 'QA방']);
    expect(namedConvos(cs, null)).toBe(cs); // 프로필판을 아직 못 읽었으면 그대로
  });

  it('바꾼 이름이 있으면 그 이름, 없으면 명부 이름 — 프로필이 아직 없으면 상태 없음', () => {
    expect(lookOf(board, 'm2', '박준호')).toEqual({ name: '준호', photo: 'data:image/webp;base64,AA', status: 'away', note: '점심 다녀올게요' });
    expect(lookOf(board, 'm3', '서연').name).toBe('서연');
    expect(lookOf(board, 'm9', '새사람')).toEqual({ name: '새사람', photo: '', status: '', note: '' });
    expect(lookOf(null, 'm2', '박준호').name).toBe('박준호');
  });
  it('상태 줄 — 상태 이름과 상태 글, 상태가 없으면 빈 줄', () => {
    expect(statusLine(lookOf(board, 'm2', ''))).toBe('자리 비움 · 점심 다녀올게요');
    expect(statusLine(lookOf(board, 'm3', ''))).toBe('방해 금지');
    expect(statusLine(lookOf(board, 'm9', ''))).toBe('');
  });
  it('방해 금지인 사람에게 보낼 때만 한 줄', () => {
    expect(dndNotice(lookOf(board, 'm3', '서연'))).toContain('서연');
    expect(dndNotice(lookOf(board, 'm2', '준호'))).toBeNull();
  });
});

describe('사진 자르기 계산', () => {
  it('확대 1 이면 짧은 변이 칸을 꽉 채우고 가운데를 자른다', () => {
    // 400×200 그림, 200 칸 → 비율 1, 가운데 200×200
    expect(cropRect({ w: 400, h: 200 }, 200, 1, { x: 0, y: 0 })).toEqual({ sx: 100, sy: 0, sw: 200, sh: 200 });
  });
  it('확대하면 더 작은 칸을 자르고, 옮기면 그만큼 원본에서 옮긴다', () => {
    // 200×200 그림, 100 칸, 확대 2 → 비율 1, 보이는 원본 100×100
    expect(cropRect({ w: 200, h: 200 }, 100, 2, { x: 0, y: 0 })).toEqual({ sx: 50, sy: 50, sw: 100, sh: 100 });
    expect(cropRect({ w: 200, h: 200 }, 100, 2, { x: 20, y: -10 })).toEqual({ sx: 30, sy: 60, sw: 100, sh: 100 });
  });
  it('옮기기는 그림이 칸 밖으로 빠지지 않게 묶는다', () => {
    expect(clampOffset({ w: 400, h: 200 }, 200, 1, { x: 500, y: 30 })).toEqual({ x: 100, y: 0 });
    expect(clampOffset({ w: 400, h: 200 }, 200, 1, { x: -500, y: -30 })).toEqual({ x: -100, y: 0 });
  });
});
