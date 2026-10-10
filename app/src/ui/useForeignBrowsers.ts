// 앱 밖 크롬을 띄운 팀 세션을 맡긴 참모에게 한 줄(2026-10-10 사용자 "브라우저는 참모 브라우저만") — 판단은 Rust browser_foreign, 고르기·문구는 domain/foreignBrowser.
// 30초마다 프로세스 표를 한 번. 세션·종류마다 한 번만 알린다(앱을 다시 켜도 — localStorage)
import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { sendToSession } from '../data/tauri';
import { forwardTo } from '../domain/forwardQuestion';
import { foreignText, nextForeign, type Foreign } from '../domain/foreignBrowser';
import type { TaskEvent } from '../domain/tasks';
import type { Session } from '../domain/session';

const DONE_KEY = 'foreignBrowserTold';
const EVERY_MS = 30_000;
const load = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
};
const save = (d: Set<string>) => {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...d].slice(-200)));
  } catch {
    // 못 남겨도 이번 실행 동안은 한 번만
  }
};

export function useForeignBrowsers(subs: Session[], front: Session | undefined, events: TaskEvent[], orchs: Session[], sessions: Session[], heir?: (s: Session) => Session | undefined) {
  const latest = useRef({ subs, front, events, orchs, sessions, heir });
  latest.current = { subs, front, events, orchs, sessions, heir };
  useEffect(() => {
    const done = load();
    let busy = false;
    const tick = () => {
      const { subs, front, events, orchs, sessions, heir } = latest.current;
      const pids = subs.map((s) => s.procPid).filter((p): p is number => !!p);
      if (busy || !pids.length) return;
      busy = true;
      void invoke<Foreign[]>('foreign_browsers', { sessionPids: pids })
        .then((found) => {
          const n = nextForeign(found, subs, done);
          const to = n && forwardTo(n.sub, events, orchs, sessions, front, heir);
          if (!n || !to || to.state === 'blocked') return; // 받을 참모가 확인창에 걸려 있으면 다음에
          done.add(n.key);
          save(done);
          return sendToSession(to.id, foreignText(n.sub, n.f.kind)).catch(() => { done.delete(n.key); save(done); });
        })
        .catch(() => {})
        .finally(() => { busy = false; });
    };
    const id = window.setInterval(tick, EVERY_MS);
    return () => window.clearInterval(id);
  }, []);
}
