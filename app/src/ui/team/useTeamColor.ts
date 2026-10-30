// 팀 색(팀 홈에서 팀장이 고른 색, 10-29 사용자 400.png) — 띠 팀 칸 고른 테두리가 따라간다.
// 팀 홈 화면과 같은 기억(homeMemo)을 읽는다 — 이 창에서 저장하면 팀 홈이 다시 읽어 넣는 순간 바로, 남이 바꾸면 프로필판과 같은 판 번호(rev)가 올라 다시 읽는다
import { useEffect, useReducer } from 'react';
import { homeMemo, teamHome } from '../../data/teamHomeApi';
import { homeColor } from '../../domain/teamHome';

export function useTeamColor(teamId: string, rev: number): string | undefined {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => homeMemo.on((t) => { if (t === teamId) bump(); }), [teamId]);
  useEffect(() => {
    if (!teamId) return;
    const m = homeMemo.get(teamId);
    if (m && m.v.rev >= rev) return;
    void teamHome(teamId).then((b) => { if (b.team === teamId) homeMemo.put(teamId, b); }, () => {});
  }, [teamId, rev]);
  return teamId ? homeColor(homeMemo.get(teamId)?.v) : undefined;
}
