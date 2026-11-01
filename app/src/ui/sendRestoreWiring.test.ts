import { describe, expect, it } from 'vitest';
import bubble from './space/DeskBubble.tsx?raw';
import remote from './chat/RemoteChat.tsx?raw';

// 2026-11-01 ux-daily M12 — 배지 대화창·다른 기기 참모 채팅은 보내기에 실패해도 입력칸이 비었다(ChatView 는 send 가 false 를 줄 때만 되살린다)
describe('보내기 실패면 false — ChatView 가 친 글을 입력칸에 되살린다', () => {
  it('배지 대화창: bubble_send 실패면 false, 붙여 둔 경로도 되돌린다', () => {
    expect(bubble).toMatch(/const send = \(body: string\): Promise<boolean> =>/);
    expect(bubble).toMatch(/invoke\('bubble_send', \{ id: chatId, text \}\)\.then\(\(\) => \{ setErr\(null\); return true; \}, \(e: unknown\) => \{ term\.current = text\.slice\(0, text\.length - body\.length\) \+ term\.current;/);
  });
  it('다른 기기 참모: 막힘(직접 친 말 아님·옛 판)도 실패도 false', () => {
    expect(remote).toMatch(/const send = useCallback\(\(text: string\): Promise<boolean> => \{/);
    expect(remote).toMatch(/type it again'\)\); return Promise\.resolve\(false\); \}/);
    expect(remote).toMatch(/if \(sayTooOld\(target\.version\)\) \{ setErr\(tooOld\); return Promise\.resolve\(false\); \}/);
    expect(remote).toMatch(/return invoke\('remote_human_say', \{ id: dev, to: agent, text \}\)\.then\(\(\) => \{ setErr\(null\); return true; \}/);
  });
});
