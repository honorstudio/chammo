// 설정 > 폰과 메신저 > 다른 기기 참모 — 같은 테일스케일 계정 기기의 Chammo 와 잇기(ADR 0007).
// 0.3.2: 같은 계정 기기는 목록에 바로 뜨고 '연결'을 누르면 그 기기에 허용 카드가 뜬다 → 그쪽 사람이 허용하면 양쪽이 이어진다.
// 코드(그 기기 설정 > 폰의 연결 코드)는 대피로 — 옛 판이거나 되묻기가 안 닿을 때. 열쇠는 이 기기 키체인에만. 참모끼리 말은 scripts/peer 로
import { useEffect, useState } from 'react';
import { remoteConnect, remoteConnectCancel, remoteDevices, remotePair, remoteUnpair, type RemoteDevice } from '../data/remote';
import { peerView } from '../domain/peerDevices';
import { IS_WIN } from '../domain/reader';
import { IconRefresh, IconUnlink } from './Icons';
import { IconButton } from './kit/IconButton';
import { tr } from '../i18n';

export function PeerSection({ title }: { title: string }) {
  const [list, setList] = useState<RemoteDevice[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 허용을 기다리는 기기들 — 기다리는 동안에도 다른 줄은 만질 수 있다
  const [waiting, setWaiting] = useState<string[]>([]);
  // 코드를 넣는 중인 기기(대피로)
  const [pairing, setPairing] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const load = () => {
    if (IS_WIN) return;
    setBusy(true);
    void remoteDevices().then((o) => { setList(o.devices); setErr(null); }, (e: unknown) => { setList([]); setErr(String(e)); }).finally(() => setBusy(false));
  };
  useEffect(load, []);
  const act = (f: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    void f().then(() => { setPairing(null); setCode(''); load(); }, (e: unknown) => { setErr(String(e)); setBusy(false); });
  };
  const connect = (d: RemoteDevice) => {
    setErr(null);
    setWaiting((w) => [...w, d.id]);
    void remoteConnect(d.id).then(load, (e: unknown) => {
      const m = String(e);
      if (!m.includes('취소')) setErr(`${d.name}: ${m}`);
    }).finally(() => setWaiting((w) => w.filter((x) => x !== d.id)));
  };

  if (IS_WIN) {
    return (
      <section className="su-sec">
        <div className="su-sec-head"><h2>{title}</h2></div>
        <p className="su-hint">{tr('다른 기기 참모는 지금 맥끼리만 이어져요', 'Linking with other devices works between Macs for now')}</p>
      </section>
    );
  }

  return (
    <section className="su-sec">
      <div className="su-sec-head">
        <h2>{title}</h2>
        <IconButton size="l" tone="line" label={tr('다시 찾기', 'Look again')} disabled={busy} onClick={load}><IconRefresh /></IconButton>
      </div>
      <p className="su-hint">
        {tr('같은 테일스케일 계정 기기의 참모와 이어요. 연결을 누르면 그 기기에 허용 카드가 떠요.',
          'Link with Chammo on your other devices on the same Tailscale account. Press Connect and allow it on that device.')}
      </p>
      <div className="su-rows">
        {(list ?? []).map((d) => {
          const wait = waiting.includes(d.id);
          const v = peerView(d, wait);
          return (
            <div key={d.id} className="su-row peer-row">
              <div className="su-row-text">
                <b>{d.name}</b>
                <span className={d.status === 'connected' ? 'peer-on' : undefined}>{v.extra ? `${v.word} · ${v.extra}` : v.word}</span>
              </div>
              {v.code && pairing !== d.id && (
                <button className="peer-alt" disabled={busy} onClick={() => { setPairing(d.id); setCode(''); }}>{tr('코드로', 'Use a code')}</button>
              )}
              {v.connect && <button className="btn pri su-row-act" disabled={busy} onClick={() => connect(d)}>{tr('연결', 'Connect')}</button>}
              {wait && <button className="btn su-row-act" onClick={() => void remoteConnectCancel(d.id)}>{tr('취소', 'Cancel')}</button>}
              {v.unlink && (
                <button className="ib danger su-row-act" aria-label={tr(`${d.name} 끊기`, `Unlink ${d.name}`)} title={tr('끊기', 'Unlink')} disabled={busy || wait} onClick={() => act(() => remoteUnpair(d.id))}><IconUnlink /></button>
              )}
              {pairing === d.id && (
                <div className="su-inline peer-code">
                  <input autoFocus autoComplete="off" spellCheck={false} placeholder="0123 4567 89ab …" aria-label={tr(`${d.name} 연결 코드`, `${d.name} connect code`)}
                    value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) act(() => remotePair(d.id, code)); if (e.key === 'Escape') setPairing(null); }} />
                  <button className="btn pri" disabled={busy || !code.trim()} onClick={() => act(() => remotePair(d.id, code))}>{tr('짝짓기', 'Pair')}</button>
                  <span className="su-hint">{tr('그 기기 설정 > 폰의 연결 코드', 'The connect code from that device’s Settings > Phone')}</span>
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
