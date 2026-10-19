import { describe, expect, it } from 'vitest';
import { dropText, paneAt, shellEscape, docDropBlocks, dropSlot, chatCellAt, quotePath, chipPastes } from './drop';

describe('shellEscape — iTerm 처럼 경로를 백슬래시로 이스케이프', () => {
  it('평범한 경로는 그대로', () => {
    expect(shellEscape('/Users/a/Desktop/shot.png')).toBe('/Users/a/Desktop/shot.png');
  });
  it('공백은 \\ 로 — macOS 스크린샷 이름', () => {
    expect(shellEscape('/Users/a/Desktop/스크린샷 2026-09-27 오후 7.09.02.png')).toBe(
      '/Users/a/Desktop/스크린샷\\ 2026-09-27\\ 오후\\ 7.09.02.png',
    );
  });
  it('한글은 건드리지 않는다', () => {
    expect(shellEscape('/Users/a/바탕화면/사진.jpg')).toBe('/Users/a/바탕화면/사진.jpg');
  });
  it('셸 특수문자는 전부 앞에 \\', () => {
    expect(shellEscape(`/a/b (1)&'"$!;*?[]{}|<>#~^\`\\=.png`)).toBe(
      `/a/b\\ \\(1\\)\\&\\'\\"\\$\\!\\;\\*\\?\\[\\]\\{\\}\\|\\<\\>\\#\\~\\^\\\`\\\\=.png`,
    );
  });
  it('탭도 이스케이프', () => {
    expect(shellEscape('/a/x\ty.png')).toBe('/a/x\\\ty.png');
  });
  it('줄바꿈이 섞이면 $\'…\' 로 — 입력칸에서 Enter 로 먹히지 않게', () => {
    expect(shellEscape("/a/x\ny'z.png")).toBe("$'/a/x\\ny\\'z.png'");
  });
});

describe('dropText — 여러 개는 공백으로, 끝에 공백 하나(이어서 쓰기 좋게)', () => {
  it('하나', () => {
    expect(dropText(['/a/b c.png'])).toBe('/a/b\\ c.png ');
  });
  it('여러 개', () => {
    expect(dropText(['/a/1.png', '/a/스크린샷 2.png'])).toBe('/a/1.png /a/스크린샷\\ 2.png ');
  });
  it('없으면 빈 글자', () => {
    expect(dropText([])).toBe('');
  });
});

describe('quotePath — 칩 경로는 큰따옴표 안이 통째로 경로', () => {
  it('띄어쓰기·가운뎃점은 그대로, 바깥만 따옴표', () => {
    expect(quotePath('/Users/me/Documents/Chammo/참모 · 시험/보고 폴더')).toBe('"/Users/me/Documents/Chammo/참모 · 시험/보고 폴더"');
  });
  it('안의 " 와 \\ 는 앞에 \\', () => {
    expect(quotePath('/a/"따옴표" 폴더/b\\c')).toBe('"/a/\\"따옴표\\" 폴더/b\\\\c"');
  });
  it('줄바꿈은 \\n — 입력칸에서 Enter 로 먹히지 않게', () => {
    expect(quotePath('/a/x\ny')).toBe('"/a/x\\ny"');
  });
});

describe('chipPastes — 붙인 칩 → 입력칸에 붙여넣을 글 조각', () => {
  it('폴더·문서는 이름표 바로 뒤 따옴표 경로 — 뒤에 사람 글이 붙어도 경계가 보인다(10/19 새 폴더 사고)', () => {
    const [t] = chipPastes([{ path: '/Users/me/보관함/보고 폴더', label: '#file1' }]);
    expect(t).toBe('#file1 "/Users/me/보관함/보고 폴더" ');
    expect(`${t}보낼 파일 여기에 담아줘`).toContain('"/Users/me/보관함/보고 폴더" 보낼');
    expect(t).not.toContain('\\ ');
  });
  it('Claude Code 가 그림으로 읽는 것(png·jpg·gif·webp)은 이스케이프 그대로 따로 한 조각 — 따옴표·이름표를 섞으면 [Image #n] 으로 안 바뀐다', () => {
    expect(chipPastes([
      { path: '/a/스크린샷 1.png', label: '#img1' },
      { path: '/a/제안서 v2.pdf', label: '#file1' },
      { path: '/a/b.JPG', label: '#img2' },
    ])).toEqual(['/a/스크린샷\\ 1.png /a/b.JPG ', '#file1 "/a/제안서 v2.pdf" ']);
  });
  it('그림이라도 Claude 가 못 읽는 확장자(heic)는 이름표 + 따옴표', () => {
    expect(chipPastes([{ path: '/a/IMG 1.heic', label: '#img1' }])).toEqual(['#img1 "/a/IMG 1.heic" ']);
  });
  it('이름표가 없으면 따옴표 경로만, 아무것도 없으면 빈 목록', () => {
    expect(chipPastes([{ path: '/a/메모.md' }])).toEqual(['"/a/메모.md" ']);
    expect(chipPastes([])).toEqual([]);
  });
});

