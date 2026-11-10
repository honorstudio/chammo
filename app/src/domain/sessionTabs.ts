// 스페이스 탭 줄의 세션 탭(s:<id>)이 세션이 꺼진 뒤에도 쓸모 있게(2026-11-10 — '꺼진 세션' 탭을 고르면 '왼쪽 메뉴에서 골라 줘'만 떴다).
// 탭 이름·가운데 화면이 살아 있는 세션 목록에서만 세션을 찾아서, 꺼지면 이름도 화면도 잃었다.
// 살아 있을 때 본 이름을 기억해 두고(이 실행 동안 — 탭 줄도 메모리에만 있다), 꺼지면 그 이름 + 이어서 켜기·탭 닫기를 보인다.
// 도우미·예약 세션(참모가 끄고 다시 안 켜는 것)의 탭은 꺼지면 저절로 닫는다.
import type { StoppedSession } from './stopped';

/** 세션 탭이 기억하는 것 — 보이던 이름, 폴더, 대화 id, 도우미·예약 세션인가(light) */
export type TabSess = { name: string; cwd: string; sessionId?: string; light: boolean };

type LiveLike = { id: string; name: string; cwd: string; sessionId?: string };

/** 살아 있는 세션을 기억에 적는다(지우지 않는다 — 꺼진 뒤에 쓰려고) */
export function rememberTabSessions<S extends LiveLike>(mem: Map<string, TabSess>, live: readonly S[], nameOf: (s: S) => string, isLight: (s: S) => boolean): void {
  for (const s of live) mem.set(s.id, { name: nameOf(s), cwd: s.cwd, ...(s.sessionId ? { sessionId: s.sessionId } : {}), light: isLight(s) });
}

/** 꺼진 세션 탭 — 이름(기억 → 꺼진 목록 → null)과 이어서 켤 대상(꺼진 목록에서 짧은 id, 없으면 대화 id 로). 지워진(rm) 세션은 대상 없음 */
export function deadTab(id: string, mem: ReadonlyMap<string, TabSess>, stopped: readonly StoppedSession[]): { name: string | null; resume: StoppedSession | undefined } {
  const m = mem.get(id);
  const resume = stopped.find((x) => x.id === id) ?? (m?.sessionId ? stopped.find((x) => x.sessionId === m.sessionId) : undefined);
  return { name: m?.name || resume?.name || null, resume };
}

/** 저절로 닫을 탭 — 살아 있는 걸 본 도우미·예약 세션 중 지금 목록에 없는 것. 본 적 없는 세션은 건드리지 않는다(목록을 받기 전 헛닫힘) */
export function goneLightTabs(tabs: readonly string[], liveIds: ReadonlySet<string>, mem: ReadonlyMap<string, TabSess>): string[] {
  return tabs.filter((t) => t.startsWith('s:') && !liveIds.has(t.slice(2)) && mem.get(t.slice(2))?.light === true);
}
