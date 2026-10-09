// 폰 로그인 카드·시트 — 홈(대시보드) 맨 위 카드 "Claude 로그인이 풀렸어요" + [로그인]. 맥 앞에 없어도 된다:
// 맥이 pty 로 claude auth login 을 띄우고(BROWSER 막음) → 주소를 이 폰에서 열어 로그인 → 페이지가 보여 준 코드를 붙여 넣으면 맥이 pty 에 한 줄.
// 비밀번호·2FA 는 사람이 브라우저에서. 코드 값은 화면 상태에만 잠깐 있고 저장하지 않는다. 해석은 domain/phoneLogin
import { useEffect, useState } from 'react';
import { loginCancel, loginCode, loginStart, readLogin } from '../../data/web';
import { flowText, readPhoneLogin, showCard, type PhoneLogin } from '../../domain/phoneLogin';
import { IconClose, IconSend } from '../Icons';
import { useMemoPoll } from './usePoll';
import { machine } from '../../i18n';

export function PhoneLoginCard() {
  const [text, , kick] = useMemoPoll('login', readLogin, 15_000, '');
  const [open, setOpen] = useState(false);
  const v = readPhoneLogin(text);
  if (!showCard(v) && !open) return null;
  const where = v.need?.sessions.length ? v.need.sessions.join(' · ') : `이 ${machine()}`;
  return (
    <>
      <div className="m-login" role="alert">
        <div className="m-login-mid">
          <b>Claude 로그인이 풀렸어요</b>
          <span>{v.need ? `멈춘 곳: ${where}` : '로그인하는 중'}</span>
        </div>
        <button type="button" className="m-btn m-login-btn" onClick={() => setOpen(true)}>로그인</button>
      </div>
      {open && <LoginSheet first={v} onClose={() => { setOpen(false); kick(); }} />}
    </>
  );
}

function LoginSheet({ first, onClose }: { first: PhoneLogin; onClose: () => void }) {
  const [v, setV] = useState(first);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id); }, []);
  // 열어 둔 동안 2초마다 — 주소가 나오고·코드 확인이 끝나는 걸 바로 보게
  useEffect(() => {
    const get = () => { readLogin().then((t) => setV(readPhoneLogin(t)), () => {}); };
    const t = setInterval(get, 2000);
    return () => clearInterval(t);
  }, []);
  const close = () => { setShown(false); window.setTimeout(onClose, 220); };
  const act = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      const st = await f();
      setV((p) => readPhoneLogin(JSON.stringify({ need: p.need, flow: st })));
    } catch (e: unknown) {
      setErr(String(e).includes('429') ? '잠깐 뒤에 다시 눌러 주세요' : `${machine()}에 못 닿았어요. 다시 해 주세요`);
    } finally {
      setBusy(false);
    }
  };
  const f = v.flow;
  const fresh = f.state === 'idle' || f.state === 'done' || f.state === 'failed';
  const clean = code.trim();
  const send = () => { if (clean) void act(() => loginCode(clean)).then(() => setCode('')); };
  return (
    <div className="m-pick-wrap" role="dialog" aria-modal="true" aria-label="Claude 로그인">
      <button type="button" className={shown ? 'm-pick-back m-on' : 'm-pick-back'} aria-label="닫기" onClick={close} />
      <div className="m-pick" style={{ transform: shown ? 'translateY(0)' : 'translateY(100%)' }}>
        <div className="m-pick-grab"><div className="m-handle" /></div>
        <div className="m-picker-head">
          <b>Claude 로그인</b>
          <button type="button" className="m-icon" onClick={close} aria-label="닫기" title="닫기"><IconClose /></button>
        </div>
        <div className="m-picker-list m-login-steps">
          {f.state !== 'idle' && <p className="m-sm">{flowText(f)}</p>}
          {fresh && f.state !== 'done' && (
            <button type="button" className="m-send m-login-go" disabled={busy} onClick={() => void act(loginStart)}>{f.state === 'failed' ? '다시 시작' : '로그인 시작'}</button>
          )}
          {f.state === 'starting' && <p className="m-muted m-sm">몇 초 걸려요</p>}
          {f.state === 'waiting' && f.url && (
            <>
              <a className="m-send m-login-go" href={f.url} target="_blank" rel="noopener noreferrer">로그인 페이지 열기</a>
              <div className="m-login-code">
                <input className="m-new-input" value={code} autoComplete="one-time-code" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="send"
                  aria-label="로그인 코드" placeholder="코드 붙여 넣기" maxLength={512} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(); }} />
                <button type="button" className="m-icon m-login-send" disabled={busy || !clean} onClick={send} aria-label="코드 보내기" title="보내기"><IconSend /></button>
              </div>
            </>
          )}
          {err && <p className="m-error">{err}</p>}
          {!fresh && <button type="button" className="m-btn m-login-stop" disabled={busy} onClick={() => void act(loginCancel).then(close)}>그만</button>}
        </div>
      </div>
    </div>
  );
}
