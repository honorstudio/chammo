// 팀 성능 예산 넘침 알림 — 1분마다 Rust 가 쌓은 알림을 가져가 받을 참모 입력칸에 [앱] 한 줄(같은 원인 하루 한 번). 판단은 domain/perfAlert
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef } from 'react';
import { sendToSession } from '../data/tauri';
import { alertTarget, deliverAlerts, type PerfAlert } from '../domain/perfAlert';
import type { RoleMap } from '../domain/orchRoles';
import type { Session } from '../domain/session';
import { every } from './poll';

const SEEN_KEY = 'perfAlertSeen';
const loadSeen = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
};

export function usePerfAlerts(o: { orchs: Session[]; roles: RoleMap }) {
  const cur = useRef(o);
  cur.current = o;
  // 못 보낸 알림 — Rust 줄은 가져가면 비어서 여기 두고 다음 바퀴에 다시(받을 참모가 아직 없거나 입력칸 보내기 실패)
  const left = useRef<PerfAlert[]>([]);
  useEffect(() => every(() => {
    void invoke<PerfAlert[]>('perf_alerts').then(async (got) => {
      const list = [...left.current, ...got];
      if (!list.length) return;
      const to = alertTarget(cur.current.orchs, cur.current.roles);
      const r = await deliverAlerts(list, loadSeen(), to, sendToSession);
      left.current = r.left;
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(r.seen.slice(-100)));
      } catch {
        // 못 남겨도 이번 실행 동안은 Rust 가 같은 알림을 칸마다 한 번만 낸다
      }
    }, () => {});
  }, 60_000), []);
}
