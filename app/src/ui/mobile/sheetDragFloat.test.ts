// 폰 채팅 시트를 끌어올리는 동안 입력줄이 손가락 따라 화면 가운데로 뜨고 그 아래가 빈 회색이던 것(2026-10-12 사용자 "끌고 있을 때 그러는 거야").
// 시트는 top + bottom:0 이라 아래 끝은 늘 화면 바닥인데, 세로 flex 안 입력줄이 위쪽에 붙어 있었다 — 입력줄은 시트 바닥에 붙인다
import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rule = (sel: string) => [...css.matchAll(new RegExp(`(?:^|\\n|\\})\\s*${esc(sel)}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]!).join(';');

describe('끄는 중 입력줄 자리', () => {
  it('CSS 를 읽었다', () => expect(css.length).toBeGreaterThan(1000));
  it('시트는 세로 flex 이고 아래 끝이 화면 틀 바닥이다(이 전제가 바뀌면 아래 시험도 다시 본다)', () => {
    expect(rule('.m-sheet')).toMatch(/flex-direction:\s*column/);
    expect(rule('.m-sheet')).toMatch(/bottom:\s*0/);
  });
  it('입력줄은 시트 바닥에 붙는다 — 시트가 내용보다 길어도 위로 안 뜬다', () => {
    expect(rule('.m-comp-wrap')).toMatch(/margin-top:\s*auto/);
  });
});

describe('홈 아래 여백 = 살짝 시트 높이(2026-10-12 사용자 — 맨 아래까지 내려도 마지막 칸이 시트에 가려짐)', () => {
  // 하네스(402×874): 아래 여백 160 고정인데 살짝 시트가 185(손잡이+입력 카드+안전 영역) — 마지막 칸 16 가려짐. 실기기는 입력 카드가 더 커 더 가려졌다
  it('홈·세션·예약 스크롤 칸(.m-dash) 아래 여백은 시트가 재는 살짝 높이 변수(--m-peek-h)를 따른다', () => {
    expect(rule('.m-dash')).toMatch(/var\(--m-peek-h/);
  });
});
