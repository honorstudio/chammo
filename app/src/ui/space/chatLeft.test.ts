import { describe, expect, it } from 'vitest';
import view from './SpaceView.tsx?raw';
import app from '../../App.tsx?raw';
import rail from './OrchRail.tsx?raw';
import css from './locker.css?raw';
import space from './space.css?raw';
import chatCss from '../chat/chat.css?raw';

// 2026-10-12 사용자(참모-2 전달, 시안 v2 Q1 A·Q2·Q3 추천대로): 채팅이 오른쪽이라 어느 참모 채팅인지 헷갈렸다 → 띠 | 채팅 | 스페이스.
// 채팅 머리 = 그 참모 프사 + 이름 + 맡은 일(한 줄 말줄임), 고른 프사와 채팅 칸이 하나로 이어져 켜진 것처럼(고른 탭이 아래 내용과 붙듯)
describe('채팅 칸 자리 A', () => {
  // 2026-10-24 홈 대시보드 — 홈을 보는 동안 채팅 칸은 숨기기만(자리 감싸개 display: contents)
  it('스페이스는 띠 바로 다음에 채팅을 그린다', () => expect(view).toMatch(/\{rail\}\n[^\n]*\n\s*<div className="cv-chat-slot" hidden=\{atHomePick\}>\{chat\}<\/div>/));
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
    expect(view).toMatch(/\{chat\}<\/div>\n[^\n]*\n\s*\{chat && !atHomePick && <ChatLink color=\{linkColor\} \/>\}/);
    // 이음 색 = 고른 프사 색(다른 기기를 보는 중이면 그 기기 참모 색, peer-panel)
    expect(view).toContain('const linkColor = far ? far.color : team?.railOn ? team.color : railList.find((a) => a.on)?.color;'); // 메신저 대화를 고르면 그 사람 색
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
    expect(rail).toMatch(/\[joined, onId, extraOn, wide, width, avatars\.map\(\(a\) => a\.id\)\.join\(' '\)\]/); // 순서가 바뀌어도 이음 면이 따라간다
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
    expect(css).toMatch(/\.lk-strip\.joined \.lk-av\.on\.st-speak \{ box-shadow: none !important;[^}]*\}/);
    expect(css).toMatch(/\.lk-strip\.joined \.lk-av\.on\.st-speak \.lk-av-pic > :first-child \{[^}]*filter: drop-shadow\([^}]*var\(--speak-level/);
  });
  // 2026-10-16 사용자: 고른 참모 빛이 안 고른 참모보다 약하다 — 모양은 그대로, 세기를 안 고른 칸만큼(블러 최대치가 같고, 겹쳐 쌓아 진하게)
  it('고른 칸 빛도 안 고른 칸만큼 — 가장 넓은 블러가 4px + 14px × 소리 크기, 그림자 셋 이상 겹침', () => {
    const rule = css.match(/\.lk-strip\.joined \.lk-av\.on\.st-speak \.lk-av-pic > :first-child \{([^}]*)\}/)?.[1] ?? '';
    const unsel = css.match(/\.lk-av\.st-speak \{([^}]*)\}/)?.[1] ?? '';
    expect(unsel).toMatch(/calc\(4px \+ 14px \* var\(--speak-level, 0\)\)/);
    expect(rule).toMatch(/drop-shadow\(0 0 calc\(4px \+ 14px \* var\(--speak-level, 0\)\)/);
    expect(rule.match(/drop-shadow\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(rule).not.toMatch(/border-left|inset/);
  });
  // 2026-10-16 실제 앱(WebKit): 사람이 보는 동안 프사 SVG 애니메이션(숨쉬기·깜빡임)이 돌면 그 위 drop-shadow 가 통째로 안 그려졌다 —
  // 안 볼 때(oa-paused = animation: none)만 보였다. 멈춤(paused)으론 안 됐고 none 이어야 한다(개발판 실측 .shots/voice-glow-2)
  it('고른 프사가 말하는 동안은 프사 애니메이션을 뺀다(animation: none — paused 는 WebKit 에서 빛이 안 그려짐)', () => {
    const rule = css.match(/([^{}]*\.lk-strip\.joined \.lk-av\.on\.st-speak \.oa\b[^{}]*)\{([^}]*)\}/);
    expect(rule?.[1]).toMatch(/\.lk-strip\.joined \.lk-av\.on\.st-speak \.oa \*/);
    expect(rule?.[2]).toMatch(/animation:\s*none !important/);
    expect(rule?.[2]).not.toMatch(/animation-play-state/);
  });
  // 2026-10-16 사용자(참모-2 전달 228.png): 빛이 띠 오른쪽 끝(채팅 카드 왼쪽 변)에서 세로로 잘렸다 — 채팅 칸 .chat(base+3, 불투명 바탕)이 프사(base+1) 위에 있었다.
  // 말하는 고른 프사만 채팅 칸 위로 — 이어진 면을 따라 빛이 카드 쪽으로 번지고, 윤곽선(ChatLink, base+4, DOM 이 뒤)은 그 위에 남는다
  it('말하는 고른 프사는 채팅 칸(.chat base+3) 위 — 빛이 카드 쪽에서 안 잘린다, 윤곽선(base+4)보다 높지 않게', () => {
    const chatZ = Number(chatCss.match(/\.chat \{[^}]*z-index: calc\(var\(--z-base\) \+ (\d+)\)/)?.[1]);
    const linkZ = Number(css.match(/\.chat-link \{[^}]*z-index: calc\(var\(--z-base\) \+ (\d+)\)/)?.[1]);
    const avZ = Number(css.match(/\.lk-strip\.joined \.lk-av\.on\.st-speak \{[^}]*z-index: calc\(var\(--z-base\) \+ (\d+)\)/)?.[1]);
    expect(chatZ).toBe(3);
    expect(avZ).toBeGreaterThan(chatZ);
    expect(avZ).toBeLessThanOrEqual(linkZ);
  });
});
