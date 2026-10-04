// 설정 > 모바일 — 폰에서 참모를 여는 서버 켜기/끄기, 폰 연결 QR(10분 한 번짜리 짝짓기), 연결된 기기·끊기(Rust mobile.rs). 기본 꺼짐.
// 목록은 폰 단위 — 사파리·홈 화면 앱(열쇠 둘)을 한 줄로 묶고 칸은 작은 글로(domain/mobileDevices)
import { useEffect, useState } from 'react';
import { mobileApi, writeClipboard, type MobileStatus, type PairQr } from '../data/tauri';
import { groupCode, pairCodeFrom } from '../domain/mobileAuth';
import { kindLabels, lastPaired, phoneGroups } from '../domain/mobileDevices';
import { IconUnlink } from './Icons';
import { tr } from '../i18n';

const day = (ms: number) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const left = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function MobileSection({ title }: { title: string }) {
  const [st, setSt] = useState<MobileStatus | null>(null);
  const [qr, setQr] = useState<PairQr | null>(null);
  // 홈 화면 앱용 — QR 주소의 코드 글자(복사해 에어드롭·메시지로 보내 앱에 붙여 넣는다)
  const code = qr ? pairCodeFrom(new URL(qr.url).search) : null;
  const [codeCopied, setCodeCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 모두 끊기는 두 번 — 웹뷰 confirm 창 대신 그 자리에서 한 번 더 묻는다
  const [clearing, setClearing] = useState(false);

  useEffect(() => { void mobileApi.status().then(setSt, (e: unknown) => setErr(String(e))); }, []);
  // QR 이 떠 있는 동안 — 남은 시간을 세고, 기기가 붙으면(열쇠를 새로 내줬으면 — 같은 폰은 줄이 안 는다) QR 을 거둔다
  useEffect(() => {
    if (!qr) return;
    const before = lastPaired(st?.devices ?? []);
    const t = window.setInterval(() => {
      setNow(Date.now());
      void mobileApi.status().then((s) => { setSt(s); if (lastPaired(s.devices) > before) setQr(null); }, () => {});
    }, 2000);
    return () => window.clearInterval(t);
  }, [qr]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (qr && now > qr.expires) setQr(null); }, [now, qr]);

  const act = (f: () => Promise<MobileStatus>) => {
    setBusy(true);
    setErr(null);
    void f().then(setSt, (e: unknown) => setErr(String(e))).finally(() => setBusy(false));
  };
  const phones = phoneGroups(st?.devices ?? []);
  const kindWords = { safari: tr('사파리', 'Safari'), browser: tr('브라우저', 'Browser'), home: tr('홈 화면 앱', 'Home Screen app') };
  const newQr = () => {
    setErr(null);
    void mobileApi.pairNew().then((q) => { setQr(q); setNow(Date.now()); }, (e: unknown) => setErr(String(e)));
  };

  return (
    <section className="su-sec">
      <div className="su-sec-head">
        <h2>{title}</h2>
        {st && (
          <button className={st.on ? 'btn' : 'btn pri'} disabled={busy} onClick={() => { setQr(null); act(() => mobileApi.set(!st.on)); }}>
            {st.on ? tr('끄기', 'Turn off') : tr('켜기', 'Turn on')}
          </button>
        )}
      </div>
      <p className="su-hint">
        {tr('폰에서 비서와 채팅하고 세션·예약을 봐요. 테일스케일로만 열리고(같은 와이파이에도 안 보임), 폰마다 한 번 연결 QR 을 찍으면 그 폰만의 열쇠가 생겨요. QR 은 10분 안에 한 번만 쓸 수 있어요.',
          'Chat with your assistant and check sessions and routines from your phone. Reachable only over Tailscale (not even on the same Wi-Fi); scan a connect QR once per phone and it gets its own key. A QR works once, within 10 minutes.')}
      </p>
      {st?.running && (
        <>
          {qr ? (
            <div className="su-mobile">
              {qr.qrSvg && <img className="su-qr" alt={tr('폰 연결 QR', 'Connect QR')} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.qrSvg)}`} />}
              <div className="su-mobile-side">
                <b>{tr(`${left(qr.expires - now)} 안에 폰 카메라로 찍어 주세요`, `Scan with the phone camera within ${left(qr.expires - now)}`)}</b>
                <span className="su-hint">{tr("한 번 쓰면 사라져요. 홈 화면에 붙인 앱은 QR 로 못 열려요 — 아래 코드를 그 앱의 '붙여넣기로 연결'에 넣거나, 연결된 사파리에서 '홈 화면 앱 연결'로 코드를 받아요.", "It disappears after one use. A home-screen app can't be opened by the QR — paste the code below into its 'Connect by pasting', or get a code from a connected Safari with 'Connect home-screen app'.")}</span>
                {code && <code className="su-pair-code">{groupCode(code)}</code>}
                <div className="su-inline">
                  <button className="btn" onClick={() => void writeClipboard(qr.url).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); })}>
                    {copied ? tr('복사했어요', 'Copied') : tr('주소 복사', 'Copy address')}
                  </button>
                  {code && <button className="btn" onClick={() => void writeClipboard(code).then(() => { setCodeCopied(true); window.setTimeout(() => setCodeCopied(false), 1500); })}>
                    {codeCopied ? tr('복사했어요', 'Copied') : tr('코드 복사', 'Copy code')}
                  </button>}
                  <button className="btn" onClick={() => setQr(null)}>{tr('닫기', 'Close')}</button>
                </div>
              </div>
            </div>
          ) : (
            <div className="su-inline"><button className="btn pri" onClick={newQr}>{tr('폰 연결 QR 만들기', 'Make connect QR')}</button></div>
          )}
          {!st.https && <span className="su-hint">{tr(`테일스케일 HTTPS 를 못 걸어 http 주소예요 — 폰에서 누르고 말하기(마이크)는 안 돼요. ${st.httpsNote ?? ''}`, `Tailscale HTTPS is not set, so this is an http address — push-to-talk (mic) won't work on the phone. ${st.httpsNote ?? ''}`)}</span>}
          <div className="su-rows">
            {phones.map((g) => (
              <div key={g.group} className="su-row">
                <div className="su-row-text">
                  <b>{g.name}</b>
                  <span>{[tr(`마지막 ${day(g.lastUsed)}`, `Last ${day(g.lastUsed)}`), ...kindLabels(g.name, g.kinds, kindWords)].join(' · ')}</span>
                </div>
                <button className="ib danger su-row-act" aria-label={tr(`${g.name} 끊기`, `Disconnect ${g.name}`)} title={tr('끊기', 'Disconnect')} disabled={busy} onClick={() => act(() => mobileApi.removeDevice(g.group))}><IconUnlink /></button>
              </div>
            ))}
            {phones.length === 0 && <span className="su-hint">{tr('연결된 폰이 없어요', 'No phones connected')}</span>}
          </div>
          {phones.length > 1 && (
            <div className="su-inline">
              {clearing
                ? <>
                    <button className="btn" disabled={busy} onClick={() => { setClearing(false); act(mobileApi.clearDevices); }}>{tr('정말 모두 끊기', 'Disconnect all now')}</button>
                    <button className="btn" onClick={() => setClearing(false)}>{tr('취소', 'Cancel')}</button>
                  </>
                : <button className="btn" disabled={busy} onClick={() => setClearing(true)}>{tr('모두 끊기', 'Disconnect all')}</button>}
            </div>
          )}
          <span className="su-hint">{tr(`묶은 곳 ${st.bind ?? ''}`, `Bound to ${st.bind ?? ''}`)}</span>
        </>
      )}
      {st?.on && !st.running && <div className="su-error">{st.error ?? tr('켜는 중…', 'Starting…')}</div>}
      {err && <div className="su-error">{err}</div>}
    </section>
  );
}
