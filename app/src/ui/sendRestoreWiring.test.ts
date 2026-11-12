import { describe, expect, it } from 'vitest';
import bubble from './space/DeskBubble.tsx?raw';
import remote from './chat/RemoteChat.tsx?raw';

// 2026-11-01 ux-daily M12 — 배지 대화창·다른 기기 참모 채팅은 보내기에 실패해도 입력칸이 비었다(ChatView 는 send 가 false 를 줄 때만 되살린다)
describe('보내기 실패면 false — ChatView 가 친 글을 입력칸에 되살린다', () => {
  it('배지 대화창: bubble_send 실패면 false, 붙여 둔 경로도 되돌린다', () => {
    expect(bubble).toMatch(/const send = \(body: string\): Promise<boolean \| 'inflight'> =>/);
    // 성공은 true(훅이 도는 중이면 'inflight' — 2026-11-13), 실패는 false + 경로 되돌림
    expect(bubble).toMatch(/invoke<string>\('bubble_send', \{ id: chatId, text \}\)\.then\(\(r\) => \{ setErr\(null\); return r === 'inflight' \? 'inflight' as const : true; \}, \(e: unknown\) => \{ term\.current = text\.slice\(0, text\.length - body\.length\) \+ term\.current;/);
  });
  it('다른 기기 참모: 막힘(직접 친 말 아님·옛 판)도 실패도 false', () => {
    expect(remote).toMatch(/const send = useCallback\(\(text: string\): Promise<boolean \| 'inflight'> => \{/);
    expect(remote).toMatch(/type it again'\)\); return Promise\.resolve\(false\); \}/);
    expect(remote).toMatch(/if \(sayTooOld\(target\.version\)\) \{ setErr\(tooOld\); return Promise\.resolve\(false\); \}/);
    // 받았으면 'inflight' — 그 기기는 받자마자 202 로 답하고 뒤에서 친다. 훅이 느리면 기록이 늦게 붙어 30초에 거짓 '전달 안 됨'이 떴다(2026-11-13)
    expect(remote).toMatch(/return invoke\('remote_human_say', \{ id: dev, to: agent, text \}\)\.then\(\(\) => \{ setErr\(null\); return 'inflight' as const; \}/);
  });
});
