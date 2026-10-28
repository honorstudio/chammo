// '팀 보관함에 수정본 올리기'(10-28 사용자 1안) — 사람이 누를 때만. 원본(풀어 둔 자리 → 팀 파일 id) → 이름(domain/teamRevise) → 올리기(Rust team_peek_revise)
import { invoke } from '@tauri-apps/api/core';
import { revisePlan } from '../../domain/teamRevise';
import type { LockerView } from '../../domain/teamLocker';
import { tr } from '../../i18n';

export type PeekState = { edited: boolean; team?: string; id?: string | null };

export const peekState = (path: string) => invoke<PeekState>('team_peek_state', { path });

/** 올린 이름 */
export async function reviseUp(path: string, team: string, me: string): Promise<string> {
  const st = await peekState(path);
  if (!st.edited) throw new Error(tr('고친 게 없어요 — 저장한 뒤 다시 눌러 줘', 'Nothing changed — save first'));
  const view = await invoke<LockerView>('team_locker_list', { team });
  const orig = st.id ? view.items.find((i) => i.id === st.id) : undefined;
  if (!orig) throw new Error(tr('원본을 못 찾았어요 — 팀 보관함에서 다시 열어 줘', "Couldn't find the original — open it again from the team locker"));
  const plan = revisePlan(orig, view.items, me);
  await invoke('team_peek_revise', { team, path, name: plan.name, folder: plan.folder, replace: plan.replace });
  return plan.name;
}
