// claude 데몬이 앱과 다른 데이터 폴더로 떠 있으면 맨 앞 참모에게 한 줄 — 판단은 Rust daemon_env, 문구는 domain/daemonEnv.
// 켤 때 한 번, 그 뒤 5분마다. 데몬·값마다 한 번만(앱을 다시 켜도 — localStorage)
import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { sendToSession } from '../data/tauri';
import { daemonEnvKey, daemonEnvText, type DaemonEnv } from '../domain/daemonEnv';
import type { Session } from '../domain/session';
import { every } from './poll';

const DONE_KEY = 'daemonEnvTold';
const EVERY_MS = 5 * 60_000;
const load = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
};
const save = (d: Set<string>) => {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...d].slice(-50)));
  } catch {
    // 못 남겨도 이번 실행 동안은 한 번만
  }
};

export function useDaemonEnv(orch: Session | undefined) {
  const latest = useRef(orch);
  latest.current = orch;
  useEffect(() => {
    const done = load();
    let busy = false;
    const tick = () => {
      const to = latest.current;
      if (busy || !to || to.state === 'blocked') return; // 받을 참모가 없거나 확인창에 걸려 있으면 다음에
      busy = true;
      void invoke<DaemonEnv | null>('daemon_env_check')
        .then((d) => {
          if (!d || done.has(daemonEnvKey(d))) return;
          // 기록부터 — 보낸 뒤 남기다 실패하면 다음 폴링에 또 보낸다
          done.add(daemonEnvKey(d));
          save(done);
          return sendToSession(to.id, daemonEnvText(d)).catch(() => { done.delete(daemonEnvKey(d)); save(done); });
        })
        .catch(() => {})
        .finally(() => { busy = false; });
    };
    // 참모 세션 목록이 막 뜨는 중일 수 있어 첫 번은 조금 뒤에
    const first = window.setTimeout(tick, 20_000);
    const stop = every(tick, EVERY_MS);
    return () => { window.clearTimeout(first); stop(); };
  }, []);
}
