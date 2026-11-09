// 사람 부르기 카드(.m-bask) — .dc-row > * { flex: 1 } 이 세로 flex 인 이 카드에도 먹어 이름 칸과 화면이 높이를 반씩 나눴다:
// 이름 밑 큰 빈 자리 + 화면 칸이 눌려 '다 했어'까지 잘림 + 채팅이 다 가려짐(2026-11-05 사용자 "화면 다 가림"). 실측은 app/e2e/phone-browser-card
import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rule = (sel: string) => [...css.matchAll(new RegExp(`(?:^|\\n|\\})\\s*${esc(sel)}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]!).join(';');

describe('폰 사람 부르기 카드', () => {
  it('카드 안 줄은 flex:1 을 물려받지 않는다', () => expect(rule('.m-direct .m-bask > *')).toMatch(/flex:\s*none/));
  it('화면 칸만 줄어든다 — 이름·단추 줄은 그대로', () => expect(rule('.m-direct .m-bask > .m-br')).toMatch(/flex:\s*0 1 auto/));
  it('카드 묶음은 화면의 40% 안, 키보드로 시트가 작아지면 시트의 절반 안', () => expect(rule('.m-bask-list')).toMatch(/max-height:\s*min\(40dvh,\s*50%\)/));
  it('여러 장이면 묶음 안에서 민다(카드는 안 눌린다)', () => {
    expect(rule('.m-bask-list.m-many')).toMatch(/overflow-y:\s*auto/);
    expect(rule('.m-bask-list.m-many > *')).toMatch(/flex:\s*none/);
  });
});
