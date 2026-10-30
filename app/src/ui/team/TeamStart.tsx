// 팀 만들기·초대받기·초대 링크 만들기 팝업 — 데스크톱 띠 + 와 메신저 창 + 가 같이 쓴다. 화면 고르기는 domain/teamStart
// 링크(chammo.app/join → chammo://join)로 앱이 열리면 invite 에 받은 초대가 채워져 온다 — 들어가기는 사람이 누른다(ADR 0015)
// 계정 기기는 팀이 있어도 '초대받았어요'로 다른 팀에 들어간다(team_relay register 여러 팀). 계정 없는 옛 초대 기기만 팀 하나
import { useEffect, useState } from 'react';
import { teamClipInvite, teamCreate, teamInvite, teamJoin, teamLogin, type TeamView } from '../../data/teamApi';
import { DEFAULT_RELAY } from '../../domain/teamAccount';
import { startScreen } from '../../domain/teamStart';
import { tr } from '../../i18n';
import { IconBack, IconCopy } from '../Icons';
import { IconButton } from '../kit/IconButton';
import './team.css';

export function TeamStart({ view: given, invite = '', makeNow = false, onDone, onChanged }: { view: TeamView | null; invite?: string; /** 팀장이면 열자마자 초대 링크를 만든다(빈 대화 목록의 단추) */ makeNow?: boolean; onDone: () => void; onChanged?: () => void }) {
  // 로그인·만들기 뒤 바로 다음 화면으로 — 부모가 다시 읽기 전에도
  const [fresh, setFresh] = useState<TeamView | null>(null);
  const view = fresh ?? given;
  const [name, setName] = useState('');
  const [code, setCode] = useState(invite);
  const [wantJoin, setWantJoin] = useState(false);
  const [fromClip, setFromClip] = useState(false);
  const [link, setLink] = useState<{ link: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (invite) { setCode(invite); setFromClip(false); } }, [invite]);
  const screen = startScreen(view, { invite, wantJoin });
  const autoLink = makeNow && screen === 'invite' && view?.role === 'owner';
  useEffect(() => {
    if (!autoLink) return;
    setBusy(true);
    void teamInvite().then(setLink, (e: unknown) => setErr(String(e))).finally(() => setBusy(false));
  }, [autoLink]);
  const run = (p: Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    void p.catch((e: unknown) => setErr(String(e))).finally(() => setBusy(false));
  };
  const got = (v: TeamView) => { setFresh(v); onChanged?.(); };
  // 클립보드에 받은 초대 링크가 있으면 채운다(빈 칸일 때만)
  const openJoin = () => {
    setWantJoin(true);
    if (code.trim()) return;
    void teamClipInvite().then((l) => { if (l) { setCode((c) => (c.trim() ? c : l)); setFromClip(true); } }, () => {});
  };
  const linkBox = link && (
    <>
      <div className="tmx-lnk"><code>{link.link}</code>
        <IconButton label={copied ? tr('복사했어요', 'Copied') : tr('복사', 'Copy')} onClick={() => void navigator.clipboard?.writeText(link.link).then(() => setCopied(true), () => {})}><IconCopy /></IconButton>
      </div>
      <span className="tmx-hint">{tr('슬랙·카톡으로 보내세요. 받은 사람이 누르면 들어와요. 24시간 안에 한 사람만 쓸 수 있어요', 'Send it over Slack or chat. Whoever clicks it joins. It works for one person within 24 hours.')}</span>
    </>
  );
  const errLine = err && <span className="tmx-hint" role="alert">{err}</span>;

  if (screen === 'loading') {
    return (
      <div className="tmx-start" aria-busy="true">
        <b>{invite ? tr('팀 초대를 받았어요', 'You got a team invite') : tr('팀 메신저', 'Team messenger')}</b>
        <span className="tmx-hint">{tr('불러오는 중…', 'Loading…')}</span>
      </div>
    );
  }
  if (screen === 'login') {
    return (
      <div className="tmx-start">
        <b>{invite ? tr('팀 초대를 받았어요', 'You got a team invite') : tr('팀 메신저', 'Team messenger')}</b>
        <span className="tmx-hint">{invite ? tr('Chammo 계정으로 로그인하면 이어서 들어가요.', 'Sign in with your Chammo account and you\'ll continue joining.') : tr('팀을 만들거나 초대받으려면 Chammo 계정이 필요해요.', 'You need a Chammo account to make or join a team.')}</span>
        <button className="tmx-btn pri" disabled={busy} onClick={() => run(teamLogin(view?.server ? '' : DEFAULT_RELAY).then(got))}>
          {busy ? tr('브라우저에서 로그인을 마쳐 주세요', 'Finish signing in in the browser') : tr('먼저 Chammo 계정에 로그인', 'Sign in to Chammo first')}
        </button>
        {errLine}
      </div>
    );
  }
  if (screen === 'make') {
    return (
      <div className="tmx-start">
        <b>{tr('팀 만들기', 'Make a team')}</b>
        <span className="tmx-fl">{tr('팀 이름', 'Team name')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label={tr('팀 이름', 'Team name')} autoFocus />
        <div className="tmx-row-a">
          <button className="tmx-btn" disabled={busy} onClick={openJoin}>{tr('초대받았어요', 'I got an invite')}</button>
          <button className="tmx-btn pri" disabled={busy || !name.trim()} onClick={() => run(teamCreate(name).then((v) => { got(v); return teamInvite(); }).then(setLink))}>{tr('만들기', 'Make')}</button>
        </div>
        {errLine}
      </div>
    );
  }
  if (screen === 'join') {
    return (
      <div className="tmx-start">
        <b>{tr('초대받은 팀에 들어가기', 'Join the team you were invited to')}</b>
        <span className="tmx-fl">{tr('받은 초대 링크(또는 코드)', 'Invite link you got (or code)')}</span>
        <input value={code} onChange={(e) => { setCode(e.target.value); setFromClip(false); }} placeholder="https://chammo.app/join#…" aria-label={tr('받은 초대 링크(또는 코드)', 'Invite link you got (or code)')} autoFocus={!code} />
        {fromClip && <span className="tmx-hint">{tr('복사해 둔 초대 링크를 채웠어요', 'Filled in the invite link you copied')}</span>}
        <div className="tmx-row-a">
          {!invite && <IconButton tone="line" label={tr('뒤로', 'Back')} disabled={busy} onClick={() => setWantJoin(false)}><IconBack /></IconButton>}
          <button className="tmx-btn pri" disabled={busy || !code.trim()} onClick={() => run(teamJoin(code).then((v) => { got(v); onDone(); }))}>{tr('들어가기', 'Join')}</button>
        </div>
        {errLine}
      </div>
    );
  }
  // invite·already — 팀이 있다
  const v = view as TeamView;
  const owner = v.role === 'owner';
  return (
    <div className="tmx-start">
      {screen === 'already' && <span className="tmx-hint" role="status">{tr(`이 기기는 초대 코드로 ${v.team} 팀에만 들어와 있어요. 다른 팀에도 들어가려면 설정 > Chammo 계정에서 로그인하세요`, `This device joined ${v.team} with an invite code only. To join other teams, sign in under Settings > Chammo account`)}</span>}
      <b>{tr(`${v.team} 초대 링크`, `${v.team} invite link`)}</b>
      {!owner && <span className="tmx-hint">{tr('초대 링크는 팀장 기기에서 만들어요', 'Only the team owner can make invite links')}</span>}
      <div className="tmx-row-a">
        {screen === 'invite' && v.account && <button className="tmx-btn" disabled={busy} onClick={openJoin}>{tr('초대받았어요', 'I got an invite')}</button>}
        {owner && !link && <button className="tmx-btn pri" disabled={busy} onClick={() => run(teamInvite().then(setLink))}>{tr('링크 만들기', 'Make a link')}</button>}
      </div>
      {linkBox}
      {errLine}
    </div>
  );
}
