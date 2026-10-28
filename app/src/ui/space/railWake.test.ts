import { describe, expect, it } from 'vitest';
import rail from './OrchRail.tsx?raw';
import view from './SpaceView.tsx?raw';
import avatar from '../avatar/OrchAvatar.tsx?raw';
import avatarCss from '../avatar/avatar.css?raw';
import lockerCss from './locker.css?raw';

// 2026-10-12 사용자 "참모가 꺼지고 켜질 때 인디케이터가 있어야 — 뿅 나왔다 뿅 사라진다. 캐릭터에 맞게 애니메이션이면 좋겠다"
describe('띠 — 켜는 중·끄는 중 참모를 자리 그대로', () => {
  it('SpaceView 는 끄는 중·켜는 중을 railRows 로 띠에 넘긴다(옛 메뉴만 쓰던 stoppingIds·startingOrchs)', () => {
    expect(view).toMatch(/railRows\(\{ live: orchs, stopping: new Set\(stoppingIds\)/);
    expect(view).toMatch(/starting: startingOrchs/);
  });
  it('켜는 중·끄는 중 칸은 phase 를 갖고 누르기·끌기가 안 된다', () => {
    expect(rail).toMatch(/phase\?: 'starting' \| 'stopping'/);
    expect(rail).toMatch(/if \(e\.button !== 0 \|\| e\.ctrlKey \|\| avatars\[i\]!\.phase\) return;/); // 끌어 순서 바꾸기·띠 밖으로 끌어 @넣기 둘 다
    expect(rail).toMatch(/aria-busy=\{a\.phase \? true : undefined\}/);
  });
  it('호버 카드·넓은 띠 둘째 줄 = 단계 글(켜는 중…·끄는 중…)', () => {
    expect(rail).toMatch(/data-tip-sub=\{a\.phaseText \?\? a\.role\}/);
    expect(rail).toMatch(/\(a\.phaseText \?\? a\.role\) && <span className=\{a\.phaseText \? 'lk-ph-tx' : undefined\}>/);
  });
  it('자리 옮김은 줄이 바뀐 때만 미끄러진다(FLIP), 동작 줄이기면 안 움직인다', () => {
    expect(rail).toMatch(/railMoved\(/);
    expect(rail).toMatch(/const still = \(\) => !motionOn\(\);/); // OS 동작 줄이기 + 앱 애니메이션 줄이기·끄기(ui/calm)
    expect(rail).toMatch(/data-flip=/);
  });
});

describe('프사 — 깨어남·잠듦', () => {
  it('OrchAvatar 가 phase 를 받아 클래스로', () => {
    expect(avatar).toMatch(/phase\?: AvatarPhase/);
    expect(avatar).toMatch(/avatarClasses\(\{ image: !!showImage, state, transition: t, size, tone, phase \}\)/);
  });
  it('켜는 중 = 깨어남(눈 뜨기·통 튀기) 다음 숨쉬기, 끄는 중 = 작아지며 흐려짐', () => {
    expect(avatarCss).toMatch(/\.oa-ph-starting \.oa-lt \{[^}]*animation: oa-ph-open-t/);
    expect(avatarCss).toMatch(/\.oa-ph-starting \.oa-all \{[^}]*oa-ph-breathe[^}]*infinite/);
    expect(avatarCss).toMatch(/\.oa\.oa-ph-stopping \{[^}]*scale\(\.8\d*\)/);
  });
  it('동작 줄이기 — 프사는 안 움직이고 점·글자만(띠 단계 점)', () => {
    const reduce = lockerCss.slice(lockerCss.indexOf('/* 켜는 중·끄는 중 단계 점'));
    expect(reduce).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.lk-ph-dot \{ display: block; \}/);
    expect(reduce).toMatch(/:is\(html\.oa-calm, html\.oa-still\) \.lk-ph-dot \{ display: block; \}/);
    expect(avatarCss).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n {2}\.oa \*, \.oa, \.oa::before \{ animation: none !important; transition: none !important; \}/);
  });
  it('.lk-pip(상태 점)는 안 건드린다 — 단계 점은 따로(.lk-ph-dot)', () => {
    expect(rail).toMatch(/<i className=\{`lk-ph-dot ph-\$\{a\.phase\}`\}/);
  });
});

describe('채팅 — 깨우는 동안 입력칸 위 한 줄', () => {
  it('ChatView 는 notice 를 입력칸 바로 위에, App 은 깨우는 중·새로 켜는 중일 때 참모 채팅 칸에 넘긴다', async () => {
    const chat = (await import('../chat/ChatView.tsx?raw')).default;
    const grid = (await import('../SessionGrid.tsx?raw')).default;
    const app = (await import('../../App.tsx?raw')).default;
    expect(chat.indexOf('{notice && <div className="chat-wake"')).toBeGreaterThan(0);
    expect(chat.indexOf('{notice && <div className="chat-wake"')).toBeLessThan(chat.indexOf('<div className="chat-input">'));
    expect(grid).toMatch(/notice=\{[^\n]*(?::|\?\?) chatNotice\}/); // 터미널 보기가 끊긴 동안만 그 안내(linkOf), 평소엔 chatNotice
    expect(app).toMatch(/chatNotice=\{wakeNote\}/);
    expect(app).toMatch(/<WakeNotice name=\{wakeName\}/); // 프사는 WakeNotice 안 — App 은 OrchAvatar 를 안 부른다(chat-head)
  });
});

describe('홈(참모가 없을 때 첫 화면) — 켜는 중도 같은 깨어남', () => {
  it('이어서 켜는 줄·만드는 줄의 프사는 phase starting(눈 뜬 쉼으로 바로 바꾸지 않는다)', async () => {
    const home = (await import('./OrchHome.tsx?raw')).default;
    expect(home).toMatch(/state=\{busy \? 'off' : r\.live \? avatarState\(r\.live\) : 'off'\} phase=\{busy \? 'starting' : undefined\}/);
    expect(home).toMatch(/<OrchAvatar name=\{creating\} size=\{36\} state="off" phase="starting"/);
  });
});
