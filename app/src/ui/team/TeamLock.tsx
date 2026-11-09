// 팀 권한(chammo-relay ADR 0015) 화면 조각 — 시안 docs/design-drafts/team-lock v1(사용자 확정: PC C·폰 A). 문구는 소넷 medium(11-04)
// LockBox = 새 팀 만들기 자리의 문의 창 몸통 · TeamIntro = 레일 '팀' 칸의 소개 판 · ClosedLine = 읽기만 되는 팀 위 한 줄
import { openTarget } from '../../data/tauri';
import type { CreateLock } from '../../domain/teamLock';
import { tr } from '../../i18n';
import { IconLock } from '../Icons';
import './team.css';

const openContact = (url: string) => void openTarget('url', url).catch(() => {});

/** 문의 창 제목·본문 — 데스크톱 창·폰 시트가 같이 쓴다 */
export function lockText(l: CreateLock): { title: string; body: string } {
  if (l.kind === 'expired') return { title: tr('팀 만들기 권한이 끝났어요', 'Your team access has ended'), body: tr('이미 만든 팀은 읽기만 돼요. 새 팀이 필요하면 다시 문의해 주세요.', 'Teams you already created are now read-only. Contact us if you need to create a new one.') };
  const title = tr('새 팀은 권한이 필요해요', 'Creating a team needs access');
  if (l.kind === 'max') return { title, body: tr(`이 계정은 팀을 ${l.max}개까지 만들 수 있어요. 더 만들려면 문의해 주세요.`, `This account can create up to ${l.max} teams. Contact us to create more.`) };
  return { title, body: tr('새 팀은 권한을 받은 계정만 만들 수 있어요. 문의하시면 이 계정에 권한을 드려요.', "Only accounts with access can create new teams. Contact us and we'll enable it for this account.") };
}

/** 새 팀 만들기 자리 — 권한이 없으면 이 몸통(만들기 칸 대신). 들어가기는 늘 열려 있다 */
export function LockBox({ lock, contact, onJoin }: { lock: CreateLock; contact: string; onJoin?: () => void }) {
  const t = lockText(lock);
  return (
    <div className="tmx-start tml-box" role="group" aria-label={t.title}>
      <div className="tml-head"><span className="tml-lock" aria-hidden="true"><IconLock /></span><b>{t.title}</b></div>
      <p className="tml-body">{t.body}</p>
      <button className="tmx-btn pri tml-go" onClick={() => openContact(contact)}>{tr('문의하기', 'Contact us')}</button>
      {onJoin && lock.kind !== 'expired' && <button className="tmx-btn tml-ghost" onClick={onJoin}>{tr('초대 링크로 들어가기', 'Join with an invite link')}</button>}
    </div>
  );
}

/** 소개 판 기능 그림 — 실제 화면을 줄인 모양(그림만, 읽을 이름은 아래 글) */
const PREVIEW: Record<string, React.ReactNode> = {
  chat: <><i className="tml-bub">{tr('시안 언제 돼요?', 'When is the draft ready?')}</i><i className="tml-bub ag">{tr('참모: 3시요', 'Agent: 3 pm')}</i><i className="tml-bub me">{tr('좋아요', 'Great')}</i></>,
  home: <><i className="tml-ln b" /><i className="tml-ln" /><i className="tml-ln s" /><i className="tml-ln b t" /><i className="tml-ln" /></>,
  cal: <span className="tml-cal">{Array.from({ length: 21 }, (_, k) => <i key={k} className={k === 3 || k === 11 ? 'e1' : k === 8 || k === 16 ? 'e2' : ''} />)}</span>,
  box: <><i className="tml-fl">견적서.pdf</i><i className="tml-fl">로고 시안.ai</i><i className="tml-fl">회의록.md</i></>,
};

/** 레일 '팀' 칸을 누르면 — 팀을 앞세운 소개(시안 C). 로그인한 사람만 온다(로그인 전은 로그인 문) */
export function TeamIntro({ contact, onJoin }: { contact: string; onJoin: () => void }) {
  const feats: [string, string, string][] = [
    ['chat', tr('팀챗과 DM', 'Team chat and DMs'), tr('여러 사람이 함께, 일대일로도 이야기해요.', 'Talk as a group or one on one.')],
    ['home', tr('팀 홈', 'Team home'), tr('공지와 글을 팀 모두가 봐요.', 'Announcements and posts everyone sees.')],
    ['cal', tr('팀 캘린더', 'Team calendar'), tr('팀 일정을 한곳에서 봐요.', "Your team's schedule in one place.")],
    ['box', tr('팀 보관함', 'Team locker'), tr('파일을 같이 보고 같이 써요.', 'View and share files together.')],
  ];
  return (
    <div className="tml-intro">
      <h2>{tr('사람과 참모가 한 팀으로 일해요', 'People and their AI staff, on one team')}</h2>
      <p className="tml-lead">{tr('팀원도, 팀원의 참모도 같은 자리에서 이야기하고 파일을 나눠요.', 'Teammates and their AI staff talk and share files in the same place.')}</p>
      <div className="tml-feats">
        {feats.map(([k, title, desc]) => (
          <div key={k} className="tml-feat"><div className="tml-pv" aria-hidden="true">{PREVIEW[k]}</div><b>{title}</b><span>{desc}</span></div>
        ))}
      </div>
      <div className="tml-cta">
        <button className="tmx-btn pri" onClick={() => openContact(contact)}>{tr('문의하기', 'Contact us')}</button>
        <button className="tmx-btn" onClick={onJoin}>{tr('초대 링크로 들어가기', 'Join with an invite link')}</button>
      </div>
    </div>
  );
}

/** 읽기만 되는 팀 — 대화 목록 위 한 줄. 팀장은 문의하기 */
export function ClosedLine({ owner, contact }: { owner: boolean; contact: string }) {
  return (
    <div className="tml-closed" role="status">
      <span>{owner ? tr('팀 권한이 끝나서 읽기만 할 수 있어요.', "This team's access has ended, so it's read-only.") : tr('읽기만 할 수 있는 팀이에요. 팀장님께 권한을 문의해 달라고 말씀해 주세요.', 'This team is read-only. Ask the team owner to contact us about access.')}</span>
      {owner && <button className="tmx-btn" onClick={() => openContact(contact)}>{tr('문의하기', 'Contact us')}</button>}
    </div>
  );
}
