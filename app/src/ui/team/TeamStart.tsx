// 팀 만들기·초대 링크로 들어오기·초대 링크 만들기(시안 v2 폰 시트와 같은 세 가지) — 데스크톱 띠 + 와 메신저 창 + 가 같이 쓴다.
// 지금은 기기마다 팀 하나(team_relay register) — 팀이 있으면 초대만, 없으면 만들기·들어오기
import { useState } from 'react';
import { teamCreate, teamInvite, teamJoin, type TeamView } from '../../data/teamApi';
import { tr } from '../../i18n';
import { IconCopy, IconSettings } from '../Icons';
import { IconButton } from '../kit/IconButton';
import './team.css';

export function TeamStart({ view, onDone, onLogin }: { view: TeamView | null; onDone: () => void; onLogin?: () => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [link, setLink] = useState<{ link: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const run = (p: Promise<unknown>, then?: () => void) => {
    setBusy(true);
    setErr(null);
    void p.then(() => { then?.(); }, (e: unknown) => setErr(String(e))).finally(() => setBusy(false));
  };
  if (!view?.joined && !view?.account) {
    return (
      <div className="tmx-start">
        <b>{tr('팀 메신저', 'Team messenger')}</b>
        <span className="tmx-hint">{tr('Chammo 계정으로 로그인하면 팀을 만들 수 있어요. 초대 링크를 받았으면 바로 들어와도 돼요.', 'Sign in with a Chammo account to make a team. Got an invite link? Join right away.')}</span>
        {onLogin && <div className="tmx-row-a"><IconButton tone="line" label={tr('설정 열기 — Chammo 계정', 'Open settings — Chammo account')} onClick={onLogin}><IconSettings /></IconButton></div>}
        <span className="tmx-fl">{tr('초대 링크', 'Invite link')}</span>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="chammo://join?…" aria-label={tr('초대 링크', 'Invite link')} />
        <span className="tmx-fl">{tr('내 이름', 'My name')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label={tr('내 이름', 'My name')} />
        {err && <span className="tmx-hint" role="alert">{err}</span>}
        <div className="tmx-row-a"><button className="tmx-btn pri" disabled={busy || !code.trim() || !name.trim()} onClick={() => run(teamJoin(code, name), onDone)}>{tr('들어가기', 'Join')}</button></div>
      </div>
    );
  }
  if (!view.joined) {
    return (
      <div className="tmx-start">
        <b>{tr('팀 만들기', 'Make a team')}</b>
        <span className="tmx-fl">{tr('팀 이름', 'Team name')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label={tr('팀 이름', 'Team name')} autoFocus />
        <div className="tmx-row-a"><button className="tmx-btn pri" disabled={busy || !name.trim()} onClick={() => run(teamCreate(name), onDone)}>{tr('만들기', 'Make')}</button></div>
        <span className="tmx-fl">{tr('또는 초대 링크로 들어오기', 'Or join with an invite link')}</span>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="chammo://join?…" aria-label={tr('초대 링크', 'Invite link')} />
        <div className="tmx-row-a"><button className="tmx-btn" disabled={busy || !code.trim()} onClick={() => run(teamJoin(code), onDone)}>{tr('들어가기', 'Join')}</button></div>
        {err && <span className="tmx-hint" role="alert">{err}</span>}
      </div>
    );
  }
  const owner = view.role === 'owner';
  return (
    <div className="tmx-start">
      <b>{tr(`${view.team} 초대 링크`, `${view.team} invite link`)}</b>
      {!owner && <span className="tmx-hint">{tr('초대 링크는 팀장 기기에서 만들어요', 'Only the team owner can make invite links')}</span>}
      {owner && !link && <div className="tmx-row-a"><button className="tmx-btn pri" disabled={busy} onClick={() => run(teamInvite().then((l) => setLink(l)))}>{tr('링크 만들기', 'Make a link')}</button></div>}
      {link && (
        <>
          <div className="tmx-lnk"><code>{link.link}</code>
            <IconButton label={copied ? tr('복사했어요', 'Copied') : tr('복사', 'Copy')} onClick={() => void navigator.clipboard?.writeText(link.link).then(() => setCopied(true), () => {})}><IconCopy /></IconButton>
          </div>
          <span className="tmx-hint">{tr('24시간 · 한 사람만 들어와요', '24 hours · one person')}</span>
        </>
      )}
      <span className="tmx-hint">{tr('팀은 지금 기기마다 하나예요', 'One team per device for now')}</span>
      {err && <span className="tmx-hint" role="alert">{err}</span>}
    </div>
  );
}
