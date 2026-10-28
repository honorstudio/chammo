// 참모 보관함 파일 → 팀 보관함(10-28 사용자 "참모 보관함 파일을 팀 보관함으로 옮기기가 안 된다") — 카드 우클릭 '팀 보관함에 올리기'의 다음 목록.
// 팀이 하나면 바로 그 팀 폴더 나무, 여럿이면 팀부터. 안쪽 폴더가 있는 폴더는 들어가서 '여기에 올리기'(폴더 안 폴더, 10-28).
// 고르면 그 자리에 올린다(바로가기는 가리키는 진짜 내용) — 올린 뒤 알림 줄은 없다(10-28 사용자, 진행은 팀 보관함 올리는 중 줄), 못 올리면 한 줄
import { baseOf, parentOf } from '../../domain/teamLocker';
import { teamLockerFolders, teamLockerPut, teamLockerTeams } from '../../data/teamApi';
import { tr } from '../../i18n';
import type { MenuItem } from '../OrchDialogs';

export type UploadApi = {
  teams: () => Promise<{ id: string; name: string }[]>;
  /** 그 팀 모든 폴더 경로(위 폴더 포함) */
  folders: (team: string) => Promise<string[]>;
  put: (team: string, paths: string[], folder: string | null) => Promise<unknown>;
};
export const uploadApi: UploadApi = { teams: teamLockerTeams, folders: teamLockerFolders, put: teamLockerPut };

export function teamUploadSub(paths: string[], api: UploadApi, onNote: (text: string) => void): () => Promise<MenuItem[]> {
  const go = (t: { id: string; name: string }, folder: string | null) => () => {
    void api.put(t.id, paths, folder).catch((e: unknown) => onNote(tr(`팀 보관함에 못 올렸어요 — ${String(e)}`, `Couldn't upload to the team locker — ${String(e)}`)));
  };
  /** 그 자리 목록 — 맨 앞 '여기에 올리기', 그다음 바로 아래 폴더(안쪽이 있으면 들어가기, 없으면 바로 올리기) */
  const level = (t: { id: string; name: string }, all: string[], at: string): MenuItem[] => {
    const kids = all.filter((f) => parentOf(f) === at).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
    const deep = (f: string) => all.some((x) => parentOf(x) === f);
    return [
      at ? { label: tr(`${baseOf(at)}에 올리기`, `Upload to ${baseOf(at)}`), run: go(t, at) } : { label: tr(`${t.name} 맨 위`, `${t.name} top level`), run: go(t, null) },
      ...kids.map((f) => (deep(f) ? { label: baseOf(f), sub: () => level(t, all, f) } : { label: baseOf(f), run: go(t, f) })),
    ];
  };
  const foldersOf = async (t: { id: string; name: string }): Promise<MenuItem[]> => level(t, await api.folders(t.id).catch(() => [] as string[]), '');
  return async () => {
    const teams = await api.teams();
    if (teams.length === 1) return foldersOf(teams[0]!);
    return teams.map((t) => ({ label: t.name, sub: () => foldersOf(t) }));
  };
}
