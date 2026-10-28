import { describe, expect, it } from 'vitest';
import sv from './SpaceView.tsx?raw';

// 2026-10-28 사용자 — 끄기가 어렵고(⋯ 맨 안쪽만), 끄면 빈 안내 칸에 남았다
describe('스페이스 브라우저 끄기', () => {
  it('끄면 칸은 바로 닫고 직전 탭(없으면 그 참모 홈)으로 + 아래 한 줄 알림(몇 초 뒤 사라짐)', () => {
    const f = sv.slice(sv.indexOf('const leaveBrowser = '));
    expect(f.slice(0, 400)).toMatch(/step\(-1, lockerOrch \? lkPick\(lockerOrch\.id, \{ kind: 'home' \}\) : HOME\)/);
    expect(f.slice(0, 400)).toMatch(/setCurNote\(note\)/);
    expect(sv).toMatch(/onClosed=\{closedBrowser\}/);
    expect(sv).not.toMatch(/브라우저가 꺼졌어 — 세션이 다시 쓰면 탭 줄에 다시 생겨', 'The browser is closed/); // 옛 빈 안내 칸
  });
  it('보던 브라우저가 밖에서 꺼져도(세션·크롬) 같은 길로 — 처음부터 없던 건 그대로', () => {
    expect(sv).toMatch(/if \(!wentAway\(seenB\.current === p, present\)\) return;/);
    expect(sv).toMatch(/setTimeout\(\(\) => leaveBrowser\([^\n]*\), 2000\)/); // 세션 크롬이 다시 뜨는 사이엔 안 닫는다
  });
  it('탭 줄 아이콘 — 끈 건 바로 빠지고, 보는 중이면 X = 앱 확인 창 뒤 브라우저 끄기(10-28 사용자 "닫으면 브라우저 자체가"), 오른쪽 클릭 = 메뉴', () => {
    expect(sv).toMatch(/\.filter\(\(it\) => !stillClosed\(closedB, it\.live\)\)/);
    expect(sv).toMatch(/className="lk-bdock-x"[^\n]*onClick=\{\(\) => setClosingB\(it\)\}/);
    expect(sv).toMatch(/const q = closeAsk\(closingB\);[\s\S]{0,120}<Confirm title=\{q\.title\} body=\{q\.body\}/); // 브라우저 기본 confirm 이 아니라 앱 겹창
    expect(sv).toMatch(/invoke\('agent_close_browser', \{ profile: it\.profile \}\)\.then\(\(\) => closedBrowser\(it\.profile, it\.pid\)/);
  });
});

// 2026-10-28 사용자 — 참모 앱 서랍에 '참모 브라우저'(세션 없이 사람이 바로 쓰는 그 참모 프로필 크롬)
describe('참모 브라우저', () => {
  it('서랍 칸을 누르면 띄우고(떠 있으면 그대로) 그 칸으로 — 윈도우는 스크립트 크롬이 숨은 데스크톱이 아니라 안 둔다', () => {
    expect(sv).toMatch(/browser=\{IS_WIN \? undefined : \{/);
    expect(sv).toMatch(/invoke<string>\('hq_browser_open'\)\.then\(\(p\) => \{ setHqB\(p\); if \(lockerOrch\) setHqOpener\(lockerOrch\.id\); setPick\(browserKey\(p\)\); \}/);
  });
  // 10-29 사용자 — HQ 참모들은 프로필 하나를 나눠 써서 '모든 참모가 쓰는 중'으로 보였다: 누른 참모(모르면 첫 참모) 한 곳에 '내가 연 것'
  it('세션 없이 띄운 것은 띄운 참모 탭 줄 독에만(프로필 = HQ, domain/browserDock hqBrowserHome)', () => {
    expect(sv).toMatch(/const hqHome = hqBrowserHome\(hqLive, orchs\.map/);
    expect(sv).toMatch(/const ownLive = \(lo: Session\) => liveOf\(lo, lives\) \?\? \(hqHomeOf\(lo\) \? hqLive : undefined\)/);
    expect(sv).toMatch(/browserDock\(\{ name: oname\(lo\), live: ownLive\(lo\), who: hqHomeOf\(lo\)\?\.who \}/);
    expect(sv).not.toMatch(/profile === hqB && lockerOrch \? oname\(lockerOrch\)/); // 칸 이름도 보는 참모 이름을 달지 않는다
  });
});
