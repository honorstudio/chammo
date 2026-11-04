// 떠 있는 참모 대화창에 끌어 놓기(2026-11-01 사용자 '다른 참모와 얘기하려 했는데 너한테 간다 자꾸') — DOM 없이 소스로 지키는 연결 규칙
import { describe, expect, it } from 'vitest';
import bubble from './OrchBubble.tsx?raw';
import drag from './dragPath.ts?raw';
import chatDrop from './chatDrop.ts?raw';
import css from './orchBubble.css?raw';

describe('떠 있는 대화창 머리 얼굴 = 놓을 자리', () => {
  it('얼굴마다 data-orch-drop — 띠 프사와 같은 놓을 자리', () => {
    expect(bubble).toMatch(/className=\{`obb-face[^`]*`\}[^>]*data-orch-drop=\{o\.id\}/);
  });
  it('놓으면 얼굴이 채팅 칸보다 먼저 — 머리는 채팅 칸 안이라 늘 지금 참모로 갔다', () => {
    expect(drag).toContain('const id = orch ?? chatAt(x, y);');
    expect(drag).not.toContain("chatAt(x, y) ?? (payload.kind !== 'team' ? orch ?? null : null)");
    expect(drag).toContain('const id = orch ?? chatAt(x, y) ?? null;');
  });
  it('끄는 동안에도 얼굴이 먼저 빛난다(채팅 칸 빛은 끈다)', () => {
    expect(drag).toMatch(/const face = folderAt\(x, y, ORCH_SPOT\);\s*\n\s*const chat = face \? null : chatDropAt\(x, y\);/);
  });
  it('떠 있는 동안은 숨은 채팅 카드 대신 떠 있는 창과 지금 얼굴을 빛낸다', () => {
    expect(chatDrop).toContain("col.querySelector<HTMLElement>('.obb-float')");
    expect(css).toMatch(/\.obb-float\.drop-hot::after/);
    expect(css).toMatch(/\.obb-face\.drop-hot::after/);
  });
});
