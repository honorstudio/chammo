// 채팅 안 파일 카드(PC) — 참모가 scripts/show 로 보여 준 그 시각 자리에(domain/chatFiles). 썸네일은 대시보드 '주고받은 파일'과 같은 것.
// 누르면 show 가 여는 곳에 다시 연다(openChatFile — 채팅 뷰는 스페이스, 터미널 뷰는 리더)
import { atLine, type ChatFile } from '../../domain/chatFiles';
import { titleOf } from '../../domain/reader';
import { Thumb } from '../space/DashboardView';
import { openChatFile } from './openChatFile';

export function ChatFileCard({ f, by }: { f: ChatFile; by: string }) {
  const where = atLine(f.at);
  const open = () => void openChatFile(f.path, by, f.at, !!f.at); // 짚은 곳이 있으면 미리보기(참모 앱은 그 자리를 모른다)
  return (
    <div className="chat-row">
      <button type="button" className="chat-filecard" onClick={open} title={f.path}>
        <span className="chat-filecard-th"><Thumb f={{ path: f.path, ts: f.ts, by }} /></span>
        <span className="chat-filecard-name">{titleOf(f.path)}</span>
        {(where || f.who) && <span className="chat-filecard-at">{[f.who, where].filter(Boolean).join(' · ')}</span>}
      </button>
    </div>
  );
}
