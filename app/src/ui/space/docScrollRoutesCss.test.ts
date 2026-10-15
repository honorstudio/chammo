import { describe, expect, it } from 'vitest';
import locker from './locker.css?raw';
import space from './space.css?raw';

// 2026-10-12 사용자: md 문서 스크롤이 또 안 됐다. 앞서 보관함 탭 칸(.lk-doc-body)에만 min-height:0 을 줬는데,
// 탭 없이 d: 로 여는 길(문서 속 링크·하위 페이지·도구에서 열기, 사무실 위 창)은 .lk-center / .osh-card 같은 다른 세로 flex 칸에
// .cv-doc 이 바로 붙어 min-height:auto 로 내용만큼(9000px+) 늘어나 안쪽 스크롤 칸이 늘어난 채 잘렸다(하네스 실측 sticks 9348).
// → 래퍼마다 고치지 않고 .cv-doc 자신이 어느 칸에 놓여도 갇히게 한다. 그 약속을 여는 길마다 굳힌다.

/** 같은 셀렉터로 흩어진 규칙을 모두 합친다(.cv-main 처럼 여러 번 나오는 것) */
const rules = (css: string, sel: string) => {
  const esc = sel.replace(/[.>[\]()]/g, '\\$&');
  const re = new RegExp(`(?:^|\\n|,)\\s*${esc}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'g');
  return [...css.matchAll(re)].map((m) => m[1]).join(' ');
};

describe('스페이스 가운데 칸의 문서 래퍼는 모두 스크롤된다', () => {
  it('.cv-doc 은 어느 래퍼 안에서도 min-height:0 — 보관함 탭·d: 길·사무실 위 창 모두 한 규칙', () => {
    expect(rules(space, '.cv-doc')).toMatch(/min-height:\s*0/);
  });
  it('문서 안 스크롤 칸(.cv-doc-scroll)은 min-height:0 + overflow-y:auto', () => {
    const s = rules(space, '.cv-doc-scroll');
    expect(s).toMatch(/flex:\s*1/);
    expect(s).toMatch(/min-height:\s*0/);
    expect(s).toMatch(/overflow-y:\s*auto/);
  });
  it('엑셀 본문(.cv-sheet-body)도 칸에 갇힌다', () => {
    expect(rules(space, '.cv-sheet-body')).toMatch(/min-height:\s*0/);
  });

  // 문서가 놓이는 칸 사슬: .space → .cv-main → .lk-main → .lk-center → (.lk-doc-body) → .cv-doc
  it('스페이스 → 가운데 칸 → 보관함 자리 → 가운데 칸 사슬 모두 min-height:0 (끊기면 아래가 늘어난다)', () => {
    for (const [css, sel] of [[space, '.space'], [space, '.cv-main'], [locker, '.lk-main'], [locker, '.lk-center']] as const) {
      expect(rules(css, sel), sel).toMatch(/min-height:\s*0/);
    }
  });
  it('가운데 칸(.lk-center)·탭 칸(.lk-doc-body)은 넘침을 막는다 — 안쪽 스크롤 칸이 맡는다', () => {
    expect(rules(locker, '.lk-center')).toMatch(/overflow:\s*hidden/);
    expect(rules(locker, '.lk-doc-body')).toMatch(/overflow:\s*hidden/);
    expect(rules(locker, '.lk-doc-body')).toMatch(/min-height:\s*0/);
  });
  it('사무실 위 창(.osh-card)은 세로 flex + 넘침 숨김 — 그 안 문서도 같은 .cv-doc 규칙으로 갇힌다', () => {
    const c = rules(space, '.osh-card');
    expect(c).toMatch(/flex-direction:\s*column/);
    expect(c).toMatch(/overflow:\s*hidden/);
  });
  it('래퍼마다 .cv-doc 에 min-height 를 따로 주는 규칙(.xxx > .cv-doc)을 다시 늘리지 않는다 — 기본 규칙 하나', () => {
    for (const css of [space, locker]) expect(css).not.toMatch(/>\s*\.cv-doc\s*\{[^}]*min-height/);
  });
  it('글 파일(.txt) 편집칸은 내용만큼 자라고 스크롤은 바깥 칸에 맡긴다', () => {
    const t = rules(space, '.cv-text-area');
    expect(t).toMatch(/overflow:\s*hidden/);
    expect(t).not.toMatch(/max-height/);
  });
});
