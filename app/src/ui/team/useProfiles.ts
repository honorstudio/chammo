// 팀 프로필판 — 사람마다 사진·상태·상태 글, 팀 아이콘. 보관함 바뀜 알림(소켓)을 3초마다 보고 다시 읽는다(실시간)
// 얼굴(PersonOf)·팀 설정·대화 머리는 ProfilesCtx 로 읽는다 — 메인 창 메신저 자리(useTeamMode)·메신저 따로 창이 각각 한 번 깐다.
// 본 판(rev)은 창마다 들고 묻는다(Rust 에 두면 두 창이 서로 알림을 먹는다)
import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { teamProfileChanged, teamProfiles } from '../../data/teamProfileApi';
import type { ProfileBoard } from '../../domain/teamProfile';
import { every } from '../poll';

export type Profiles = { board: ProfileBoard | null; reload: () => void };
export const ProfilesCtx = createContext<Profiles>({ board: null, reload: () => {} });

export function useProfiles(teamId: string | null | undefined): Profiles {
  const [board, setBoard] = useState<ProfileBoard | null>(null);
  const rev = useRef(0);
  /** 읽는 중 — 3초 폴링이 읽는 중에 또 부르지 않게 */
  const busy = useRef(false);
  const reload = useCallback(() => {
    if (!teamId) return;
    busy.current = true;
    void teamProfiles(teamId).then((b) => {
      if (b.team !== teamId) return;
      rev.current = b.rev;
      setBoard(b);
    }, () => {}).finally(() => { busy.current = false; });
  }, [teamId]);
  useEffect(() => {
    setBoard(null);
    rev.current = 0;
    if (!teamId) return;
    reload();
    return every(() => { if (!busy.current) void teamProfileChanged(teamId, rev.current).then((c) => { if (c) reload(); }, () => {}); }, 3_000);
  }, [teamId, reload]);
  return useMemo(() => ({ board, reload }), [board, reload]);
}
