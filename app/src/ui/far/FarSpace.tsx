// 다른 기기 보기(peer-panel) 오른쪽 스페이스 — 그 기기 홈(결정 대기 → 참모 → 맡긴 세션)·세션 엿보기(읽기 전용)·보관함(목록만)
import { useMemo, useState } from 'react';
import { remoteApi, remoteCardAnswer, type RemoteDevice } from '../../data/remote';
import type { FarDot, FarSession } from '../../domain/farHome';
import type { RemoteCard } from '../../domain/remoteCards';
import { josa, tr } from '../../i18n';
import { OrchAvatar, orchColor } from '../avatar';
import { ChatView } from '../chat/ChatView';
import { DirectCardView, type DirectPick } from '../chat/DirectCard';
import { IconBack, IconFolder, IconHome, IconRefresh } from '../Icons';
import type { FarData, FarTarget } from './Far';
import { avState } from './FarParts';
import { seenName } from '../../domain/session';

const size = (b: number) => (b < 1024 ? `${b}B` : b < 1024 * 1024 ? `${Math.round(b / 1024)}KB` : `${(b / 1024 / 1024).toFixed(1)}MB`);
const when = (ms: number) => {
  if (!ms) return '';
  const d = new Date(ms);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? d.toTimeString().slice(0, 5) : `${d.getMonth() + 1}/${d.getDate()}`;
};
const ext = (name: string) => (name.includes('.') ? name.split('.').pop()!.slice(0, 4).toUpperCase() : '');
const dotCls = (d: FarDot) => `far-dot d-${d}`;

