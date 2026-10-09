// 직접 답하기 카드 — <데이터>/direct.jsonl 을 2초마다 읽어 참모별로 나눈다(그 세션을 맡긴 참모 채팅에, forwardTo 와 같은 규칙).
// 사람 답이 필요한 카드는 그 참모 채팅 맨 아래 + 결정 대기함(상단 종)에 늘 — 어느 화면·탭을 보든, 받을 참모가 없어도 보이게(2026-10-05 아이맥 사고).
// 새로 기다리는 카드가 생기면 알린다(human — 앱을 보고 있으면 앱 안만)
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Activity } from '../domain/activity';
import { liveOf, type Live } from '../domain/agentBrowser';
import { needsAnswer, needsLook, placeDirect, stepSeen, type DirectCard, type Seen } from '../domain/directAsk';
import type { Session } from '../domain/session';
import type { TaskEvent } from '../domain/tasks';
import { tr } from '../i18n';
import { DirectCardView, DirectLine, useDirectTidy } from './chat/DirectCard';

export type ChatExtra = { ts: string; key: string; pin?: boolean; clip?: boolean; node: ReactNode };

/**
 * everyone = 폴더로 거르기 전 전체 세션 목록(agents --json) — 워크트리로 들어가 사이드바에서 빠진 세션도 살아 있다.
 * onRespawn = 주인 세션이 꺼진 카드의 '다시 띄우기'(같은 번호)
 */
export function useDirectCards(everyone: Session[], acts: { session: Session; activity: Activity }[], events: TaskEvent[], orchs: Session[], front: Session | undefined, lives: Live[],
  notify: (c: DirectCard, name: string) => void, heir?: (s: Session) => Session | undefined, onRespawn?: (c: DirectCard) => Promise<void>) {
  const [log, setLog] = useState<string | null>(null); // null = 아직 한 번도 못 읽음
  const [open, setOpen] = useState<string | null>(null);
  const [inboxOpen, setInboxOpen] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => void invoke<string>('direct_log').then((t) => { if (alive) setLog((p) => (p === t ? p : t)); }, () => {});
    tick();
    const id = window.setInterval(tick, 2000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);
  const seen = useRef<Seen>({});
  const placed = useMemo(() => {
    const now = Date.now();
    seen.current = stepSeen(seen.current, everyone.map((s) => s.id), now); // 목록을 새로 읽을 때마다(everyone 이 바뀔 때) — 재시작 유예를 시간으로 잰다
    const act = new Map(acts.map((a) => [a.session.id, a.activity]));
    return placeDirect(log ?? '', {
      everyone, seen: seen.current, now, events, orchs, front, heir, unknown: everyone.length === 0, // 첫 목록 전
      prompt: (sid) => act.get(sid)?.prompt,
      reply: (sid) => act.get(sid)?.reply,
    });
  }, [log, everyone, acts, events, orchs, front, heir]);
  const cards = useMemo(() => placed.map((p) => p.card), [placed]);
  const tidy = useDirectTidy(cards);
  // 새로 기다리는 카드 알림 — 한 카드에 한 번. 처음 읽은 기록의 옛 카드는 안 알린다(첫 읽기 전 빈 목록으로 굳히지 않게 — 기록을 받은 뒤에 시작)
  const told = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (told.current === null) { if (log !== null) told.current = new Set(cards.map((c) => c.id)); return; }
    for (const c of cards) {
      if (!needsAnswer(c) || told.current.has(c.id)) continue;
      told.current.add(c.id);
      notify(c, everyone.find((s) => s.id === c.from)?.name || c.from);
    }
  }, [cards]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (c: DirectCard) => everyone.find((x) => x.id === c.from)?.name || c.from;
  const card = (c: DirectCard, place: string, compact: boolean, onOpen: () => void) => {
    const s = everyone.find((x) => x.id === c.from);
    return <DirectCardView c={c} name={nameOf(c)} project={s?.project ?? undefined} profile={s ? liveOf(s, lives)?.profile : undefined} compact={compact} onOpen={onOpen}
      place={place} onDismiss={() => tidy.hide(c)} onRespawn={onRespawn && (() => onRespawn(c))} />;
  };

  /** 그 참모 채팅에 끼울 카드들 — 봐야 하는 카드는 맨 아래 고정(가장 오래된 하나만 펼침), 끝난 건 그 시각 자리에 한 줄 영수증(5분) */
  const extraOf = (orch: Session): ChatExtra[] => {
    const mine = placed.filter((p) => p.owner?.id === orch.id && tidy.show(p.card) !== 'hide').map((p) => p.card);
    const first = mine.find(needsLook)?.id;
    const picked = open !== null && mine.some((m) => m.id === open && needsLook(m));
    const place = `chat:${orch.name || orch.id}`;
    return mine.map((c) => (needsLook(c)
      ? { ts: c.ts, key: `direct:${c.id}`, pin: true, node: <div className="chat-row dc-row">{card(c, place, picked ? c.id !== open : c.id !== first, () => setOpen(c.id))}</div> }
      : { ts: c.ts, key: `direct:${c.id}`, node: <div className="chat-row dc-row"><DirectLine c={c} name={nameOf(c)} onDismiss={() => tidy.hide(c)} /></div> }));
  };

  /** 결정 대기함(상단 종) — 봐야 하는 카드 전부. 한 줄씩, 누른 것만 펼친다 */
  const inboxCards = cards.filter((c) => needsLook(c) && tidy.show(c) === 'full');
  const inboxNode = inboxCards.length ? (
    <div className="inbox-direct" role="group" aria-label={tr('직접 답', 'Direct answers')}>
      {inboxCards.map((c) => <div key={c.id} className="dc-row">{card(c, 'inbox', c.id !== inboxOpen, () => setInboxOpen(c.id))}</div>)}
    </div>
  ) : null;
  return { cards, extraOf, inboxCards, inboxNode };
}
