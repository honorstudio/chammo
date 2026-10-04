// 폰 참모 프사 — 데스크톱과 같은 OrchAvatar(ui/avatar). 색은 프사에서 고른 색 → 없으면 이름 번호 색, 상태는 세션 상태(+사용자 답 기다림이면 물음)
import { avatarState, bodyColor, OrchAvatar, orchColor, useAvatars } from '../avatar';
import { phoneName } from '../../domain/mobile';
import type { Session } from '../../domain/session';

/** 그 참모 색 — 시트 색(orchVars)과 프사가 같은 색을 쓴다 */
export function useOrchColor(orch: Session, orchs: Session[]): string {
  const { saved } = useAvatars();
  return bodyColor(saved, orch.name, orchColor(orch.name));
}

export function MAvatar({ orch, orchs, size, asking }: { orch: Session; orchs: Session[]; size: number; asking?: boolean }) {
  const color = useOrchColor(orch, orchs);
  return <OrchAvatar name={orch.name} label={phoneName(orch.name, orchs)} size={size} state={asking ? 'ask' : avatarState(orch)} color={color} />;
}
