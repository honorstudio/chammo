// 설정 > 텔레그램 — 봇 토큰 넣기(키체인) → 텔레그램에서 시작(10분 한 번짜리 딥링크·QR) → 연결됨·끊기(Rust messenger_cmd.rs). 기본 꺼짐.
// 짝지은 계정의 1:1 대화만 받고, 결제·보내기·삭제·운영 카드는 텔레그램에선 알림만(docs/plans/2026-10-06-messenger.md)
import { useEffect, useState } from 'react';
import { messengerApi, openTarget, writeClipboard, type MessengerLink, type MessengerView } from '../data/tauri';
import { accountLine, BOTFATHER, dotOf, stageOf, tokenFrom, tokenLooksRight } from '../domain/messenger';
import { IconClose, IconCopy, IconOpen, IconUnlink } from './Icons';
import { tr } from '../i18n';

const left = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function MessengerSection({ title }: { title: string }) {
  const [st, setSt] = useState<MessengerView | null>(null);
  const [token, setToken] = useState('');
  const [link, setLink] = useState<MessengerLink | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 토큰 지우기는 두 번 — 그 자리에서 한 번 더 묻는다
  const [forgetting, setForgetting] = useState(false);

  useEffect(() => { void messengerApi.status().then(setSt, (e: unknown) => setErr(String(e))); }, []);
  // 링크가 떠 있는 동안 — 남은 시간을 세고, 짝이 생기면 링크를 거둔다
  useEffect(() => {
    if (!link) return;
    const t = window.setInterval(() => {
      setNow(Date.now());
      void messengerApi.status().then((s) => { setSt(s); if (s.pending) setLink(null); }, () => {});
    }, 2000);
    return () => window.clearInterval(t);
  }, [link]);
  useEffect(() => { if (link && now > link.expires) setLink(null); }, [now, link]);

  const act = (f: () => Promise<MessengerView>, after?: () => void) => {
    setBusy(true);
    setErr(null);
    void f().then((s) => { setSt(s); after?.(); }, (e: unknown) => setErr(String(e))).finally(() => setBusy(false));
  };
  const newLink = () => {
    setErr(null);
    setBusy(true);
    void messengerApi.pairNew().then((l) => { setLink(l); setNow(Date.now()); void openTarget('url', l.link).catch(() => {}); }, (e: unknown) => setErr(String(e))).finally(() => setBusy(false));
  };
  const closeLink = () => { setLink(null); void messengerApi.pairCancel().catch(() => {}); };
  const stage = stageOf(st);
  const dot = st ? dotOf(st) : 'off';
  const dotWord = { ok: tr('받는 중', 'Listening'), err: tr('문제 있음', 'Problem'), off: tr('꺼짐', 'Off') }[dot];

  return (
    <section className="su-sec">
      <div className="su-sec-head">
        <h2>{title}</h2>
        {st?.hasToken && st.bot && (
          <button className={st.on ? 'btn' : 'btn pri'} disabled={busy} onClick={() => { setLink(null); act(() => messengerApi.set(!st.on)); }}>
            {st.on ? tr('끄기', 'Turn off') : tr('켜기', 'Turn on')}
          </button>
        )}
      </div>
      <p className="su-hint">
        {tr('텔레그램에서 참모와 말해요. 연결한 내 계정의 1:1 대화만 받고, 결제·보내기·삭제·운영 카드는 알림만 가요 — 승인은 앱·폰에서.',
          'Talk to your assistant from Telegram. Only 1:1 chats from your linked account are accepted; payment, send, delete and production cards arrive as notices only — approve them in the app or on the phone.')}
      </p>

      {stage === 'token' && (
        <ol className="tg-steps">
          <li>
            <span>{tr('텔레그램 BotFather 에서 /newbot 으로 내 봇을 만들어요', 'In Telegram, create your bot with /newbot in BotFather')}</span>
            <button className="ib" aria-label={tr('BotFather 열기', 'Open BotFather')} title={tr('BotFather 열기', 'Open BotFather')} onClick={() => void openTarget('url', BOTFATHER).catch(() => {})}><IconOpen /></button>
          </li>
          <li>
            <span>{tr('받은 토큰을 붙여 넣어요', 'Paste the token you get')}</span>
            <div className="su-inline">
              <input className="tg-token" type="password" autoComplete="off" spellCheck={false} placeholder="123456789:AA…" aria-label={tr('봇 토큰', 'Bot token')}
                value={token} onChange={(e) => setToken(tokenFrom(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter' && tokenLooksRight(token)) act(() => messengerApi.setToken(token), () => setToken('')); }} />
              <button className="btn pri" disabled={busy || !tokenLooksRight(token)} onClick={() => act(() => messengerApi.setToken(token), () => setToken(''))}>{tr('연결', 'Connect')}</button>
            </div>
          </li>
        </ol>
      )}

      {stage === 'pair' && st && (link ? (
        <div className="su-mobile">
          {link.qrSvg && <img className="su-qr" alt={tr('텔레그램 연결 QR', 'Telegram link QR')} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(link.qrSvg)}`} />}
          <div className="su-mobile-side">
            <b>{tr(`${left(link.expires - now)} 안에 텔레그램에서 시작(Start)을 눌러 주세요`, `Press Start in Telegram within ${left(link.expires - now)}`)}</b>
            <span className="su-hint">{tr('폰이면 QR 을 찍고, 이 맥 텔레그램이면 방금 열린 창에서 눌러요. 한 번 쓰면 사라져요.', 'On the phone scan the QR; on this Mac use the window that just opened. It works once.')}</span>
            <div className="su-inline">
              <button className="ib" aria-label={tr('텔레그램에서 열기', 'Open in Telegram')} title={tr('텔레그램에서 열기', 'Open in Telegram')} onClick={() => void openTarget('url', link.link).catch(() => {})}><IconOpen /></button>
              <button className="ib" aria-label={copied ? tr('복사했어요', 'Copied') : tr('링크 복사', 'Copy link')} title={copied ? tr('복사했어요', 'Copied') : tr('링크 복사', 'Copy link')} onClick={() => void writeClipboard(link.link).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); })}><IconCopy /></button>
              <button className="ib" aria-label={tr('닫기', 'Close')} title={tr('닫기', 'Close')} onClick={closeLink}><IconClose /></button>
            </div>
          </div>
        </div>
      ) : (
        <div className="su-inline"><button className="btn pri" disabled={busy || !st.on} onClick={newLink}>{tr(`@${st.bot} 텔레그램에서 시작`, `Start @${st.bot} in Telegram`)}</button></div>
      ))}

      {stage === 'confirm' && st?.pending && (
        <div className="tg-confirm">
          <span className="su-hint">{tr('텔레그램에서 시작을 누른 계정이에요. 내 계정이 맞을 때만 연결해요 — 이 계정은 이 맥의 참모에게 말할 수 있어요.', 'This account pressed Start in Telegram. Link it only if it is yours — it will be able to talk to the assistant on this Mac.')}</span>
          <div className="su-row">
            <div className="su-row-text">
              <b>{st.pending.name}</b>
              <span>{accountLine(st.pending)}</span>
            </div>
            <button className="btn pri" disabled={busy} onClick={() => act(messengerApi.confirm)}>{tr('이 계정이 맞아요', 'This is my account')}</button>
            <button className="ib su-row-act" aria-label={tr('내 계정 아님', 'Not my account')} title={tr('내 계정 아님', 'Not my account')} disabled={busy} onClick={() => act(messengerApi.reject)}><IconClose /></button>
          </div>
        </div>
      )}

      {stage === 'linked' && st && (
        <div className="su-rows">
          <div className="su-row">
            <div className="su-row-text">
              <b>{st.user?.name}</b>
              <span><i className={`tg-dot tg-dot-${dot}`} aria-hidden="true" />{`${st.user ? accountLine(st.user) : ''} · @${st.bot} · ${dotWord}`}</span>
            </div>
            <button className="ib danger su-row-act" aria-label={tr(`${st.user?.name} 연결 끊기`, `Unlink ${st.user?.name}`)} title={tr('연결 끊기', 'Unlink')} disabled={busy} onClick={() => act(messengerApi.unpair)}><IconUnlink /></button>
          </div>
        </div>
      )}

      {st?.hasToken && (
        <span className="su-hint">
          {tr('봇 대화는 종단 암호화가 아니라 텔레그램 서버에 남아요 — 비밀번호·키는 치지 마세요. 텔레그램 2단계 인증을 켜 두세요. 잃어버렸으면 텔레그램에서 /잠금.',
            'Bot chats are not end-to-end encrypted and stay on Telegram servers — never type passwords or keys. Turn on Telegram two-step verification. Lost the phone? Send /lock.')}
          {st.tokenFile && tr(' 이 PC 는 키체인이 없어 토큰을 데이터 폴더 파일(나만 읽기)에 둬요.', ' This PC keeps the token in a data-folder file readable only by you (no keychain).')}
        </span>
      )}
      {st?.hasToken && (
        <div className="su-inline">
          {forgetting
            ? <>
                <button className="btn" disabled={busy} onClick={() => { setForgetting(false); setLink(null); act(messengerApi.forget); }}>{tr('정말 토큰 지우기', 'Remove the token now')}</button>
                <button className="btn" onClick={() => setForgetting(false)}>{tr('취소', 'Cancel')}</button>
              </>
            : <button className="btn" disabled={busy} onClick={() => setForgetting(true)}>{tr('토큰 지우기', 'Remove token')}</button>}
        </div>
      )}
      {st?.error && <div className="su-error">{st.error}</div>}
      {err && <div className="su-error">{err}</div>}
    </section>
  );
}