describe('paneAt — 드롭한 점이 어느 칸인가', () => {
  const panes = [
    { id: 'a', left: 0, top: 0, right: 100, bottom: 100 },
    { id: 'b', left: 100, top: 0, right: 200, bottom: 100 },
    { id: 'c', left: 0, top: 100, right: 200, bottom: 200 },
  ];
  it('안쪽 점은 그 칸', () => {
    expect(paneAt(panes, 50, 50)).toBe('a');
    expect(paneAt(panes, 150, 20)).toBe('b');
    expect(paneAt(panes, 10, 150)).toBe('c');
  });
  it('경계는 왼쪽·위 칸이 가진다(오른쪽·아래 끝은 제외)', () => {
    expect(paneAt(panes, 100, 50)).toBe('b');
    expect(paneAt(panes, 50, 100)).toBe('c');
  });
  it('어느 칸도 아니면(사이드바·작업 패널 위) null', () => {
    expect(paneAt(panes, 250, 50)).toBeNull();
    expect(paneAt(panes, -1, 50)).toBeNull();
    expect(paneAt([], 10, 10)).toBeNull();
  });
  it('겹치면 나중 것(위에 그려진 것)', () => {
    expect(paneAt([...panes, { id: 'top', left: 40, top: 40, right: 60, bottom: 60 }], 50, 50)).toBe('top');
  });
});

describe('docDropBlocks — 문서 편집기에 끌어다 놓은 파일의 블록 종류', () => {
  it('그림·영상·소리는 그 블록, 나머지(PDF·문서·압축)는 파일 블록', () => {
    expect(docDropBlocks(['/a/b.PNG', '/a/c.mp4', '/a/d.mp3', '/a/e.pdf', 'C:\\x\\f.zip'])).toEqual([
      { path: '/a/b.PNG', type: 'image' },
      { path: '/a/c.mp4', type: 'video' },
      { path: '/a/d.mp3', type: 'audio' },
      { path: '/a/e.pdf', type: 'file' },
      { path: 'C:\\x\\f.zip', type: 'file' },
    ]);
  });
  it('빈 목록은 빈 배열', () => {
    expect(docDropBlocks([])).toEqual([]);
  });
});

describe('dropSlot — 문서에 놓을 자리(가장 가까운 블록의 위/아래)', () => {
  const blocks = [
    { id: 'a', top: 0, bottom: 40 },
    { id: 'b', top: 50, bottom: 90 },
    { id: 'c', top: 100, bottom: 140 },
  ];
  it('블록 위쪽 절반이면 그 앞, 아래쪽 절반이면 그 뒤', () => {
    expect(dropSlot(blocks, 55)).toEqual({ id: 'b', place: 'before', y: 50 });
    expect(dropSlot(blocks, 85)).toEqual({ id: 'b', place: 'after', y: 90 });
  });
  it('블록 사이 빈 곳은 가까운 쪽 블록에 붙는다', () => {
    expect(dropSlot(blocks, 43)).toEqual({ id: 'a', place: 'after', y: 40 });
    expect(dropSlot(blocks, 48)).toEqual({ id: 'b', place: 'before', y: 50 });
  });
  it('맨 위보다 위면 첫 블록 앞, 맨 아래보다 아래면 마지막 블록 뒤', () => {
    expect(dropSlot(blocks, -20)).toEqual({ id: 'a', place: 'before', y: 0 });
    expect(dropSlot(blocks, 400)).toEqual({ id: 'c', place: 'after', y: 140 });
  });
  it('겹치면(목록 속 블록) 안쪽 작은 블록', () => {
    expect(dropSlot([{ id: 'list', top: 0, bottom: 100 }, { id: 'child', top: 60, bottom: 80 }], 75)).toEqual({ id: 'child', place: 'after', y: 80 });
  });
  it('블록이 없으면 null', () => {
    expect(dropSlot([], 10)).toBeNull();
  });
});

// 2026-10-12 사용자: 입력창까지 옮겨야만 들어갔다 → 채팅 칸(머리·대화 기록·입력칸·여백) 어디든 놓으면 그 칸 세션 입력칸에
describe('chatCellAt — 채팅 칸 안 어디에 놓아도 받을 세션', () => {
  const one = [{ id: 's1', left: 0, top: 60, right: 400, bottom: 800 }];
  const two = [{ id: 'a', left: 0, top: 60, right: 400, bottom: 400 }, { id: 'b', left: 0, top: 400, right: 400, bottom: 800 }];
  it('세션 칸 위면 그 칸', () => expect(chatCellAt(two, 100, 500)).toBe('b'));
  it('칸 밖(채팅 머리·카드 여백)이면 가장 가까운 칸 — 하나면 그 칸', () => {
    expect(chatCellAt(one, 100, 20)).toBe('s1');
    expect(chatCellAt(one, 403, 300)).toBe('s1');
  });
  it('쌓기에 여럿이면 머리 위는 맨 위 칸, 맨 아래 여백은 맨 아래 칸', () => {
    expect(chatCellAt(two, 100, 20)).toBe('a');
    expect(chatCellAt(two, 100, 805)).toBe('b');
  });
  it('받을 칸이 없으면 null', () => expect(chatCellAt([], 1, 1)).toBeNull());
});
