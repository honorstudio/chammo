// 참모 맡은 일 저장소(화면) — 맥 <데이터>/orch-roles.json 을 App 이 5초마다 읽어 넣고, 사이드바·대시보드·칸 머리가 같이 읽는다.
// 자동 추론(최근 7일 "주로 a·b")도 App 이 작업 기록으로 계산해 넣는다. 판단은 domain/orchRoles
import { useSyncExternalStore } from 'react';
import { parseRoles, roleLine, roleChips, type RoleMap } from '../domain/orchRoles';
import { splitOrchName } from '../domain/orchLabel';
import { setOrchRole } from '../data/tauri';
import { tr } from '../i18n';

type State = { roles: RoleMap; inferred: Record<string, string[]> };
let state: State = { roles: {}, inferred: {} };
const subs = new Set<() => void>();
const ping = () => subs.forEach((f) => f());

/** App 이 읽은 것·계산한 것을 넣는다 — 같으면 다시 그리지 않는다 */
export function setOrchRoleData(roles: RoleMap, inferred: Record<string, string[]>) {
  if (JSON.stringify(roles) === JSON.stringify(state.roles) && JSON.stringify(inferred) === JSON.stringify(state.inferred)) return;
  state = { roles, inferred };
  ping();
}
export const useOrchRoleData = (): State => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state);

/** 사람이 적은 맡은 일(없으면 '') — 이름 창에 미리 채울 것 */
export const orchRoleSet = (name: string): string => state.roles[splitOrchName(name).base]?.role ?? '';
/** 이름 밑 한 줄 — 사람이 적은 것, 없으면 "주로 a·b" */
export const orchRoleOf = (name: string) => roleLine(name, state.roles, state.inferred);

/** 저장한 뒤 바뀐 전체를 받는 곳 — App 이 자기 상태도 바꿔야 다음 계산이 옛 값으로 덮지 않는다(2026-10-04 리뷰: 저장 직후 5초 옛 글) */
const savedSubs = new Set<(m: RoleMap) => void>();
export function onOrchRolesSaved(f: (m: RoleMap) => void): () => void {
  savedSubs.add(f);
  return () => { savedSubs.delete(f); };
}

/** 맡은 일 저장 — 맥 파일에 쓰고 바로 화면에. fresh = 새 참모를 띄울 때(태어난 때를 적는다) */
export async function saveOrchRole(name: string, role: string, fresh = false): Promise<void> {
  const m = parseRoles(JSON.stringify(await setOrchRole(name, role, fresh)));
  state = { ...state, roles: m };
  savedSubs.forEach((f) => f(m));
  ping();
}

/** 이름 밑 작은 회색 한 줄 — 없으면 아무것도 안 그린다. 넘치면 말줄임, 전체는 title */
export function OrchRole({ name, className }: { name: string; className?: string }) {
  useOrchRoleData();
  const r = orchRoleOf(name);
  if (!r) return null;
  return <span className={`orch-role${r.auto ? ' auto' : ''}${className ? ` ${className}` : ''}`} title={r.auto ? tr(`${r.text} — 최근 7일 맡긴 일로 짐작`, `${r.text} — guessed from the last 7 days`) : r.text}>{r.text}</span>;
}

/** 맡은 일 칸 + 예시 칩(글자) — 칩을 누르면 칸을 그 글로. 비워도 된다 */
export function RoleField({ value, onChange, onEnter, onEscape }: { value: string; onChange: (v: string) => void; onEnter?: () => void; onEscape?: () => void }) {
  return (
    <div className="od-role">
      <input value={value} onChange={(e) => onChange(e.target.value)} maxLength={80} placeholder={tr('맡은 일(비워도 돼)', 'What it handles (optional)')} aria-label={tr('맡은 일', 'What it handles')}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) onEnter?.(); if (e.key === 'Escape') { e.stopPropagation(); onEscape?.(); } }} />
      <div className="od-chips">
        {roleChips().map((c) => <button key={c} type="button" className={value.trim() === c ? 'on' : ''} onClick={() => onChange(c)}>{c}</button>)}
      </div>
    </div>
  );
}
