// 메신저 따로 창의 팀 파일 탭(10-26 사용자 "따로 창도 팀 모드와 똑같이") — 메인 창 스페이스의 filePage 와 같은 조각:
// md·글은 편집 페이지(DocPage), 그 밖(그림·영상·html·pdf·오피스)은 탭 안 미리보기(FileTab). 크게 보기는 리더 창
import { invoke } from '@tauri-apps/api/core';
import { isPlainDoc, kindOf } from '../../domain/reader';
import { DocPage } from '../space/DocPage';
import { FileTab } from '../space/FileTab';
import '../space/space.css';
import '../space/locker.css';

export function TeamFile({ path, team, send }: { path: string; team: string; send: (text: string) => Promise<void> }) {
  const name = path.split('/').pop() ?? path;
  return kindOf(path) === 'md' || isPlainDoc(path)
    ? <DocPage key={path} path={path} owner={team} where={name} send={send} />
    : <FileTab key={path} path={path} where={name} onBig={() => void invoke('reader_open', { paths: [path] }).catch(() => {})} />;
}
