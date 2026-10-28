// 로그인 필수(2026-10-24 사용자) — Chammo 계정에 로그인 안 된 기기는 앱을 켜면 먼저 이 화면. '나중에' 없음.
// 중계에 못 닿을 때만 '일단 쓰기'(이번 실행만, 다음에 켜면 다시). 허용 대기 기기는 한 번 안내하고 쓰게 둔다(ADR 0014)
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { teamLogin, teamLogout, teamStatus, type TeamView } from '../data/teamApi';
import { alreadyIn, gateState, lookEvery, offlineError, watchGate } from '../domain/loginGate';
import { tr } from '../i18n';
import { BrandMark } from './avatar';
import { IconRefresh } from './Icons';
import { IconButton } from './kit/IconButton';
import { CodeEntry, NumberWait } from './e2e/NumberWait';
import { RecoverLost, RecoverReady, RecoverWait } from './e2e/Recover';
import './setup.css';

// 이번 실행 동안만 — 앱을 다시 켜면 다시 묻는다
let skipped = false;
let waitSeen = false;
let startLater = false;
let resetLater = false;
let reloginLater = false;
let recoverLater = false;

export function LoginGate() {
  const [v, setV] = useState<TeamView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
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
  // 허용 대기·4자리 단계 동안은 자주(허용되면 4자리 화면으로 넘어가게), 아닐 때도 가끔(서버가 이 기기를 지우거나 끊으면 다시 로그인 문)
  const watching = watchGate(v, step, fresh);
  useEffect(() => {
    const t = window.setInterval(look, lookEvery(watching));
    return () => window.clearInterval(t);
  }, [watching]);
  const gate = codeDone ? 'code' : gateState(v, { offline, skipped, waitSeen, step, startLater, resetLater, reloginLater, recoverLater });
  if (gate === 'none') return null;
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
    void teamLogout().then((x) => { setV(x); setStep(''); if (again) login(); }, (e: unknown) => setErr(String(e))).finally(() => setBusy(false));
  };
  const login = () => {
    setBusy(true);
    setErr(null);
    // 서버는 Rust 가 고른다 — 이 기기 team.json → 로그아웃 전에 쓰던 것 → 기본(QA 4: '처음부터'·첫 로그인이 기본 중계로 갔다)
    void teamLogin('').then(
      (x) => { setOffline(false); setV(x); },
      (e: unknown) => { const m = String(e); if (alreadyIn(m)) { look(); return; } setOffline(offlineError(m)); setErr(m); },
    ).finally(() => setBusy(false));
  };
  return (
    <div className="setup lg-gate" role="dialog" aria-modal="true" aria-label={tr('Chammo 계정', 'Chammo account')}>
      <div className="lg-box">
        <BrandMark size={56} />
        {gate === 'start' ? (
          <>
            {/* 계정 기기 사슬 시작(chammo-relay ADR 0007 R8) — 서버 말만 믿고 스스로 시작하지 않는다. 사람이 '첫 기기'를 고른다 */}
            <h1>{tr('이 기기가 이 계정의 첫 기기예요?', 'Is this the first device on this account?')}</h1>
            <p>{tr('메신저는 종단 암호로만 써요. 이 기기에서 계정의 기기 묶음을 시작해요 — 이미 쓰던 기기가 있으면 누르지 말고, 그 기기에서 허용받아요.', 'Messages are end-to-end encrypted only. This starts your account\'s device group here — if you already use another device, don\'t press this; get approved on that device instead.')}</p>
            <div className="lg-acts">
              <button className="btn pri su-go" disabled={busy} onClick={start}>{tr('첫 기기로 시작', 'Start as first device')}</button>
              <button className="btn su-go" disabled={busy} onClick={() => { startLater = true; bump((n) => n + 1); }}>{tr('나중에', 'Later')}</button>
            </div>
            {err && <div className="su-error">{err}</div>}
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
            {err && <div className="su-error">{err}</div>}
          </>
        ) : gate === 'relogin' ? (
          <>
            {/* 봉인 없이 대기(옛 판에서 로그인)·사슬 기기 0 인 auto 기기 — 숫자가 영영 안 뜨거나 다시 시작이 막힌다. 다시 로그인하면 봉인을 같이 올리거나 바로 허용돼 다시 시작(10-26) */}
            <h1>{tr('로그인을 한 번 더 해 주세요', 'Please sign in once more')}</h1>
            <p>{tr('이 기기는 지금 상태로는 계정을 쓸 수 없어요(다른 기기에서 이 기기를 끊었거나 로그인 허용이 거절됐어요, 또는 예전 판에서 로그인했거나 허용해 줄 내 기기가 다 로그아웃됐어요). 다시 로그인하면 숫자가 뜨거나 이 기기로 다시 시작할 수 있어요.', "This device can't use the account as it is (another device disconnected it or declined its sign-in, or it signed in with an older version, or every device that could approve it signed out). Sign in again to get a number or start over on this device.")}</p>
            <div className="lg-acts">
              <button className="btn pri su-go" disabled={busy} onClick={() => out(true)}>{tr('다시 로그인', 'Sign in again')}</button>
              <button className="btn su-go" disabled={busy} onClick={() => { reloginLater = true; bump((n) => n + 1); }}>{tr('나중에', 'Later')}</button>
            </div>
            {err && <div className="su-error">{err}</div>}
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
            {err && <div className="su-error">{err}</div>}
          </>
        ) : gate === 'offline' ? (
          <>
            <h1>{tr('지금은 연결이 안 돼요', "Can't connect right now")}</h1>
            <p>{tr('Chammo 계정 서버에 닿지 않아요(인터넷이 끊겼거나 서버 장애). 다시 닿으면 로그인을 다시 권할게요.', "Can't reach the Chammo account server (offline or an outage). We'll ask again once it's reachable.")}</p>
            <div className="lg-acts">
              <IconButton size="l" tone="pri" label={tr('다시 시도', 'Try again')} busy={busy} onClick={login}><IconRefresh /></IconButton>
              <button className="btn su-go" disabled={busy} onClick={() => { skipped = true; bump((n) => n + 1); }}>{tr('일단 쓰기', 'Use for now')}</button>
            </div>
          </>
        ) : (
          <>
            <h1>{tr('Chammo 계정으로 시작해요', 'Start with your Chammo account')}</h1>
            <p>{tr('폰·다른 컴퓨터·메신저가 이 계정으로 이어져요. 한 번 로그인하면 앱을 다시 켜도 계속 유지돼요.', 'Your phone, other computers and messenger connect through this account. Sign in once and it stays signed in.')}</p>
            <button className="btn pri su-go lg-go" disabled={busy} onClick={login}>{busy ? tr('브라우저에서 로그인을 마쳐 주세요', 'Finish signing in in the browser') : tr('구글로 로그인', 'Sign in with Google')}</button>
            {err && <div className="su-error">{err}</div>}
          </>
        )}
      </div>
    </div>
  );
}