/** 오른쪽 스페이스 — 그 기기 홈(결정 대기 → 참모 → 맡긴 세션) · 보관함(목록만) */
export function FarSpace({ t, data, status, cards, onAgent, agent, fontSize }: {
  t: FarTarget; data: FarData; status: RemoteDevice | undefined; cards: RemoteCard[]; agent: string | null;
  onAgent: (a: FarSession) => void; fontSize?: number;
}) {
  const [tab, setTab] = useState<'home' | 'locker'>('home');
  // 세션 줄을 누르면 그 세션 대화(읽기 전용) — 말은 그 기기 참모에게(프로젝트 세션에 바로 치는 사람 길은 없다)
  const [peek, setPeek] = useState<FarSession | null>(null);
  const { home, err, locker } = data;
  const nameOf = (id: string | null) => home?.assistants.find((a) => a.id === id)?.name ?? tr('맡긴 참모 없음', 'No assistant');
  const answer = (id: string, pick: DirectPick) => remoteCardAnswer(t.dev)(id, pick);
  const os = status?.os ? (/win/i.test(status.os) ? tr('윈도우', 'Windows') : tr('맥', 'Mac')) : '';
  const cut = !!err && !home;
  return (
    <div className="far-space">
      <div className="far-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'home'} className={tab === 'home' ? 'on' : ''} onClick={() => setTab('home')} aria-label={tr(`${t.name} 홈`, `${t.name} home`)} title={tr(`${t.name} 홈`, `${t.name} home`)}><IconHome /></button>
        <button role="tab" aria-selected={tab === 'locker'} className={tab === 'locker' ? 'on' : ''} onClick={() => setTab('locker')} aria-label={tr('보관함', 'Files')} title={tr('보관함', 'Files')}><IconFolder /></button>
      </div>
      {peek && peek.sessionId ? (
        <div className="far-peek">
          <div className="far-peek-head"><button className="ib" aria-label={tr('뒤로', 'Back')} title={tr('뒤로', 'Back')} onClick={() => setPeek(null)}><IconBack /></button><b>{peek.name}</b><span className="far-ro">{tr('읽기 전용', 'Read-only')}</span></div>
          <FarPeek dev={t.dev} s={peek} fontSize={fontSize} />
        </div>
      ) : cut ? (
        <div className="far-empty">
          <b>{tr(`${t.name}에 안 닿아요`, `Can't reach ${t.name}`)}</b>
          <span>{tr('그 기기의 Chammo 가 꺼졌거나 잠자기예요. 켜지면 저절로 이어져요', 'Chammo on that device is off or asleep. It reconnects on its own')}</span>
          <button className="ib line" aria-label={tr('다시 시도', 'Try again')} title={tr('다시 시도', 'Try again')} onClick={data.again}><IconRefresh /></button>
        </div>
      ) : tab === 'home' ? (
        <div className="far-main">
          <div className="far-h1"><b>{t.name}</b><span>{[os, tr('연결됨', 'Connected'), status?.version].filter(Boolean).join(' · ')}</span></div>
          {cards.length > 0 && (
            <div className="far-cards">
              {cards.map((c) => <DirectCardView key={c.card.id} c={c.card} name={c.name} onAnswer={answer} />)}
            </div>
          )}
          {!home && <span className="far-muted">{tr('읽는 중…', 'Loading…')}</span>}
          {home && (
            <>
              <section>
                <h3>{tr(`참모 ${home.assistants.length}`, `Assistants ${home.assistants.length}`)}</h3>
                <div className="far-orchs">
                  {home.assistants.map((a) => (
                    <button key={a.id} className={`far-orch ${agent === a.id ? 'on' : ''}`} style={{ ['--c' as string]: orchColor(a.name) }} onClick={() => onAgent(a)}>
                      <OrchAvatar name={a.name} size={32} state={avState(a.dot)} color={orchColor(a.name)} label={seenName(a.name)} />
                      <span className="far-tx"><b>{seenName(a.name)}</b><span>{a.doing || (a.dot === 'rest' ? tr('쉼', 'Resting') : '')}</span></span>
                      <i className={dotCls(a.dot)} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h3>{tr(`세션 ${home.groups.reduce((n, g) => n + g.sessions.length, 0)}`, `Sessions ${home.groups.reduce((n, g) => n + g.sessions.length, 0)}`)}</h3>
                {home.groups.length === 0 && <span className="far-muted">{tr('지금 도는 세션이 없어요', 'No sessions running')}</span>}
                {home.groups.length > 0 && (
                  <div className="far-rows">
                    {home.groups.map((g) => (
                      <div key={g.owner ?? '-'} className="far-group">
                        <div className="far-row head"><OrchAvatar name={nameOf(g.owner)} size={20} state="rest" color={orchColor(nameOf(g.owner))} label={nameOf(g.owner)} /><b>{nameOf(g.owner)}</b><span className="far-muted">{tr(`맡긴 세션 ${g.sessions.length}`, `${g.sessions.length} sessions`)}</span></div>
                        {g.sessions.map((s) => (
                          <button key={s.id} className="far-row sub" onClick={() => { setTab('home'); setPeek(s); }} disabled={!s.sessionId}>
                            <i className={dotCls(s.dot)} aria-hidden="true" /><b>{s.name}</b><span className="far-doing">{s.doing}</span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      ) : (
        <FarLockerView name={t.name} locker={locker} />
      )}
    </div>
  );
}

const noop = () => {};
/** 그 기기 프로젝트 세션 대화 — 읽기만(입력칸 없음) */
function FarPeek({ dev, s, fontSize }: { dev: string; s: FarSession; fontSize?: number }) {
  const api = useMemo(() => remoteApi(dev), [dev]);
  return (
    <div className="pane headless far-peek-chat">
      <ChatView remote readOnly readFn={api.readTranscript} fontSize={fontSize} sessionId={s.sessionId} state={s.dot === 'run' ? 'working' : 'idle'} send={noop}
        interrupt={noop} onTerminal={noop} submitTerminal={noop} pasteImage={noop} clearTerminal={noop} sendQueuedNow={noop} paneId={`far:${dev}:${s.id}`} />
    </div>
  );
}

function FarLockerView({ name, locker }: { name: string; locker: FarData['locker'] }) {
  if (locker === null) return <div className="far-main"><span className="far-muted">{tr('읽는 중…', 'Loading…')}</span></div>;
  if (locker === 'old') return <div className="far-empty"><b>{tr(`${josa(name, '을', '를')} 업데이트해야 보여요`, `Update ${name} to see its files`)}</b><span>{tr('그 기기 판은 보관함 보기 전이에요. 채팅·세션은 지금도 돼요', 'That device is on an older version. Chat and sessions still work')}</span></div>;
  if (locker === 'off') return <div className="far-empty"><b>{tr(`${name}에서 보관함 보여 주기를 껐어요`, `${name} turned off sharing its files`)}</b><span>{tr('그 기기 설정 > 기기 관리의 연결된 기기 줄에서 켤 수 있어요', 'Turn it on in that device’s Settings > Devices, on the connected-device row')}</span></div>;
  if (locker === 'err') return <div className="far-empty"><b>{tr('보관함을 못 읽었어요', 'Couldn’t read the files')}</b></div>;
  return (
    <div className="far-main">
      <div className="far-h1"><b>{tr('보관함', 'Files')}</b><span className="far-ro">{tr('읽기 전용', 'Read-only')}</span></div>
      {locker.length === 0 && <span className="far-muted">{tr('보관함이 비어 있어요', 'No files')}</span>}
      <div className="far-rows">
        {locker.map((o) => (
          <div key={o.owner} className="far-group">
            <div className="far-row head"><OrchAvatar name={o.owner} size={20} state="rest" color={orchColor(o.owner)} label={seenName(o.owner)} /><b>{seenName(o.owner)}</b><span className="far-muted">{tr(`파일 ${o.files.length}`, `${o.files.length} files`)}</span></div>
            {o.files.map((f) => (
              <div key={f.rel} className="far-row sub file" title={f.rel}>
                <span className="far-ext">{ext(f.name)}</span><b>{f.name}</b>{f.folder && <span className="far-muted">{f.folder}</span>}<span className="far-sp" /><span className="far-t">{`${size(f.size)} · ${when(f.mtime)}`}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <span className="far-muted small">{tr(`파일 열기는 다음 판에서 — 지금은 ${name} 참모에게 "그 파일 보여 줘"라고 하면 그 기기 앱에 떠요`, `Opening files comes later — ask the assistant on ${name} to show it there`)}</span>
    </div>
  );
}

/** ⌘1~9·⌘⇧D 를 App 단축키가 넘긴다 — 그 기기를 보는 중이면 ⌘N 은 그 기기 N번째 참모 */
