import { describe, expect, it } from 'vitest';
import goal from './GoalProgress.tsx?raw';
import css from './goalProgress.css?raw';
import chatView from './chat/ChatView.tsx?raw';
import composer from './mobile/Composer.tsx?raw';
import list from './mobile/MessageList.tsx?raw';
import mobileApp from './mobile/MobileApp.tsx?raw';
import mcss from './mobile/mobile.css?raw';

// 2026-10-23 사용자(폰): 진행 칸의 일을 눌러 바로 참모에게 '이거 뭐야' — 줄 끝 말풍선 단추 → 그 참모 입력칸에 #task1·#goal1
describe('진행 칸 참모에게 묻기', () => {
  it('목표 줄과 일 줄 끝에 같은 말풍선 단추(IconChatSend, 이모지·라이브러리 없음)', () => {
    expect(goal).toMatch(/<AskBtn what="goal"/);
    expect(goal).toMatch(/<AskBtn what="task"/);
    expect(goal).toMatch(/className="gp-ref"[^\n]*<IconChatSend \/>/);
    expect(goal).not.toMatch(/lucide|react-icons/);
    // gp-ask 는 '답 기다림' 칸 이름(gp-${state}) — 단추가 같은 이름이면 막대 칸이 단추 색·숨김을 먹고 누르기가 줄을 접었다(하네스 실측)
    expect(goal).not.toMatch(/className="gp-ask"/);
  });
  it('일은 taskRefText(task id·세션·상태), 목표는 goalRefText 로 — 그 홈 참모 id 로 나른다', () => {
    expect(goal).toMatch(/kind: 'task'[^\n]*taskRefText\(refJob\(c, now\)\)/);
    expect(goal).toMatch(/kind: 'goal'[^\n]*goalRefText\(/);
    expect(goal).toMatch(/onAsk=\{onAsk \?\? \(\(r\) => askRef\(p\.orch\.id, r\)\)\}/);
  });
  it('데스크톱 입력칸은 자기 칸 id 로 받는다(원격 칸은 빼고)', () => {
    expect(chatView).toMatch(/useRefInbox\(remote \? undefined : paneId, \(r\) => addRef\(r\.who, r\.text, r\.kind\)\)/);
  });
  it('데스크톱은 줄에 올릴 때만, 폰(hover: none)은 늘 보이고 누름 칸 44px, 왼쪽 색 띠 없음', () => {
    expect(css).toMatch(/\.gp-top:hover \.gp-ref/);
    const touch = css.slice(css.indexOf('@media (hover: none)'));
    expect(touch).toMatch(/visibility: visible; width: 44px; height: 44px;/);
    expect(css).not.toMatch(/border-left:\s*\d/);
  });
});

// 2026-10-23 사용자(폰): 폰엔 말풍선 참조가 없어 글을 복사해 붙이고 있었다 — 길게 누르면 참조·복사
describe('폰 말풍선 참조', () => {
  it('내 말·참모 말풍선을 길게 누르면 참조·복사(글자 메뉴), 참조는 이 참모 입력칸에 #chat', () => {
    expect(list).toMatch(/<Mine text=\{it\.text\} images=\{it\.images\} press=\{held\} \/>/);
    expect(list).toMatch(/className="m-bubble m-ai m-md"[^\n]*\{\.\.\.held\}/);
    expect(list).toMatch(/>\{tr\('참조', '[^']+'\)\}<\/button>/);
    expect(list).toMatch(/>\{tr\('복사', 'Copy'\)\}<\/button>/);
    expect(mobileApp).toMatch(/onRef=\{\(who, text\) => askRef\(orch\.id, \{ kind: 'chat', who, text \}\)\}/);
  });
  it('입력칸은 참모 id(draftKey)로 받고, 보낼 땐 데스크톱과 같은 withRefs', () => {
    expect(composer).toMatch(/useRefInbox\(draftKey,/);
    expect(composer).toMatch(/send\(withRefs\(draft, refs\), paths\)/);
  });
  it('보낸 내 말의 인용은 말풍선 안 아래 칸으로(왼쪽 띠 없이), 칩 빼기 단추 44px 그대로', () => {
    expect(list).toMatch(/splitRefs\(text\)/);
    expect(mcss).toMatch(/\.m-quote \{[^}]*background/);
    expect(mcss).not.toMatch(/\.m-quote[^{]*\{[^}]*border-left/);
    expect(mcss).toMatch(/\.m-att-x \{[^}]*height: 44px/);
  });
});
