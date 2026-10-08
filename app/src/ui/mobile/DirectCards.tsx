// 폰 — 이 참모 채팅 끝에 직접 답하기 카드(데스크톱과 같은 카드·같은 문지기). 맥이 그 세션 입력칸에 사람 말로 친다
import { useMemo, useRef, useState } from 'react';
import { directAnswer, readDirect } from '../../data/web';
import { needsLook, placeDirect, stepSeen, type DirectCard, type Seen } from '../../domain/directAsk';
import type { Session } from '../../domain/session';
import type { TaskEvent } from '../../domain/tasks';
import { DirectCardView, DirectLine, useDirectTidy } from '../chat/DirectCard';
import { usePoll } from './usePoll';

/** 이 참모 몫 카드(맡긴 세션이 올린 것) — 시트·접힌 줄·카드가 같이 쓴다. 데스크톱과 같은 배치(domain placeDirect) — 재시작 사이 잠깐 빠져도 기다림 */
export function usePhoneDirect(orch: Session, orchs: Session[], sessions: Session[], events: TaskEvent[]): DirectCard[] {
  const log = usePoll(readDirect, 3000, '');
  const seen = useRef<Seen>({});
  return useMemo(() => {
    const now = Date.now();
    seen.current = stepSeen(seen.current, sessions.map((s) => s.id), now);
    // 폰은 세션 대화 기록을 안 읽는다 — 보냄까지, 세션이 done 을 남기면 처리됨
    return placeDirect(log, { everyone: sessions, seen: seen.current, now, unknown: sessions.length === 0, events, orchs, front: orchs[0], prompt: () => undefined, reply: () => undefined })
      .filter((p) => p.owner?.id === orch.id).map((p) => p.card);
  }, [log, sessions, events, orchs, orch.id]);
}

export function DirectCards({ mine: all, sessions }: { mine: DirectCard[]; sessions: Session[] }) {
  const [open, setOpen] = useState<string | null>(null);
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
        if (!needsLook(c)) return <div key={c.id} className="dc-row"><DirectLine c={c} name={s?.name || c.from} onDismiss={() => tidy.hide(c)} /></div>;
        return <div key={c.id} className="dc-row"><DirectCardView c={c} name={s?.name || c.from} project={s?.project ?? undefined} compact={picked ? c.id !== open : c.id !== first} onOpen={() => setOpen(c.id)} onAnswer={directAnswer} onDismiss={() => tidy.hide(c)} /></div>;
      })}
    </div>
  );
}
