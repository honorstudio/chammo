import { describe, expect, it } from 'vitest';
import { NOTE_PANEL_W, NOTE_W_MAX, NOTE_W_MIN, noteLines, noteMd, noteOverlay, notePaste, noteTitle, notesToggle, noteW, noteWhen, pickNote, SKINS, skinOf, splitNotes, withPlain, type NoteRow, noteFresh, noteStale } from './notes';

const row = (name: string, title = '', at = 0, x: Partial<NoteRow> = {}): NoteRow => ({ name, path: `/d/notes/${name}`, title, preview: '', at, skin: 'paper', shown: false, win: false, ...x });

describe('좁은 창 — 스페이스 내용이 360 밑이면 패널을 덮개로', () => {
  it('자리를 나란히 뒀을 때 남는 폭으로 가른다(폭이 패널 상태에 안 흔들린다)', () => {
    expect(NOTE_PANEL_W).toBe(300);
    expect(noteOverlay(660)).toBe(false); // 300 + 360 — 딱 맞으면 나란히
    expect(noteOverlay(659)).toBe(true);
    expect(noteOverlay(714)).toBe(false);
    expect(noteOverlay(400)).toBe(true);
  });
  it('끌어서 넓힌 폭이면 그 폭으로 가른다', () => {
    expect(noteOverlay(840, 480)).toBe(false); // 480 + 360
    expect(noteOverlay(839, 480)).toBe(true);
  });
});

describe('패널 폭 — 왼쪽 경계를 끌어 바꾸고 기억(11-05 사용자)', () => {
  it('끌지 않았으면(기억 없음·망가진 값) 지금 폭', () => {
    expect(noteW(null)).toBe(NOTE_PANEL_W);
    expect(noteW('abc')).toBe(NOTE_PANEL_W);
  });
  it('기억한 폭은 최소·최대 안으로', () => {
    expect(noteW('420')).toBe(420);
    expect(noteW('100')).toBe(NOTE_W_MIN);
    expect(noteW('5000')).toBe(NOTE_W_MAX);
    expect(NOTE_W_MIN).toBeLessThan(NOTE_PANEL_W);
    expect(NOTE_W_MAX).toBeGreaterThan(NOTE_PANEL_W);
  });
});

describe('보내기 아이콘 — 메모 글 통째를 입력칸에(보내기는 사람이 Enter)', () => {
  it('앞뒤 빈 줄을 걷어 낸 글, 비었으면 null', () => {
    expect(notePaste('\n\n뭐가 될지 잘\n모르겠네\n\n')).toBe('뭐가 될지 잘\n모르겠네');
    expect(notePaste('  \n ')).toBeNull();
  });
  it('입력칸에 쓰던 글이 있으면 줄을 바꿔 뒤에, 비었으면 그대로', () => {
    expect(withPlain('', '메모')).toBe('메모');
    expect(withPlain('이거 봐 ', '메모\n둘째 줄')).toBe('이거 봐\n메모\n둘째 줄');
  });
});

describe('열 메모 고르기', () => {
  const rows = [row('b.md'), row('a.md')];
  it('마지막에 본 메모가 있으면 그것', () => expect(pickNote(rows, 'a.md')?.name).toBe('a.md'));
  it('없어졌거나 처음이면 맨 위', () => {
    expect(pickNote(rows, 'gone.md')?.name).toBe('b.md');
    expect(pickNote(rows, null)?.name).toBe('b.md');
  });
  it('메모가 없으면 없음', () => expect(pickNote([], 'a.md')).toBeNull());
});

describe('머리줄 아이콘을 누르면', () => {
  it('터미널 뷰는 늘 따로 창', () => {
    expect(notesToggle(false, false, false)).toBe('window');
    expect(notesToggle(false, true, false)).toBe('window');
  });
  it('채팅 뷰는 패널을 여닫는다', () => {
    expect(notesToggle(true, false, false)).toBe('panel');
    expect(notesToggle(true, true, false)).toBe('closed');
  });
  it('창이 떠 있으면 그 창을 앞으로', () => expect(notesToggle(true, false, true)).toBe('window'));
});

describe('이름·날짜', () => {
  it('빈 메모는 넘겨준 대신 글로', () => {
    expect(noteTitle(row('a.md', '장 볼 것 내용'), '새 메모')).toBe('장 볼 것 내용');
    expect(noteTitle(row('a.md'), '새 메모')).toBe('새 메모');
  });
  it('오늘은 시각, 그 전은 월/일', () => {
    const now = new Date(2026, 10, 5, 14, 0).getTime();
    expect(noteWhen(new Date(2026, 10, 5, 9, 7).getTime(), now)).toBe('09:07');
    expect(noteWhen(new Date(2026, 9, 29, 23, 0).getTime(), now)).toBe('10/29');
    expect(noteWhen(0, now)).toBe('');
  });
});

