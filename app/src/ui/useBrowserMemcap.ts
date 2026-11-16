// 참모 브라우저 메모리 상한 알림 — 30초마다 래퍼 기록(browser_memcap_events)을 가져가 맡긴 참모(스크립트 길이면 그 세션도)에게 [앱] 한 줄.
// 어디까지 보냈나는 localStorage 의 시각 — 처음 켤 땐 지금부터(옛 기록을 몰아 보내지 않게). 판단은 domain/browserMemcap
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef } from 'react';
import { sendToSession } from '../data/tauri';
import { routeMemcap, type MemcapEvent } from '../domain/browserMemcap';
import { forwardTo } from '../domain/forwardQuestion';
import type { Session } from '../domain/session';
import type { TaskEvent } from '../domain/tasks';
import { every } from './poll';

const SINCE_KEY = 'browserMemcapSince';
const readSince = () => {
  try {
    const v = localStorage.getItem(SINCE_KEY);
    if (v) return v;
    const now = new Date().toISOString();
    localStorage.setItem(SINCE_KEY, now);
    return now;
  } catch {
    return new Date().toISOString();
  }
};

type In = { orchs: Session[]; sessions: Session[]; events: TaskEvent[]; front?: Session; heir?: (s: Session) => Session | undefined };

export function useBrowserMemcap(o: In) {
  const cur = useRef(o);
  cur.current = o;
  const since = useRef<string | null>(null);
  useEffect(() => every(() => {
    since.current ??= readSince();
    void invoke<MemcapEvent[]>('browser_memcap_events', { since: since.current }).then(async (list) => {
      for (const e of list) {
        const x = cur.current;
        const sends = routeMemcap(e, { sessions: x.sessions, chiefOf: (s) => (s ? forwardTo(s, x.events, x.orchs, x.sessions, x.front, x.heir) : undefined) ?? x.front ?? x.orchs[0] });
        if (!sends.length) return; // 참모가 아직 없다 — 다음 바퀴에 이 기록부터
        for (const m of sends) await sendToSession(m.to, m.text).catch(() => {});
        since.current = e.at;
        try { localStorage.setItem(SINCE_KEY, e.at); } catch { /* 이번 실행 동안은 since 로 */ }
      }
    }, () => {});
  }, 30_000), []);
}
