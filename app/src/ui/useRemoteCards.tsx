// 짝지은 다른 기기의 카드(ADR 0011) — 결정 대기함(상단 종)에 이 기기 카드와 같은 모양으로. 누른 답은 사람 길(remote_direct_answer)로 그 기기에
// '사람이 <이 기기>에서 원격으로 눌렀어'가 된다. 보임 줄(direct_shown)은 이 기기 기록이라 남기지 않는다
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { remoteCards, type PeerCardsRow, type RemoteCard } from '../domain/remoteCards';
import { remoteCardAnswer } from '../data/remote';
import { DirectCardView, type DirectPick } from './chat/DirectCard';

export function useRemoteCards() {
  const [rows, setRows] = useState<PeerCardsRow[]>([]);
  useEffect(() => {
    let alive = true;
    const tick = () => void invoke<PeerCardsRow[]>('remote_cards').then((r) => { if (alive) setRows((p) => (JSON.stringify(p) === JSON.stringify(r) ? p : r)); }, () => {});
    tick();
    const id = window.setInterval(tick, 4000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);
  const cards: RemoteCard[] = remoteCards(rows, Date.now());
  const key = (x: RemoteCard) => `${x.dev}:${x.card.id}`;
  const answer = (dev: string) => (id: string, pick: DirectPick) => remoteCardAnswer(dev)(id, pick);
  /** 결정 대기함 한 장 — 펼친 채로 */
  const cardNode = (x: RemoteCard) => <div className="dc-row"><DirectCardView c={x.card} name={x.name} onAnswer={answer(x.dev)} /></div>;
  return { cards, cardNode, key, keys: cards.map((x) => `${key(x)}:${x.card.state}`).join('|') };
}
