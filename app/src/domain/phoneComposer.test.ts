// 폰 입력창 두 줄 카드(시안 docs/design-drafts/phone-dash K) — 오른쪽 아래 한 자리와 글 칸 높이
import { describe, expect, it } from 'vitest';
import { composerSlots, pickState, PICK_WAIT_MS, textMaxH, TEXT_LINE_PX } from './phoneComposer';

describe('입력창 아래 줄 자리(2026-10-11 사용자 "일하는 중이어도·쓰는 중이어도 참모를 바꿀 수 있어야")', () => {
  it('비었으면 오른쪽 아래는 늘 참모 프사 — 일하는 중이어도', () => {
    expect(composerSlots({ canSend: false, busy: false })).toEqual({ corner: 'orch', left: 'voice', stop: false });
    expect(composerSlots({ canSend: false, busy: true })).toEqual({ corner: 'orch', left: 'voice', stop: true });
  });
  it('글이 있으면 오른쪽 아래는 보내기, 그 왼쪽(스피커 자리)이 참모 프사 — 쓰다가도 바꾸러 간다', () => {
    expect(composerSlots({ canSend: true, busy: false })).toEqual({ corner: 'send', left: 'orch', stop: false });
    expect(composerSlots({ canSend: true, busy: true })).toEqual({ corner: 'send', left: 'orch', stop: true });
  });
  it('멈춤은 일하는 중일 때만, 따로 한 칸', () => {
    expect(composerSlots({ canSend: false, busy: false }).stop).toBe(false);
    expect(composerSlots({ canSend: true, busy: true }).stop).toBe(true);
  });
});

describe('글 칸 높이', () => {
  it('6줄까지만 늘고 그 뒤로는 안에서 스크롤', () => {
    expect(textMaxH(1000)).toBe(Math.round(TEXT_LINE_PX * 6));
  });
  it('화면이 작으면(키보드가 덮으면) 화면 쪽 상한이 이긴다', () => {
    expect(textMaxH(80)).toBe(80);
  });
});

describe('모델 칩 바꾸는 중 — 맥이 상태줄로 새 값을 알려 줄 때까지', () => {
  const asked = { key: 'Opus 5.5|high', at: 1000 };
  it('안 눌렀으면 그대로', () => {
    expect(pickState(null, 'Opus 5.5|high', 5000)).toBe('idle');
  });
  it('값이 바뀌면 끝', () => {
    expect(pickState(asked, 'Sonnet 5.5|high', 3000)).toBe('idle');
  });
  it('안 바뀐 채 기다리는 동안은 바꾸는 중, 넘으면 못 바꿈(맥 화면에 그 참모 창이 없을 때 등)', () => {
    expect(pickState(asked, 'Opus 5.5|high', 1000 + PICK_WAIT_MS - 1)).toBe('wait');
    expect(pickState(asked, 'Opus 5.5|high', 1000 + PICK_WAIT_MS)).toBe('fail');
  });
});
