// 닫히지 않은 일 — 맡긴 세션이 꺼졌는데 끝(done) 표시가 없는 일. 작업 패널 '주인 잃은 일'로 쌓이던 것을
// 그 일을 맡긴 참모 대시보드 안 한 줄로 옮긴다(2026-10-02 사용자: 왜 쌓이는지·누구 것인지 모르겠다)
import { shownName } from './orchLabel';
import { owners } from './spaceNav';
import type { TaskCard, TaskEvent } from './tasks';

/** 이 맥 세션 기록 한 줄 — 떠 있는 세션과 꺼진 세션(claude agents --all) */
export type KnownSession = { id: string; name: string; sessionId?: string };

/**
 * 이 맥에 없는 세션인가 — 세션 사이 주소([ref])가 붙은 대상(다른 기계·파트너 참모 브리지, 예: 원격 [abc123])이거나
 * 이 맥 기록 어디에도 없는 이름. 그런 대상은 늘 '세션 없음'으로 보여 주인 잃은 일로 잘못 쌓였다
 */
export function isRemoteTarget(target: string, known: KnownSession[]): boolean {
  if (!target) return false;
  if (target.includes(' [')) return true;
  return !known.some((k) => k.id === target || k.name === target || k.sessionId === target);
}

/** 그 참모가 맡긴(send 의 from, 나중에 붙인 own) 닫히지 않은 일 — 원격 대상은 뺀다. 주인 없는 일은 '누가 시켰는지 모르는 일' 몫 */
export function unclosedOf(orphaned: TaskCard[], events: TaskEvent[], orchId: string, known: KnownSession[]): TaskCard[] {
  const own = owners(events);
  return orphaned.filter((c) => own.get(c.id) === orchId && !isRemoteTarget(c.target, known));
}

/** 닫히지 않은 일 줄에 보일 대상 — 세션 id·세션 번호로 맡긴 일도 그 세션 이름으로, 참모면 별명만 */
export function targetLabel(target: string, known: KnownSession[]): string {
  const k = known.find((x) => x.id === target || x.name === target || x.sessionId === target);
  return shownName(k?.name ?? target);
}