describe('스킨 4종(시안 v2 K)', () => {
  it('넷 — 모르는 값은 메모지', () => {
    expect(SKINS).toEqual(['paper', 'lined', 'dark', 'term']);
    expect(skinOf('term')).toBe('term');
    expect(skinOf('neon')).toBe('paper');
    expect(skinOf(undefined)).toBe('paper');
  });
});

describe('띄운 / 안 띄운(시안 v2 P 나 안) — 따로 창에 뜬 메모는 패널에 안 쌓는다', () => {
  const rows = [
    row('note-3.md', '셋', 300, { shown: true }),
    row('note-1.md', '하나', 900, { shown: true, win: true }),
    row('note-5.md', '다섯', 100, { shown: true }),
    row('note-2.md', '둘', 500),
    row('note-4.md', '넷', 700),
  ];
  const n = (rs: NoteRow[]) => rs.map((r) => r.name);
  it('쌓는 순서는 만든 순(새 것 위) — 고칠 때마다 자리가 안 바뀐다', () => expect(n(splitNotes(rows).stack)).toEqual(['note-5.md', 'note-3.md']));
  it('따로 창은 창 칸에', () => expect(n(splitNotes(rows).windows)).toEqual(['note-1.md']));
  it('띄운 칸 = 패널 + 창, 안 띄운 칸은 최근 고친 것부터', () => {
    expect(n(splitNotes(rows).shown)).toEqual(['note-5.md', 'note-3.md', 'note-1.md']);
    expect(n(splitNotes(rows).hidden)).toEqual(['note-4.md', 'note-2.md']);
  });
});

// 데스크톱 메모는 블록 편집기라 문단마다 빈 줄(\n\n)로 저장한다 — 폰 글 칸이 그대로 보여 줄마다 빈 줄이 끼었다(2026-11-06 사용자)
describe('폰 메모 글 칸 — 문단 = 한 줄', () => {
  const md = '뭐가 될지\n\n잘되긴 하는데\n\n그래서\n';
  it('문단 사이 빈 줄 없이 그린다', () => {
    expect(noteLines(md)).toBe('뭐가 될지\n잘되긴 하는데\n그래서');
  });
  it('안 고치면 저장 글 그대로', () => {
    expect(noteMd(noteLines(md), md)).toBe(md);
    expect(noteMd(noteLines('a\r\n\r\nb'), 'a\r\n\r\nb')).toBe('a\r\n\r\nb');
  });
  it('고치면 줄마다 문단으로 — 끝 줄바꿈은 원래대로', () => {
    expect(noteMd('뭐가 될지\n잘되긴 하는데\n그래서 끝', md)).toBe('뭐가 될지\n\n잘되긴 하는데\n\n그래서 끝\n');
  });
  it('목록 줄끼리는 한 줄(데스크톱이 쓰는 모양)', () => {
    expect(noteLines('- a\n- b\n\n끝')).toBe('- a\n- b\n끝');
    expect(noteMd('- a\n- b\n끝!', '- a\n- b\n\n끝')).toBe('- a\n- b\n\n끝!');
  });
  it('폰에서 넣은 빈 줄·끝 빈 줄이 타자마다 안 사라진다(왕복이 같다)', () => {
    for (const v of ['a\n\nb', 'a\n', 'a\n\n', '- a\n\n- b', '']) {
      for (const base of ['x', 'x\n']) expect(noteLines(noteMd(v, base))).toBe(v);
    }
  });
});

describe('폰 메모 탭 다시 열기(2026-11-08 사용자 "메모 나올 때 느림, 매번 새로 로드")', () => {
  it('noteStale — 기억이 없거나 목록의 고친 시각이 다르면 다시 받는다, 같으면 안 받는다', () => {
    expect(noteStale(undefined, 5)).toBe(true);
    expect(noteStale({ text: 'a', at: 5 }, 5)).toBe(false);
    expect(noteStale({ text: 'a', at: 5 }, 6)).toBe(true); // 맥·다른 기기가 고침
    expect(noteStale({ text: 'a', at: 0 }, 0)).toBe(true); // 시각을 모르면(맥 꺼짐 목록) 받는다
  });
  it('noteFresh — 쓰는 중(글 칸 ≠ 맥과 맞춘 글)이면 새 값으로 안 간다', () => {
    expect(noteFresh('옛 글폰타자', '옛 글', '맥에서 고침')).toBe('keep');
  });
  it('noteFresh — 안 고쳤으면 새 값으로 간다, 같으면 할 일 없음', () => {
    expect(noteFresh('옛 글', '옛 글', '맥에서 고침')).toBe('take');
    expect(noteFresh('같음', '옛 글', '같음')).toBe('same');
    expect(noteFresh('같음', '같음', '같음')).toBe('same');
  });
  it('noteFresh — 아직 맥과 한 번도 안 맞췄으면(첫 받기·글 칸 없음) 받은 글을 그린다', () => {
    expect(noteFresh(null, null, '첫 글')).toBe('take');
    expect(noteFresh('맥 꺼졌을 때 본 글', null, '맥 글')).toBe('take');
    expect(noteFresh('', null, '')).toBe('same');
  });
});
