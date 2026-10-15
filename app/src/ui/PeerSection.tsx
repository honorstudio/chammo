// 설정 > 폰과 메신저 > 다른 기기 참모 — 같은 테일스케일 계정 기기의 Chammo 와 잇기(ADR 0007).
// 처음 한 번 그 기기 설정 > 폰의 연결 코드로 짝짓기 → 열쇠는 이 기기 키체인에만. 참모끼리 말은 scripts/peer 로
import { useEffect, useState } from 'react';
import { remoteDevices, remotePair, remoteUnpair, type RemoteDevice } from '../data/remote';
import { peerAction, peerSub } from '../domain/peerDevices';
import { IconRefresh, IconUnlink } from './Icons';
import { IconButton } from './kit/IconButton';
import { tr } from '../i18n';

export function PeerSection({ title }: { title: string }) {
  const [list, setList] = useState<RemoteDevice[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 코드를 넣는 중인 기기
  const [pairing, setPairing] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const load = () => {
    setBusy(true);
    void remoteDevices().then((o) => { setList(o.devices); setErr(null); }, (e: unknown) => { setList([]); setErr(String(e)); }).finally(() => setBusy(false));
  };
  useEffect(load, []);
  const act = (f: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    void f().then(() => { setPairing(null); setCode(''); load(); }, (e: unknown) => { setErr(String(e)); setBusy(false); });
  };

  return (
    <section className="su-sec">
      <div className="su-sec-head">
        <h2>{title}</h2>
        <IconButton size="l" tone="line" label={tr('다시 찾기', 'Look again')} disabled={busy} onClick={load}><IconRefresh /></IconButton>
      </div>
      <p className="su-hint">
        {tr('같은 테일스케일 계정 기기의 참모와 이어요. 처음 한 번 그 기기 설정 > 폰의 연결 코드로 짝지어요.',
          'Link with Chammo on your other devices on the same Tailscale account. Pair once with the connect code from that device’s Settings > Phone.')}
      </p>
      <div className="su-rows">
        {(list ?? []).map((d) => {
          const a = peerAction(d);
          return (
            <div key={d.id} className="su-row peer-row">
              <div className="su-row-text">
                <b>{d.name}</b>
                <span>{peerSub(d)}</span>
              </div>
              {a !== 'unpair' && pairing !== d.id && (
                <button className="btn su-row-act" disabled={busy} onClick={() => { setPairing(d.id); setCode(''); }}>{a === 'repair' ? tr('다시 짝짓기', 'Pair again') : tr('짝짓기', 'Pair')}</button>
              )}
              {d.paired && (
                <button className="ib danger su-row-act" aria-label={tr(`${d.name} 끊기`, `Unpair ${d.name}`)} title={tr('끊기', 'Unpair')} disabled={busy} onClick={() => act(() => remoteUnpair(d.id))}><IconUnlink /></button>
              )}
              {pairing === d.id && (
                <div className="su-inline peer-code">
                  <input autoFocus autoComplete="off" spellCheck={false} placeholder="0123 4567 89ab …" aria-label={tr(`${d.name} 연결 코드`, `${d.name} connect code`)}
                    value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) act(() => remotePair(d.id, code)); if (e.key === 'Escape') setPairing(null); }} />
                  <button className="btn pri" disabled={busy || !code.trim()} onClick={() => act(() => remotePair(d.id, code))}>{tr('짝짓기', 'Pair')}</button>
                </div>
              )}
            </div>
          );
        })}
        {list && list.length === 0 && !err && <span className="su-hint">{tr('같은 계정에 참모가 있는 다른 기기가 없어요', 'No other device with Chammo on this account')}</span>}
        {!list && <span className="su-hint">{tr('찾는 중…', 'Looking…')}</span>}
      </div>
      {err && <div className="su-error">{err}</div>}
    </section>
  );
}
