// 결정 대기함 한 장씩 배선(시안 inbox-today v2, 2026-11-05 사용자) — 닫힘 규칙·누름 막기·결제 답 길이 그대로인지 소스로 못 박는다(앱 테스트엔 DOM 이 없다)
import { describe, expect, it } from 'vitest';
import inbox from './Inbox.tsx?raw';
import app from '../App.tsx?raw';
import css from './styles.css?raw';
import deckHook from './useDeck.ts?raw';

const popover = inbox.slice(inbox.indexOf('export function InboxPopover'));

describe('결정 대기함 닫힘 — 결제·운영 카드가 있으면 바깥 클릭·Esc 로 안 닫힌다', () => {
  it('바깥 클릭·Esc 귀는 closesOnOutside 일 때만 단다', () => {
    expect(popover).toMatch(/const loose = closesOnOutside\(deck\);/);
    expect(popover).toMatch(/if \(!open \|\| !loose\) return;/);
    expect(popover).toMatch(/addEventListener\('pointerdown', down, true\)/);
    expect(popover).toMatch(/e\.key === 'Escape'\) onClose\(\)/);
  });
  it('종을 누르는 건 바깥 클릭으로 안 친다(App 이 열고 닫는다)', () => expect(popover).toMatch(/t\.closest\('\.bell'\)\)\) return;/));
  it('제목 막대·닫기 X 없음', () => {
    expect(popover).not.toMatch(/inbox-later|IconClose/);
  });
});

describe('카드를 넘기거나 답한 직후엔 누름을 안 받는다 — 따닥이 다음 결제 카드 승인에 떨어지지 않게', () => {
  it('장마다 새로 그린다(key) — 앞 카드의 눌림·하는 중 상태가 다음 카드에 안 남는다', () => expect(popover).toMatch(/<div key=\{cur\.key\} className=\{`ibx-page\$\{arming \? ' arming' : ''\}`\}>/));
  it('보던 카드가 바뀌면 시각을 새로 재고 그동안 arming', () => {
    expect(deckHook).toMatch(/setChangedAt\(Date\.now\(\)\);[\s\S]*?\}, \[curKey, open\]\);/);
    expect(deckHook).toMatch(/arming: !armed\(changedAt, Date\.now\(\)\)/);
  });
  it('arming 동안 카드 안 누름이 안 먹는다', () => expect(css).toMatch(/\.ibx-page\.arming \{ pointer-events: none; \}/));
});

describe('결제 답 길은 그대로 — 대기함도 직접 카드(DirectCardView)를 그대로 쓴다', () => {
  it('이 기기 카드는 cardNode(c, \'inbox\'), 다른 기기 카드는 remote.cardNode', () => {
    expect(app).toMatch(/node: direct\.cardNode\(c, 'inbox'\)/);
    expect(app).toMatch(/node: remote\.cardNode\(x\)/);
  });
  it('급한 정도는 기록된 종류로(directRank·itemRank)', () => {
    expect(app).toMatch(/rank: directRank\(c\.kind\)/);
    expect(app).toMatch(/rank: itemRank\(i\)/);
  });
  it('그냥 물음은 저절로 안 펼친다 — 채팅에 보이는지(askInView)로 가르던 예외는 없앴다', () => expect(app).not.toMatch(/askInView/));
});

describe('말풍선 모양', () => {
  it('종에서 나온 꼬리 + 결제 장은 옅은 빨강', () => {
    expect(css).toMatch(/\.inbox-pop::before \{/);
    expect(css).toMatch(/\.inbox-pop\.pay \{/);
  });
  it('물음은 줄임 없이 — 한 장 물음엔 line-clamp·ellipsis 가 없다', () => {
    const rules = css.split('\n').filter((l) => l.startsWith('.ibx-q') || l.startsWith('.ibx-line'));
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.join('\n')).not.toMatch(/line-clamp|ellipsis|nowrap/);
  });
});
