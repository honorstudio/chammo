import { describe, expect, it } from 'vitest';
import view from './SpaceView.tsx?raw';
import app from '../../App.tsx?raw';
import rail from './OrchRail.tsx?raw';
import css from './locker.css?raw';
import space from './space.css?raw';

// 2026-10-12 사용자(참모-2 전달, 시안 v2 Q1 A·Q2·Q3 추천대로): 채팅이 오른쪽이라 어느 참모 채팅인지 헷갈렸다 → 띠 | 채팅 | 스페이스.
// 채팅 머리 = 그 참모 프사 + 이름 + 맡은 일(한 줄 말줄임), 고른 프사와 채팅 칸이 하나로 이어져 켜진 것처럼(고른 탭이 아래 내용과 붙듯)
describe('채팅 칸 자리 A', () => {
  it('스페이스는 띠 바로 다음에 채팅을 그린다', () => expect(view).toMatch(/\{rail\}\{chat\}/));
  it('앱은 채팅 칸을 스페이스 안 자리로 넘긴다(오른쪽에 따로 안 그림)', () => {
    expect(app).toMatch(/chat=\{chatCol\}/);
    expect(app).toMatch(/className="office-chats left"/);
  });
  it('폭 손잡이는 채팅 칸 오른쪽 가장자리 — 기억(officeChatWidth)·280~900 그대로', () => {
    expect(app).toMatch(/<Grip side="right" width=\{chatWidth\} onWidth=\{setChatWidth\} min=\{280\} max=\{900\} \/>/);
  });
  // 프사는 같은 날 사용자가 뺐다('이중으로 보여 너무 많다') — 이름·맡은 일은 격자가 머리 자리에 올린다(chatHead.test.ts)
  it('채팅 머리 = 이름 + 맡은 일 자리(채팅 글자 대신)', () => {
    const head = app.slice(app.indexOf('className="space-chat-head'), app.indexOf('className="space-chat-head') + 900);
    expect(head).toMatch(/className="sch-who" ref=\{setChatHeadSlot\}/);
    expect(head).not.toMatch(/tr\('채팅', 'Chat'\)/);
  });
  it('왼쪽 채팅은 오른쪽 경계선, 맡은 일은 한 줄 말줄임', () => {
    expect(space).toMatch(/\.office-chats\.left \{[^}]*border-left: 0;[^}]*border-right: 1px solid var\(--line\)/);
    expect(space).toMatch(/\.sch-role \{[^}]*text-overflow: ellipsis/);
  });
});

describe('고른 프사 ↔ 채팅 이어진 면', () => {
  it('띠가 고른 줄에 채팅 바탕 면(lk-join)을 깔고 경계를 그 높이만큼 덮는다', () => {
    expect(rail).toMatch(/joined && join && <i className="lk-join"/);
    expect(css).toMatch(/\.lk-join \{[^}]*right: 0;[^}]*background: var\(--surface\)/);
    expect(css).toMatch(/\.lk-strip\.joined \{ border-right: 0; box-shadow: inset -1px 0 0 var\(--line\); \}/); // 경계선은 안쪽 그림자 — 이음 면이 그 높이만큼 덮는다
  });
  it('바꿀 땐 짧게 옮겨 간다(140ms), 줄인 움직임이면 바로', () => {
    expect(css).toMatch(/\.lk-join \{[^}]*transition: top \.14s ease-out, height \.14s ease-out/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.lk-join \{ transition: none; \} \}/);
  });
  it('왼쪽 색 띠 없음', () => expect(css).not.toMatch(/\.lk-join[^{]*\{[^}]*border-left/));
});

