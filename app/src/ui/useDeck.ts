import { useEffect, useRef, useState } from 'react';
import { armed, keepIndex, orderPages, type DeckPage } from '../domain/inboxDeck';

/** 결정 카드 한 장씩 — 데스크톱 대기함·폰 알림 시트가 같이 쓴다. 급한 차례로 늘어놓고, 목록이 바뀌면 보던 카드에 머물고,
 *  보던 카드가 바뀐 직후엔 arming(누름 안 받음) — 넘기기·답한 뒤 따닥이 다음 결제 카드 승인에 떨어지지 않게(domain/inboxDeck ARM_MS) */
export function useDeck<T extends DeckPage>(pages: T[], open = true) {
  const deck = orderPages(pages);
  const keys = deck.map((p) => p.key);
  const [idx, setIdx] = useState(0);
  const prevKeys = useRef<string[]>(keys);
  const [changedAt, setChangedAt] = useState(0);
  const [, tick] = useState(0);
  const at = keys.join('\n') === prevKeys.current.join('\n') ? Math.min(idx, Math.max(0, deck.length - 1)) : keepIndex(prevKeys.current, idx, keys);
  const cur = deck[at];
  useEffect(() => { prevKeys.current = keys; if (at !== idx) setIdx(at); });
  const curKey = cur?.key;
  useEffect(() => {
    setChangedAt(Date.now());
    const t = window.setTimeout(() => tick((n) => n + 1), 500);
    return () => window.clearTimeout(t);
  }, [curKey, open]);
  const go = (d: number) => setIdx((at + d + deck.length) % deck.length);
  return { deck, at, cur, go, arming: !armed(changedAt, Date.now()) };
}
