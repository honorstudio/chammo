import { describe, expect, it } from 'vitest';
import chat from './chat.css?raw';
import space from '../space/space.css?raw';
import avatar from '../avatar/avatar.css?raw';

const rules = (css: string, sel: RegExp) => css.split('\n').filter((l) => sel.test(l.split('{')[0] ?? ''));

// 2026-10-10 사용자 QA: 탭이 많으면 오른쪽 끝 탭이 반쯤 잘리고 더 있다는 표시가 없었다 — 크롬 탭처럼 줄어들기
describe('채팅 탭 줄 — 줄어들기·넘기기', () => {
  it('탭은 줄어들되 최소 폭이 있고, 넘기는 칸은 탭 줄 안쪽(ct-strip)이다', () => {
    const tab = rules(chat, /^\.chat-tabs \[role="tab"\]\s*$/).join(' ');
    expect(tab).toMatch(/flex: 0 1 auto/);
    expect(tab).toMatch(/min-width: \d+px/);
    expect(rules(chat, /^\.ct-strip\s*$/).join(' ')).toMatch(/overflow-x: auto/);
  });
  it('이름은 줄임표, 프사·닫기 ×는 안 눌린다', () => {
    expect(rules(chat, /\.ct-nm\s*$/).join(' ')).toMatch(/text-overflow: ellipsis/);
    expect(rules(chat, /^\.chat-tabs \.tab-x\s*$/).join(' ')).toMatch(/flex: none/);
  });
  it('넘치면 양 끝을 흐린다(가장자리 마스크) — 왼쪽 색 띠가 아니다', () => {
    expect(chat).toMatch(/\.ct-strip\[data-more-l\]/);
    expect(chat).toMatch(/\.ct-strip\[data-more-r\]/);
    expect(chat).toMatch(/mask-image: linear-gradient/);
  });
  it('고른 탭은 안 줄어든다 — 이름이 다 보이게(너무 길면 상한에서만 줄임표)', () => {
    const on = rules(chat, /^\.chat-tabs \[role="tab"\]\.on\s*$/).join(' ');
    expect(on).toMatch(/flex-shrink: 0/);
    expect(on).toMatch(/max-width: \d+px/);
  });
});

// 2026-10-10 사용자 QA: 앱 창이 비활성이면 :focus-within 이 풀려 고른 탭이 검정 알약 + 하얀 프사(파란 눈만 빛남)로 바뀌었다
describe('채팅 탭 — 포커스가 밖에 있을 때(앱 비활성 포함) 고른 탭', () => {
  it('검정 알약(배경 = 글자색)으로 칠하지 않는다', () => {
    const unfocused = rules(space, /\.chat-tabs button\.on/).filter((l) => !(l.split('{')[0] ?? '').includes(':focus-within'));
    for (const l of unfocused) expect(l).not.toMatch(/background: var\(--text\)/);
  });
  it('프사를 바탕색(흰색)으로 뒤집지 않는다 — 몸·눈 색 바꾸기는 포커스 안(참모 색 면 위)에서만', () => {
    const flips = rules(avatar, /chat-tabs button\.on/);
    expect(flips.length).toBeGreaterThan(0);
    for (const l of flips) expect(l.split('{')[0] ?? '').toMatch(/:focus-within/);
  });
});

// 2026-10-10 사용자: 말하기 키를 눌렀는지·뗐는지 화면에 표시가 없었다 — 누르는 동안 받는 창(TerminalPane .pt-live)의 입력칸이 빛난다
describe('말하기 키 누르는 중(.pt-live)', () => {
  it('채팅 입력칸을 참모 색으로 감싼다 — 스페이스 보기의 포커스 규칙보다 세게', () => {
    expect(rules(chat, /\.pane\.pt-live \.chat-input/).join(' ')).toMatch(/box-shadow: .*var\(--orch/);
    expect(rules(space, /\.space-mode \.pane\.pt-live \.chat-input/).join(' ')).toMatch(/box-shadow/);
  });
  it('터미널 화면(채팅 없음)은 둘레를 덮는 층으로 — 왼쪽 띠가 아니라 전체 테두리', () => {
    const r = rules(chat, /\.pane\.pt-live:not\(:has\(\.chat\)\)::after/).join(' ');
    expect(r).toMatch(/inset: 0/);
    expect(r).not.toMatch(/border-left/);
  });
});
