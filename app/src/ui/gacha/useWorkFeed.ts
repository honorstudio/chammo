// 코인 재료 — 1분마다 작업 기록(커밋·CI·시킨 일·세션이 일한 시간)을 모은다. 다마고치를 없애고(사용자 11-06) 남은 한 가지 일.
// tama.json 은 일한 시간 칸(work)만 이어서 쓴다 — 옛 펫 기록은 그대로 둔다(domain/moveTama 가 한 번 옮겼다)
import { useEffect, useRef, useState, type RefObject } from 'react';
import { ciRuns, commitLog, readShowLog, readSpaceLog, readTama, reposTag, writeTama, type AppEnv } from '../../data/tauri';
import type { Routine } from '../../domain/routine';
import type { Session } from '../../domain/session';
import type { TaskEvent } from '../../domain/tasks';
import type { TamaEvent } from '../../domain/tama/pet';
import { rememberTalks, routineFeed, showFeed, spaceFeed, talkEvents } from '../../domain/tama/signals';
import { balanceFeed, parseCiRuns, parseCommitLog, taskEvents } from '../../domain/tama/sources';
import { addWork, parseTamaFile, workEvents, workMinutes } from '../../domain/tama/store';

const STEP_MS = 60_000;
const COMMITS_MS = 5 * 60_000;   // git log 는 저장소 40개를 도니 5분에 한 번
const CI_MS = 10 * 60_000;       // gh 는 네트워크라 10분에 한 번
const DAY = 86_400_000;
type Cache = { at: number; key: string; events: TamaEvent[] };

/** 커밋을 어디서부터 읽나 — 코인 상한(지난 28일 과식 기준)까지 필요해서 29일 전, 그날 0시로 끊는다.
 *  시각까지 넣으면 부를 때마다 인자가 달라져 저장소가 그대로여도 git 캐시(Rust git_cache)가 안 맞았다 — 저장소 79곳에 5분마다 다시 띄웠다(11-07 진짜 앱).
 *  하루치 더 읽어도 코인은 그대로다 — earn 이 지난 사건을 안 센다 */
export const commitsFrom = (now: number) => `${new Date(now - 29 * DAY).toISOString().slice(0, 10)}T00:00:00.000Z`;

/** 커밋을 다시 받을까 — 저장소 지문(Rust repos_tag)이 그대로면 답도 그대로다. 답이 3.6MB 라(11-07 진짜 앱 79곳, 29일) 5분마다 받지 않는다. 지문을 모르면('') 받는다 */
export const commitsChanged = (prev: { key: string; tag: string }, dayKey: string, tag: string) => !tag || prev.key !== dayKey || prev.tag !== tag;

/** talks = 세션마다 사람이 건 마지막 말(앱이 이미 읽는 대화 꼬리) — 대화 기록은 여기서 안 읽는다 */
export function useWorkFeed(env: AppEnv | null, sessions: Session[], tasks: TaskEvent[], routines: Routine[], talks: RefObject<{ id: string; ts?: string }[]>): TamaEvent[] {
  const [feed, setFeed] = useState<TamaEvent[]>([]);
  const pending = useRef(0);
  const lastPoll = useRef(Date.now());
  const busy = sessions.filter((s) => s.state === 'working').length;
  const latest = useRef({ tasks, routines });
  latest.current = { tasks, routines };
  const commits = useRef<Cache & { tag: string }>({ at: 0, key: '', tag: '', events: [] });
  const ci = useRef<Cache>({ at: 0, key: '', events: [] });
  const seenTalks = useRef(new Map<string, number>());

  // 3초마다 일한 시간을 모아 둔다 — 세션 값이 그대로면 앱이 다시 안 그리니(11-07) 스스로. 일 수가 바뀌면 그때까지 몫을 옛 수로 먼저 더한다
  const collect = useRef<(n: number) => void>(() => {});
  collect.current = (n) => {
    const now = Date.now();
    pending.current += workMinutes(n, now - lastPoll.current);
    lastPoll.current = now;
  };
  const busyAt = useRef(busy);
  useEffect(() => { collect.current(busyAt.current); busyAt.current = busy; }, [busy]);
  useEffect(() => { const t = setInterval(() => collect.current(busyAt.current), 3000); return () => clearInterval(t); }, []);

  useEffect(() => {
    if (!env) return;
    let alive = true;
    const run = async () => {
      const now = Date.now();
      let f = parseTamaFile(await readTama());
      f = addWork(f, now, pending.current);
      pending.current = 0;
      const since = commitsFrom(now);
      const dayKey = since.slice(0, 10);
      if (now - commits.current.at > COMMITS_MS || commits.current.key !== dayKey) {
        const tag = await reposTag(env.devRoot).catch(() => '');
        commits.current = commitsChanged(commits.current, dayKey, tag)
          ? { at: now, key: dayKey, tag, events: parseCommitLog(env.gitEmail ? await commitLog(env.devRoot, env.gitEmail, since) : '') }
          : { ...commits.current, at: now };
      }
      const day = new Date(now - DAY).toISOString().slice(0, 10);
      if (now - ci.current.at > CI_MS || ci.current.key !== day) {
        ci.current = { at: now, key: day, events: parseCiRuns(env.githubUser ? await ciRuns(env.devRoot, env.githubUser, day) : '') };
      }
      const [shows, space] = await Promise.all([readShowLog().catch(() => ''), readSpaceLog().catch(() => '')]);
      rememberTalks(seenTalks.current, talks.current, now);
      const extra = [...taskEvents(latest.current.tasks), ...showFeed(shows), ...spaceFeed(space), ...routineFeed(latest.current.routines), ...talkEvents(seenTalks.current)];
      const events = balanceFeed([...commits.current.events, ...ci.current.events, ...extra]);
      if (alive) setFeed([...events, ...workEvents(f, now)]);
      await writeTama(JSON.stringify(f));
    };
    const go = () => void run().catch(() => {});
    go();
    const t = setInterval(go, STEP_MS);
    return () => { alive = false; clearInterval(t); };
  }, [env]);
  return feed;
}
