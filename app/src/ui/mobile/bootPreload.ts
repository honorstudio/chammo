// 폰 첫 화면 미리 받기 — 스플래시(모찌) 동안 대시보드·대화 첫 묶음·첫 카드 썸네일을 기억(memo·대화 캐시·BlobMemo)에 넣는다.
// 화면 쪽 훅(useMemoPoll 등)이 같은 열쇠를 읽어 뜨는 순간 다 차 있다 — 열쇠는 그 훅들과 같게(2026-10-03 사용자 "뚝뚝 나오는데")
import { listStoppedOrchs, readFileText, readShowLog, readTails, readTranscript, readUsage, routinesList, type MobileEnv } from '../../data/web';
import { offOrchRows } from '../../domain/mobile';
import { OFF_TAILS } from './OrchWake';
import { firstThumbs } from '../../domain/boot';
import type { Session } from '../../domain/session';
import { warmChat } from '../space/useChatItems';
import { remember } from './memo';
import { warmBlob } from './useBlobUrl';
import { shared } from '../../domain/inflight';

const keep = (key: string) => (v: string) => { remember(key, v); return v; };
/** 받는 중이면 화면 훅(useMemoPoll)이 같은 요청을 같이 기다린다 — 스플래시가 마감으로 먼저 걷혀도 두 번 안 받게 */
const get = (key: string, load: () => Promise<string>) => shared(key, load).then(keep(key));

/** 하나가 늦거나 실패해도 나머지는 계속 — 다 끝나면(성공·실패 상관없이) 풀린다 */
export async function preloadFirstScreen(env: MobileEnv, orch: Session | undefined, live: Session[] = []): Promise<void> {
  const shows = get('shows', readShowLog);
  const jobs: Promise<unknown>[] = [
    shows,
    get(`starter:${env.hqDir}`, () => readFileText(`${env.hqDir}/docs/starter.md`).catch(() => '')),
    get('usage', readUsage),
    get('routines', routinesList),
  ];
  if (orch?.sessionId) jobs.push(warmChat(orch.sessionId, readTranscript));
  // 참모 바꾸기 시트의 꺼진 참모 줄과 마지막 말 — 열 때 받으면 줄이 이름만 나왔다가 커졌다. 첫 화면이 아니라 스플래시는 안 기다린다(기다리면 +300ms 실측)
  void get('stopped', listStoppedOrchs).then((raw) => {
    const ids = offOrchRows(raw, env, live, {}).map((r) => r.off!.sessionId).slice(0, 12);
    return readTails(ids).then((t) => remember(OFF_TAILS, t));
  }).catch(() => {});
  if (orch) jobs.push(shows.then((log) => Promise.allSettled(firstThumbs(log, orch.id).map((t) => warmBlob(t.path, true, t.size)))));
  await Promise.allSettled(jobs);
}
