// 팀챗 링크(10-28 사용자 "팀챗에서 링크 클릭이 안 되네. 참모 챗에는 되는데") — DOM 없이 소스로 지킨다(앱 테스트엔 jsdom 이 없다).
// 판단(웹 주소만·쪼개기)은 domain/links 시험, 실측 하네스는 .shots/team-chat-parity/
import { describe, expect, it } from 'vitest';
import convo from './TeamConvo.tsx?raw';
import bits from './RoomBits.tsx?raw';
import chat from '../chat/ChatView.tsx?raw';
import follow from '../followLink.ts?raw';
import md from '../md.ts?raw';
import css from './team.css?raw';

describe('팀챗 링크 — 참모 채팅과 같은 길로 연다', () => {
  it('말 목록 클릭은 참모 채팅과 같은 openWebLink(데스크톱) — 폰은 새 탭 링크라 안 건다', () => {
    expect(follow).toMatch(/export function openWebLink\(/);
    expect(follow).toMatch(/webHref\(/);
    expect(chat).toMatch(/onClick=\{openWebLink\}/);
    expect(convo).toMatch(/className="tmx-msgs"[^>]*onClick=\{phone \? undefined : openWebLink\}/);
  });
  it('사람 말풍선의 맨 주소는 링크(실제 주소를 title 로), 폰은 새 탭', () => {
    expect(bits).toMatch(/linkParts\(/);
    expect(bits).toMatch(/<a [^>]*href=\{[^}]+\}[^>]*title=/);
    expect(bits).toMatch(/rel="noopener noreferrer"/);
  });
  it('참모 말은 참모 채팅과 같은 마크다운(mdParse·거름) — 링크는 웹 주소만 살리고 실제 주소를 title 로', () => {
    expect(md).toMatch(/export function mdToHtmlTeam\(/);
    expect(md).toMatch(/webHref\(a\.getAttribute\('href'\)\)/);
    expect(md).toMatch(/setAttribute\('title', href\)/);
    expect(convo).toMatch(/className="tmx-plain tmx-md"[^>]*dangerouslySetInnerHTML=\{\{ __html: agentHtml\(/);
  });
  it('말 누르기(폰 고르기)는 링크를 누를 땐 안 한다', () => {
    expect(convo).toMatch(/closest\('a'\)/);
  });
  it('마크다운 참모 말은 줄바꿈을 HTML 이 맡는다(pre-wrap 이면 문단 사이가 두 줄로 벌어진다)', () => {
    expect(css).toMatch(/\.tmx-plain\.tmx-md \{[^}]*white-space: normal/);
  });
  it('말 목록 빈 데를 누르면 입력칸으로 — 참모 채팅과 같은 판단(clickFocusesInput), 폰은 키보드가 튀어나와 뺀다', () => {
    expect(convo).toMatch(/onMouseUp=\{phone \? undefined : \(e\) => \{[^}]*clickFocusesInput\(/);
  });
});
