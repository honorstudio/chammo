import { describe, expect, it } from 'vitest';
import { dropText, paneAt, shellEscape } from './drop';

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
