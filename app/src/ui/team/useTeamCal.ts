// 팀 캘린더 데이터 — 첫 그림은 창 기억·기기 캐시(망 안 씀), 그다음 따라잡기. 남이 고친 건 소켓 → Rust 기록장 → 1초 poll 번호로.
// 탭을 오가도(홈 블록 ↔ 캘린더 탭) 창 기억에서 바로 그리고 다시 받지 않는다(10-30 사용자 '첫 로드 빠르게·다시 로드 없음')
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalApi } from '../../data/teamCalApi';
import { calPutOk, type CalData, type CalItem, type CalSnap } from '../../domain/teamCal';
import { syncGate } from '../../domain/teamCalSync';

const memo = new Map<string, CalSnap>();
/** 홈 블록·캘린더 탭이 같이 떠 있어도 팀마다 따라잡기 하나, 실패하면 물러서기 */
const gate = syncGate<CalSnap>();
const SLOW_SYNC = 5 * 60_000;

export type CalNote = { text: string; undo?: () => void };

export function useTeamCal(team: string, api: CalApi) {
  const [st, setSnap] = useState<CalSnap | null>(() => memo.get(team) ?? null);
  // 팀을 바꾸면 앞 팀 기록장을 안 보인다 — 늦게 온 앞 팀 답(take)도 여기서 걸러진다
  const snap = st && (!team || st.team === team) ? st : memo.get(team) ?? null;
  const [err, setErr] = useState('');
  const ver = useRef(snap?.ver ?? 0);
  const cur = useRef(snap);
  cur.current = snap;

  const take = useCallback((s: CalSnap) => {
    memo.set(team, s);
    ver.current = s.ver;
    setSnap(s);
  }, [team]);

  useEffect(() => {
    let live = true;
    ver.current = memo.get(team)?.ver ?? 0;
    const sync = async () => {
      const p = gate(team, () => api.sync(team));
      if (p) await p.then((s) => { if (live) { take(s); setErr(''); } }, (e) => { if (live) setErr(String(e)); });
    };
    void (async () => {
      if (!memo.get(team)) {
        const c = await api.cached(team).catch(() => null);
        if (live && c) take(c);
      }
      await sync();
    })();
    const fast = setInterval(async () => {
      const p = await api.poll(team).catch(() => null);
      if (!live || !p) return;
      if (p.stale) void sync();
      else if (p.ver && p.ver !== ver.current) {
        const c = await api.cached(team).catch(() => null);
        if (live && c) take(c);
      }
    }, 1000);
    const slow = setInterval(() => void sync(), SLOW_SYNC);
    return () => { live = false; clearInterval(fast); clearInterval(slow); };
  }, [team, api, take]);

  /** 쓰기 — 누른 즉시 화면에(옅게), 서버가 받으면 진하게. 실패면 되돌린다. 남의 고침을 덮었으면 그 한 줄을 돌려준다 */
  const put = useCallback(async (it: CalItem | null, id: string, data: CalData | null, restore = false): Promise<{ lost: string[]; by: string; gone: boolean }> => {
    const before = cur.current;
    if (!calPutOk(before, team, it)) throw new Error('팀이 바뀌었어요 — 일정을 다시 열어 주세요');
    if (before) {
      const now: CalItem = { id, rev: it?.rev ?? 0, by: before.me, at: Date.now(), del: data === null, deletedAt: data === null ? Date.now() : null, why: '', data: data ?? it?.data ?? ({} as CalData), pending: true };
      setSnap({ ...before, items: [...before.items.filter((x) => x.id !== id), now] });
    }
    try {
      const r = await api.put(team, id, it?.rev ?? 0, it?.data ?? null, data, restore);
      take(r.snap);
      return { lost: r.lost, by: r.by, gone: r.gone };
    } catch (e) {
      if (before) setSnap(before);
      throw e;
    }
  }, [api, team, take]);

  return { snap, err, put };
}
