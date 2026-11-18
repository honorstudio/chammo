import { describe, expect, it } from 'vitest';
import chat from './chat/ChatView.tsx?raw';
import chatCss from './chat/chat.css?raw';
import spaceCss from './space/space.css?raw';
import phone from './mobile/MessageList.tsx?raw';

// 2026-11-17 사용자: 일하는 중 보낸 말이 점선 상자·'대기 중' 글·보내기/빼기 단추로 아직 안 간 것처럼 보였다 — 판단은 domain/queueBubble.test, 여기선 화면이 그 판단에 이어졌나만
describe('화면 — 점선 상자·대기 중 글·보내기/빼기 단추가 없다', () => {
  it('데스크톱 채팅(원격 참모·바탕 대화창·떠 있는 창·팀 에이전트 채팅이 같은 ChatView)', () => {
    expect(chat).not.toMatch(/참모가 지금 단계를 마치면/);
    expect(chat).not.toMatch(/chat-pend-acts/);
    expect(chat).not.toMatch(/label=\{tr\('빼기', 'Remove'\)\} onClick=\{\(\) => act\(/);
    expect(chat).not.toMatch(/줄 서 있는 말이 있어요/);
    expect(chat).toMatch(/className="chat-unread"/);
    expect(chat).toMatch(/mark === 'failed'/);
  });
  it('CSS 에 점선·흐림이 남지 않는다', () => {
    expect(chatCss).not.toMatch(/st-queued|chat-pend-acts/);
    expect(chatCss).not.toMatch(/\.bubble\.pending/);
    expect(spaceCss).not.toMatch(/bubble\.me\.pending/);
  });
  it('줄 선 말 고치기는 숨은 길 — 빈 입력칸 ↑ 로 꺼낸다(CLI 와 같이)', () => {
    expect(chat).toMatch(/e\.key === 'ArrowUp'[^\n]*canPull\(\)\) \{ e\.preventDefault\(\); pullQueued\(\)/);
  });
  it('끊고 보내기로 다시 넣은 말은 데스크톱·폰 다 한 번만', () => {
    expect(chat).toMatch(/dropRescued\(rewound/);
    expect(phone).toMatch(/dropRescued\(items\)/);
  });
  it('폰 보낼 함도 흐림 없이 보통 말풍선 + 작은 점', () => {
    expect(phone).not.toMatch(/m-pending/);
    expect(phone).toMatch(/className="m-unread"/);
  });
});
