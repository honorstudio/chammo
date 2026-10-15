import { describe, expect, it } from 'vitest';
import { chatHeadPane } from '../../domain/paneLayout';
import app from '../../App.tsx?raw';
import grid from '../SessionGrid.tsx?raw';
import pane from '../TerminalPane.tsx?raw';
import space from './space.css?raw';
import chatCss from '../chat/chat.css?raw';

// 2026-10-12 사용자(캡처 chat-header-1·2, 참모-2 전달): ① 고른 프사 칸과 채팅 칸이 한 면으로 안 이어져 보인다(머리 밑 경계선·회색 칸 머리 줄)
// ② 채팅 머리에 프사가 또 있어 이중 — 글만 ③ 머리 줄 '개발 담당 / 맡은 일' 아래 칸 머리 줄에 같은 글이 또 — 한 줄로, 아래 줄 단추(메모·터미널·크게)는 위로
describe('chatHeadPane — 채팅 머리에 올릴 창', () => {
  it('탭 보기면 지금 보이는 탭 — 다른 세션으로 바꾸면 머리도 그 세션', () => {
    expect(chatHeadPane({ tabbed: true, active: 'b', shown: ['b'] })).toBe('b');
    expect(chatHeadPane({ tabbed: true, active: 'c', shown: ['c'] })).toBe('c');
  });
  it('쌓기에 창이 하나면 그 창(칸 머리 줄은 숨긴다)', () => expect(chatHeadPane({ tabbed: false, active: null, shown: ['a'] })).toBe('a'));
  it('여럿 쌓였으면 없음 — 칸마다 머리가 이름표(위에 또 올리면 두 번)', () => expect(chatHeadPane({ tabbed: false, active: null, shown: ['a', 'b'] })).toBeNull());
  it('보이는 창이 없으면 없음', () => expect(chatHeadPane({ tabbed: false, active: null, shown: [] })).toBeNull());
});

describe('채팅 머리 — 글만, 한 줄', () => {
  const at = app.indexOf('className="space-chat-head');
  const head = app.slice(at, app.indexOf('</div>', at));
  it('머리엔 프사가 없다(띠에 이미 있다)', () => {
    expect(head).not.toMatch(/OrchAvatar/);
    expect(app).not.toMatch(/import \{[^}]*\bOrchAvatar\b[^}]*\} from '\.\/ui\/avatar'/);
  });
  it('이름·맡은 일·단추는 격자가 보이는 창 것으로 머리 자리에 올린다(App 은 자리만)', () => {
    expect(head).toMatch(/ref=\{setChatHeadSlot\}/);
    expect(app).toMatch(/headSlot=\{chatHeadSlot\}/);
    expect(grid).toMatch(/createPortal\(/);
    expect(grid).toMatch(/chatHeadPane\(/);
    expect(grid).toMatch(/className="sch-name"/);
    expect(grid).toMatch(/className="sch-role"/);
  });
  it('한 창만 보이면 칸 머리 줄은 없다(같은 글 두 번 금지)', () => {
    expect(grid).toMatch(/headless=\{/);
    expect(pane).toMatch(/\{!headless && \(\s*<div className="pane-head"/);
  });
  it('머리줄 없는 창은 채팅 판이 맨 위부터(빈 35px 로 뒤 터미널 커서가 비쳤다 — 하네스 실측)', () => {
    expect(pane).toMatch(/\$\{headless \? ' headless' : ''\}/);
    expect(chatCss.length).toBeGreaterThan(0);
    expect(chatCss).toMatch(/\.pane\.headless > \.chat \{ top: 0; \}/);
  });
});

describe('고른 프사 → 채팅 한 면', () => {
  it('왼쪽 채팅 머리는 채팅 바탕과 같은 면, 아래 경계선 없음', () => {
    expect(space).toMatch(/\.space-mode \.office-chats\.left \.space-chat-head \{[^}]*background: var\(--surface\);[^}]*border-bottom: 0;/);
  });
});
