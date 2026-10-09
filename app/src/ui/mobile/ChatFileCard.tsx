// 채팅 안 파일 카드 — 참모가 scripts/show 로 보여 준 그 시각 자리에(domain/chatFiles). 누르면 FileView, 웹 주소는 새 탭
import { atLine, type ChatFile } from '../../domain/chatFiles';
import { titleOf } from '../../domain/reader';
import { FileThumb } from './FileThumb';

export function ChatFileCard({ f, onOpen }: { f: ChatFile; onOpen: (f: ChatFile) => void }) {
  const where = atLine(f.at);
  const body = (
    <>
      <FileThumb path={f.path} />
      <span className="m-chatfile-name">{titleOf(f.path)}</span>
      {where && <span className="m-chatfile-at">{where}</span>}
    </>
  );
  if (/^https?:\/\//i.test(f.path)) return <a className="m-chatfile" href={f.path} target="_blank" rel="noopener noreferrer" title={f.path}>{body}</a>;
  return <button type="button" className="m-chatfile" onClick={() => onOpen(f)} title={f.path.split('/').pop()}>{body}</button>;
}
