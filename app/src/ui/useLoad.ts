import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { loadEnv, loadSample, loadSave } from '../data/tauri';
import type { ModeRow } from '../domain/modeTree';
import { attribute, envCandidates, parseClaudePids, parsePs, parseSys, summarize, type LoadReport, type SysLoad } from '../domain/load';
import type { Session } from '../domain/session';

/**
 * 부하 모니터 — mine = Chammo 세션(프로젝트·HQ·루틴), others = 이 맥의 나머지 Claude 세션.
 * 상단 바만 볼 땐 10초, 부하 화면을 열면(fast) 3초. 잴 때마다 참모용 요약(load.json)도 남긴다
 */
export function useLoad(mine: Session[], others: Session[], fast: boolean) {
  const [sys, setSys] = useState<SysLoad | null>(null);
  const [report, setReport] = useState<LoadReport | null>(null);
  const ref = useRef({ mine, others });
  ref.current = { mine, others };
  const busy = useRef(false);
  const sample = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const raw = await loadSample();
      const s = parseSys(raw.sys);
      const procs = parsePs(raw.ps);
      const sessions = ref.current.mine.filter((x) => x.procPid).map((x) => ({ id: x.id, name: x.name, project: x.project, pid: x.procPid! }));
      const env = parseClaudePids(await loadEnv(envCandidates(procs, sessions.map((x) => x.pid))));
      // 켜진 참모 모드 호스트 — 모드 하나당 claude 프로세스 하나라 부하 화면에 따로 보인다
      const modes = (await invoke<ModeRow[]>('mode_list').catch(() => [] as ModeRow[])).filter((m) => m.pid > 0).map((m) => ({ name: m.title || m.name, pid: m.pid }));
      const r = attribute(procs, sessions, env, ref.current.others.map((x) => x.procPid ?? 0).filter(Boolean), modes);
      setSys(s);
      setReport(r);
      if (s) void loadSave(JSON.stringify(summarize(s, r, new Date()), null, 2)).catch(() => {});
    } catch {
      // 다음 주기에 다시 — 부하 칸이 잠깐 비는 것뿐
    } finally {
      busy.current = false;
    }
  }, []);
  useEffect(() => {
    void sample();
    const t = setInterval(() => void sample(), fast ? 3000 : 10_000);
    return () => clearInterval(t);
  }, [fast, sample]);
  return { sys, report, refresh: sample };
}
