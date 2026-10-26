// 설정 > 계정 > Chammo 계정(맨 위)(중계 서버 ADR 0004) — 구글로 로그인해 내 기기끼리 잇는다. 지금 앱 모양(su-sec·su-row)만, 메신저 본 화면은 4단계.
// 로그인은 사람 브라우저에서(앱이 127.0.0.1 로 돌려받는다), 열쇠는 이 기기 키체인(chammo-team)에만. 끊기·로그아웃·계정 지우기는 서버에서 먼저
import { useEffect, useState } from 'react';
import { teamAccountDelete, teamAccountRefresh, teamLogin, teamLogout, teamStatus, type TeamView } from '../data/teamApi';
import { DEFAULT_RELAY, deleteConfirmOk, PRIVACY_URL, TERMS_URL } from '../domain/teamAccount';
import { openTarget } from '../data/tauri';
import { IconRefresh } from './Icons';
import { IconButton } from './kit/IconButton';
import { tr } from '../i18n';

/** onDevices = 기기 관리 탭으로(내 기기 목록). 이 기기 로그아웃은 여기에도 — 허용 대기·확인 중이면 기기 목록이 비어 거기 줄이 안 보였다(10-26 사용자 "로그아웃도 없고") */
export function TeamAccountSection({ title, onDevices }: { title: string; onDevices?: () => void }) {
  const [v, setV] = useState<TeamView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [server, setServer] = useState(DEFAULT_RELAY);
  const [deleting, setDeleting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [typed, setTyped] = useState('');
  // 중계 주소는 기본(relay.chammo.app) 그대로 쓰는 게 보통 — 칸은 '중계 서버 바꾸기'를 눌렀을 때만(10-24)
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => { void teamStatus().then(setV, (e: unknown) => setErr(String(e))); }, []);
  const act = (f: () => Promise<TeamView>) => {
    setBusy(true);
    setErr(null);
    void f().then((x) => { setV(x); setDeleting(false); setLeaving(false); setTyped(''); }, (e: unknown) => setErr(String(e))).finally(() => setBusy(false));
  };
  const login = () => {
    setWaiting(true);
    setErr(null);
    void teamLogin(server.trim()).then(setV, (e: unknown) => setErr(String(e))).finally(() => setWaiting(false));
  };

  const acc = v?.account ?? null;
  return (
    <section className="su-sec">
      <div className="su-sec-head">
        <h2>{title}</h2>
        {acc && <IconButton size="l" tone="line" label={tr('다시 받기', 'Refresh')} disabled={busy} onClick={() => act(teamAccountRefresh)}><IconRefresh /></IconButton>}
      </div>
      {!acc && (
        <>
          <p className="su-hint">{tr('구글로 로그인하면 같은 계정 기기의 참모끼리 말할 수 있어요.', 'Sign in with Google so assistants on your devices can talk to each other.')}</p>
          <div className="su-inline">
            {advanced && !v?.server && (
              <input autoComplete="off" spellCheck={false} placeholder="https://…" aria-label={tr('중계 서버 주소', 'Relay server address')} value={server} onChange={(e) => setServer(e.target.value)} />
            )}
            <button className="btn pri" disabled={busy || waiting || (!v?.server && !server.trim())} onClick={login}>{tr('구글로 로그인', 'Sign in with Google')}</button>
          </div>
          {!advanced && !v?.server && <div className="su-inline"><button className="peer-alt" onClick={() => setAdvanced(true)}>{tr('중계 서버 바꾸기', 'Change relay server')}</button></div>}
          {waiting && <span className="su-hint">{tr('브라우저에서 로그인을 마쳐 주세요', 'Finish signing in in the browser')}</span>}
        </>
      )}
      {acc && (
        <div className="su-rows">
          <div className="su-row">
            <div className="su-row-text"><b>{acc.name || acc.email}</b><span>{acc.email}</span></div>
            <button className="btn su-row-act" onClick={onDevices}>{tr('내 기기 보기', 'My devices')}</button>
          </div>
          <div className="su-row">
            {leaving ? (
              <div className="su-inline">
                <span className="su-hint">{tr('이 기기에서 로그아웃할까요? 다시 쓰려면 다시 로그인해요', 'Sign out of this device? Sign in again to use it')}</span>
                <button className="btn danger" disabled={busy} onClick={(e) => { if (e.nativeEvent.isTrusted) act(teamLogout); }}>{tr('로그아웃', 'Sign out')}</button>
                <button className="btn" disabled={busy} onClick={() => setLeaving(false)}>{tr('취소', 'Cancel')}</button>
              </div>
            ) : (
              <button className="peer-alt" disabled={busy} onClick={() => setLeaving(true)}>{tr('이 기기 로그아웃', 'Sign out of this device')}</button>
            )}
          </div>
          <div className="su-row">
            {deleting ? (
              <div className="su-inline">
                <input autoFocus autoComplete="off" spellCheck={false} placeholder={acc.email || acc.name} aria-label={tr('확인하려면 계정 이메일을 그대로 쳐 주세요', 'Type the account email to confirm')} value={typed} onChange={(e) => setTyped(e.target.value)} />
                <button className="btn danger" disabled={busy || !deleteConfirmOk(acc, typed)} onClick={() => act(() => teamAccountDelete(typed))}>{tr('계정 지우기', 'Delete account')}</button>
                <span className="su-hint">{tr('모든 기기가 끊기고 팀에서 빠져요. 되돌릴 수 없어요', 'Every device is disconnected and you leave every team. This can’t be undone')}</span>
              </div>
            ) : (
              <button className="peer-alt" disabled={busy} onClick={() => setDeleting(true)}>{tr('계정 지우기', 'Delete account')}</button>
            )}
          </div>
        </div>
      )}
      <div className="su-inline">
        <button className="peer-alt" onClick={() => void openTarget('url', PRIVACY_URL).catch(() => {})}>{tr('개인정보 처리방침', 'Privacy Policy')}</button>
        <button className="peer-alt" onClick={() => void openTarget('url', TERMS_URL).catch(() => {})}>{tr('이용약관', 'Terms')}</button>
      </div>
      {err && <div className="su-error">{err}</div>}
    </section>
  );
}
