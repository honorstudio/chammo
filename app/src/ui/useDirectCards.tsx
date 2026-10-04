// 직접 답하기 카드 — <데이터>/direct.jsonl 을 2초마다 읽어 참모별로 나눈다(그 세션을 맡긴 참모 채팅에, forwardTo 와 같은 규칙).
// 새로 기다리는 카드가 생기면 알린다(human — 앱을 보고 있으면 앱 안만)
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Activity } from '../domain/activity';
import { liveOf, type Live } from '../domain/agentBrowser';
import { directCards, needsAnswer, type DirectCard } from '../domain/directAsk';
import { forwardTo } from '../domain/forwardQuestion';
import type { Session } from '../domain/session';
import type { TaskEvent } from '../domain/tasks';
import { DirectCardView } from './chat/DirectCard';

const DAY = 24 * 3600_000;
export type ChatExtra = { ts: string; key: string; node: ReactNode };

export function useDirectCards(sessions: Session[], acts: { session: Session; activity: Activity }[], events: TaskEvent[], orchs: Session[], front: Session | undefined, lives: Live[],
  notify: (c: DirectCard, name: string) => void, heir?: (s: Session) => Session | undefined) {
  const [log, setLog] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => void invoke<string>('direct_log').then((t) => { if (alive) setLog((p) => (p === t ? p : t)); }, () => {});
    tick();
    const id = window.setInterval(tick, 2000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);
  const cards = useMemo(() => {
    const act = new Map(acts.map((a) => [a.session.id, a.activity]));
    return directCards(log, {
      alive: (sid) => sessions.some((s) => s.id === sid), // 일 끝남(finished)도 살아 있어 답을 받는다 — 목록에서 빠져야 꺼짐
      prompt: (sid) => act.get(sid)?.prompt,
      reply: (sid) => act.get(sid)?.reply,
    }).filter((c) => needsAnswer(c) || Date.now() - Date.parse(c.ts) < DAY); // 끝난 영수증은 하루만
  }, [log, sessions, acts]);
  // 새로 기다리는 카드 알림 — 한 카드에 한 번
  const told = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (told.current === null) { told.current = new Set(cards.map((c) => c.id)); return; } // 처음 읽은 옛 카드는 안 알린다
    for (const c of cards) {
      if (!needsAnswer(c) || told.current.has(c.id)) continue;
      told.current.add(c.id);
      notify(c, sessions.find((s) => s.id === c.from)?.name || c.from);
    }
  }, [cards]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 그 참모 채팅에 끼울 카드들 — 기다리는 것 중 가장 오래된 하나만 펼치고 나머지는 한 줄(열기) */
  const extraOf = (orch: Session): ChatExtra[] => {
    const mine = cards.filter((c) => {
      const s = sessions.find((x) => x.id === c.from) ?? ({ id: c.from, project: c.cwd.split('/').pop() } as Session);
      return forwardTo(s, events, orchs, sessions, front, heir)?.id === orch.id;
    });
    const first = mine.find(needsAnswer)?.id;
    return mine.map((c) => {
      const s = sessions.find((x) => x.id === c.from);
      const name = s?.name || c.from;
      const picked = open !== null && mine.some((m) => m.id === open && needsAnswer(m));
      const expanded = picked ? c.id === open : c.id === first;
      return {
        ts: c.ts, key: `direct:${c.id}`,
        node: <div className="chat-row dc-row"><DirectCardView c={c} name={name} project={s?.project ?? undefined} profile={s ? liveOf(s, lives)?.profile : undefined} compact={needsAnswer(c) && !expanded} onOpen={() => setOpen(c.id)} /></div>,
      };
    });
  };
  return { cards, extraOf };
}
