// 폰 — 이 참모 채팅 끝에 직접 답하기 카드(데스크톱과 같은 카드·같은 문지기). 맥이 그 세션 입력칸에 사람 말로 친다
import { useMemo, useState } from 'react';
import { directAnswer, readDirect } from '../../data/web';
import { directCards, needsAnswer, type DirectCard } from '../../domain/directAsk';
import { forwardTo } from '../../domain/forwardQuestion';
import type { Session } from '../../domain/session';
import type { TaskEvent } from '../../domain/tasks';
import { DirectCardView } from '../chat/DirectCard';
import { usePoll } from './usePoll';

const DAY = 24 * 3600_000;

/** 이 참모 몫 카드(맡긴 세션이 올린 것) — 시트·접힌 줄·카드가 같이 쓴다 */
export function usePhoneDirect(orch: Session, orchs: Session[], sessions: Session[], events: TaskEvent[]): DirectCard[] {
  const log = usePoll(readDirect, 3000, '');
  return useMemo(() => directCards(log, {
    alive: (sid) => sessions.some((s) => s.id === sid), // 일 끝남(finished)도 살아 있어 답을 받는다 — 목록에서 빠져야 꺼짐
    prompt: () => undefined, // 폰은 세션 대화 기록을 안 읽는다 — 보냄까지, 세션이 done 을 남기면 처리됨
    reply: () => undefined,
  }).filter((c) => (needsAnswer(c) || Date.now() - Date.parse(c.ts) < DAY)
    && forwardTo(sessions.find((s) => s.id === c.from) ?? ({ id: c.from, project: c.cwd.split('/').pop() } as Session), events, orchs, sessions, orchs[0])?.id === orch.id),
  [log, sessions, events, orchs, orch.id]);
}

export function DirectCards({ mine: all, sessions }: { mine: DirectCard[]; sessions: Session[] }) {
  const [open, setOpen] = useState<string | null>(null);
  // 폰은 좁다 — 기다리는 카드 + 30분 안 영수증 2개까지(하루치 영수증이 쌓여 기다리는 카드가 밀려났다, 2026-10-03 QA)
  const recent = all.filter((c) => !needsAnswer(c) && Date.now() - Date.parse(c.answer?.ts || c.ts) < 30 * 60_000).slice(-2);
  const mine = all.filter((c) => needsAnswer(c) || recent.includes(c));
  if (!mine.length) return null;
  const first = mine.find(needsAnswer)?.id;
  const picked = open !== null && mine.some((m) => m.id === open && needsAnswer(m));
  return (
    <div className="m-direct">
      {mine.map((c) => {
        const s = sessions.find((x) => x.id === c.from);
        return <div key={c.id} className="dc-row"><DirectCardView c={c} name={s?.name || c.from} project={s?.project ?? undefined} compact={needsAnswer(c) && (picked ? c.id !== open : c.id !== first)} onOpen={() => setOpen(c.id)} onAnswer={directAnswer} /></div>;
      })}
    </div>
  );
}
