// 팀 만들기·초대받기·초대 링크 만들기 팝업 — 데스크톱 띠 + 와 메신저 창 + 가 같이 쓴다. 화면 고르기는 domain/teamStart
// 링크(chammo.app/join → chammo://join)로 앱이 열리면 invite 에 받은 초대가 채워져 온다 — 들어가기는 사람이 누른다(ADR 0015)
// 계정 기기는 팀이 있어도 '초대받았어요'로 다른 팀에 들어간다(team_relay register 여러 팀). 계정 없는 옛 초대 기기만 팀 하나
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { canDo } from '../../domain/teamSettings';
import { LoginWait, loginCancelled } from '../LoginWait';
import { teamClipInvite, teamCreate, teamInvite, teamJoin, teamLogin, type TeamView } from '../../data/teamApi';
import { DEFAULT_RELAY } from '../../domain/teamAccount';
import { needStart, startScreen } from '../../domain/teamStart';
import { defaultMe, sameTeamName } from '../../domain/teamAdd';
import { tr } from '../../i18n';
import { gateErrText } from '../../domain/loginGate';
import { IconBack, IconCopy } from '../Icons';
import { IconButton } from '../kit/IconButton';
import './team.css';

export function TeamStart({ view: given, invite = '', makeNow = false, want, onDone, onChanged }: { view: TeamView | null; invite?: string; /** 팀장이면 열자마자 초대 링크를 만든다(빈 대화 목록의 단추) */ makeNow?: boolean;
  /** 레일 + ·칩 ▾ 메뉴에서 고른 것 — 팀이 있어도 새 팀 만들기·초대 링크로 들어가기(11-02 팀 여러 개) */ want?: 'make' | 'join'; onDone: () => void; onChanged?: () => void }) {
  // 로그인·만들기 뒤 바로 다음 화면으로 — 부모가 다시 읽기 전에도
  const [fresh, setFresh] = useState<TeamView | null>(null);
  const view = fresh ?? given;
  const [name, setName] = useState('');
  const [code, setCode] = useState(invite);
  const [wantJoin, setWantJoin] = useState(want === 'join');
  // 이 팀에서 보일 내 이름 — 손대기 전엔 지금 팀 이름·계정 이름(팀마다 다르게 정할 수 있다)
  const [meIn, setMe] = useState<string | null>(null);
  const me = meIn ?? defaultMe(view);
  /** 방금 만든 팀 이름 — 만든 직후 화면(초대 링크 + 나중에 보내기). 뒤 화면은 이미 새 팀 */
  const [made, setMade] = useState('');
  const [fromClip, setFromClip] = useState(false);
  const [link, setLink] = useState<{ link: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (invite) { setCode(invite); setFromClip(false); } }, [invite]);
  const screen = startScreen(view, { invite, wantJoin, wantMake: want === 'make' });
  // 계정을 아직 어느 기기에서도 시작 안 했으면 만들기·들어가기가 막힌다 — 그 자리에서 시작(ux-team H2). 로그인 문·설정 기기 관리와 같은 명령
  const [step, setStep] = useState('');
  const readStep = () => void invoke<string>('e2e_self_step').then(setStep, () => {});
  useEffect(readStep, [view?.account]); // eslint-disable-line react-hooks/exhaustive-deps
  const startBox = needStart(screen, step) && (
    <div className="tmx-row-a">
      <span className="tmx-hint">{tr('팀을 쓰려면 이 컴퓨터에서 먼저 시작해야 해요. 여기서 시작을 눌러 주세요.', 'To use teams, you need to start on this computer first. Press Start here.')}</span>
      <button className="tmx-btn pri" disabled={busy} onClick={(e) => { if (e.nativeEvent.isTrusted && !busy) run(invoke('e2e_start_chain').then(readStep)); }}>{tr('여기서 시작', 'Start here')}</button>
    </div>
  );
  const autoLink = makeNow && screen === 'invite' && canDo(view, 'invite');
  useEffect(() => {
    if (!autoLink) return;
    setBusy(true);
    void teamInvite().then(setLink, (e: unknown) => setErr(String(e))).finally(() => setBusy(false));
  }, [autoLink]);
  const run = (p: Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    void p.catch((e: unknown) => { if (!loginCancelled(e)) setErr(gateErrText(String(e))); }).finally(() => setBusy(false));
  };
  const got = (v: TeamView) => { setFresh(v); onChanged?.(); };
  // 같은 이름은 막지 않고 경고 한 줄(만들기 전 내 팀 목록 기준)
  const dup = !made && sameTeamName(name, view?.teams);
  // 클립보드에 받은 초대 링크가 있으면 채운다(빈 칸일 때만)
  const openJoin = () => {
    setWantJoin(true);
    if (code.trim()) return;
    void teamClipInvite().then((l) => { if (l) { setCode((c) => (c.trim() ? c : l)); setFromClip(true); } }, () => {});
  };
  useEffect(() => { if (want === 'join') openJoin(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const meBox = (
    <>
      <span className="tmx-fl">{tr('이 팀에서 보일 내 이름', 'Your name in this team')}</span>
      <input value={me} onChange={(e) => setMe(e.target.value)} maxLength={40} aria-label={tr('이 팀에서 보일 내 이름', 'Your name in this team')} />
    </>
  );
  const linkBox = link && (
    <>
      <div className="tmx-lnk"><code>{link.link}</code>
        <IconButton label={copied ? tr('복사했어요', 'Copied') : tr('복사', 'Copy')} onClick={() => void navigator.clipboard?.writeText(link.link).then(() => setCopied(true), () => {})}><IconCopy /></IconButton>
      </div>
      <span className="tmx-hint">{made ? tr('이 링크를 보내면 한 분이 24시간 안에 들어올 수 있어요.', 'Send this link and one person can join within 24 hours.') : tr('슬랙·카톡으로 보내세요. 받은 사람이 누르면 들어와요. 24시간 안에 한 사람만 쓸 수 있어요', 'Send it over Slack or chat. Whoever clicks it joins. It works for one person within 24 hours.')}</span>
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
        {busy && <LoginWait />}
        {errLine}
      </div>
    );
  }
  // 만든 직후 — 뒤 화면은 이미 새 팀(Rust 가 지금 팀을 새 팀으로), 초대 링크를 바로 보여 준다
  if (made) {
    return (
      <div className="tmx-start">
        <b>{tr(`${made} 팀을 만들었어요`, `${made} is ready`)}</b>
        {linkBox}
        {busy && !link && <span className="tmx-hint">{tr('초대 링크를 만드는 중…', 'Making the invite link…')}</span>}
        <div className="tmx-row-a"><button className="tmx-btn" onClick={onDone}>{tr('나중에 보내기', 'Send later')}</button></div>
        {errLine}
      </div>
    );
  }
  if (screen === 'make') {
    return (
      <div className="tmx-start">
        {startBox}
        <span className="tmx-fl">{tr('팀 이름', 'Team name')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label={tr('팀 이름', 'Team name')} autoFocus />
        {dup && <span className="tmx-hint" role="status">{tr('같은 이름의 팀이 이미 있어요.', 'You already have a team with this name.')}</span>}
        {meBox}
        <span className="tmx-hint">{tr('팀마다 다르게 정할 수 있어요.', 'You can use a different name in each team.')}</span>
        <div className="tmx-row-a">
          {!want && <button className="tmx-btn" disabled={busy} onClick={openJoin}>{tr('초대받았어요', 'I got an invite')}</button>}
          <button className="tmx-btn pri" disabled={busy || !name.trim()} onClick={() => { const n = name.trim(); run(teamCreate(name, me).then((v) => { got(v); setMade(n); return teamInvite(); }).then(setLink)); }}>{tr('만들기', 'Create')}</button>
        </div>
        {errLine}
      </div>
    );
  }
  if (screen === 'join') {
    return (
      <div className="tmx-start">
        {!want && <b>{tr('초대받은 팀에 들어가기', 'Join the team you were invited to')}</b>}
        {startBox}
        <span className="tmx-fl">{tr('초대 링크', 'Invite link')}</span>
        <input value={code} onChange={(e) => { setCode(e.target.value); setFromClip(false); }} placeholder="https://chammo.app/join#…" aria-label={tr('초대 링크', 'Invite link')} autoFocus={!code} />
        {fromClip && <span className="tmx-hint">{tr('복사해 둔 링크를 넣어 두었어요.', 'We filled in the link you copied.')}</span>}
        {meBox}
        <div className="tmx-row-a">
          {!invite && !want && <IconButton tone="line" label={tr('뒤로', 'Back')} disabled={busy} onClick={() => setWantJoin(false)}><IconBack /></IconButton>}
          <button className="tmx-btn pri" disabled={busy || !code.trim()} onClick={() => run(teamJoin(code, me).then((v) => { got(v); onDone(); }))}>{tr('들어가기', 'Join')}</button>
        </div>
        {errLine}
      </div>
    );
  }
  // invite·already — 팀이 있다
  const v = view as TeamView;
  const owner = canDo(v, 'invite'); // 초대할 수 있나(팀장·초대 권한 매니저 — 11-01 QA M2)
  return (
    <div className="tmx-start">
      {screen === 'already' && <span className="tmx-hint" role="status">{tr(`이 기기는 초대 코드로 ${v.team} 팀에만 들어와 있어요. 다른 팀에도 들어가려면 설정 > Chammo 계정에서 로그인하세요`, `This device joined ${v.team} with an invite code only. To join other teams, sign in under Settings > Chammo account`)}</span>}
      <b>{tr(`${v.team} 초대 링크`, `${v.team} invite link`)}</b>
      {!owner && <span className="tmx-hint">{tr('초대 링크는 팀장이나 초대 권한을 받은 사람이 만들어요', 'Only a team owner or someone with the Invite permission can make invite links.')}</span>}
      <div className="tmx-row-a">
        {screen === 'invite' && v.account && <button className="tmx-btn" disabled={busy} onClick={openJoin}>{tr('초대받았어요', 'I got an invite')}</button>}
        {owner && !link && <button className="tmx-btn pri" disabled={busy} onClick={() => run(teamInvite().then(setLink))}>{tr('링크 만들기', 'Make a link')}</button>}
      </div>
      {linkBox}
      {errLine}
    </div>
  );
}
