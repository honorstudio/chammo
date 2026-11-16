import { describe, expect, it } from 'vitest';
import styles from '../styles.css?raw';
import space from './space.css?raw';
import spaceView from './SpaceView.tsx?raw';
import tools from './tools.css?raw';

// 2026-11-16 사용자 "이거 스크롤이 안 됨" — 도구 화면이 아래로 안 내려갔다.
// 세션 독(1af28da3, 10-12)부터 기능 화면은 lockerFrame 으로 .lk-center(세로 flex · overflow hidden) 안에 놓이는데,
// 도구 화면 뿌리 .cv-dash 에 min-height:0 이 없어 min-height:auto 로 내용만큼(하네스 3175px) 늘어나고,
// 안쪽 스크롤 칸 .cv-files 도 같이 늘어나 scrollHeight = clientHeight — 굴릴 게 없는 채 .lk-center 가 잘랐다.
// 터미널 뷰 떠 있는 도구 창(.hn-panel.tl-float, 세로 flex · overflow hidden)도 같은 모양.
// → 래퍼마다 고치지 않고 칸 뿌리 자신이 어느 세로 flex 칸에 놓여도 갇히게 한다(docScrollRoutesCss 의 .cv-doc 과 같은 약속).

/** 같은 셀렉터로 흩어진 규칙을 모두 합친다 */
const rules = (css: string, sel: string) => {
  const esc = sel.replace(/[.>[\]()]/g, '\\$&');
  const re = new RegExp(`(?:^|\\n|,)\\s*${esc}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'g');
  return [...css.matchAll(re)].map((m) => m[1]).join(' ');
};

describe('기능 화면은 독 칸(.lk-center)·떠 있는 창 안에서도 스크롤된다', () => {
  it('독이 기능 화면을 .lk-center 로 감싼다 — 이 전제가 바뀌면 이 시험도 다시 본다', () => {
    expect(spaceView).toMatch(/className="lk-center"/);
    expect(spaceView).toMatch(/main = lockerFrame\(dockOrch, main\)/);
  });

  it('.cv-dash(도구·참모 홈·홈 대시보드 뿌리)는 min-height:0 — 세로 flex 칸에서 내용만큼 안 늘어난다', () => {
    expect(rules(space, '.cv-dash')).toMatch(/min-height:\s*0/);
  });

  it('.cv-dash 안 스크롤 칸(.cv-files)은 flex:1 + min-height:0 + overflow-y:auto', () => {
    const f = rules(space, '.cv-files');
    expect(f).toMatch(/flex:\s*1/);
    expect(f).toMatch(/min-height:\s*0/);
    expect(f).toMatch(/overflow-y:\s*auto/);
  });

  it('독에 들어가는 다른 기능 화면 뿌리도 모두 min-height:0 (리뷰·예약·예약 목록·리플레이)', () => {
    for (const [css, sel] of [[styles, '.rv'], [styles, '.routine'], [space, '.rl-page'], [styles, '.replay']] as const) {
      expect(rules(css, sel), sel).toMatch(/min-height:\s*0/);
    }
  });

  it('터미널 뷰 떠 있는 도구 창은 세로 flex + 넘침 숨김 — 그 안 .cv-dash 도 같은 기본 규칙으로 갇힌다', () => {
    expect(rules(styles, '.hn-panel')).toMatch(/flex-direction:\s*column/);
    expect(rules(tools, '.tl-float')).toMatch(/overflow:\s*hidden/);
  });

  it('래퍼마다 .cv-dash 에 min-height 를 따로 주는 규칙(.xxx > .cv-dash)을 늘리지 않는다 — 기본 규칙 하나', () => {
    for (const css of [space, tools, styles]) expect(css).not.toMatch(/>\s*\.cv-dash\s*\{[^}]*min-height/);
  });
});
