// 폰 — 이 참모 채팅 끝에 직접 답하기 카드(데스크톱과 같은 카드·같은 문지기). 맥이 그 세션 입력칸에 사람 말로 친다
import { useEffect, useMemo, useRef, useState } from 'react';
import { askCardKey, type AskPlaced } from '../../domain/agentAsk';
import { askName } from '../../domain/agentBrowser';
import { directAnswer, peerCardAnswer, phoneNumber, readDirect, readPeerCards } from '../../data/web';
import { remoteCards, type PeerCardsRow } from '../../domain/remoteCards';
import { needsLook, phoneOwns, placeDirect, stepSeen, type DirectCard, type Seen } from '../../domain/directAsk';
import { seenName, type Session } from '../../domain/session';
import type { TaskEvent } from '../../domain/tasks';
import { DirectCardView, DirectLine, useDirectTidy } from '../chat/DirectCard';
import { BrowserView } from './BrowserView';
import { usePoll } from './usePoll';

/** 이 참모 몫 카드(맡긴 세션이 올린 것) — 시트·접힌 줄·카드가 같이 쓴다. 데스크톱과 같은 배치(domain placeDirect) — 재시작 사이 잠깐 빠져도 기다림 */
export function usePhoneDirect(orch: Session, orchs: Session[], sessions: Session[], events: TaskEvent[]): DirectCard[] {
  const log = usePoll(readDirect, 3000, '');
  const seen = useRef<Seen>({});
  return useMemo(() => {
    const now = Date.now();
    seen.current = stepSeen(seen.current, sessions.map((s) => s.id), now);
    // 폰은 세션 대화 기록을 안 읽는다 — 보냄까지, 세션이 done 을 남기면 처리됨
    return phoneOwns(placeDirect(log, { everyone: sessions, seen: seen.current, now, unknown: sessions.length === 0, events, orchs, front: orchs[0], prompt: () => undefined, reply: () => undefined })
      , orch.id);
  }, [log, sessions, events, orchs, orch.id]);
}

/** focus = 알림이 짚은 카드 id — 그 카드를 펼치고 반짝(data-card 로 굴려 온다) */
export function DirectCards({ mine: all, sessions, focus }: { mine: DirectCard[]; sessions: Session[]; focus?: string }) {
  const [open, setOpen] = useState<string | null>(focus ?? null);
  useEffect(() => { if (focus) setOpen(focus); }, [focus]);
  const tidy = useDirectTidy(all);
  // 기다리는 카드만 크게, 끝난 건 한 줄로 5분(2026-10-05 — 처리된 카드 두 장이 채팅 아래를 크게 가렸다)
  const mine = all.filter((c) => tidy.show(c) !== 'hide');
  if (!mine.length) return null;
  const first = mine.find(needsLook)?.id;
  const picked = open !== null && mine.some((m) => m.id === open && needsLook(m));
  return (
    <div className="m-direct">
      {mine.map((c) => {
        const s = sessions.find((x) => x.id === c.from);
        if (!needsLook(c)) return <div key={c.id} className="dc-row"><DirectLine c={c} name={seenName(s?.name || c.from)} onDismiss={() => tidy.hide(c)} /></div>;
        return <div key={c.id} className={c.id === focus ? 'dc-row m-jumped' : 'dc-row'} data-card={`d:${c.id}`}><DirectCardView c={c} name={seenName(s?.name || c.from)} project={s?.project ?? undefined} compact={picked ? c.id !== open : c.id !== first} onOpen={() => setOpen(c.id)} onAnswer={directAnswer} number={phoneNumber} onDismiss={() => tidy.hide(c)} /></div>;
      })}
    </div>
  );
}

/** 짝지은 다른 기기의 카드(ADR 0011) — 맨 앞 참모 채팅 끝에. 이 맥이 사람 길로 그 기기에 넘겨 '사람이 <이 맥>에서 원격으로 눌렀어'가 된다 */
export function PeerCards() {
  const rows = usePoll<PeerCardsRow[]>(() => readPeerCards().catch(() => []), 4000, []);
  const [open, setOpen] = useState<string | null>(null);
  const cards = remoteCards(rows, Date.now());
  if (!cards.length) return null;
  const key = (x: (typeof cards)[number]) => `${x.dev}:${x.card.id}`;
  return (
    <div className="m-direct">
      {cards.map((x) => (
        <div key={key(x)} className="dc-row">
          <DirectCardView c={x.card} name={x.name} compact={key(x) !== (open ?? key(cards[0]!))} onOpen={() => setOpen(key(x))} onAnswer={peerCardAnswer(x.dev)} />
        </div>
      ))}
    </div>
  );
}

/**
 * 사람 부르기 카드(browser_ask_human) — 이 참모가 맡긴 세션의 브라우저가 사람을 부르는 동안 채팅 끝에. 화면(QR 같은 것)을 실시간으로 보고
 * 크게 눌러 개입하거나 '다 했어'(BrowserView). 예전엔 세션 판·사무실에서 그 세션을 찾아 들어가야만 보여 밖에서 놓쳤다(2026-10-24 트레이더)
 */
export function PhoneAskCards({ asks, sessions, focus }: { asks: AskPlaced[]; sessions: Session[]; focus?: string }) {
  if (!asks.length) return null;
  return (
    <div className="m-direct">
      {asks.map(({ live: l }) => {
        const k = askCardKey(l);
        return (
          <div key={k} className={k === focus ? 'dc-row m-bask m-jumped' : 'dc-row m-bask'} data-card={k}>
            <b className="m-bask-who">{askName(l, sessions)}</b>
            <BrowserView live={l} />
          </div>
        );
      })}
    </div>
  );
}
