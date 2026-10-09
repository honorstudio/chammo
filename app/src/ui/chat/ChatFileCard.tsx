// 채팅 안 파일 카드(PC) — 참모가 scripts/show 로 보여 준 그 시각 자리에(domain/chatFiles). 썸네일은 대시보드 '주고받은 파일'과 같은 것.
// 누르면 왼쪽 스페이스에 연다(show 가 여는 길 — SpaceView 가 CHAT_FILE_OPEN 을 받는다)
import { atLine, type ChatFile } from '../../domain/chatFiles';
import { titleOf } from '../../domain/reader';
import { Thumb } from '../space/DashboardView';

/** 스페이스에 열기 신호 — detail = { path, at, by(띄운 참모 id) } */
export const CHAT_FILE_OPEN = 'chat-file-open';

export function ChatFileCard({ f, by }: { f: ChatFile; by: string }) {
  const where = atLine(f.at);
  const open = () => window.dispatchEvent(new CustomEvent(CHAT_FILE_OPEN, { detail: { path: f.path, at: f.at, by } }));
  return (
    <div className="chat-row">
      <button type="button" className="chat-filecard" onClick={open} title={f.path}>
        <span className="chat-filecard-th"><Thumb f={{ path: f.path, ts: f.ts, by }} /></span>
        <span className="chat-filecard-name">{titleOf(f.path)}</span>
        {where && <span className="chat-filecard-at">{where}</span>}
      </button>
    </div>
  );
}
