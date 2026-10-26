import { describe, expect, it } from 'vitest';
import dash from './HomeDash.tsx?raw';
import view from './SpaceView.tsx?raw';
import app from '../../App.tsx?raw';
import css from './homeDash.css?raw';
import proj from './HomeProjects.tsx?raw';
import comp from '../GoalProgress.tsx?raw';

// 2026-10-24 사용자 시안 home-dash v1 HA — 띠 맨 위 홈 = 참모 채팅 없는 전체 한눈에(타일 격자)
describe('홈 대시보드 HA', () => {
  it('홈(oh:)에 참모가 있으면 홈 대시보드, 없으면 지금 오케스트레이터 홈(참모 고르기)', () => {
    const at = view.indexOf('} else if (atHome && homeDash && orchs.length > 0) {');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(view.indexOf('} else if (atHome && orchHome) {'));
  });
  it('누르면 그 참모(채팅 탭까지)·그 세션·그 기능·사무실', () => {
    const b = view.slice(view.indexOf('main = homeDash({'), view.indexOf('} else if (atHome && orchHome) {'));
    expect(b).toMatch(/orch: goOrch/);
    // 그 참모 탭이 기억하던 화면 그대로 — 다른 참모면 탭 바꾸기(switchTo)와 같은 길, 지금 참모면 홈 열기 전 화면(10-24 ⌘1 이 홈으로 돌아오던 것)
    expect(view).toMatch(/const goOrch = \(id: string\) => \{[^\n]*setPick\(ownPick\(screens\.current\.get\(id\)\?\.pick, id, homeOf\(o\)\)\); else switchTo\(id, 'home'\); onChatTab\?\.\(id\);/);
    expect(b).toMatch(/session: \(t\) => \{ const s = findTarget\(sessions, t\)/);
    expect(b).toMatch(/feature: \(k\) => featureTo\(k, 'open'\)/);
  });
  it('앱이 홈에 데이터를 넘긴다 — 결정 대기 = 위 종과 같은 물음·직접 카드, 누르면 결정 대기함', () => {
    expect(app).toMatch(/homeDash=\{homeDashNode\}/);
    expect(app).toMatch(/\.\.\.direct\.inboxCards\.map\(/);
    expect(app).toMatch(/\.\.\.inbox\.map\(/);
    expect(app).toMatch(/onAsks=\{\(\) => setInboxOpen\(true\)\}/);
  });
  it('홈 칸 — 숫자 넷·참모 타일·쉬는 참모·결정 대기·오래 조용·참모별 진행 칸·기기·도구·오늘 끝남·사무실', () => {
    for (const k of ['hd-stats', 'hd-otiles', 'hd-shelf', 'hd-a-ask', 'hd-quiet', 'hd-a-gp', 'hd-a-dev', 'hd-tools', 'hd-a-done', 'hd-a-office']) expect(dash).toContain(k);
    expect(dash).toMatch(/<HomeProgress orch=/); // 진행 칸은 참모 홈과 같은 컴포넌트
  });
  it('도구는 아이콘만 — 이름은 aria-label·title(아이콘+글자 줄줄이 금지)', () => {
    const t = dash.slice(dash.indexOf('<div className="hd-tools"'), dash.indexOf('</section>', dash.indexOf('<div className="hd-tools"')));
    expect(t).toMatch(/aria-label=\{t\.n \?/);
    expect(t).toMatch(/title=\{t\.name\}/);
    expect(t).not.toMatch(/<span>\{t\.name\}<\/span>/);
  });
  it('사무실 미리보기는 못 누르게(inert) 깔고 위를 덮는 단추 하나', () => {
    expect(dash).toMatch(/<div className="hd-office-in" inert aria-hidden="true">\{office\}<\/div>/);
    expect(dash).toMatch(/className="hd-office-go"[^>]*onClick=\{\(\) => \(go\.officeBig \? flip\(\{ kind: 'office'/);
  });
  it('사무실 칸은 홈 안에서 크게 — 참모 탭으로 안 넘어가고 닫으면 홈 그대로(2026-10-25 사용자)', () => {
    expect(dash).toMatch(/className="hd-office-big" data-hpop=""/);
    expect(dash).toMatch(/go\.officeBig\?\.\(close\)/);
    expect(css).toMatch(/\.hd-office-big \{[^}]*position: absolute; inset: 0/);
  });
  it('왼쪽 색 띠·이모지 없음, 누름 칸 44px', () => {
    expect(css).not.toMatch(/border-left:\s*\d/);
    expect(css).toMatch(/\.hd-tool \{[^}]*width: 44px; height: 44px/);
    expect(css).toMatch(/\.hd-ask \{[^}]*min-height: 44px/);
  });
});

// 2026-10-24 사용자 시안 home-inplace v1 A — 홈에서 누르는 단추는 홈 안에서. 다른 화면으로는 '크게 열기' 아이콘만
describe('홈 그 자리에서 다루기', () => {
  it('참모 타일 = 카드 아래 미니 대화(넘어가지 않음), 띄움은 하나씩(flipPop)·Esc·바깥 누름으로 닫힘', () => {
    const tile = dash.slice(dash.indexOf('className={`hd-otile'), dash.indexOf('</button>', dash.indexOf('className={`hd-otile')));
    expect(tile).toMatch(/onClick=\{\(\) => flip\(\{ kind: 'chat', id: o\.id \}\)\}/);
    expect(tile).not.toMatch(/go\.orch/);
    expect(dash).toMatch(/flipPop\(/);
    expect(dash).toMatch(/closeOnKey\(/);
    expect(dash).toMatch(/addEventListener\('pointerdown'/);
  });
  it('미니 대화 = 진짜 대화 기록(useChatItems) + 보내기는 앱의 참모 보내기 길 그대로(say), 크게 열기만 그 참모로', () => {
    const mini = dash.slice(dash.indexOf('function MiniChat'), dash.indexOf('\n}\n', dash.indexOf('function MiniChat')));
    expect(mini).toMatch(/useChatItems\(/);
    expect(mini).toMatch(/await say\(/);
    expect(mini).toMatch(/onBig/);
    // 앱: 스페이스 보내기와 같은 함수 — '보내는 중' 말풍선(chat-pending) 다음 sendTextToSession
    expect(app).toMatch(/const sayTo = async \(id: string, text: string\) => \{\s*window\.dispatchEvent\(new CustomEvent\('chat-pending', \{ detail: \{ id, text \} \}\)\);\s*await sendTextToSession\(id, text\);/);
    expect(app).toMatch(/say=\{sayTo\}/);
    expect(app).toMatch(/await sayTo\(spaceOrch\.id, text\)/);
  });
  it('결정 대기 = 그 자리 펼침 — 결정 대기함 줄(InboxRow)·직접 카드(DirectCardView)를 그대로(결제는 사람이 카드에서)', () => {
    expect(app).toMatch(/open: \(\) => direct\.cardNode\(c, 'home'\)/);
    expect(app).toMatch(/open: \(\) => <InboxRow item=\{i\}/);
    expect(dash).toMatch(/isPop\(pop, 'ask', a\.key\) && a\.open && <div className="hd-askx">\{a\.open\(\)\}<\/div>/);
  });
  it('오래 조용 = 세션 한눈 보기 띄움, 오늘 끝남 = 칩 아래 결과 한 줄, 도구 = 기능 서랍(스페이스가 그 기능 화면을 준다)', () => {
    expect(dash).toMatch(/flip\(\{ kind: 'peek', id: q\.task \}\)/);
    expect(dash).toMatch(/flip\(\{ kind: 'done', id: x\.task \}\)/);
    expect(dash).toMatch(/flip\(\{ kind: 'fn', id: t\.k \}\)/);
    expect(dash).toMatch(/go\.fnPane\?\.\(/);
    expect(view).toMatch(/fnPane: \(k, close\) =>/);
  });
});

// 2026-10-25 사용자 제보 — 미니 대화(380×360)에서 긴 답이 '폰: 허용 카드만…' 쯤에서 끊겼다(말풍선 9.5em 상한 + overflow hidden)
describe('미니 대화 긴 답', () => {
  it('말풍선은 높이 상한 없이 다 그리고, 목록이 안에서 굴러간다', () => {
    expect(css).not.toMatch(/\.hd-mini-row \.bubble\.md \{[^}]*max-height/);
    expect(css).toMatch(/\.hd-mini-list \{[^}]*min-height: 0; overflow-y: auto/);
  });
  it('새 말이 오면 자리 잡기(domain/homePop miniScroll) — 마지막 답 글이 바뀌어도 다시', () => {
    const mini = dash.slice(dash.indexOf('function MiniChat'), dash.indexOf('\n}\n', dash.indexOf('function MiniChat')));
    expect(mini).toMatch(/miniScroll\(\{/);
    expect(mini).toMatch(/\}, \[said\.length, waiting\.length, lastText\]\);/);
  });
});

// 2026-10-25 사용자 제보 — 홈에서 사무실을 켜면 늘 첫 번째 참모 기준이었다. 규칙: 홈에서 마지막으로 다룬 참모 → 지금 고른 참모 탭 → 첫 참모
describe('홈에서 사무실 — 누구 기준', () => {
  it('홈이 다룬 참모를 알린다 — 타일·진행 칸 이름(미니 대화 열기)과 미니 대화 보내기', () => {
    expect(dash).toMatch(/touch\?: \(id: string\) => void/);
    expect(dash).toMatch(/if \(p\.kind === 'chat'\) go\.touch\?\.\(p\.id\);/);
    expect(dash).toMatch(/say=\{\(id, t\) => \{ go\.touch\?\.\(id\); return say\(id, t\); \}\}/);
  });
  it('스페이스: 홈에서 켜면 homeOfficeOrch 로 고른 참모 탭으로 옮긴 뒤 사무실, 홈에 들어올 때마다 비운다', () => {
    expect(view).toMatch(/touch: \(id\) => \{ homeTouched\.current = id; \}/);
    expect(view).toMatch(/useEffect\(\(\) => \{ if \(pick === HOME\) homeTouched\.current = undefined; \}, \[pick === HOME\]\);/);
    const o = view.slice(view.indexOf('const officeTo = '), view.indexOf('useEffect(() => { if (officeReq)'));
    expect(o).toMatch(/pick === HOME \? homeOfficeOrch\(homeTouched\.current, now\.current\.view, orchs\.map\(\(o\) => o\.id\)\) : orch\?\.id/);
    expect(o).toMatch(/if \(id !== now\.current\.view\) \{ switchTo\(id, 'home'\); onChatTab\?\.\(id\); \}/);
  });
});

// 2026-10-25 사용자 시안 home-projects v1 A — 참모 줄 아래 프로젝트 줄 목록, 접기(기억), 펼치기 전엔 창에 꽉 차 고정
describe('홈 지금 돌아가는 프로젝트', () => {
  it('참모 줄이 첫 줄, 프로젝트 목록은 바로 그 아래(진행 칸 위)', () => {
    const o = dash.indexOf('hd-a-orch'), p = dash.indexOf('<HomeProjects'), g = dash.indexOf('hd-a-gp');
    expect(o).toBeGreaterThan(-1);
    expect(o).toBeLessThan(p);
    expect(p).toBeLessThan(g);
  });
  it('앱이 사이드바와 같은 프로젝트 묶음을 넘기고, 홈은 domain/homeProjects 로 센다', () => {
    expect(app).toMatch(/projects=\{groups\.projects\}\n\s*asks=\{asks\}/);
    expect(dash).toMatch(/homeProjects\(\{ groups: projects, sessions, events/);
  });
  it('목록 전체·줄 하나하나 접기 — 기억은 localStorage(FOLD_KEY), 못 쓰면 이번 실행만', () => {
    expect(proj).toMatch(/localStorage\.getItem\(FOLD_KEY\)/);
    expect(proj).toMatch(/localStorage\.setItem\(FOLD_KEY, writeFold\(n\)\)/);
    expect(proj).toMatch(/onClick=\{\(\) => onFold\(\{ list: true \}\)\}/);
    expect(proj).toMatch(/onClick=\{\(\) => onFold\(\{ row: r\.name \}\)\}/);
  });
  it('창 맞춤 — 펼친 줄·+N개 더가 없을 때만 .fit(바깥 스크롤 없음), 목록 칸 높이로 줄 수(fitRows)', () => {
    expect(dash).toMatch(/const fit = !narrow && !projGrown\(fold, pr\.live\);/);
    expect(dash).toMatch(/className=\{`hd\$\{fit \? ' fit' : ''\}`\}/);
    expect(css).toMatch(/\.hd\.fit \{ overflow: hidden; \}/);
    expect(css).toMatch(/\.hd\.fit \.hd-a-proj \{ flex: 1 1 45%;/);
    expect(proj).toMatch(/fitRows\(\{ avail: [^}]*rowH: PROW_H, moreH: PMORE_H, n: rows\.length \}\)/);
  });
  it('줄 높이 상수와 CSS 가 같다(44 + 줄 사이 선 1)', () => {
    expect(proj).toMatch(/export const PROW_H = 45;/);
    expect(css).toMatch(/\.hd-prow \{[^}]*min-height: 44px;/);
    expect(proj).toMatch(/export const PMORE_H = 40;/);
    expect(css).toMatch(/\.hd-pmore \{[^}]*min-height: 36px; margin-top: 4px;/);
  });
  it('창 맞춤이면 띄움 창을 창 안으로 당긴다(홈이 안 굴러가서 잘림)', () => {
    expect(dash).toMatch(/box\.scrollTop \+ box\.clientHeight - h - 12/);
  });
  it('급한 줄은 옅은 면, 상태는 글자 낱말(아이콘+글자 줄줄이 없음)', () => {
    expect(css).toMatch(/\.hd-pcell\.hot \.hd-prow \{ background: var\(--panel\); \}/);
    expect(proj).not.toMatch(/border-left/);
  });
});

// 2026-10-26 사용자 제보(.shots/299) — 진행 칸 목표 줄 말풍선을 눌러도 아무 일 없었다: askRef 가 그 참모 채팅 입력칸(안 떠 있음)으로 보내 대기열에만 쌓였다.
// 홈 설계(누르면 그 자리) 그대로 — 그 참모 미니 대화가 그 칸 아래 열리고 입력칸에 #goal·#task 칩
describe('홈 진행 칸 말풍선 = 그 참모 미니 대화에 #참조', () => {
  const cell = dash.slice(dash.indexOf('<section className="hd-a-gp"'), dash.indexOf('</section>', dash.indexOf('<section className="hd-a-gp"')));
  it('진행 칸은 홈이 준 onAsk 로 — 미니 대화를 그 칸 아래 연다(대기열 askRef 아님)', () => {
    expect(cell).toMatch(/data-pop=\{`gpc:\$\{o\.id\}`\}/);
    expect(cell).toMatch(/<HomeProgress orch=\{\{ id: o\.id, name: o\.name \}\} events=\{events\} sessions=\{sessions\} onAsk=\{\(r\) => askIn\(o\.id, r\)\} \/>/);
    const fn = dash.slice(dash.indexOf('const askIn = '), dash.indexOf('\n', dash.indexOf('const askIn = ')));
    expect(fn).toMatch(/setPop\(\{ kind: 'chat', id \}\)/); // 열려 있어도 닫지 않는다(flipPop 아님)
    expect(fn).toMatch(/setAt\(`gpc:\$\{id\}`\)/);
    expect(fn).not.toMatch(/askRef/);
  });
  it('같은 참모 미니 대화가 떠 있으면 다시 열지 않고 칩만 더한다 — 말풍선 단추는 바깥 누름이 아니다(data-hpop)', () => {
    expect(dash).toMatch(/const askIn = [^\n]*if \(!isPop\(pop, 'chat', id\)\)/);
    expect(comp).toMatch(/className="gp-ref" data-hpop=""/);
  });
  it('미니 대화 = 칩 줄(chat-refs, 빼기 단추) + 보낼 땐 withRefs, 크게 열면 칩을 그 참모 채팅으로(askRef)', () => {
    const mini = dash.slice(dash.indexOf('function MiniChat'), dash.indexOf('\n}\n', dash.indexOf('function MiniChat')));
    expect(mini).toMatch(/addRef\(/);
    expect(mini).toMatch(/className="chat-refs"/);
    expect(mini).toMatch(/withRefs\(t, refs\)/);
    expect(mini).toMatch(/refs\.forEach\(\(r\) => askRef\(o\.id/);
    expect(dash).toMatch(/inbox=\{inbox\?\.id === chatOrch\.id \? inbox : undefined\}/);
  });
  it('다른 띄움으로 바뀌거나 닫히면 받은 칩은 버린다(다음에 연 미니 대화에 옛 칩이 다시 안 붙게)', () => {
    expect(dash).toMatch(/useEffect\(\(\) => \{ if \(pop\?\.kind !== 'chat'\) setInbox\(null\); \}, \[pop\]\);/);
    expect(dash).toMatch(/const flip = [^\n]*setInbox\(null\);/);
  });
  it('홈 진행 칸은 onAsk 를 받을 수 있다(없으면 예전처럼 그 참모 입력칸으로 askRef)', () => {
    expect(comp).toMatch(/export function HomeProgress\(\{ onAsk, \.\.\.p \}: Parameters<typeof useGoalBar>\[0\] & \{ onAsk\?: \(r: RefAsk\) => void \}\)/);
    expect(comp).toMatch(/onAsk=\{onAsk \?\? \(\(r\) => askRef\(p\.orch\.id, r\)\)\}/);
  });
});
