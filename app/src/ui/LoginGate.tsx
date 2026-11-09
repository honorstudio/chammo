// 로그인한 기기의 다음 단계(4자리·첫 기기·다시 시작) 문 — 로그인 전엔 앱을 막지 않는다(2026-11-05 사용자, ADR 0027). 첫 로그인은 폰·메신저 칸에서.
// 허용 대기 기기는 한 번 안내하고 쓰게 둔다(ADR 0014)
import { invoke } from '@tauri-apps/api/core';
import { LoginWait, loginCancelled } from './LoginWait';
import { useEffect, useState } from 'react';
import { TEAM_LOGGED_IN, teamLogin, teamLogout, teamStatus, type TeamView } from '../data/teamApi';
import { alreadyIn, clockText, gateErr, gateErrText, gateState, laterFor, lookEvery, watchGate, type Gate } from '../domain/loginGate';
import { machine, tr } from '../i18n';
import { BrandMark } from './avatar';
import { IconClose } from './Icons';
import { IconButton } from './kit/IconButton';
import { CodeEntry, NumberWait } from './e2e/NumberWait';
import { RecoverLost, RecoverReady, RecoverWait } from './e2e/Recover';
import './setup.css';

// 이번 실행 동안만 — 앱을 다시 켜면 다시 묻는다
let waitSeen = false;
let startLater = false;
let resetLater = false;
let reloginLater = false;
let recoverLater = false;
let checkingLater = false;
/** 첫 기기 질문 '나중에' — 계정(메일)별로 남긴다. 켤 때마다 다시 막았다(2026-11-01 ux-start M1). 시작은 설정 > 기기 관리 */
const START_LATER_KEY = 'e2eStartLater';
const savedLater = (): string | null => { try { return localStorage.getItem(START_LATER_KEY); } catch { return null; } };

