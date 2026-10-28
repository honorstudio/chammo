// 메신저 따로 창의 팀 파일 탭(10-26 사용자 "따로 창도 팀 모드와 똑같이") — 메인 창 스페이스의 filePage 와 같은 조각:
// md·글은 편집 페이지(DocPage), 그 밖(그림·영상·html·pdf·오피스)은 탭 안 미리보기(FileTab). 크게 보기는 이 창 안 — 오른쪽 칸을 창 전체로(MessengerApp, 10-28 사용자)
// 머리 '내 참모에게 보내기' — 참모를 고르면 그 참모 보관함에 두고 메인 창이 그 참모 채팅 입력칸에 붙인다(ui/team/teamGive)
import { useState } from 'react';
import { isPlainDoc, kindOf } from '../../domain/reader';
import { DocPage } from '../space/DocPage';
import { FileTab } from '../space/FileTab';
import { useGivePath } from './teamGive';
import '../space/space.css';
import '../space/locker.css';

export function TeamFile({ path, team, send, big, onBig }: { path: string; team: string; send: (text: string) => Promise<void>; big: boolean; onBig: () => void }) {
  const name = path.split('/').pop() ?? path;
  const [err, setErr] = useState('');
  const give = useGivePath(setErr);
  const onAttach = (e?: React.MouseEvent<HTMLElement>) => { setErr(''); give.open(path, e); };
  return (
    <>
      {err && <div className="tmx-hint tlk-note" role="alert" onClick={() => setErr('')}>{err}</div>}
      {kindOf(path) === 'md' || isPlainDoc(path)
        ? <DocPage key={path} path={path} owner={team} where={name} send={send} onAttach={onAttach} attachTo={give.to} />
        : <FileTab key={path} path={path} where={name} onAttach={onAttach} attachTo={give.to} big={big} onBig={onBig} />}
      {give.node}
    </>
  );
}
