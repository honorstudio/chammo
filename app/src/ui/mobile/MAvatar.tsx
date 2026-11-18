// 폰 참모 프사 — 데스크톱과 같은 OrchAvatar(ui/avatar). 색은 프사에서 고른 색 → 없으면 이름 번호 색, 상태는 세션 상태(+사용자 답 기다림이면 물음)
import { avatarKey, avatarState, bodyColor, imageUrl, OrchAvatar, orchColor, useAvatars } from '../avatar';
import { phoneName } from '../../domain/mobile';
import type { Session } from '../../domain/session';

/** 그 참모 색 — 시트 색(orchVars)과 프사가 같은 색을 쓴다 */
export function useOrchColor(orch: Session, orchs: Session[]): string {
  const { saved } = useAvatars();
  return bodyColor(saved, orch.name, orchColor(orch.name));
}

export function MAvatar({ orch, orchs, size, asking }: { orch: Session; orchs: Session[]; size: number; asking?: boolean }) {
  const { saved, known, fresh, dataDir } = useAvatars();
  const color = bodyColor(saved, orch.name, orchColor(orch.name));
  // 프로필을 아직 모르면(처음 켬·맥 답 전) 기본 색·모양 대신 빈 자리 — 기본형을 그렸다가 바꾼 프로필로 바뀌었다(2026-11-16 사용자).
  // 기억한 그림 프사는 이번 실행에 그림을 받을 때까지 빈 자리(그 전엔 기본 모양이 그려진다)
  const e = saved.get(avatarKey(orch.name));
  if (!known || (!fresh && e?.avatar.kind === 'image' && !imageUrl(dataDir, e))) return <span className="m-av-skel" style={{ width: size, height: size }} role="img" aria-label={phoneName(orch.name, orchs)} />;
  return <OrchAvatar name={orch.name} label={phoneName(orch.name, orchs)} size={size} state={asking ? 'ask' : avatarState(orch)} color={color} />;
}
