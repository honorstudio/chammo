// 메인 창이 다마고치를 계산한다: 1분마다 tama.json 을 읽고 → 작업 기록(커밋·CI·시킨 일·세션 작업)을 먹여 → 다시 쓴다.
// 위젯 창은 그 파일을 읽어 그리기만 한다
import { useEffect, useRef, useState } from 'react';
import { ciRuns, commitLog, humanTurns, readShowLog, readSpaceLog, readTama, tamaRequest, tamaWidget, writeTama, type AppEnv } from '../../data/tauri';
import type { Routine } from '../../domain/routine';
import { keeperOf, routineFeed, showFeed, spaceFeed, talkFeed } from '../../domain/tama/signals';
import { orchColor } from '../../domain/avatar';
import { earnedBadges, unlockBadges } from '../../domain/tama/badges';
import type { Session } from '../../domain/session';
import type { TaskEvent } from '../../domain/tasks';
import type { TamaEvent } from '../../domain/tama/pet';
import { balanceFeed, parseCiRuns, parseCommitLog, taskEvents } from '../../domain/tama/sources';
import { addWork, parseTamaFile, step, workMinutes, type TamaFile } from '../../domain/tama/store';

const STEP_MS = 60_000;
const COMMITS_MS = 5 * 60_000;   // git log 는 저장소 40개를 도니 5분에 한 번
const CI_MS = 10 * 60_000;       // gh 는 네트워크라 10분에 한 번
const DAY = 86_400_000;

type Cache = { at: number; key: string; events: TamaEvent[] };

/** onRequest: 위젯이 부탁한 것("dex" = 다마고치 페이지) */
export function useTama(env: AppEnv | null, sessions: Session[], tasks: TaskEvent[], routines: Routine[], orchs: Session[], onRequest: (kind: string) => void) {
  const [file, setFile] = useState<TamaFile | null>(null);
  // 먹이 사건(커밋·PR·CI·시킨 일) — 머지 가챠 코인도 같은 사건으로 센다(useGacha)
  const [feed, setFeed] = useState<TamaEvent[]>([]);
  const [widgetShown, setWidgetShown] = useState(false); // 처음 켤 땐 숨김 — 상단 바 미니나 메뉴로 연다
  const pending = useRef(0);
  const lastPoll = useRef(Date.now());
  const busy = sessions.filter((s) => s.state === 'working').length;
  const latest = useRef({ busy, tasks, routines, sessions, orchs, onRequest });
  latest.current = { busy, tasks, routines, sessions, orchs, onRequest };
  const commits = useRef<Cache>({ at: 0, key: '', events: [] });
  const ci = useRef<Cache>({ at: 0, key: '', events: [] });

  // 세션 목록이 새로 올 때마다(3초) 일한 시간을 모아 둔다
  useEffect(() => {
    const now = Date.now();
    pending.current += workMinutes(busy, now - lastPoll.current);
    lastPoll.current = now;
  }, [sessions, busy]);

  useEffect(() => {
    if (!env) return;
    let alive = true;
    const run = async () => {
      const now = Date.now();
      let f = parseTamaFile(await readTama());
      f = addWork(f, now, pending.current);
      pending.current = 0;
      // 과식 기준(지난 28일)까지 필요해서 알 고르기 28일 전부터 읽는다. 다마고치가 없어도 읽는다 — 가챠 코인이 같은 사건을 쓴다
      const bornAt = f.pet && !f.pet.dead ? f.pet.bornAt : now - DAY;
      const since = new Date(bornAt - 28 * DAY).toISOString();
      if (now - commits.current.at > COMMITS_MS || commits.current.key !== since) {
        commits.current = { at: now, key: since, events: parseCommitLog(env.gitEmail ? await commitLog(env.devRoot, env.gitEmail, since) : '') };
      }
      const day = new Date(bornAt).toISOString().slice(0, 10);
      if (now - ci.current.at > CI_MS || ci.current.key !== day) {
        ci.current = { at: now, key: day, events: parseCiRuns(env.githubUser ? await ciRuns(env.devRoot, env.githubUser, day) : '') };
      }
      // 끝낸 일 먹이(2026-10-03) — 개발 안 해도 키운다. 대화는 대화 기록 id → 세션 id 로 바꿔 '누가 먹였나'를 맞춘다
      const live = latest.current.sessions.filter((s) => s.sessionId);
      const bySid = new Map(live.map((s) => [s.sessionId!, s.id]));
      const [shows, talks, space] = await Promise.all([readShowLog().catch(() => ''), humanTurns(live.map((s) => s.sessionId!)).catch(() => ''), readSpaceLog().catch(() => '')]);
      const extra = [
        ...taskEvents(latest.current.tasks), ...showFeed(shows), ...spaceFeed(space), ...routineFeed(latest.current.routines),
        ...talkFeed(talks).map((e) => ({ ...e, by: e.by && bySid.get(e.by) })),
      ];
      const events = balanceFeed([...commits.current.events, ...ci.current.events, ...extra]);
      if (alive) setFeed(events);
      if (f.pet && !f.pet.dead) f = step(f, events, now);
      // 업적: 딴 것은 다마고치 화면에만 — macOS 알림은 안 보낸다(사용자 2026-09-27, domain/notify)
      f = unlockBadges(f, earnedBadges(f, commits.current.events, now), now).file;
      const ids = latest.current.orchs.map((o) => o.id);
      const kid = keeperOf(events, ids);
      const k = latest.current.orchs.find((o) => o.id === kid);
      f = { ...f, busy: latest.current.busy > 0, keeper: k ? { name: k.name, color: orchColor(k.name) } : undefined };
      // 계산하는 사이 사람이 바꿨으면(알 고르기·보관함·처음부터 → rev 증가) 이번 계산은 버리고 다음 분에 다시
      const again = parseTamaFile(await readTama());
      if ((again.rev ?? 0) !== (f.rev ?? 0)) return;
      await writeTama(JSON.stringify(f));
      if (alive) setFile(f);
    };
    const go = () => void run().catch(() => {});
    go();
    const t = setInterval(go, STEP_MS);
    return () => { alive = false; clearInterval(t); };
  }, [env]);

  // 위젯을 숨겼는지 — 숨겼으면 상단 바에 작게 띄운다. 창 이벤트는 권한 파일이 필요해서 대신 짧게 물어본다
  // (3초 간격이면 숨기기 누르고 상단 바에 뜨기까지 최대 3초 걸렸다 — 2026-09-27 사용자). 창 보임 여부만 묻는 가벼운 호출
  useEffect(() => {
    const poll = () => {
      void tamaWidget().then(setWidgetShown).catch(() => {});
      void tamaRequest().then((k) => k && latest.current.onRequest(k)).catch(() => {});
    };
    poll();
    const t = setInterval(poll, 300);
    return () => clearInterval(t);
  }, []);

  const showWidget = () => void tamaWidget(true).then(setWidgetShown).catch(() => {});
  /** 사람 조작(보관함·처음부터 등): 파일을 새로 읽어 바꾸고 바로 쓴다. null 이면 못 함(보관함 꽉 참 등) */
  const apply = async (op: (f: TamaFile, now: number) => TamaFile | null) => {
    const next = op(parseTamaFile(await readTama()), Date.now());
    if (!next) return false;
    await writeTama(JSON.stringify(next));
    setFile(next);
    return true;
  };
  return { file, widgetShown, showWidget, apply, feed };
}
