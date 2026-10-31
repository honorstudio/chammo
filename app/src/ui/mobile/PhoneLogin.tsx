// 폰 로그인 카드·시트 — 홈(대시보드) 맨 위 카드 "Claude 로그인이 풀렸어요" + [로그인]. 맥 앞에 없어도 된다:
// 맥이 pty 로 claude auth login 을 띄우고(BROWSER 막음) → 주소를 이 폰에서 열어 로그인 → 페이지가 보여 준 코드를 붙여 넣으면 맥이 pty 에 한 줄.
// 비밀번호·2FA 는 사람이 브라우저에서. 코드 값은 화면 상태에만 잠깐 있고 저장하지 않는다. 해석은 domain/phoneLogin
import { useEffect, useState } from 'react';
import { loginCancel, loginCode, loginStart, loginTermsRetry, readLogin } from '../../data/web';
import { needText, termsText, type TermsCard } from '../../domain/login';
import { flowText, readPhoneLogin, showCard, type PhoneLogin } from '../../domain/phoneLogin';
import { IconClose, IconSend } from '../Icons';
import { BottomSheet, useSheet } from './kit';
import { useMemoPoll } from './usePoll';
import { machine, tr } from '../../i18n';

export function PhoneLoginCard() {
  const [text, , kick] = useMemoPoll('login', readLogin, 15_000, '');
  const [open, setOpen] = useState(false);
  const v = readPhoneLogin(text);
  const terms = v.terms ?? [];
  if (!showCard(v) && !open) return terms.length ? <PhoneTermsCards cards={terms} onDone={kick} /> : null;
  const t = v.need ? needText(v.need) : null;
  return (
    <>
      <PhoneTermsCards cards={terms} onDone={kick} />
      <div className="m-login" role="alert">
        <div className="m-login-mid">
          <b>{t?.title ?? tr('Claude 로그인이 풀렸어요', 'Claude has signed out')}</b>
          <span>{t?.where ?? tr('로그인하는 중', 'Signing in')}</span>
        </div>
        <button type="button" className="m-btn m-login-btn" onClick={() => setOpen(true)}>{tr('로그인', 'Sign in')}</button>
      </div>
      {open && <LoginSheet first={v} onClose={() => { setOpen(false); kick(); }} />}
    </>
  );
}

/** 약관 동의 카드 — 계정마다 하나. 이 폰 브라우저로 claude.ai 를 열어 그 계정으로 동의(사람이 직접) → [다시 시도] 는 맥이 멈춘 세션을 이어서 */
function PhoneTermsCards({ cards, onDone }: { cards: TermsCard[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const retry = () => {
    setBusy(true);
    setErr(null);
    loginTermsRetry().then(onDone, () => setErr(tr(`${machine()}에 못 닿았어요. 다시 해 주세요`, `Couldn't reach your ${machine()}. Please try again`))).finally(() => setBusy(false));
  };
  return <>{cards.map((c) => {
    const t = termsText(c);
    return (
      <div key={c.id} className="m-login m-terms" role="alert">
        <div className="m-login-mid">
          <b>{t.title}</b>
          <span>{err ?? t.where}</span>
        </div>
        <div className="m-terms-acts">
          <a className="m-btn m-login-btn" href="https://claude.ai" target="_blank" rel="noopener noreferrer">{tr('claude.ai 열기', 'Open claude.ai')}</a>
          <button type="button" className="m-btn m-login-btn" disabled={busy} onClick={retry}>{tr('다시 시도', 'Try again')}</button>
        </div>
      </div>
    );
  })}</>;
}

function LoginSheet({ first, onClose }: { first: PhoneLogin; onClose: () => void }) {
  const [v, setV] = useState(first);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 열어 둔 동안 2초마다 — 주소가 나오고·코드 확인이 끝나는 걸 바로 보게
  useEffect(() => {
    const get = () => { readLogin().then((t) => setV(readPhoneLogin(t)), () => {}); };
    const t = setInterval(get, 2000);
    return () => clearInterval(t);
  }, []);
  const act = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      const st = await f();
      setV((p) => readPhoneLogin(JSON.stringify({ need: p.need, flow: st })));
    } catch (e: unknown) {
      setErr(String(e).includes('429') ? tr('잠깐 뒤에 다시 눌러 주세요', 'Please wait a moment and tap again') : tr(`${machine()}에 못 닿았어요. 다시 해 주세요`, `Couldn't reach your ${machine()}. Please try again`));
    } finally {
      setBusy(false);
    }
  };
  const f = v.flow;
  const fresh = f.state === 'idle' || f.state === 'done' || f.state === 'failed';
  const clean = code.trim();
  const send = () => { if (clean) void act(() => loginCode(clean)).then(() => setCode('')); };
  return (
    <BottomSheet label={tr('Claude 로그인', 'Claude sign-in')} title={tr('Claude 로그인', 'Claude sign-in')} onClose={onClose} bodyClass="m-picker-list m-login-steps">
      {f.state !== 'idle' && <p className="m-sm">{flowText(f)}</p>}
      {fresh && f.state !== 'done' && (
        <button type="button" className="m-send m-login-go" disabled={busy} onClick={() => void act(loginStart)}>{f.state === 'failed' ? tr('다시 시작', 'Start again') : tr('로그인 시작', 'Start sign-in')}</button>
      )}
      {f.state === 'starting' && <p className="m-muted m-sm">{tr('몇 초 걸려요', 'This takes a few seconds')}</p>}
      {f.state === 'waiting' && f.url && (
        <>
          <a className="m-send m-login-go" href={f.url} target="_blank" rel="noopener noreferrer">{tr('로그인 페이지 열기', 'Open the sign-in page')}</a>
          <div className="m-login-code">
            <input className="m-new-input" value={code} autoComplete="one-time-code" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="send"
              aria-label={tr('로그인 코드', 'Sign-in code')} placeholder={tr('코드 붙여 넣기', 'Paste the code')} maxLength={512} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(); }} />
            <button type="button" className="m-icon m-login-send" disabled={busy || !clean} onClick={send} aria-label={tr('코드 보내기', 'Send code')} title={tr('보내기', 'Send')}><IconSend /></button>
          </div>
        </>
      )}
      {err && <p className="m-error">{err}</p>}
      {!fresh && <StopLogin disabled={busy} onStop={() => act(loginCancel)} />}
    </BottomSheet>
  );
}

/** 로그인 그만 — 멈춘 뒤 시트를 내려 닫는다(공용 시트의 닫기) */
function StopLogin({ disabled, onStop }: { disabled: boolean; onStop: () => Promise<void> }) {
  const { close } = useSheet();
  return <button type="button" className="m-icon m-login-stop" disabled={disabled} onClick={() => void onStop().then(close)} aria-label={tr('로그인 그만', 'Stop signing in')} title={tr('그만', 'Stop')}><IconClose /></button>;
}
