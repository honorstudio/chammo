// 리뷰 자료 — gh 검색 두 번(열린 것·오늘 머지된 것) + 바뀐 PR 만 상세 다시 읽기. 2분마다, 리뷰 화면을 열 때·머지 뒤엔 바로.
// 실측(2026-09-27): 검색 0.6+0.8초, 상세 8개 병렬 1.2초 → 한 바퀴 ≈ 2.6초, 전부 Rust 뒤에서 돈다
import { useCallback, useEffect, useRef, useState } from 'react';
import { appendTaskEvent, prMerge, prRevert, prSearch, prViews, repoMap, sendToSession, writeReviewState, type AppEnv } from '../data/tauri';
import { gates, type OpenPr } from '../domain/review';
import { needsView, parseHits, parseMerged, parseRepoMap, parseView, type MergedPr, type RepoMap } from '../domain/reviewSource';
import { sinceIso, taskId, type Reviewed } from '../domain/reviewSummary';
import { dayStart } from '../domain/usage';
import { tr } from '../i18n';

export const REVIEW_POLL_MS = 2 * 60_000;
const MAP_MS = 10 * 60_000;

const load = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v == null ? d : (JSON.parse(v) as T);
  } catch {
    return d;
  }
};
const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    // 이번 실행 동안만 기억해도 된다
  }
};

export type RevertMade = { number: number; url: string };

export type ReviewData = {
  open: Reviewed[];
  merged: MergedPr[];
  /** 마지막으로 다 읽은 시각(ms)과 걸린 시간(ms) */
  scannedAt: number | null;
  tookMs: number | null;
  busy: boolean;
  error: string | null;
  later: Record<string, string>;
  reverts: Record<string, RevertMade>;
  refresh: () => void;
  merge: (p: OpenPr) => Promise<void>;
  revert: (m: MergedPr) => Promise<RevertMade>;
  postpone: (p: OpenPr) => void;
  /** 세션에 글을 보내고 작업 기록에 '시킨 일' 로 남긴다 */
  requestFix: (p: OpenPr, sessionId: string, sessionName: string, text: string) => Promise<void>;
};

export function useReview(env: AppEnv | null, onTaskLogged: () => void): ReviewData {
  const [open, setOpen] = useState<Reviewed[]>([]);
  const [merged, setMerged] = useState<MergedPr[]>([]);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [tookMs, setTookMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [later, setLater] = useState<Record<string, string>>(() => load('reviewLater', {}));
  useEffect(() => save('reviewLater', later), [later]);
  const [reverts, setReverts] = useState<Record<string, RevertMade>>(() => load('reviewReverts', {}));
  useEffect(() => save('reviewReverts', reverts), [reverts]);

  const cache = useRef(new Map<string, OpenPr>());
  const map = useRef<{ at: number; map: RepoMap } | null>(null);
  const running = useRef(false);

  const scan = useCallback(async () => {
    if (!env || running.current) return; // 한 바퀴가 안 끝났으면 겹쳐 돌지 않는다
    running.current = true;
    setBusy(true);
    const t0 = performance.now();
    try {
      if (!map.current || Date.now() - map.current.at > MAP_MS) map.current = { at: Date.now(), map: parseRepoMap(await repoMap(env.devRoot)) };
      const m = map.current.map;
      const [openRaw, mergedRaw] = await Promise.all([prSearch(), prSearch(sinceIso(dayStart(new Date())))]);
      const hits = parseHits(openRaw, m);
      const stale = hits.filter((h) => needsView(cache.current.get(h.key), h));
      const raws = stale.length ? await prViews(stale.map((h) => ({ repo: h.repo, number: h.number }))) : [];
      stale.forEach((h, i) => {
        const p = parseView(raws[i] ?? '', h.folder, h.repo);
        if (p) cache.current.set(h.key, p);
      });
      const list = hits.map((h) => cache.current.get(h.key)).filter((p): p is OpenPr => !!p).map((p) => ({ ...p, gates: gates(p) }));
      setOpen(list);
      setMerged(parseMerged(mergedRaw, m));
      setScannedAt(Date.now());
      setTookMs(Math.round(performance.now() - t0));
      setError(null);
      // 참모가 머지하기 전에 읽는 판정 — 앱과 참모가 같은 기준을 쓰게
      const state = { updatedAt: new Date().toISOString(), open: list.map((p) => ({ repo: p.repo, number: p.number, title: p.title, url: p.url, gates: p.gates })) };
      void writeReviewState(JSON.stringify(state)).catch(() => {});
      console.info(`[review] 열린 ${list.length} · 상세 다시 읽음 ${stale.length} · 오늘 머지 ${parseMerged(mergedRaw, m).length} · ${Math.round(performance.now() - t0)}ms`);
    } catch (e: unknown) {
      // GitHub 가 안 돼도 앱 나머지는 그대로 — 리뷰 칸에만 알린다
      setError(String(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [env]);

  useEffect(() => {
    if (!env) return;
    void scan();
    const t = setInterval(() => void scan(), REVIEW_POLL_MS);
    return () => clearInterval(t);
  }, [env, scan]);

  const merge = async (p: OpenPr) => {
    await prMerge(p.repo, p.number);
    cache.current.delete(p.key);
    await scan();
  };

  const revert = async (m: MergedPr) => {
    const raw = await prRevert(m.id, `Revert "${m.title}" (#${m.number})`, tr(`#${m.number} 되돌리기 — Chammo 작업 패널에서 만들었다. 머지는 확인한 뒤에.`, `Revert #${m.number} — opened from the task panel. Merge after checking.`));
    const made = JSON.parse(raw) as RevertMade;
    setReverts((r) => ({ ...r, [m.key]: made }));
    void scan();
    return made;
  };

  const postpone = (p: OpenPr) => setLater((l) => ({ ...l, [p.key]: p.updatedAt }));

  const requestFix = async (p: OpenPr, sessionId: string, sessionName: string, text: string) => {
    await sendToSession(sessionId, tr(`${p.folder} #${p.number} 수정 요청: ${text}`, `${p.folder} #${p.number} change request: ${text}`));
    await appendTaskEvent({ ts: new Date().toISOString(), type: 'send', task: taskId(new Date()), target: sessionName, title: tr(`#${p.number} 수정 요청 — ${text.slice(0, 80)}`, `#${p.number} change request — ${text.slice(0, 80)}`) });
    onTaskLogged();
  };

  return { open, merged, scannedAt, tookMs, busy, error, later, reverts, refresh: () => void scan(), merge, revert, postpone, requestFix };
}
