// 스페이스 팀 탭 — 고른 팀의 보관함(시안 v2 P2). 진짜 폴더 ~/Documents/Chammo/<팀 이름>(locker_fs owner_dir, id = team-<팀 id>).
// 파일 보내기(서버 6단계) 전이라 지금은 이 기기에 둔 팀 폴더 — 머리 고리 아이콘으로 '메신저 팀 따라가기'를 끄고 켠다
import { useState } from 'react';
import { useLockerTree } from '../space/useLocker';
import { tr } from '../../i18n';
import { IconFolder, IconLink } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { TeamMarkIcon } from './TeamFaces';
import './team.css';

export const teamOwner = (teamId: string, team: string) => ({ id: `team-${teamId}`, name: team });

const extOf = (n: string) => (n.includes('.') ? n.split('.').pop()!.slice(0, 4) : '');

export function TeamLocker({ teamId, team, people, follow, onFollow, onOpen }: {
  teamId: string;
  team: string;
  people: number;
  follow: boolean;
  onFollow: (on: boolean) => void;
  onOpen: (path: string, dir: boolean) => void;
}) {
  // 보관함을 아직 안 쓴 사람이면(started 아님) 사람이 누를 때만 시작한다 — 팀 탭은 대화를 고르면 저절로 열려서,
  // 그대로 열면 보관함 처음 열기(스크린샷 연결 안내 등)가 사람 모르게 돌았다
  const [start, setStart] = useState(false);
  const tree = useLockerTree(teamOwner(teamId, team), 5000, start);
  const top = tree.entries.filter((e) => !e.rel.includes('/'));
  const folders = top.filter((e) => e.dir);
  const files = top.filter((e) => !e.dir);
  const inside = (rel: string) => tree.entries.filter((e) => !e.dir && e.rel.startsWith(`${rel}/`)).length;
  return (
    <div className="tmx-locker">
      <div className="tmx-lk-h">
        <TeamMarkIcon name={team} size={34} />
        <span className="tmx-head-tx"><b>{team}</b><span>{tr(`팀 보관함 · 사람 ${people}`, `Team locker · ${people} people`)}</span></span>
        <IconButton tone="line" pressed={follow} label={follow ? tr('메신저 팀 따라가기 — 켜짐', 'Follow messenger team — on') : tr('메신저 팀 따라가기 — 꺼짐', 'Follow messenger team — off')} onClick={() => onFollow(!follow)}><IconLink /></IconButton>
      </div>
      {!tree.started && !start && (
        <div className="tmx-none">{tr('팀 보관함은 이 컴퓨터 문서 폴더의 팀 폴더예요.', 'The team locker is a team folder in your Documents.')} <button className="tmx-btn" onClick={() => setStart(true)}>{tr('보관함 열기', 'Open the locker')}</button></div>
      )}
      {folders.length > 0 && (
        <div className="tmx-lk-folders">
          {folders.map((f) => (
            <button key={f.rel} className="tmx-lk-folder" onClick={() => onOpen(`${tree.dir}/${f.rel}`, true)}><IconFolder /><b>{f.name}</b><span>{tr(`파일 ${inside(f.rel)}`, `${inside(f.rel)} files`)}</span></button>
          ))}
        </div>
      )}
      {files.length > 0 ? (
        <div className="tmx-lk-rows">
          {files.map((f) => (
            <button key={f.rel} className="tmx-lk-row" onClick={() => onOpen(`${tree.dir}/${f.rel}`, false)} title={f.name}>
              <span className="tmx-ext">{extOf(f.name) || tr('파일', 'file')}</span><b>{f.name}</b><span className="d" />
            </button>
          ))}
        </div>
      ) : tree.started && <div className="tmx-none">{tr('팀 보관함이 비었어요 — 파인더에서 이 칸으로 끌어 넣거나, 팀 대화로 받은 파일이 여기 쌓여요(파일 보내기는 다음 단계)', 'The team locker is empty — drag files in from Finder. Files sent in team chats will land here (file sending comes next).')}</div>}
    </div>
  );
}