/** onGate = 문 상태를 App 에(둘러보기는 문이 닫힌 뒤에 — ux-start H1). 상태를 못 읽었으면 null */
export function LoginGate({ onGate }: { onGate?: (g: Gate | null) => void } = {}) {
  const [v, setV] = useState<TeamView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** '다시 로그인'을 눌렀다 — 로그아웃으로 계정이 비어도 로그인 화면을 지킨다 */
  const [asked, setAsked] = useState(false);
  const [, bump] = useState(0);
  // 새 기기 4자리 단계(R7) — need·failed 면 그 화면. 끝 화면은 사람이 계속 쓰기를 누를 때까지
  const [step, setStep] = useState('');
  const [codeDone, setCodeDone] = useState(false);
  // 계정이 생긴 뒤 단계를 읽었나 — 상태를 먼저 읽고 그다음 단계를 읽어, 로그인 전에 읽은 빈 단계로 감시를 멈추지 않게(10-26 아이맥)
  const [fresh, setFresh] = useState(false);
  // 숫자 대기에서 '허용해 줄 기기가 없어요'를 눌렀다 — 되찾기 화면(갈래 ②)
  const [lost, setLost] = useState(false);
  const look = () => {
    void teamStatus().then(
      (t) => {
        setV(t);
        void invoke<string>('e2e_self_step').then((x) => { setStep(x); setFresh(!!t.account); if (x) setCodeDone(false); }, () => {});
      },
      () => {},
    );
  };
  useEffect(look, []);
  // 앱 안 다른 칸(메신저·설정)에서 로그인했다 — 다음 단계(4자리·첫 기기)를 바로
  useEffect(() => {
    window.addEventListener(TEAM_LOGGED_IN, look);
    return () => window.removeEventListener(TEAM_LOGGED_IN, look);
  }, []);
  // 허용 대기·4자리 단계 동안은 자주(허용되면 4자리 화면으로 넘어가게), 아닐 때도 가끔(서버가 이 기기를 지우거나 끊으면 다시 로그인 문)
  const watching = watchGate(v, step, fresh);
  useEffect(() => {
    const t = window.setInterval(look, lookEvery(watching));
    return () => window.clearInterval(t);
  }, [watching]);
  const later = startLater || laterFor(savedLater(), v?.account?.email);
  const gate = codeDone ? 'code' : gateState(v, { asked, waitSeen, step, startLater: later, resetLater, reloginLater, recoverLater, checkingLater });
  const known = v ? gate : null;
  useEffect(() => { onGate?.(v ? gate : null); }, [known]); // eslint-disable-line react-hooks/exhaustive-deps
  if (gate === 'none') return null;
  const ge = err ? gateErr(err) : null;
  const clock = ge?.kind === 'clock' ? clockText(ge.min, machine() === 'PC') : null;
  const start = (e: React.MouseEvent) => {
    if (!e.isTrusted || busy) return; // 사람 클릭만
    setBusy(true);
    setErr(null);
    void invoke('e2e_start_chain').then(look, (x: unknown) => setErr(String(x))).finally(() => setBusy(false));
  };
  const reset = (e: React.MouseEvent) => {
    if (!e.isTrusted || busy) return; // 사람 클릭만
    setBusy(true);
    setErr(null);
    void invoke('e2e_reset_chain').then(look, (x: unknown) => setErr(String(x))).finally(() => setBusy(false));
  };
  const out = (again: boolean) => {
    setBusy(true);
    void teamLogout().then((x) => { setV(x); setStep(''); if (again) { setAsked(true); login(); } }, (e: unknown) => setErr(String(e))).finally(() => setBusy(false));
  };
  const login = () => {
    setBusy(true);
    setErr(null);
    // 서버는 Rust 가 고른다 — 이 기기 team.json → 로그아웃 전에 쓰던 것 → 기본(QA 4: '처음부터'·첫 로그인이 기본 중계로 갔다)
    void teamLogin('').then(
      (x) => { setAsked(false); setV(x); },
      (e: unknown) => { const m = String(e); if (alreadyIn(m)) { setAsked(false); look(); return; } if (loginCancelled(m)) return; setErr(m); },
    ).finally(() => setBusy(false));
  };
  return (
    <div className="setup lg-gate" role="dialog" aria-modal="true" aria-label={tr('Chammo 계정', 'Chammo account')}>
      <div className="lg-box">
        <BrandMark size={56} />
        {gate === 'start' ? (
          <>
            {/* 계정 기기 사슬 시작(chammo-relay ADR 0007 R8) — 서버 말만 믿고 스스로 시작하지 않는다. 사람이 '첫 기기'를 고른다 */}
            <h1>{tr('이 컴퓨터에서 처음 시작할까요?', 'Is this your first time using Chammo?')}</h1>
            <p>{tr('이 컴퓨터에서 Chammo를 처음 쓴다면 여기서 시작하면 돼요. 다른 기기에서 이미 쓰고 있다면 시작하지 말고, 그 기기에서 이 컴퓨터를 허용해 주세요. 시작해야 메신저를 쓸 수 있어요. 참모에게 일 맡기기는 시작하지 않아도 돼요.', "If this is your first time using Chammo, start here. If you already use it on another device, don't start. Approve this computer from that device instead. You need to start to use messaging, but not to give work to your assistant.")}</p>
            <div className="lg-acts">
              <button className="btn pri su-go" disabled={busy} onClick={start}>{tr('여기서 시작', 'Start here')}</button>
              <button className="btn su-go" disabled={busy} onClick={() => { startLater = true; try { localStorage.setItem(START_LATER_KEY, v?.account?.email ?? ''); } catch { /* 이번 실행만 */ } bump((n) => n + 1); }}>{tr('나중에', 'Not now')}</button>
            </div>
            <p className="lg-note">{tr('나중에를 누르면 다시 묻지 않아요. 설정 > 기기 관리에서 언제든 시작할 수 있어요.', "If you choose Not now, we won't ask again. You can start any time in Settings > Devices.")}</p>
            {err && <div className="su-error">{gateErrText(err)}</div>}
          </>
        ) : gate === 'reset' ? (
          <>
            {/* 계정 되찾기 갈래 ①(docs/plans/2026-10-26-e2e-recover.md) — 허용해 줄 사슬 기기가 하나도 없다. 새 신원이라 팀원 화면엔 보안 번호 바뀜이 뜬다 */}
            <h1>{tr('이 기기로 다시 시작할까요?', 'Start over on this device?')}</h1>
            <p>{tr('이 계정의 다른 기기가 모두 로그아웃돼서 이 기기를 허용해 줄 기기가 없어요.', 'Every other device on this account is signed out, so nothing is left to approve this one.')}</p>
            <ul className="lg-list">
              <li>{tr('팀원 화면에 내 보안 번호가 바뀌었다고 떠요', 'Teammates will see that your safety number changed')}</li>
              <li>{tr('지난 대화는 이 기기에서 열리지 않아요 — 잠금 열쇠가 옛 기기에만 있었어요', "Past messages won't open here — their keys were only on your old devices")}</li>
              <li>{tr('팀 보관함 파일은 팀원이 새 번호를 받아들이면 다시 보여요', 'Team locker files come back once a teammate accepts the new number')}</li>
            </ul>
            <div className="lg-acts">
              <button className="btn pri su-go" disabled={busy} onClick={reset}>{tr('다시 시작', 'Start over')}</button>
              <button className="btn su-go" disabled={busy} onClick={() => { resetLater = true; bump((n) => n + 1); }}>{tr('나중에', 'Later')}</button>
            </div>
            {err && <div className="su-error">{gateErrText(err)}</div>}
          </>
        ) : gate === 'relogin' ? (
          <>
            {/* 봉인 없이 대기(옛 판에서 로그인)·사슬 기기 0 인 auto 기기 — 숫자가 영영 안 뜨거나 다시 시작이 막힌다. 다시 로그인하면 봉인을 같이 올리거나 바로 허용돼 다시 시작(10-26) */}
            <h1>{tr('로그인을 한 번 더 해 주세요', 'Please sign in once more')}</h1>
            <p>{tr('이 기기는 지금 계정을 쓸 수 없어요. 다른 기기에서 끊었거나, 허용이 거절됐거나, 옛 버전으로 로그인했거나, 허용해 줄 기기가 모두 로그아웃됐을 수 있어요. 다시 로그인하면 숫자가 뜨거나 이 기기에서 새로 시작할 수 있어요.', "This device can't use the account right now. Another device may have disconnected it or declined its sign-in, it may have signed in with an older version, or every device that could approve it may have signed out. Sign in again to get a number or start over on this device.")}</p>
            <div className="lg-acts">
              <button className="btn pri su-go" disabled={busy} onClick={() => out(true)}>{tr('다시 로그인', 'Sign in again')}</button>
              <button className="btn su-go" disabled={busy} onClick={() => { reloginLater = true; bump((n) => n + 1); }}>{tr('나중에', 'Later')}</button>
            </div>
            {err && <div className="su-error">{gateErrText(err)}</div>}
          </>
        ) : gate === 'code' ? (
          <CodeEntry failed={step === 'failed'} onAgain={() => out(true)} onCancel={() => out(false)} onOk={() => setCodeDone(true)}
            onDone={() => { setCodeDone(false); setStep(''); look(); }} />
        ) : gate === 'recoverWait' ? (
          <RecoverWait onLater={() => { recoverLater = true; bump((n) => n + 1); }} onChanged={look} />
        ) : gate === 'recoverReady' ? (
          <RecoverReady onLater={() => { recoverLater = true; bump((n) => n + 1); }} onDone={() => { setLost(false); look(); }} />
        ) : gate === 'waiting' && lost ? (
          <RecoverLost onBack={() => setLost(false)} />
        ) : gate === 'waiting' ? (
          <>
            {/* 숫자 넣기 허용(chammo-relay ADR 0007, 시안 e2e-approve v1) — 그동안 이 컴퓨터 참모는 그대로 쓴다 */}
            <NumberWait>
              <button className="btn pri" onClick={() => { waitSeen = true; bump((n) => n + 1); }}>{tr('계속 쓰기', 'Continue')}</button>
              {/* 허용해 줄 기기가 없을 때(다 로그아웃됨)도 빠져나갈 길 — 대기 기기는 기기 목록이 비어 설정에서 로그아웃을 못 한다(10-26) */}
              <button className="btn" disabled={busy} onClick={() => out(false)}>{tr('로그인 취소', 'Cancel sign-in')}</button>
            </NumberWait>
            {/* 옛 기기를 잃었으면 — 계정 되찾기 갈래 ②(chammo-relay ADR 0007 R9) */}
            <button className="lg-link" onClick={() => setLost(true)}>{tr('허용해 줄 기기가 없어요', 'No device to approve this one')}</button>
            {err && <div className="su-error">{gateErrText(err)}</div>}
          </>
        ) : gate === 'checking' ? (
          <>
            <h1>{tr('확인하는 중', 'Checking this computer')}</h1>
            <p>{tr('계정과 이 컴퓨터를 확인하고 있어요.', "Checking your account and this computer.")}</p>
            <div className="lg-acts">
              <button className="btn su-go" onClick={() => { checkingLater = true; bump((n) => n + 1); }}>{tr('기다리지 않고 계속 쓰기', 'Continue without waiting')}</button>
            </div>
            <p className="lg-note">{tr('확인이 끝나기 전엔 팀 메신저가 안 될 수 있어요.', 'Team messaging may not work until this check finishes.')}</p>
          </>
        ) : (
          <>
            {clock ? <><h1>{clock.title}</h1><p>{clock.body}</p></> : <>
            <h1>{tr('Chammo 계정으로 시작해요', 'Start with your Chammo account')}</h1>
            <p>{tr('폰·다른 컴퓨터·메신저가 이 계정으로 연결돼요. 한 번 로그인하면 앱을 다시 켜도 유지돼요', 'Your phone, other computers and messenger connect through this account. Sign in once and it stays signed in.')}</p></>}
            <button className="btn pri su-go lg-go" disabled={busy} onClick={login}>{busy ? tr('브라우저에서 로그인을 마쳐 주세요', 'Finish signing in in the browser') : tr('구글로 로그인', 'Sign in with Google')}</button>
            {busy && <LoginWait />}
            {!busy && <div className="lg-acts"><IconButton size="l" tone="line" label={tr('닫기', 'Close')} onClick={() => { setAsked(false); setErr(null); }}><IconClose /></IconButton></div>}
            {err && !clock && <div className="su-error">{gateErrText(err)}</div>}
          </>
        )}
      </div>
    </div>
  );
}
