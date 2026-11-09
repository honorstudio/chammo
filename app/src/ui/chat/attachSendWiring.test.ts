// 첨부 줄 연결(2026-11-05 사용자 '계속 첨부 중') — 판단은 domain/chatAttach 가 하고, ChatView 는 보낼 때마다 그 판단을 부른다
import { describe, expect, it } from 'vitest';
import chat from './ChatView.tsx?raw';

describe('ChatView 첨부 줄', () => {
  it('채팅에서 보내면(바로·끊고 보내기·입력칸 글만 보내기) 줄을 비우고 그 그림을 대기 말풍선에 붙인다', () => {
    expect(chat.match(/const went = sendAtt\(\);/g)).toHaveLength(2);
    expect(chat.match(/sendWatched\(text, at, went\)/g)).toHaveLength(2);
    expect(chat.match(/\.\.\.imgsOf\(went\)/g)).toHaveLength(2);
    expect(chat).toContain('{p.imgs && <div className="chat-thumbs">');
  });
  it('보내기가 실패하면 줄에 되돌린다 — 보낼 그림이 사라지지 않게', () => {
    expect(chat).toContain("if (went.length) stepAtt({ kind: 'back', went });");
  });
  it('줄은 세션마다 기억해 창이 새로 그려져도 남고, 비우는 판단은 한 곳(attachStep)', () => {
    expect(chat).toContain('attBy.get(paneId)');
    expect(chat).toContain('attBy.set(paneNow.current, r.s)');
    expect(chat).not.toMatch(/imgCount|fileCount|lastAttach|empties\.current/);
  });
});
