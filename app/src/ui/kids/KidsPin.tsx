// 보호자 숫자판(여섯째 조각, 계획서 결정 3 — 숫자 네 자리 기본) — 구석 3초 뒤에 뜬다. 네 자리를 다 누르면 맥이 확인한다(나가기는 서버가 본다).
// 틀리면 흔들고 비우고, 쉬는 중이면 남은 초만. 글은 안 둔다(아이가 읽을 것 없음) — 바깥을 누르면 닫힌다
// 패스키(일곱째 조각) — 이 기기가 되면 왼쪽 아래 빈칸이 얼굴 칸이 된다. 등록돼 있으면 누르면 바로 나가기,
// 아니면 누른 뒤 숫자 네 자리를 맞히면 등록(나가지는 않음). Safari 는 누름이 있어야 열어서 도전값은 미리 받아 둔다
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPasskey, getPasskey, passkeyReady, type PasskeyAssertion, type PasskeyReg } from '../../domain/kidsPasskey';
import { tr } from '../../i18n';

export type LeaveResult = { ok: true } | { ok: false; waitMs: number; wrong: boolean };
export type KidsPasskeyApi = {
  challenge: (purpose: 'register' | 'leave', rp: string) => Promise<{ challenge: string; ids: string[] }>;
  register: (pin: string, reg: PasskeyReg) => Promise<LeaveResult>;
  leave: (a: PasskeyAssertion) => Promise<LeaveResult>;
};
type Ch = { purpose: 'register' | 'leave'; challenge: string; ids: string[]; at: number };
const FRESH_MS = 90_000; // 맥 도전값 2분 — 넉넉히 먼저 새로

export function KidsPin({ onTry, onClose, passkey }: { onTry: (pin: string) => Promise<LeaveResult>; onClose: () => void; passkey?: { api: KidsPasskeyApi; registered: boolean } }) {
  const [pin, setPin] = useState('');
  const [ready, setReady] = useState(false);
  const [registered, setRegistered] = useState(!!passkey?.registered);
  const [regMode, setRegMode] = useState(false);
  const ch = useRef<Ch | null>(null);
  const rp = location.hostname;
  const fetchCh = useCallback((purpose: 'register' | 'leave') => {
    if (!passkey) return;
    ch.current = null;
    void passkey.api.challenge(purpose, rp).then((c) => { ch.current = { purpose, ...c, at: Date.now() }; }, () => undefined);
  }, [passkey, rp]);
  useEffect(() => {
    if (!passkey) return;
    void passkeyReady().then((ok) => { setReady(ok); if (ok && passkey.registered) fetchCh('leave'); });
  }, [passkey, fetchCh]);
  const fresh = (purpose: 'register' | 'leave') => (ch.current && ch.current.purpose === purpose && Date.now() - ch.current.at < FRESH_MS ? ch.current : null);
  const [shake, setShake] = useState(0);
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const waiting = until > now;
  useEffect(() => {
    if (!waiting) return;
    const i = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(i);
  }, [waiting]);
  const press = (d: string) => {
    if (busy || waiting || pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length < 4) return;
    setBusy(true);
    const c = regMode ? fresh('register') : null;
    // 등록 — 누른 이 자리에서 바로 인증기를 연다(숫자는 맥이 등록 때 본다)
    const run = regMode && passkey && c ? createPasskey(c.challenge, rp).then((reg) => passkey.api.register(next, reg)) : onTry(next);
    if (regMode) setRegMode(false);
    void run.then((r) => {
      setBusy(false);
      setPin('');
      if (r.ok) { if (regMode) { setRegistered(true); fetchCh('leave'); } return; }
      if (r.wrong) setShake((x) => x + 1);
      if (r.waitMs > 0) { setUntil(Date.now() + r.waitMs); setNow(Date.now()); }
    }, () => { setBusy(false); setPin(''); });
  };
  // 얼굴 칸 — 등록돼 있으면 바로 나가기, 아니면 등록 모드(다음 숫자 네 자리)
  const face = () => {
    if (!passkey || busy || waiting) return;
    if (!registered) { const on = !regMode; setRegMode(on); setPin(''); if (on) fetchCh('register'); return; }
    const c = fresh('leave');
    if (!c) { fetchCh('leave'); return; }
    setBusy(true);
    ch.current = null;
    void getPasskey(c.challenge, rp, c.ids).then((a) => passkey.api.leave(a)).then((r) => {
      setBusy(false);
      if (!r.ok) { setShake((x) => x + 1); fetchCh('leave'); }
    }, () => { setBusy(false); fetchCh('leave'); });
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  return (
    <div className="kzpin-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="kzpin" role="dialog" aria-label={tr('보호자 숫자', 'Guardian code')}>
        <div className={`kzpin-dots${shake ? ' kzpin-shake' : ''}`} key={shake} aria-live="polite">
          {waiting ? <span className="kzpin-wait">{Math.ceil((until - now) / 1000)}</span> : [0, 1, 2, 3].map((i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}
        </div>
        <div className="kzpin-keys">
          {keys.map((k, i) => k === '' ? (passkey && ready
            ? <button key={i} type="button" className={`kzpin-face${regMode ? ' on' : ''}${registered ? ' set' : ''}`} aria-pressed={regMode}
                aria-label={registered ? tr('얼굴로 열기', 'Unlock with Face ID') : tr('얼굴로 열기 등록 — 숫자 네 자리를 누르면', 'Set up Face ID — then enter the code')}
                title={registered ? tr('얼굴로 열기', 'Unlock with Face ID') : tr('얼굴로 열기 등록', 'Set up Face ID')} onClick={face} disabled={waiting || busy}>
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M9 9.5v1M15 9.5v1M12 9.5v3.5h-1M9.5 16a3.5 3.5 0 0 0 5 0" /></svg>
              </button>
            : <span key={i} />) : k === 'del'
            ? <button key={i} type="button" aria-label={tr('지우기', 'Delete')} title={tr('지우기', 'Delete')} onClick={() => setPin((p) => p.slice(0, -1))} disabled={waiting}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-6-6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M12 10l4 4M16 10l-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </button>
            : <button key={i} type="button" onClick={() => press(k)} disabled={waiting || busy}>{k}</button>)}
        </div>
      </div>
    </div>
  );
}
