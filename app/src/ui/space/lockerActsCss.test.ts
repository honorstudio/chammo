import { describe, expect, it } from 'vitest';
import css from './locker.css?raw';

// 2026-10-11 사용자: 카드에 올리면 오른쪽 위 버튼이 영상 썸네일 위에서 투명하게 떠 지우기(더 보기) 버튼이 안 보였다.
// 원인 — 올림·눌림 바탕이 반투명 토큰(--hover, 라이트 .045)이라 아래 그림이 그대로 비쳤다.

describe('카드 위 동작 버튼 — 올려도 바탕이 비치지 않는다', () => {
  const rule = (sel: string) => new RegExp(`${sel.replace(/[.:()[\]]/g, '\\$&')}[^{]*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  const solid = (b: string) => /background:\s*(var\(--surface\)|color-mix\(in srgb,[^;]*var\(--surface\)[^;]*\))\s*;?/.test(b);
  // 참모 색 보내기 단추(.send-orch)는 제 색을 쓰니 빼고 잰다(space-tabs 머지)
  it('기본·올림·눌림(pressed) 모두 불투명 바탕을 직접 정한다', () => {
    expect(solid(rule('.lk-acts .kit-ib'))).toBe(true);
    expect(solid(rule('.lk-acts .kit-ib:not(.send-orch):hover'))).toBe(true);
    expect(solid(rule('.lk-acts .kit-ib.on:not(.send-orch)'))).toBe(true);
  });
  it('투명 토큰(--hover)을 바탕에 그대로 쓰지 않는다', () => {
    const body = css.split('\n').filter((l) => l.includes('.lk-acts')).join('\n');
    expect(body).not.toMatch(/background:\s*var\(--hover\)/);
  });
});
