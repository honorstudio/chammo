// 설정 > 기기 관리 > 다른 기기 참모 — 같은 테일스케일 계정 기기의 Chammo 와 잇기(ADR 0007).
// 0.3.2: 같은 계정 기기는 목록에 바로 뜨고 '연결'을 누르면 그 기기에 허용 카드가 뜬다 → 그쪽 사람이 허용하면 양쪽이 이어진다.
// 코드(그 기기 설정 > 폰의 연결 코드)는 대피로 — 옛 판이거나 되묻기가 안 닿을 때. 열쇠는 이 기기 키체인(윈도우는 자격 증명 관리자)에만. 참모끼리 말은 scripts/peer 로
import { useEffect, useState } from 'react';
import { remoteApi, remoteConnect, remoteConnectCancel, remoteDevices, remoteLogoutAsk, remotePair, remoteUnpair, type RemoteDevice } from '../data/remote';
import { teamStatus } from '../data/teamApi';
import { peerAccount, type HereAccount } from '../domain/chammoHere';
import { remoteAssistants, type RemoteAssistant } from '../domain/remoteChat';
import { REMOTE_CHAT_EVENT, type RemoteChatTarget } from './chat/RemoteChat';
import { peerView } from '../domain/peerDevices';
import { IconChat, IconRefresh, IconUnlink } from './Icons';
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

  // 이어진 기기의 참모들(ADR 0011) — 누르면 채팅 열이 그 참모로(사람이 친 말은 그 기기에 '사람 말(원격)'로 간다)
  const [agents, setAgents] = useState<Record<string, RemoteAssistant[]>>({});
  // 그 기기 Chammo 가 어느 계정에 붙어 있나(그 기기 /api/env) — 내 계정과 다르면 표시하고 로그아웃 요청(그 기기 사람 확인 카드)
  const [accts, setAccts] = useState<Record<string, HereAccount[] | undefined>>({});
  const [mine, setMine] = useState('');
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { void teamStatus().then((v) => setMine(v.account?.email ?? ''), () => {}); }, []);
  const load = () => {
    setBusy(true);
    void remoteDevices().then((o) => {
      setList(o.devices);
      setErr(null);
      for (const d of o.devices.filter((x) => x.status === 'connected')) {
        const api = remoteApi(d.id);
        void Promise.all([api.getEnv(), api.listSessionsRaw()]).then(([env, raw]) => {
          setAgents((m) => ({ ...m, [d.id]: remoteAssistants(raw, env.hqDir) }));
          setAccts((m) => ({ ...m, [d.id]: env.chammoAccounts }));
        }, () => {});
      }
    }, (e: unknown) => { setList([]); setErr(String(e)); }).finally(() => setBusy(false));
  };
  const chat = (d: RemoteDevice, a: RemoteAssistant) => {
    const detail: RemoteChatTarget = { dev: d.id, devName: d.name, agent: a.id, name: a.name || a.id };
    window.dispatchEvent(new CustomEvent(REMOTE_CHAT_EVENT, { detail }));
  };
  useEffect(load, []);
  const act = (f: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    void f().then(() => { setPairing(null); setCode(''); load(); }, (e: unknown) => { setErr(String(e)); setBusy(false); });
  };
  // 사람 클릭만 — 그 기기엔 카드만 뜨고 끊기는 그쪽 사람이 누를 때
  const askLogout = (e: React.MouseEvent, d: RemoteDevice) => {
    if (!e.nativeEvent.isTrusted || busy) return;
    setErr(null);
    setNote(null);
    void remoteLogoutAsk(d.id).then(() => setNote(tr(`${d.name} 에 확인 카드를 띄웠어요 — 그 기기에서 '로그아웃'을 눌러야 끊겨요`, `A card is up on ${d.name} — it signs out only when someone presses Sign out there`)), (x: unknown) => setErr(`${d.name}: ${String(x)}`));
  };
  const connect = (d: RemoteDevice) => {
    setErr(null);
    setWaiting((w) => [...w, d.id]);
    void remoteConnect(d.id).then(load, (e: unknown) => {
      const m = String(e);
      if (!m.includes('취소')) setErr(`${d.name}: ${m}`);
    }).finally(() => setWaiting((w) => w.filter((x) => x !== d.id)));
  };

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
          const pa = d.status === 'connected' ? peerAccount(accts[d.id], mine) : null;
          return (
            <div key={d.id} className="su-row dev-row peer-row">
              <div className="su-row-text">
                <b title={d.name}>{d.name}</b>
                <span className={d.status === 'connected' ? 'peer-on' : undefined}>{v.extra ? `${v.word} · ${v.extra}` : v.word}</span>
                {pa?.main && <span>{pa.main.signedIn ? tr(`${pa.main.who} 계정`, `${pa.main.who} account`) : tr('Chammo 계정 로그인 안 됨', 'Not signed in to Chammo')}{pa.main.other && <> · <span className="acct-st-out">{tr('다른 계정', 'Another account')}</span></>}</span>}
                {pa?.others.map((o) => <span key={o.folder}>{o.folder} · {o.who}{o.other && <> · <span className="acct-st-out">{tr('다른 계정', 'Another account')}</span></>}</span>)}
              </div>
              {pa?.main?.other && <button className="btn su-row-act" disabled={busy} onClick={(e) => askLogout(e, d)}>{tr('로그아웃 요청', 'Ask to sign out')}</button>}
              {v.code && pairing !== d.id && (
                <button className="peer-alt" disabled={busy} onClick={() => { setPairing(d.id); setCode(''); }}>{tr('코드로', 'Use a code')}</button>
              )}
              {v.connect && <button className="btn pri su-row-act" disabled={busy} onClick={() => connect(d)}>{tr('연결', 'Connect')}</button>}
              {wait && <button className="btn su-row-act" onClick={() => void remoteConnectCancel(d.id)}>{tr('취소', 'Cancel')}</button>}
              {v.unlink && (
                <button className="ib danger su-row-act" aria-label={tr(`${d.name} 끊기`, `Unlink ${d.name}`)} title={tr('끊기', 'Unlink')} disabled={busy || wait} onClick={() => act(() => remoteUnpair(d.id))}><IconUnlink /></button>
              )}
              {d.status === 'connected' && (agents[d.id] ?? []).length > 0 && (
                <div className="peer-agents">
                  {agents[d.id]!.map((a) => (
                    <div key={a.id} className="peer-agent">
                      <span>{a.name || a.id}</span>
                      <IconButton size="m" tone="line" label={tr(`${a.name || a.id}와 채팅`, `Chat with ${a.name || a.id}`)} onClick={() => chat(d, a)}><IconChat /></IconButton>
                    </div>
                  ))}
                </div>
              )}
              {pairing === d.id && (
                <div className="su-inline peer-code">
                  <input autoFocus autoComplete="off" spellCheck={false} placeholder="0123 4567 89ab …" aria-label={tr(`${d.name} 연결 코드`, `${d.name} connect code`)}
                    value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) act(() => remotePair(d.id, code)); if (e.key === 'Escape') setPairing(null); }} />
                  <button className="btn pri" disabled={busy || !code.trim()} onClick={() => act(() => remotePair(d.id, code))}>{tr('짝짓기', 'Pair')}</button>
                  <span className="su-hint">{tr('그 기기 설정 > 기기 관리 > 폰의 연결 코드', 'The connect code from that device’s Settings > Devices > Phone')}</span>
                </div>
              )}
            </div>
          );
        })}
        {list && list.length === 0 && !err && <span className="su-hint">{tr('같은 계정에 참모가 있는 다른 기기가 없어요', 'No other device with Chammo on this account')}</span>}
        {!list && <span className="su-hint">{tr('찾는 중…', 'Looking…')}</span>}
      </div>
      {note && <span className="su-hint">{note}</span>}
      {err && <div className="su-error">{err}</div>}
    </section>
  );
}
