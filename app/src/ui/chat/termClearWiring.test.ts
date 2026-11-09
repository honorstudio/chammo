// 채팅 판이 뒤 터미널 입력칸을 지울 때·붙인 것 기억을 비울 때 — 화면 읽기만 믿지 않는다(2026-11-01 사용자 '#file1 세 번, 하나는 중간에서 잘림')
import { describe, expect, it } from 'vitest';
import chat from './ChatView.tsx?raw';
import attach from '../../domain/chatAttach.ts?raw';

describe('터미널 입력칸 지우기', () => {
  it('지우는 곳 셋(빼기·다시 넣기·남은 말 비우기)이 모두 clearCount(읽은 글, 붙인 글) — 읽은 글 길이 + 20 만 쓰지 않는다', () => {
    expect(chat).not.toMatch(/clearTerminal\(\[\.\.\.(termText|term)\]\.length \+ 20\)/);
    expect(chat.match(/clearTerminal\(clearCount\(/g)?.length).toBe(3);
  });
  it('붙여 넣은 글 길이를 센다 — 칩 붙여넣기 조각마다', () => {
    expect(chat).toMatch(/pasted\.current \+= \[\.\.\.t\]\.length/);
  });
  it('빈 입력칸 판정은 nextEmpties — 못 읽음(null)을 빈 칸으로 세지 않는다', () => {
    // 11-05 부터 첨부 줄 판단(domain/chatAttach)이 센다 — 화면 읽기를 그대로 넘긴다
    expect(attach).toContain('const empties = nextEmpties(s.empties, e.raw)');
    expect(chat).toContain("stepAtt({ kind: 'read', raw, draft: draftRef.current, now: Date.now() })");
  });
});
