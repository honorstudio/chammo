import { describe, expect, it } from 'vitest';
import rail from './OrchRail.tsx?raw';
import view from './SpaceView.tsx?raw';
import app from '../../App.tsx?raw';
import teamRail from '../team/TeamRail.tsx?raw';
import teamMode from '../team/useTeamMode.tsx?raw';
import css from './locker.css?raw';

// 2026-10-24 사용자 시안 home-dash v1 RA "접어 담기" — 띠 = 홈 · 깨어 있는 참모 · 도우미 · + 하나,
// 잠든 참모는 얼굴 겹친 칸 하나, 도구 다섯은 더보기 하나. 참모 10·잠든 5 에서도 안 넘치게
const strip = rail.slice(rail.indexOf('<nav ref={navRef} className={`lk-strip'), rail.lastIndexOf('</nav>'));
const FOOT = '{wide ? <div className="lk-foot">{schedBtn}{fns}</div> : (';
const narrow = strip.slice(strip.indexOf(FOOT) + FOOT.length);

describe('띠 RA — 맨 위 홈', () => {
  it('홈 칸은 접기 단추보다 위 — 홈 아이콘, 이름은 aria-label·호버 카드', () => {
    expect(strip.indexOf('rail-home')).toBeGreaterThan(-1);
    expect(strip.indexOf('rail-home')).toBeLessThan(strip.indexOf('<div className="rail-top">'));
    expect(rail).toMatch(/className=\{`lk-av rail-home \$\{home\.on \? 'on' : ''\}`\}[\s\S]*?aria-label=\{tr\('홈', 'Home'\)\}[\s\S]*?<IconHome \/>/);
  });
  it('스페이스가 홈 칸에 오케스트레이터 홈(oh:)을 잇는다', () => {
    expect(view).toMatch(/home=\{\{ on: atHomePick, onOpen: \(\) => setPick\(HOME, 'home'\) \}\}/);
  });
});

describe('띠 RA — 잠든 참모는 칸 하나', () => {
  it('접힌 띠엔 잠든 참모 줄 대신 얼굴 겹친 칸 하나(수)', () => {
    expect(narrow).toMatch(/className=\{`lk-av rest-fold/);
    expect(narrow).toMatch(/resting\.slice\(0, 3\)/);
    expect(view).not.toMatch(/stoppedOrchs\(stopped, orchCwd, orchs\)\.slice\(0, 6\)/); // 접혀서 여섯 개 제한이 필요 없다
    expect(narrow).toMatch(/\{resting\.length\}/);
    expect(narrow).not.toMatch(/<div className="lk-rests">/);
  });
  it('누르면 옆 펼침에 잠든 참모 줄 — 누르면 깨움(같은 wake 길)', () => {
    const pop = rail.slice(rail.indexOf("pop?.kind === 'rest'"));
    expect(pop).toMatch(/className="lk-av rest"[\s\S]*onClick=\{\(\) => \{ wake\(r\); setPop\(null\); \}\}/);
  });
  it('넓은 띠는 지금처럼 줄로(자리가 있다)', () => {
    expect(strip).toMatch(/wide && resting\.length > 0 && <div className="lk-rests">/);
  });
});

describe('띠 RA — 도구는 더보기 하나', () => {
  it('접힌 띠엔 예약·기능 줄 대신 더보기 하나 — 볼 것이 있으면 점', () => {
    expect(narrow).toMatch(/className=\{`rail-fn rail-more/);
    expect(narrow).toMatch(/<IconMore \/>/);
    expect(narrow).toMatch(/moreDot && <i className="rail-dot"/);
    expect(narrow).not.toMatch(/\{fns\}/);
  });
  it('더보기 펼침 = 예약 + 기능 단추(아이콘만, 이름은 title·aria-label)', () => {
    const pop = rail.slice(rail.indexOf("pop?.kind === 'more'"));
    expect(pop).toMatch(/\{schedPop\}\{popFns \?\? fns\}/);
    expect(app).toMatch(/pop: <FeatureRow items=\{items\} p=\{fp\} dir="row" titles \/>/);
  });
  it('넓은 띠는 지금처럼 맨 아래 가로 줄', () => expect(rail).toMatch(/wide \? <div className="lk-foot">\{schedBtn\}\{fns\}<\/div>/));
});

describe('띠 RA — + 하나', () => {
  it('팀 칸의 + 는 띠 + 메뉴 안으로(팀 칸엔 + 없음)', () => {
    expect(teamRail).toMatch(/\{!noAdd && <button className="tmx-rail-add"/);
    expect(teamMode).toMatch(/noAdd/);
  });
  it('+ 를 누르면 참모 하나 더 · 팀 만들기(팀이 있으면 팀 초대)', () => {
    const pop = rail.slice(rail.indexOf("pop?.kind === 'new'"));
    expect(pop).toMatch(/tr\(`\$\{assistant\(\)\} 하나 더`/);
    expect(pop).toMatch(/onTeam\.label/);
    expect(view).toMatch(/onTeam=\{team\?\.add/);
  });
});

describe('띠 RA — 펼침 창', () => {
  it('바깥 누름·Esc·창 포커스 잃음이면 닫힌다', () => {
    const fx = rail.slice(rail.indexOf('// 펼침 창 닫기'));
    expect(fx).toMatch(/pointerdown/);
    expect(fx).toMatch(/'Escape'/);
    expect(fx).toMatch(/'blur'/);
  });
  it('펼침 창은 직접 그린 칸(이모지·아이콘 라이브러리 없음)', () => {
    expect(rail).not.toMatch(/lucide|react-icons/);
    expect(css).toMatch(/\.rail-pop \{/);
  });
});
