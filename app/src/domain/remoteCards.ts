// 짝지은 다른 기기의 직접 답하기 카드(ADR 0011) — 그 기기 /api/direct 기록을 이 기기 결정 대기함·폰에 같이 띄운다.
// 답은 사람 길(remote_direct_answer · 폰은 /api/peer-card-answer)로만 가고, 연결 요청 카드는 그 기기 사람만 누른다(빼고 보인다)
import { directCards, needsAnswer, type DirectCard } from './directAsk';
import { seenName } from './session';
import { tr } from '../i18n';

/** off = 이 맥이 지금 그 기기에 안 닿는다(맥이 짧게 쉬었다 다시 묻는다) — log·sessions 는 마지막으로 받은 것(10분까지, 그 뒤엔 빈 값) */
export type PeerCardsRow = { dev: string; name: string; log: string; sessions: string; off?: boolean };
export type RemoteCard = { dev: string; card: DirectCard; name: string };

const devWord = (n: string) => n.replace(/^참모 · /, '');

export function remoteCards(rows: PeerCardsRow[], now: number): RemoteCard[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r) => {
    let list: { id?: string; name?: string }[] = [];
    try {
      const v: unknown = JSON.parse(r.sessions);
      if (Array.isArray(v)) list = v as typeof list;
    } catch {
      return [];
    }
    const alive = new Set(list.map((s) => s.id).filter(Boolean));
    return directCards(r.log ?? '', { alive: (sid) => alive.has(sid), prompt: () => undefined, reply: () => undefined, now })
      .filter((c) => needsAnswer(c) && c.kind !== 'link')
      .map((card) => ({ dev: r.dev, card, name: `${devWord(r.name)}${r.off ? tr(' · 연결 안 됨', ' · not connected') : ''} · ${seenName(list.find((s) => s.id === card.from)?.name || card.from)}` }));
  });
}