// 2026-10-12 사용자 201.png: 이음 면만으론 약하다 → 고른 프사 칸과 채팅 칸을 참모 색 윤곽선 하나로(탭이 내용과 붙은 모양, 맞닿는 변만 열림)
import link from './ChatLink.tsx?raw';
import chatLinkDomain from '../../domain/chatLink.ts?raw';
describe('고른 프사 ↔ 채팅 카드 이음 윤곽', () => {
  it('채팅은 띠 바탕 위 둥근 카드 — 손잡이는 카드 밖', () => {
    expect(app).toMatch(/<Grip side="right" width=\{chatWidth\}[^\n]*\n[^\n]*\n\s*<div className="och-card">/);
    expect(space).toMatch(/\.space-mode \.office-chats\.left \{ background: var\(--panel\); padding: 6px 6px 6px 0; \}/);
    expect(space).toMatch(/\.och-card \{[^}]*border-radius: 12px;[^}]*overflow: hidden;[^}]*background: var\(--surface\)/);
  });
  it('스페이스가 채팅이 있을 때 고른 프사 색으로 윤곽을 그린다', () => {
    expect(view).toMatch(/\{rail\}\{chat\}\n[^\n]*\n\s*\{chat && <ChatLink color=\{railList\.find\(\(a\) => a\.on\)\?\.color\} \/>\}/);
  });
  it('윤곽 = 참모 색(--orch-solid) 2px 선 하나, 누르기는 통과', () => {
    expect(css).toMatch(/\.chat-link \{[^}]*pointer-events: none/);
    expect(css).toMatch(/\.chat-link \.cl-line \{[^}]*fill: none;[^}]*stroke: var\(--orch-solid[^;]*;[^}]*stroke-width: 2;/);
  });
  it('바꾸면 140ms 로 옮겨 간다(색은 CSS, 자리는 JS) — 동작 줄이기면 바로', () => {
    expect(css).toMatch(/\.chat-link \.cl-line \{[^}]*transition: stroke \.14s ease-out/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.chat-link \.cl-line \{ transition: none; \} \}/);
    expect(chatLinkDomain).toMatch(/export const LINK_MOVE_MS = 140;/); // 스페이스 바꿔 끼우기(domain/switchHold)도 이 값을 기다린다
    expect(link).toMatch(/if \(!moved \|\| still\(\)\) \{ draw\(next\); return; \}/);
    // 시작 시각은 첫 프레임 — rAF 시각이 performance.now() 보다 앞서 k 가 음수가 되면 탭이 위로 튀었다(하네스 -184px)
    expect(link).toMatch(/if \(t0 < 0\) t0 = now;/);
    expect(link).toMatch(/Math\.max\(0, \(now - t0\) \/ LINK_MOVE_MS\)/);
  });
  it('자리는 offsetTop 으로 — 자리 옮김(FLIP)·끌기 중간 자리를 재지 않는다', () => {
    expect(link).not.toMatch(/getBoundingClientRect/);
    expect(rail).toMatch(/setJoin\(\{ top: on\.offsetTop, height: on\.offsetHeight \}\)/);
    expect(rail).toMatch(/\[joined, onId, wide, width, avatars\.map\(\(a\) => a\.id\)\.join\(' '\)\]/); // 순서가 바뀌어도 이음 면이 따라간다
  });
  it('왼쪽 색 띠 없음 — 카드·윤곽 규칙에 border-left 없음', () => {
    expect(css).not.toMatch(/\.chat-link[^{]*\{[^}]*border-left/);
    expect(space).not.toMatch(/\.och-card[^{]*\{[^}]*border-left/);
  });
  it('포커스 고리는 키보드(:focus-visible)일 때만 — 고른 표시와 안 헷갈리게', () => {
    expect(css).toMatch(/\.lk-av:focus-visible \{/);
    expect(css).not.toMatch(/\.lk-av:focus[ ,{]/);
  });
});

// 2026-10-12 사용자(참모-2 전달): 지금 보는 참모(고른 프사)가 말하면 빛이 칸 네모 모양 — 캐릭터 모양을 따라가게(동작 줄이기면 levelAt 0.7 고정 = 은은히 켜짐)
describe('고른 프사 말하는 빛 = 캐릭터 모양', () => {
  it('고른 칸은 네모 빛(box-shadow)을 끄고 그림에 drop-shadow', () => {
    expect(css).toMatch(/\.lk-strip\.joined \.lk-av\.on\.st-speak \{ box-shadow: none !important; \}/);
    expect(css).toMatch(/\.lk-strip\.joined \.lk-av\.on\.st-speak \.lk-av-pic > :first-child \{[^}]*filter: drop-shadow\([^)]*var\(--speak-level/);
  });
});
