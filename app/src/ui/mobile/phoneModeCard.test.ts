// 폰 홈 모드 카드 — 내용만큼 펼치고 홈이 스크롤한다(10/12 사용자 실기기: 달력 모드 칸이 안 밀림, 카드 360px 에서 내용이 넘쳐 겹쳤다)
import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';
import src from './PhoneModes.tsx?raw';
import { LH, PHONE_HOME_ROWS, phoneCells } from '../../domain/modeTree';

const rule = (sel: string) => {
  const m = new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`${sel} 규칙 없음`);
  return m[1]!;
};

describe('폰 홈 모드 카드 = 내용만큼, 스크롤은 홈 하나', () => {
  it('CSS 를 읽었다', () => expect(css.length).toBeGreaterThan(1000));
  it('홈 카드 몸통엔 높이 상한이 없다 — 넘쳐 겹치거나 안 밀리는 칸이 생기지 않게', () => {
    expect(rule('.m-mode-body')).not.toMatch(/max-height/);
    expect(rule('.m-mode-body')).not.toMatch(/overflow/);
  });
  it('꽉 채워 보기는 높이가 정해져 있으니 그 안에서 위아래로 민다', () => {
    expect(rule('.m-mode-full .m-mode-body')).toMatch(/overflow-y\s*:\s*auto/);
    expect(rule('.m-mode-full .m-mode-body')).toMatch(/overscroll-behavior\s*:\s*contain/);
  });
});

describe('phoneCells — 폰이 모드에 넘기는 글자 칸', () => {
  it('홈 카드는 높이를 재지 않고 늘 같은 줄 수 — 카드가 내용만큼 늘어나니 잰 높이를 보내면 칸이 자꾸 커진다', () => {
    expect(phoneCells(332, null)).toEqual({ columns: 41, rows: PHONE_HOME_ROWS });
  });
  it('홈 카드 줄 수는 28(504px) — 20줄(360)이면 맛보기 그림이 높이 248px 에 맞춰 0.56~0.72배로 줄어 글이 6px 대가 됐다(세로 41칸 1.0배, 가로 100칸 0.89배 이상)', () => {
    expect(PHONE_HOME_ROWS).toBe(28);
    expect(PHONE_HOME_ROWS * LH).toBe(504);
  });
  it('꽉 채워 보기는 잰 높이', () => expect(phoneCells(370, 728)).toEqual({ columns: 46, rows: 40 }));
  it('PhoneModes 는 phoneCells 로 — 홈 카드에 잰 높이를 보내지 않는다', () => {
    expect(src).toMatch(/phoneCells\(/);
    expect(src).not.toMatch(/cellsOf\(el\.client/);
  });
  it('폭은 안쪽(padding 뺀) 폭 — clientWidth 그대로면 모드가 칸보다 3칸 넓게 그려 그림이 0.92~0.94배로 줄었다(데스크톱은 contentRect)', () => {
    expect(src).not.toMatch(/phoneCells\(el\.clientWidth/);
    expect(src).toMatch(/paddingLeft[\s\S]*paddingRight/);
  });
});

describe('폰 모드 칸 누르는 자리 44px(전역 UI 규칙)', () => {
  it('모드 안 단추(스킨 칩·‹ ›·넣기·체크)는 높이·폭 44 이상 — 36px·32px 이었다', () => {
    const r = rule('.m-mode-body .btn, .m-mode-body .mdv-field button');
    expect(r).toMatch(/min-height\s*:\s*44px/);
    expect(r).toMatch(/min-width\s*:\s*44px/);
  });
  it('입력칸·고르기도 44', () => expect(rule('.m-mode-body .mdv-field input, .m-mode-body .mdv-field select')).toMatch(/min-height\s*:\s*44px/));
  it('글처럼 보이는 단추(plain — 달력 모드 날짜 숫자)는 누르는 자리만 44 — 가로 100칸에서 15~38×27px 이었다. 크기는 안 키운다(옆 글이 잘렸다)', () => {
    expect(rule('.m-mode-body .mdv-plain')).toMatch(/position\s*:\s*relative/);
    expect(rule('.m-mode-body .mdv-plain')).not.toMatch(/min-(height|width)/);
    expect(rule('.m-mode-body .mdv-plain::after')).toMatch(/inset\s*:\s*min\(0px,\s*calc\(\(100% - 44px\) \/ 2\)\)/);
  });
  it('모드 알약(여럿 켰을 때 위 줄)도 44', () => expect(rule('.m-mode-pills button')).toMatch(/min-height\s*:\s*44px/));
});
